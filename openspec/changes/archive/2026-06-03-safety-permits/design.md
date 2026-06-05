# Design: Safety & Permits (PTW + LOTO)

## Technical Approach

Single migration (`20260527000001_safety_permits.sql`) con toda la lógica en PostgreSQL. Sin edge functions, sin frontend. El servidor **valida** transiciones FSM vía triggers `BEFORE UPDATE`, **NUNCA** crea registros automáticamente (Client-Driven). La aplicación cliente orquesta los cambios de estado; la BD rechaza transiciones inválidas con `RAISE EXCEPTION`.

El orden de ejecución dentro de la migración es: ENUMs → alter role CHECK → tablas → índices → triggers `updated_at` → triggers FSM → audit triggers → RLS → seed data. Esto asegura que cada sección tiene sus dependencias creadas antes de usarse.

## Architecture Decisions

### Decision: ENUMs sobre CHECK constraints

| Option | Tradeoff | Decision |
|--------|----------|----------|
| **PostgreSQL ENUM** | Validación nativa, los valores se ven en `\dT`, imposible asignar valores inválidos. DDL pesado (ALTER TYPE...ADD VALUE requiere evitar locks). | ✅ **Chosen** |
| CHECK con TEXT | Más flexible (no requiere DDL para nuevos valores), pero sin tipado fuerte y no se refleja en el schema del sistema. | Rejected |

**Rationale**: Los FSM tienen conjuntos de estados fijos y acotados (7 y 4 valores respectivamente). No se esperan cambios frecuentes. El tipado fuerte del ENUM evita que el cliente mande strings inválidos incluso antes de llegar al trigger FSM. `device_type` también es un dominio cerrado (LOCK/TAG/HASPS/CHAIN). Para valores que sí pueden crecer (ej: tipos de permiso), usamos una tabla catálogo (`permit_types`) en lugar de ENUM.

### Decision: Client-Driven FSM (NO auto-triggers)

| Option | Tradeoff | Decision |
|--------|----------|----------|
| **Cliente UPDATE → trigger valida** | El cliente orquesta el cambio de estado, la BD solo rechaza transiciones inválidas. Sin auto-creación, sin duplicados. | ✅ **Chosen** |
| Trigger automático que crea/transiciona | Riesgo de duplicados en offline-first, la BD no conoce la intención del usuario. | Rejected |

**Rationale**: Misma filosofía que labor-reporting. El cliente sabe qué transición quiere hacer. La BD valida que sea permitida. Si un trigger automático creara registros, en un contexto offline-first (RxDB) podrían generarse duplicados al sincronizar. Ejemplo: cliente cambia REQUESTED→APPROVED, trigger también crea una línea de auditoría duplicada.

### Decision: Auto-expiry como BEFORE UPDATE (NO schedule job)

| Option | Tradeoff | Decision |
|--------|----------|----------|
| **BEFORE UPDATE trigger con auto-expiry** | Se ejecuta solo cuando alguien toca el registro. No consume recursos si nadie consulta. No requiere cron/pg_cron. | ✅ **Chosen** |
| pg_cron job periódico | Expira permisos incluso si nadie los consulta, pero agrega dependencia externa y latencia de hasta minutos. | Rejected |
| CHECK constraint con expires_at | No puede cambiar el estado automáticamente, solo rechazar escrituras. | Rejected |

**Rationale**: `fn_permit_auto_expiry()` corre en el mismo `BEFORE UPDATE` que el FSM, pero ANTES. Si el permiso está ACTIVE, `expires_at` ya pasó, y el usuario NO está cambiando `permit_status` explícitamente → se setea EXPIRED. Esto asegura que cualquier interacción con un permiso vencido lo expire automáticamente sin necesidad de infraestructura externa.

**Orden de triggers en work_permits**:
1. `trg_permit_auto_expiry` (BEFORE UPDATE) — primero, porque si auto-expira, el FSM debe validar contra EXPIRED
2. `trg_work_permits_updated_at` (BEFORE UPDATE) — siempre actualiza timestamp
3. `trg_validate_permit_fsm` (BEFORE UPDATE) — después de auto-expiry, valida la transición solicitada

### Decision: Regla de dos personas en el trigger LOTO (NO capa aplicación)

| Option | Tradeoff | Decision |
|--------|----------|----------|
| **Trigger valida verified_by != locked_by** | Regla de seguridad crítica enforceable a nivel BD. Ningún cliente puede esquivarla. | ✅ **Chosen** |
| Validación solo en frontend | Cliente malicioso o bug puede saltarla. En seguridad industrial, esto no es aceptable. | Rejected |

**Rationale**: La regla de dos personas es un requisito de seguridad ocupacional (OSHA/NFPA 70E). Debe estar enforced en la BD porque es un invariante del dominio, no una conveniencia de UI.

### Decision: Audit triggers reutilizan función existente (NO tabla separada)

