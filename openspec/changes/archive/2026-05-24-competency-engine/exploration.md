## Exploration: GEMA Competency Engine

### Current State

**El codebase NO tiene tracking de competencias.** No hay skills, no hay niveles de proficiencia, no hay matrices de competencia. Todo está por construir.

**NO existen checklists.** El flujo de ejecución del mecánico (WorkOrderDrawer) captura notas de texto libre (symptom_note, cause_note, action_note) pero NO tiene checklists estructurados con bloques A (Seguridad), B (Ejecución), C (Precisión). Las checklists son un concepto nuevo — el competency engine debe diseñarse para RECIBIR resultados de checklists sin definirlos.

**NO existen módulos tecnológicos.** El concepto de M-PACK, M-TRAN, M-ELEC, M-REFR, M-VAPO, M-CAL no existe en assets. `asset_types` es un catálogo genérico (id + name) sin relación a módulos.

**Relevant existing schema:**

| Tabla | Relevancia para Competency Engine |
|-------|----------------------------------|
| `assets` | Activos que pertenecen a módulos tecnológicos — necesita `module_id` FK nueva |
| `asset_types` | Catálogo genérico — podría mapearse a módulos pero no es suficiente |
| `work_orders` | Tiene `asset_id` y `job_plan_id` — cadena de trazabilidad: WO → asset → module |
| `job_plans` | Plantillas de trabajo — necesitan `skill_requirements` (nivel mínimo requerido) |
| `job_plan_tasks` | Tareas secuenciadas del plan — sin relación a skills |
| `pm_schedules` | Programación PM — se cruza con skill_requirements para gap analysis predictivo |
| `labor_records` | **Única conexión existente** entre technician + WO (technician_id + work_order_id) |
| `user_profiles` | Roles: TECHNICIAN/PLANNER/ADMIN/STOREKEEPER/SAFETY_OFFICER — sin datos de skill |
| `audit_logs` | Auditoría genérica reusable para todas las tablas nuevas |

**Existing patterns that must be followed:**

1. **FSM triggers**: BEFORE UPDATE, forward-only linear transitions (validate_lifecycle_fsm, fn_validate_permit_fsm)
2. **RLS**: get_user_role() helper, one policy per role per operation
3. **Audit**: generic audit_trigger_func() attached via trigger
4. **Naming**: snake_case, UUID PKs, gen_random_uuid(), COMMENT ON TABLE/COLUMN
5. **Client-driven**: server validates, NEVER auto-creates records (labor-reporting pattern)
6. **RxDB**: collections with manual pull/push replication, Dexie storage
7. **Migrations**: Supabase format YYYYMMDDHHMMSS_descriptive_name.sql
8. **Tests**: pgTAP (BEGIN/ROLLBACK, SAVEPOINT, is(), throws_ok())

---

### Affected Areas

#### Database (New Migration)

| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/202605<next>_competency_engine.sql` | **NEW** | 6 tablas: skills, proficiency_levels, technician_skills, skill_requirements, technician_skill_evidence, skill_gap_alerts. FKs, RLS, FSM trigger para candado de asignación, trigger de recálculo dinámico, gap analysis function. |
| `supabase/migrations/202605<prev>_technological_modules.sql` | **NEW** (previo o incluido) | Tabla technological_modules + module_id en assets. Seed data: M-PACK, M-TRAN, M-ELEC, M-REFR, M-VAPO, M-CAL. |

#### Database Tests

| File | Action | Description |
|------|--------|-------------|
| `supabase/tests/database/competency_engine_test.sql` | **NEW** | pgTAP: schema constraints, trigger recálculo, candado asignación, RLS, gap analysis query |

#### Backend / Frontend

| File | Action | Description |
|------|--------|-------------|
| `src/lib/rxdb.js` | **MODIFY** | Add collections: skills, technician_skills, skill_requirements, technician_skill_evidence. Add replication handlers. |
| `src/hooks/useCompetencyEngine.js` | **NEW** | RxDB hook: technicianSkills, skillMatrix, recalculateLevel(), getGapAlerts() |
| `src/components/planner/TechnicianSkillMatrix.jsx` | **NEW** | Matriz visual: técnicos × módulos, niveles coloreados, evidencia expandible |
| `src/components/planner/SkillGapDashboard.jsx` | **NEW** | Dashboard de gaps predictivos: cruza pm_schedules × skill_requirements |
| `src/components/planner/TechnicianSkillDetail.jsx` | **NEW** | Detalle de evidencia: qué checklists/WOs contribuyeron al nivel |
| `src/components/mechanic/WorkOrderDrawer.jsx` | **MODIFY** | Candado de asignación: validar nivel antes de permitir APPROVED→INPRG |
| `src/components/mechanic/WorkOrderActions.jsx` | **MODIFY** | Botón deshabilitado con tooltip si no cumple nivel requerido |
| `src/pages/PlannerDashboard.jsx` | **MODIFY** | Agregar pestaña/sección de Competency Matrix y Gap Analysis |
| `src/lib/adapters/competencyAdapter.js` | **NEW** | RxDB doc → ViewModel mapper |

---

### Approaches

#### Approach 1: technician_crafts estático (asignación manual de oficio)

**Description**: Una tabla `technician_crafts` donde al técnico se le asigna un oficio (Electricista, Mecánico, Instrumentista, etc.) de forma manual. No hay niveles, no hay cálculo. La asignación de OT se hace por oficio.

**Schema:**
```sql
CREATE TABLE crafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,       -- ELECTRICIAN, MECHANIC, INSTRUMENTIST
  name TEXT NOT NULL,
  description TEXT
);

CREATE TABLE technician_crafts (
  technician_id UUID NOT NULL REFERENCES user_profiles(id),
  craft_id UUID NOT NULL REFERENCES crafts(id),
  is_primary BOOLEAN DEFAULT false,
  UNIQUE(technician_id, craft_id)
);
```

**Pros:**
- Mínima implementación — 2 tablas, sin triggers, sin recálculo
- No depende de checklists (no existen aún)
- Fácil de entender para usuarios familiarizados con oficios tradicionales
- Sin complejidad técnica

**Cons:**
- **NO mide competencia real** — un Electricista con 30 años y uno con 1 mes tienen el mismo craft
- No hay niveles — no se puede distinguir entre "puede ayudar" y "puede liderar"
- No hay evidencia — no se sabe en qué se basa la asignación
- No detecta gaps — no hay forma de saber si faltan técnicos calificados para trabajos futuros
- Sigue siendo subjetivo (asignación manual del supervisor)
- No aprovecha los datos operativos (checklists, WOs) que el CMMS ya genera

**Effort**: Low (~1-2 días)

---

#### Approach 2: Skills matrix con niveles manuales (supervisor asigna)

**Description**: Similar a Maximo HSE Competency Management. Tabla `skills` (módulos tecnológicos), tabla `technician_skills` con nivel asignado por supervisor (1-5). El supervisor revisa periódicamente y actualiza los niveles.

**Schema:**
```sql
CREATE TABLE skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,       -- M-PACK, M-TRAN, etc.
  name TEXT NOT NULL
);

CREATE TABLE proficiency_levels (
  level INT PRIMARY KEY CHECK (level BETWEEN 1 AND 5),
  name TEXT NOT NULL,              -- Awareness, Assisted, etc.
  description TEXT
);