| Option | Tradeoff | Decision |
|--------|----------|----------|
| **Reutilizar `audit_trigger_func()` de migración 1** | Consistente con el resto del sistema. Sin duplicación. | ✅ **Chosen** |
| Audit table específica para safety | Agrega complejidad innecesaria. El requirement de trazabilidad es el mismo que en otras tablas. | Rejected |

### Decision: CHECK constraint gas_test_result (NO ENUM)

| Option | Tradeoff | Decision |
|--------|----------|----------|
| **CHECK ('PASS','FAIL', NULL)** | Dominio cerrado de 2 valores + NULL. No justifica un ENUM separado. | ✅ **Chosen** |
| `gas_test_result` ENUM | Overkill para 2 valores. | Rejected |

## FSM Transition Tables

### PTW — Estados terminales

REQUESTED, APPROVED y ACTIVE son estados "vivos". COMPLETED, REJECTED, CANCELLED y EXPIRED son terminales — no hay transición saliente. Esto simplifica el modelo mental: un permiso se crea, progresa, y termina en un estado final irreversible.

### LOTO — Forward-only estricto

PLANNED es el único estado inicial. Una vez que se avanza a LOCKED, no se puede volver atrás. VERIFIED y REMOVED son estados terminales. La regla de dos personas solo aplica en LOCKED→VERIFIED porque es el punto donde se confirma que el aislamiento de energía es seguro.

### Gas Test Gate

El campo `gas_test_required` en `work_permits` permite al cliente indicar si este permiso en particular requiere prueba de gas (independientemente de lo que diga `permit_types.requires_gas_test`). El trigger verifica: `IF NEW.gas_test_required AND (NEW.gas_test_result IS NULL OR NEW.gas_test_result != 'PASS') THEN RAISE`. Esto significa que si `gas_test_required=false`, el gate no se aplica.

## Data Flow

```
Cliente (futuro):
  INSERT work_permits(status=REQUESTED)
    → RLS verifica rol PLANNER/ADMIN/SAFETY_OFFICER
    → trigger updated_at setea created_at, updated_at
    → audit registra INSERT

  UPDATE work_permits SET status=APPROVED, approved_by=...
    → auto-expiry check (no aplica, status cambió)
    → trigger updated_at
    → trg_validate_permit_fsm: REQUESTED→APPROVED, requiere approved_by
    → audit registra UPDATE

  UPDATE work_permits SET status=ACTIVE (con gas_test_result=PASS si requiere)
    → auto-expiry check (no aplica, status cambió)
    → trigger updated_at
    → trg_validate_permit_fsm: APPROVED→ACTIVE, verifica gas_test, setea issued_at+expires_at
    → audit registra UPDATE

  UPDATE work_permits SET status=COMPLETED
    → auto-expiry check (no aplica, status cambió)
    → trigger updated_at
    → trg_validate_permit_fsm: ACTIVE→COMPLETED, setea completed_at
    → audit registra UPDATE

  UPDATE work_permits SET description='...' (permiso ACTIVE vencido)
    → trg_permit_auto_expiry: status no cambió, NOW() > expires_at → status=EXPIRED
    → trigger updated_at
    → trg_validate_permit_fsm: OLD=ACTIVE, NEW=EXPIRED ✅ transición válida
    → audit registra UPDATE

LOTO (similar, con su propio FSM):
  INSERT lockout_tagout(status=PLANNED)
  UPDATE SET status=LOCKED
  UPDATE SET status=VERIFIED, verified_by=... (distinto de locked_by)
  UPDATE SET status=REMOVED, removed_by=...
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/20260527000001_safety_permits.sql` | Create | 717 líneas: 3 ENUMs, alter user_profiles, 5 tablas + índices, updated_at triggers, FSM triggers PTW+LOTO, audit triggers, RLS (25 policies), seed data |
| `supabase/tests/database/safety_permits_test.sql` | Create | 50 pgTAP tests: Schema (20), PTW FSM (10), LOTO FSM (8), RLS (8), Cascade (4) |

## Interfaces

### ENUMs

```sql
CREATE TYPE permit_status AS ENUM (
  'REQUESTED', 'APPROVED', 'ACTIVE', 'COMPLETED',
  'REJECTED', 'CANCELLED', 'EXPIRED'
);

CREATE TYPE loto_status AS ENUM (
  'PLANNED', 'LOCKED', 'VERIFIED', 'REMOVED'
);

CREATE TYPE device_type AS ENUM (
  'LOCK', 'TAG', 'HASPS', 'CHAIN'
);
```

### permit_types (catálogo)

```sql
CREATE TABLE permit_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  requires_isolation BOOLEAN NOT NULL DEFAULT false,
  requires_gas_test BOOLEAN NOT NULL DEFAULT false,
  validity_hours INT NOT NULL DEFAULT 8 CHECK (validity_hours > 0),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### work_permits (PTW)

```sql
CREATE TABLE work_permits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  permit_type_id UUID NOT NULL REFERENCES permit_types(id),
  work_order_id TEXT REFERENCES work_orders(id),
  asset_id TEXT REFERENCES assets(id),
  permit_status permit_status NOT NULL DEFAULT 'REQUESTED',
  requested_by UUID NOT NULL REFERENCES user_profiles(id),
  approved_by UUID REFERENCES user_profiles(id),
  issued_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  isolation_required BOOLEAN NOT NULL DEFAULT false,
  gas_test_required BOOLEAN NOT NULL DEFAULT false,
  gas_test_result TEXT CHECK (gas_test_result IN ('PASS','FAIL') OR gas_test_result IS NULL),
  description TEXT NOT NULL,
  location TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_expires_after_issued CHECK (expires_at IS NULL OR issued_at IS NULL OR expires_at > issued_at)
);
```

### permit_tasks

```sql
CREATE TABLE permit_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_permit_id UUID NOT NULL REFERENCES work_permits(id) ON DELETE CASCADE,
  step_sequence INT NOT NULL CHECK (step_sequence > 0),
  task_description TEXT NOT NULL,
  is_precaution BOOLEAN NOT NULL DEFAULT false,
  completed BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(work_permit_id, step_sequence)
);
```

### lockout_tagout (LOTO)

```sql
CREATE TABLE lockout_tagout (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_permit_id UUID REFERENCES work_permits(id),
  work_order_id TEXT REFERENCES work_orders(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  loto_status loto_status NOT NULL DEFAULT 'PLANNED',
  description TEXT NOT NULL,
  locked_by UUID NOT NULL REFERENCES user_profiles(id),
  locked_at TIMESTAMPTZ,
  verified_by UUID REFERENCES user_profiles(id),
  verified_at TIMESTAMPTZ,
  removed_by UUID REFERENCES user_profiles(id),
  removed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_verified_after_locked CHECK (verified_at IS NULL OR locked_at IS NULL OR verified_at >= locked_at),
  CONSTRAINT chk_removed_after_verified CHECK (removed_at IS NULL OR verified_at IS NULL OR removed_at >= verified_at)
);
```

### tagout_devices

```sql
CREATE TABLE tagout_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lockout_tagout_id UUID NOT NULL REFERENCES lockout_tagout(id) ON DELETE CASCADE,
  device_type device_type NOT NULL,
  device_id TEXT NOT NULL,
  device_label TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### FSM Trigger Functions (inline en migration)

- **`fn_permit_auto_expiry()`** (BEFORE UPDATE ON work_permits): Si `OLD.permit_status='ACTIVE'`, `NEW.permit_status` no cambió, y `NOW() > OLD.expires_at` → setea `NEW.permit_status='EXPIRED'`. Corre ANTES que `fn_validate_permit_fsm()`.
- **`fn_validate_permit_fsm()`** (BEFORE UPDATE ON work_permits): Valida transiciones PTW vía `CASE`. Setea `issued_at`, `expires_at` (desde `permit_types.validity_hours`), `completed_at`. Rechaza transiciones inválidas con `RAISE EXCEPTION 'Transición inválida...'`.
- **`fn_validate_loto_fsm()`** (BEFORE UPDATE ON lockout_tagout): Valida transiciones LOTO vía `CASE`. Setea `locked_at`, `verified_at`, `removed_at`. Aplica regla de dos personas en LOCKED→VERIFIED.
- **`set_safety_updated_at()`** (BEFORE UPDATE ON work_permits, lockout_tagout): Setea `NEW.updated_at = NOW()`. Reutilizada en ambas tablas.

## Testing Strategy

| Layer | What | How |
|-------|------|-----|
| DB — Schema | Existencia de tablas, ENUMs con valores correctos, FKs, defaults, CHECKs | pgTAP tests 1-20 (has_table, has_type, enum_range, col_is_fk, col_type_is, col_has_default) |
| DB — PTW FSM | Lifecycle completo, backward rejected, gas test gate, auto-expiry, invalid ENUM value | pgTAP tests 21-29 (UPDATE + SELECT is/throws_ok con SAVEPOINT rollback por escenario) |
| DB — LOTO FSM | Lifecycle completo, skip verification rejected, two-person rule (fail + pass), backward rejected, invalid ENUM value | pgTAP tests 30-37 (mismo patrón) |
| DB — RLS | Cada rol con su permiso esperado sobre work_permits | pgTAP tests 38-45 (SET LOCAL ROLE + request.jwt.claim.sub, INSERT/SELECT/UPDATE/DELETE) |
| DB — Cascade | DELETE work_permit → permit_tasks, DELETE lockout_tagout → tagout_devices | pgTAP tests 46-47 (COUNT antes/después del DELETE) |

## Migration Plan

1. Ejecutar `supabase/migrations/20260527000001_safety_permits.sql` (orden: ENUMs → alter user_profiles → tablas → índices → triggers → RLS → seed)
2. Ejecutar pgTAP tests: `supabase db test --file supabase/tests/database/safety_permits_test.sql`
3. No hay data migration (tablas nuevas vacías)
4. Rollback: DROP tablas (CASCADE), DROP ENUMs, restaurar CHECK de `user_profiles`