CREATE TABLE technician_skills (
  technician_id UUID NOT NULL REFERENCES user_profiles(id),
  skill_id UUID NOT NULL REFERENCES skills(id),
  assigned_level INT NOT NULL REFERENCES proficiency_levels(level),
  assigned_by UUID NOT NULL REFERENCES user_profiles(id),
  assessed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(technician_id, skill_id)
);
```

**Pros:**
- Más granular que Approach 1 (5 niveles vs 1 craft)
- Sigue el estándar de la industria (Maximo HSE, SAP PM)
- Independiente de checklists (no existen aún)
- Relativamente simple de implementar
- Permite candado de asignación básico

**Cons:**
- **Subjetivo** — basado en opinión del supervisor, no en datos objetivos
- **Estático** — el nivel no se actualiza automáticamente, requiere revisión manual periódica
- **SIN evidencia** — no hay trail de qué work justifica el nivel
- **Admin burden** — el supervisor debe evaluar y actualizar constantemente
- **No predictivo** — no puede anticipar gaps de competencia
- **Desconectado de las OTs** — el nivel no refleja el trabajo real del técnico
- El técnico puede estar en nivel 4 pero no haber tocado ese equipo en 6 meses

**Effort**: Medium (~3-4 días)

---

#### Approach 3: GEMA Dynamic Engine ⭐

**Description**: Los niveles se CALCULAN automáticamente desde los resultados de checklists que el técnico completa en cada WO. Cada checklist tiene bloques (A=Seguridad, B=Ejecución, C=Precisión). Cuando un técnico pasa consistentemente bloques en equipos de un módulo tecnológico, su nivel para ese módulo sube automáticamente.

**Los 5 niveles calculados:**

| Level | Name | Cómo se alcanza |
|-------|------|-----------------|
| 1 | Awareness | Ha leído los LUPs (procedimientos) del módulo |
| 2 | Assisted | Ha pasado Bloque A (Seguridad) en checklists del módulo |
| 3 | Independent | Ha pasado Bloque B (Ejecución) consistentemente en 5+ WOs del módulo |
| 4 | Specialist | Ha desbloqueado y pasado Bloque C (Precisión) en reparaciones complejas |
| 5 | Master/Trainer | Ha creado o actualizado 3+ LUPs/SOPs aprobados del módulo |

**Schema completo:**

```sql
-- Módulos tecnológicos (catálogo)
CREATE TABLE technological_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,        -- M-PACK, M-TRAN, M-ELEC, M-REFR, M-VAPO, M-CAL
  name TEXT NOT NULL,               -- Empaque, Transporte, Eléctrico, Refrigeración, Vapor, Calderas
  description TEXT
);

-- ALTER TABLE assets ADD COLUMN module_id UUID REFERENCES technological_modules(id);

-- Skills = módulos tecnológicos (1:1 con technological_modules)
CREATE TABLE skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID UNIQUE NOT NULL REFERENCES technological_modules(id),
  code TEXT UNIQUE NOT NULL,        -- SKL-M-PACK, SKL-M-TRAN, etc.
  description TEXT
);

-- Los 5 niveles (catálogo fijo)
CREATE TABLE proficiency_levels (
  level INT PRIMARY KEY CHECK (level BETWEEN 1 AND 5),
  name TEXT NOT NULL,               -- Awareness, Assisted, Independent, Specialist, Master
  trigger_description TEXT NOT NULL, -- qué condición activa este nivel
  trigger_condition JSONB NOT NULL   -- condiciones estructuradas para evaluación programática
);

-- Junction: técnico × skill × nivel calculado
CREATE TABLE technician_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id UUID NOT NULL REFERENCES user_profiles(id),
  skill_id UUID NOT NULL REFERENCES skills(id),
  current_level INT NOT NULL REFERENCES proficiency_levels(level) DEFAULT 1,
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  last_updated_by_wo_id TEXT REFERENCES work_orders(id),
  UNIQUE(technician_id, skill_id)
);

-- Qué nivel mínimo requiere cada job_plan
CREATE TABLE skill_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_plan_id UUID NOT NULL REFERENCES job_plans(id),
  skill_id UUID NOT NULL REFERENCES skills(id),
  minimum_level INT NOT NULL REFERENCES proficiency_levels(level),
  UNIQUE(job_plan_id, skill_id)
);

-- Evidencia: qué checklists/WOs contribuyeron al nivel
CREATE TABLE technician_skill_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_skill_id UUID NOT NULL REFERENCES technician_skills(id),
  work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  checklist_block TEXT NOT NULL CHECK (checklist_block IN ('A', 'B', 'C')),
  passed BOOLEAN NOT NULL,
  evaluated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Alertas de gap predictivo
CREATE TABLE skill_gap_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id UUID NOT NULL REFERENCES skills(id),
  projected_hours_next_period NUMERIC,
  available_technicians_at_level INT,
  alert_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Trigger de recálculo dinámico:**

```sql
-- Cuando se inserta/actualiza evidencia, recalcular el nivel
CREATE OR REPLACE FUNCTION recalculate_technician_level()
RETURNS TRIGGER AS $$
BEGIN
  -- Obtener el technician_skill_id y el work_order_id
  -- Revisar condiciones para cada nivel:
  -- Level 2 (Assisted): pasó Bloque A en algún checklist del módulo
  -- Level 3 (Independent): pasó Bloque B en 5+ WOs distintas
  -- Level 4 (Specialist): pasó Bloque C
  -- Level 5 (Master): creó LUPs (trigger externo desde SOP system)
  
  -- UPDATE technician_skills SET current_level = <calculated> ...
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

**Candado de asignación (FSM trigger en work_orders):**

```sql
CREATE OR REPLACE FUNCTION validate_assignment_competency()
RETURNS TRIGGER AS $$
DECLARE
  v_min_level INT;
  v_tech_level INT;
BEGIN
  -- Solo validar en transición APPROVED → INPRG (asignación a técnico)
  IF OLD.lifecycle_phase = 'APPROVED' AND NEW.lifecycle_phase = 'INPRG' THEN
    -- Obtener mínimo nivel requerido para el job_plan de esta WO
    SELECT sr.minimum_level INTO v_min_level
    FROM work_orders wo
    JOIN skill_requirements sr ON sr.job_plan_id = wo.job_plan_id
    WHERE wo.id = NEW.id;
    
    -- Obtener nivel actual del técnico
    SELECT ts.current_level INTO v_tech_level
    FROM technician_skills ts
    WHERE ts.technician_id = auth.uid()
      AND ts.skill_id IN (
        SELECT sr.skill_id FROM work_orders wo
        JOIN skill_requirements sr ON sr.job_plan_id = wo.job_plan_id
        WHERE wo.id = NEW.id
      );
    
    IF v_tech_level < v_min_level THEN
      RAISE EXCEPTION 'El técnico no cumple el nivel mínimo requerido (%) para esta OT', v_min_level;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

**Gap Analysis predictivo:**

```sql
CREATE OR REPLACE FUNCTION predict_skill_gaps()
RETURNS TABLE (
  skill_code TEXT,
  projected_hours NUMERIC,
  available_techs INT,
  gap_level TEXT
) AS $$
  -- Cruza pm_schedules futuras × skill_requirements → horas proyectadas
  -- Cuenta técnicos por nivel en cada skill
  -- Compara oferta vs demanda
  -- Genera alertas en skill_gap_alerts
$$ LANGUAGE sql;
```

**Pros:**
- **Objetivo** — niveles basados en datos reales de checklists, no en opiniones
- **Dinámico** — se actualiza automáticamente con cada checklist completado
- **Evidencia trazable** — cada nivel tiene un trail de checklists/WOs específicos
- **Predictivo** — gap analysis anticipa bottlenecks antes de que ocurran
- **Zero admin** — no requiere evaluación manual del supervisor
- **Integración natural** — aprovecha datos que el CMMS ya genera (WOs, checklists)
- **Candado real** — el sistema BLOQUEA asignación si no hay competencia suficiente
- **ISO 14224 compatible** — taxonomía de fallas + módulos tecnológicos

**Cons:**
- **Requiere checklists** — necesidad CRÍTICA: las checklists con bloques A/B/C no existen. O se implementan como parte de este cambio o el engine queda en "modo listen" hasta que existan.
- **Requiere módulos tecnológicos** — assets necesita module_id FK (nueva columna + seed data)
- **Complejidad de triggers** — el trigger de recálculo debe ser eficiente para no degradar el INSERT en checklists
- **Nivel 1 y 5 son externos** — Awareness (leer LUPs) y Master (crear SOPs/LUPs) dependen de sistemas/documentación que puede no existir aún
- **Complejidad media-alta** — 6 tablas, 2 triggers, 1 función de gap analysis, frontend de matriz y dashboard

**Dependencias críticas:**
1. `technological_modules` table + seed data + `assets.module_id` FK (nuevo)
2. Checklists con bloques A/B/C (NO EXISTE — separado o incluido)
3. SOP/LUP system (para niveles 1 y 5 — puede ser document tracking simple)
4. `work_orders` ya tiene `created_by` (technician_id) y `job_plan_id` — OK

**Effort**: High (~5-8 días schema + 4-6 días frontend = ~2 semanas total)

---

### Recommendation

**Approach 3 — GEMA Dynamic Engine** es la única opción que cumple con los objetivos de diseño:

| Criterio | Approach 1 (crafts) | Approach 2 (manual) | Approach 3 (dynamic) |
|----------|-------------------|--------------------|--------------------|
| Objetivo | ❌ Subjetivo | ❌ Subjetivo | ✅ Basado en datos |
| Dinámico | ❌ Estático | ❌ Requiere admin | ✅ Automático |
| Evidencia | ❌ Sin trail | ❌ Sin trail | ✅ Trazable |
| Predictivo | ❌ No | ❌ No | ✅ Sí |
| Candado real | ❌ Parcial | ⚠️ Básico | ✅ FSM trigger |
| Sin admin burden | ✅ | ❌ | ✅ |
| Dependencias | ✅ Mínimas | ✅ Mínimas | ⚠️ Checklists + módulos |

**Why Approach 3:**

1. **Es la innovación central del sistema.** Si vamos a tener una matriz de competencias como cualquier Maximo/SAP, no tiene sentido construirla desde cero. La ventaja competitiva de GEMA es JUSTAMENTE que los niveles emergen del trabajo diario.

2. **Candado de asignación REAL.** No es opcional — es el corazón del sistema. Si un técnico no tiene el nivel requerido, el sistema DEBE bloquear la asignación. Esto solo es posible con datos objetivos.

3. **Los datos ya existen (o existirán).** El CMMS ya genera labor_records, work_orders, assets. Las checklists están en el roadmap. Los módulos tecnológicos son parte del dominio. El competency engine solo conecta los puntos.

4. **Valor predictivo.** El gap analysis no es un lujo — en una planta con 100+ técnicos y 5000+ equipos, saber qué skills van a faltar en el próximo período PM evita paradas por falta de personal calificado.

**Scope recomendado para el cambio:**

| Componente | Incluir en v1? |
|------------|---------------|
| Tabla technological_modules + seed | ✅ SÍ |
| assets.module_id FK | ✅ SÍ |
| skills + proficiency_levels + technician_skills | ✅ SÍ |
| skill_requirements + candado FSM trigger | ✅ SÍ |
| technician_skill_evidence | ✅ SÍ (modo insert manual para data seed) |
| skill_gap_alerts + gap function | ⚠️ MVP básico (análisis semanal vía cron) |
| Trigger recálculo automático | ⚠️ MVP depende de checklists |
| Frontend matriz/skills | ⚠️ MVP: solo candado + vista básica |
| Checklists (bloques A/B/C) | ❌ NO — cambio separado pero COMPATIBLE |
| SOP/LUP system (niveles 1 y 5) | ❌ NO — trigger manual inicial |

---

### Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Checklists NO existen** — el engine necesita bloques A/B/C para recálculo automático | 🔴 CRITICAL | 1) Incluir schema mínimo de checklists en este cambio, O 2) Diseñar engine para recibir resultados via API/trigger desde sistema externo de checklists. **Recomendación: opción 2 — separación de responsabilidades.** El competency engine es un SENSOR de evidencia, no el creador de checklists. |
| **Módulos tecnológicos no existen en assets** — sin module_id, la trazabilidad WO→asset→module se rompe | 🔴 HIGH | Crear tabla technological_modules y agregar module_id a assets. Seed data obligatorio. Esta migración DEBE ser previa o parte de este cambio. |
| **Niveles 1 (Awareness) y 5 (Master) dependen de sistemas externos** — LUPs y SOPs | 🟡 MEDIUM | Nivel 1: trigger manual en technician_skills por planner cuando el técnico completa inducción. Nivel 5: trigger manual cuando se aprueba un SOP. Ambos con evidencia en technician_skill_evidence (checklist_block = 'L' para LUP, 'S' para SOP). |
| **Trigger recálculo puede ser lento** — cada checklist INSERT recalcula nivel | 🟡 MEDIUM | Usar BEFORE INSERT light (solo marca flag), y un job asíncrono (pg_cron) que procesa flags y recalcula en batch. O usar función SECURITY DEFINER con análisis de ventana. |
| **Candado de asignación bloquea trabajo real** — técnico capacitado pero sin evidencia formal no puede trabajar | 🟡 MEDIUM | Implementar bypass con aprobación de PLANNER/ADMIN. El bypass queda auditado en audit_logs. El trigger valida pero permite override con approved_by. |
| **Multi-técnico en una WO** — varios técnicos con diferentes niveles completan la misma WO | 🟢 LOW | technician_skill_evidence se asocia al técnico individual (via labor_records.technician_id). Cada técnico recibe crédito por su trabajo en la WO. |
| **Transición de oficio legacy a competency engine** — data histórica de skills no existe | 🟢 LOW | Todos los técnicos comienzan en Level 1 (Awareness) por defecto. El planner puede seedear technician_skill_evidence con WOs completadas históricamente para subir niveles iniciales. |

---

### Ready for Proposal

**Yes, con condiciones críticas.**

La exploración está completa. El orchestrator debe presentar las 3 opciones al usuario, recomendar Approach 3, y ANTES de pasar a propuesta confirmar:

**Preguntas clave al usuario:**

1. ✅ **Confirmar Approach 3** — ¿Está de acuerdo con el enfoque de niveles calculados desde checklists?

2. 🔴 **CRÍTICO — ¿Checklists existen o hay que crearlos?** — El engine necesita resultados de checklists (Bloques A/B/C). ¿Las checklists se implementan como parte de este cambio o en uno separado? Si es separado, el engine arranca en "modo semilla" donde el planner asigna niveles manualmente y el recálculo automático se activa cuando existan checklists.

3. 🔴 **CRÍTICO — Módulos tecnológicos** — ¿Confirmar los 6 módulos? M-PACK (Empaque), M-TRAN (Transporte), M-ELEC (Eléctrico), M-REFR (Refrigeración), M-VAPO (Vapor), M-CAL (Calderas). ¿Hay más?

4. **Nivel 1 y 5** — ¿Existe un sistema de LUPs/SOPs o se construye? Si no existe, los niveles 1 y 5 arrancan como triggers manuales.

5. **Checklist schema** — Si los checklists son parte del CMMS roadmap, ¿hay diseño preliminar? El competency engine necesita saber que los checklists tendrán:
   - Un `asset_id` (para determinar módulo tecnológico)
   - Un `technician_id` (quién completó)
   - Un `work_order_id` (WO asociada)
   - Bloques `A`, `B`, `C` con resultado `PASS`/`FAIL`

6. **Candado MVP** — ¿El candado de asignación (bloquear APPROVED→INPRG si no cumple nivel) aplica desde el día 1, o hay un período de gracia donde solo es warning?
