## Exploration: Checklist Evidence System

### Current State

**El Competency Engine ya existe** en dos migraciones aplicadas:
- `20260528000001_technological_modules.sql` — 8 módulos tecnológicos (M-PACK, M-TRAN, M-ELEC, M-REFR, M-VAPO, M-PUMP, M-TÉRM, M-CAL), `assets.module_id` FK agregada
- `20260528000002_competency_engine.sql` — 5 tablas (`proficiency_levels`, `technician_skills`, `skill_requirements`, `technician_skill_evidence`, `technician_module_progress`), 3 triggers (`trg_recalculate_technician_level`, `trg_update_module_progress`, `trg_progress_updated_at`), función de soft-lock `check_competency_for_assignment()`, RLS completa

**El trigger de recálculo funciona así:**
- AFTER INSERT ON `technician_skill_evidence` → recalcula nivel máximo por técnico+módulo
- Nivel 2: al menos 1 PASS en nivel_evaluado=2
- Nivel 3: 5+ PASS en nivel_evaluado=3 (mismo módulo)
- Nivel 4: al menos 1 PASS en nivel_evaluado=4
- Nivel 5: `autor_estandar=true` en `technician_module_progress`

**NO existen checklists.** El flujo del mecánico (WorkOrderDrawer) captura notas técnicas de texto libre (symptom_note, cause_note, action_note) más materiales y acciones lifecycle. No hay nada estructurado tipo checklist.

**El mechanic dashboard** usa un SwipeableDrawer de 420px que muestra: detalle de WO, materiales, notas, y acciones lifecycle. Sin checklists.

**Los patrones existentes a seguir:**
1. **Adaptador ViewModel**: `workOrderAdapter.js`, `laborAdapter.js` — snake_case del documento RxDB → camelCase para React
2. **RxDB**: Colecciones con schema JSON, pull/push handlers genéricos, `createPullHandler()` / `createPushHandler()` reutilizables
3. **pgTAP tests**: BEGIN/ROLLBACK, SAVEPOINT, `throws_ok()`, `lives_ok()`, seed data con UUIDs fijos
4. **Triggers**: BEFORE UPDATE para FSM, AFTER INSERT para recálculo, SECURITY DEFINER, SET search_path = public
5. **Auditoría**: `audit_trigger_func()` genérico attach via trigger
6. **RLS**: `get_user_role()`, una policy por rol por operación

---

### Los 3 Puntos Ciegos (REQUISITOS NO NEGOCIABLES)

**Blind Spot 1 — BOOLEAN PASS/FAIL es insuficiente:**
El `technician_skill_evidence.status` BOOLEAN no captura POR QUÉ falló. Necesitamos `causa_falla`:
- `FALTA_HERRAMIENTA` — el técnico sabe pero no tiene el equipo
- `FALTA_CONOCIMIENTO` — no sabe, necesita training
- `DESVIACION_INTENCIONAL` — decidió no hacerlo (no siguió el LUP)
- `NO_APLICA` — el ítem no aplica en este contexto
- `CONDICION_INSEGURA` — no pudo evaluar por condiciones inseguras
- `OTRO` — captura abierta

**Blind Spot 2 — Falta `evaluator_source` (quién es el sensor):**
`evaluated_by` existe como UUID pero no diferencia fuente de evaluación. Necesitamos:
- `evaluator_source`: `SELF` (auto-evaluación del técnico), `SUPERVISOR` (spot-check del supervisor), `PEER` (evaluación por par)
- `verified_by` / `verified_at` para supervisor que confirma una auto-evaluación
- El motor de competencias DEBE ponderar: evidencia de SUPERVISOR vale más que SELF

**Blind Spot 3 — Click Fatigue requiere muestreo:**
job_plan con 15 tareas × 3-4 ítems cada una = 60 taps en pantalla de celular. El técnico va a spammear PASS. Solución:
- Sampling configurable: `sampling_rate` (1 de cada N), `auditable_only` flag
- Block C (nivel 4, precisión) NO debe aparecer en cada PM rutinario
- Quién configura: Planner desde job_plan o módulo

---

### A. Data Model — 3 Enfoques

#### Approach A1: Checklist Templates Embebidos (por job_plan)

**Descripción**: Cada checklist template se asocia directamente a un `job_plan`. Cuando se crea una WO desde ese job_plan, se genera una `checklist_instance` con los ítems del template.

**Schema:**

```sql
-- ============================================================
-- CATÁLOGOS BASE
-- ============================================================

-- Causa de falla (blind spot 1)
CREATE TABLE causa_falla_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT
);

INSERT INTO causa_falla_catalog (code, name, description) VALUES
  ('FALTA_HERRAMIENTA', 'Falta de Herramienta', 'El técnico no dispone del equipo o herramienta necesaria'),
  ('FALTA_CONOCIMIENTO', 'Falta de Conocimiento', 'El técnico no sabe cómo ejecutar la tarea'),
  ('DESVIACION_INTENCIONAL', 'Desviación Intencional', 'El técnico decidió no seguir el procedimiento'),
  ('NO_APLICA', 'No Aplica', 'El ítem no aplica en este contexto'),
  ('CONDICION_INSEGURA', 'Condición Insegura', 'Condiciones inseguras impidieron la evaluación'),
  ('OTRO', 'Otro', 'Otra causa — captura abierta');

-- ============================================================
-- CHECKLIST TEMPLATES
-- ============================================================

-- Template de checklist (asociado a job_plan + opcional a tarea específica)
CREATE TABLE checklist_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,                    -- CHK-PM-MPACK-001
  description TEXT NOT NULL,
  job_plan_id UUID REFERENCES job_plans(id),    -- NULL si es genérico por módulo
  job_plan_task_id UUID REFERENCES job_plan_tasks(id), -- NULL si es para todo el plan
  module_id UUID REFERENCES technological_modules(id),  -- NULL si es por job_plan
  block_type TEXT NOT NULL CHECK (block_type IN ('A', 'B', 'C')),
  -- Sampling (blind spot 3)
  sampling_rate INT DEFAULT 1,                  -- 1 = siempre, 3 = 1 de cada 3, 0 = solo auditable
  is_auditable BOOLEAN DEFAULT false,           -- TRUE = solo aparece en WOs marcadas como auditables
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ítems individuales del checklist
CREATE TABLE checklist_template_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_template_id UUID NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
  step_sequence INT NOT NULL,
  item_text TEXT NOT NULL,                      -- "¿Usó el alineador láser?"
  item_type TEXT DEFAULT 'PASS_FAIL' CHECK (item_type IN ('PASS_FAIL', 'MEASUREMENT', 'YES_NO', 'TEXT')),
  requires_photo BOOLEAN DEFAULT false,         -- ¿Requiere foto como evidencia?
  requires_comment BOOLEAN DEFAULT false,       -- ¿Requiere comentario si FAIL?
  optional BOOLEAN DEFAULT false,               -- TRUE = puede saltarse
  UNIQUE(checklist_template_id, step_sequence)
);

-- ============================================================
-- CHECKLIST INSTANCES (runtime)
-- ============================================================

-- Una instancia por WO que dispara checklists
CREATE TABLE checklist_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  checklist_template_id UUID NOT NULL REFERENCES checklist_templates(id),
  technician_id UUID NOT NULL REFERENCES user_profiles(id),
  -- Fuente de evaluación (blind spot 2)
  evaluator_source TEXT NOT NULL DEFAULT 'SELF'
    CHECK (evaluator_source IN ('SELF', 'SUPERVISOR', 'PEER')),
  evaluated_by UUID NOT NULL DEFAULT auth.uid() REFERENCES user_profiles(id),
  -- Spot-check: supervisor que verifica
  verified_by UUID REFERENCES user_profiles(id),
  verified_at TIMESTAMPTZ,
  -- Estado
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED')),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Respuestas por ítem
CREATE TABLE checklist_item_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_instance_id UUID NOT NULL REFERENCES checklist_instances(id) ON DELETE CASCADE,
  template_item_id UUID NOT NULL REFERENCES checklist_template_items(id),
  -- Resultado (blind spot 1: causa_falla + status en lugar de BOOLEAN puro)
  status TEXT NOT NULL CHECK (status IN ('PASS', 'FAIL', 'NA', 'SKIPPED')),
  causa_falla_id UUID REFERENCES causa_falla_catalog(id),  -- NULL si PASS
  comment TEXT,                            -- Requerido si FAIL + causa_falla
  photo_url TEXT,                          -- Evidencia fotográfica
  measurement_value NUMERIC,               -- Si item_type = MEASUREMENT
  answered_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(checklist_instance_id, template_item_id)
);

-- ============================================================
-- SAMPLING CONFIG (blind spot 3)
-- ============================================================

-- Configuración global de muestreo (override por módulo/job_plan)
CREATE TABLE checklist_sampling_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID REFERENCES technological_modules(id),      -- NULL = global
  job_plan_id UUID REFERENCES job_plans(id),                 -- NULL = global
  block_type TEXT NOT NULL CHECK (block_type IN ('A', 'B', 'C')),
  default_sampling_rate INT NOT NULL DEFAULT 1,              -- 1 = siempre
  is_auditable_only BOOLEAN DEFAULT false,                   -- TRUE = solo si WO es auditable
  UNIQUE(module_id, job_plan_id, block_type)
);

-- Flag auditable en work_orders
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS is_auditable BOOLEAN DEFAULT false;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS audit_reason TEXT;
```

**Trigger de feeding al Competency Engine:**

```sql
-- Cuando se completa una checklist_instance, alimenta technician_skill_evidence
CREATE OR REPLACE FUNCTION trg_checklist_to_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_module_code TEXT;
  v_block_level INT;
  v_template RECORD;
BEGIN
  -- Solo en COMPLETED
  IF NEW.status = 'COMPLETED' AND (OLD.status IS DISTINCT FROM 'COMPLETED') THEN
    -- Obtener template info
    SELECT ct.block_type, ct.module_id INTO v_template
    FROM checklist_templates ct
    WHERE ct.id = NEW.checklist_template_id;

    -- Resolver nivel según bloque
    v_block_level := CASE v_template.block_type
      WHEN 'A' THEN 2
      WHEN 'B' THEN 3
      WHEN 'C' THEN 4
    END;

    -- Resolver código de módulo
    IF v_template.module_id IS NOT NULL THEN
      SELECT code INTO v_module_code
      FROM technological_modules
      WHERE id = v_template.module_id;
    ELSE
      -- Resolver desde job_plan → asset → module
      SELECT tm.code INTO v_module_code
      FROM work_orders wo
      JOIN assets a ON a.id = wo.asset_id
      JOIN technological_modules tm ON tm.id = a.module_id
      WHERE wo.id = NEW.work_order_id;
    END IF;

    IF v_module_code IS NULL THEN
      RETURN NEW;
    END IF;

    -- Si el bloque completo es PASS (sin FAILs), alimentar evidencia
    -- NOTA: la granularidad puede ser por ítem o por bloque completo
    IF NOT EXISTS (
      SELECT 1 FROM checklist_item_responses cir
      WHERE cir.checklist_instance_id = NEW.id
        AND cir.status = 'FAIL'
    ) THEN
      INSERT INTO technician_skill_evidence (
        work_order_id, technician_id, asset_id,
        modulo_gema, nivel_evaluado, item_evaluado,
        status, evaluated_by, evaluation_source
      )
      SELECT
        NEW.work_order_id,
        NEW.technician_id,
        wo.asset_id,
        v_module_code,
        v_block_level,
        ct.description || ' - Block ' || v_template.block_type,
        true,
        NEW.evaluated_by,
        NEW.evaluator_source
      FROM work_orders wo
      WHERE wo.id = NEW.work_order_id;
    ELSE
      -- Si hay FAILs, alimentar como FAIL y registrar causa_falla
      INSERT INTO technician_skill_evidence (
        work_order_id, technician_id, asset_id,
        modulo_gema, nivel_evaluado, item_evaluado,
        status, evaluated_by, evaluation_source
      )
      SELECT
        NEW.work_order_id,
        NEW.technician_id,
        wo.asset_id,
        v_module_code,
        v_block_level,
        ct.description || ' - Block ' || v_template.block_type || ' (FAIL)',
        false,
        NEW.evaluated_by,
        NEW.evaluator_source
      FROM work_orders wo
      WHERE wo.id = NEW.work_order_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
```

**Cambios necesarios en technician_skill_evidence:**
```sql
-- Agregar columna de fuente de evaluación (blind spot 2)
ALTER TABLE technician_skill_evidence
  ADD COLUMN IF NOT EXISTS evaluation_source TEXT
    CHECK (evaluation_source IN ('SELF', 'SUPERVISOR', 'PEER'));

-- Agregar columna de causa_falla (blind spot 1)
ALTER TABLE technician_skill_evidence
  ADD COLUMN IF NOT EXISTS causa_falla_id UUID REFERENCES causa_falla_catalog(id);

-- Agregar trust_score para ponderación
ALTER TABLE technician_skill_evidence
  ADD COLUMN IF NOT EXISTS trust_score NUMERIC DEFAULT 1.0
    CHECK (trust_score BETWEEN 0 AND 1);
```

**Pros:**
- Todo check-in-one: templates, instancias, respuestas, sampling, trigger feeding
- Asociación directa job_plan → template → evidencia (trazabilidad completa)
- Sampling configurable a nivel de módulo, job_plan, y block_type
- Blind spot 1 resuelto con causa_falla catalog + status TEXT
- Blind spot 2 resuelto con evaluator_source + verified_by
- Blind spot 3 resuelto con sampling_rate + is_auditable

**Cons:**
- Alta complejidad inicial (7 tablas nuevas + alter existentes + trigger)
- Los templates requieren mantenimiento del Planner (curva de adopción)
- Trigger feeding puede ser complejo de depurar
- La migración del BOOLEAN status existente (de 0 filas actualmente, pero conceptualmente)

**Effort**: High (~6-8 tablas, 2 triggers, alter technician_skill_evidence, adaptador frontend, tests)

---

#### Approach A2: Checklist Templates Genéricos por Módulo + Block Type

**Descripción**: Los templates NO se asocian a job_plan sino a módulo tecnológico + block_type. Cuando se genera una WO para un activo de módulo M-PACK, el sistema busca templates activos para M-PACK del bloque correspondiente.

**Schema** (similar a A1 pero con diferencias clave):

```sql
CREATE TABLE checklist_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL,
  module_id UUID NOT NULL REFERENCES technological_modules(id),  -- REQUERIDO
  block_type TEXT NOT NULL CHECK (block_type IN ('A', 'B', 'C')),
  intervention_type TEXT CHECK (intervention_type IN ('INSPECTION', 'LUBRICATION', 'MINOR_SERVICE', 'OVERHAUL')),
  sampling_rate INT DEFAULT 1,
  is_auditable BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true
);
```

**Regla de deployment**: Cuando un Planner crea/edita un checklist template, se asigna al módulo + opcionalmente a un intervention_type. No por job_plan individual — reduce la cantidad de templates a mantener.

**Pros:**
- Menos templates que mantener (por módulo, no por job_plan)
- Reutilización: el mismo template sirve para múltiples job_plans del mismo módulo
- Más escalable a largo plazo (100+ job_plans vs 8 módulos)
- Sampling natural por módulo+block

**Cons:**
- Menos granular: no se puede tener un checklist específico para "OVERHAUL de bomba centrífuga M-PACK"
- Si dos job_plans en el mismo módulo necesitan checklists diferentes, no es posible
- El mapeo WO→template requiere resolver módulo desde asset (query extra)

**Effort**: Medium-High (~5 tablas, 1 trigger, menos templates)

---

#### Approach A3: Checklist Libre por WO (sin templates, el supervisor crea ad-hoc)

**Descripción**: No hay templates predefinidos. El supervisor/planner puede agregar ítems de checklist ad-hoc a una WO específica. Cada WO puede tener su propio checklist EFÍMERO. No hay reutilización.

**Pros:**
- Máxima flexibilidad
- Sin mantenimiento de templates
- Implementación más rápida

**Cons:**
- **NO hay estandarización** — cada supervisor crea sus propios checklists, no hay consistencia
- **NO reutilización** — el mismo checklist hay que crearlo cada vez
- **NO sampling** — no hay forma de configurar "1 de cada 5 PMs"
- **No alimenta al competency engine limpiamente** — sin mapping a módulo+bloque, la evidencia es ambigua
- **Anti-patrón industrial** — todas las implementaciones CMMS clase mundial usan templates

**Effort**: Low (~3 tablas, sin triggers complejos)

---

### B. Evaluation Source / Trust Model

#### Trust Weighting Scheme

El motor de competencias DEBE ponderar la evidencia según su fuente. Propuesta:

| Fuente | Trust Score | Efecto en recálculo |
|--------|-------------|---------------------|
| `SUPERVISOR` | 1.0 (plena) | Cuenta normal. Una PASS de supervisor vale lo mismo que 1 evidencia. |
| `PEER` | 0.8 | Cuenta como 0.8 evidencia para nivel 3 (se necesitan ~7 peer PASS para nivel 3). |
| `SELF` | 0.5 | Cuenta como 0.5 evidencia. Un técnico auto-evaluándose necesita ~10+ PASS nivel 3. |

**Implementación en el trigger `trg_recalculate_technician_level`:**

```sql
-- Modificar conteo de nivel 3 para usar trust_score
SELECT COUNT(*) INTO v_lv3_count
FROM technician_skill_evidence
WHERE technician_id = NEW.technician_id
  AND modulo_gema = NEW.modulo_gema
  AND nivel_evaluado = 3
  AND status = true
  AND COALESCE(trust_score, 1.0) >= 0.5;  -- Mínimo filtro

-- Si queremos ponderación exacta (más preciso pero más complejo):
-- SELECT COALESCE(SUM(COALESCE(trust_score, 1.0)), 0) INTO v_lv3_weighted
-- Luego comparar v_lv3_weighted >= 5
```

#### Evaluator Workflow

**Self-evaluation** (técnico en campo):
1. Técnico abre WO en WorkOrderDrawer
2. Ve checklists aplicables (según sampling) en una sección "Checklist de Competencia"
3. Marca cada ítem como PASS/FAIL + causa_falla si FAIL
4. Al completar, el evaluator_source = 'SELF'
5. Si el técnico marca FAIL en algo, el sistema NO bloquea la WO pero REGISTRA la evidencia

**Supervisor spot-check** (supervisor en campo):
1. Supervisor abre la WO desde PlannerDashboard
2. Ve los mismos checklists + indicador de qué respondió el técnico
3. Puede CONFIRMAR (verified_by) o RE-EVALUAR (nueva instancia con evaluator_source='SUPERVISOR')
4. La evidencia de supervisor OVERRIDE a la de self-evaluation (trust_score más alto)

**Peer review** (senior mechanic):
1. Senior mechanic asignado como "certificador" en WO complejas
2. Ve el checklist + puede modificar respuestas
3. evaluator_source = 'PEER', trust_score = 0.8

#### Verified_by Pattern

```sql
-- En checklist_instances:
-- evaluated_by = quien llenó el checklist (puede ser el técnico mismo)
-- verified_by = supervisor que confirmó (NULL si nadie verificó)
-- evaluator_source: SELF | SUPERVISOR | PEER

-- Cuando un supervisor verifica una self-evaluation:
-- UPDATE checklist_instances
-- SET verified_by = auth.uid(),
--     verified_at = NOW(),
--     evaluator_source = 'SUPERVISOR'  -- upgrade de confianza
-- WHERE id = :instance_id;
```

---

### C. Sampling Strategy

#### Niveles de Configuración

| Nivel | Tabla | Qué configura |
|-------|-------|---------------|
| Global | `checklist_sampling_config` WHERE module_id IS NULL AND job_plan_id IS NULL | Default para todos los módulos y planes |
| Por módulo | `checklist_sampling_config` WHERE module_id IS SET AND job_plan_id IS NULL | Override por módulo tecnológico |
| Por job_plan | `checklist_sampling_config` WHERE job_plan_id IS SET | Override específico para un plan |
| Por plantilla | `checklist_templates.sampling_rate` | Override por template individual |

#### Sampling Algorithm (en frontend o backend)

```
Para cada checklist_template asociado a la WO (vía job_plan o módulo):

1. Si is_active = false → SKIP
2. Si sampling_rate = 0 AND is_auditable = true AND wo.is_auditable = false → SKIP
3. Si sampling_rate = 0 AND is_auditable = false → SKIP (nunca aparece)
4. Si sampling_rate = 1 → SIEMPRE mostrar
5. Si sampling_rate > 1:
   a. Hash determinístico: hash(wo.id + template.id) % sampling_rate == 0 → mostrar
   b. Esto garantiza consistencia (misma WO siempre muestra/oculta el mismo template)
6. Block C: solo mostrar si technician.current_level >= 3 (nivel 3 desbloquea nivel 4)
```

#### Block C Visibility Gate

**Regla de negocio CRÍTICA**: Block C (Precisión, nivel 4) solo debe aparecer si el técnico tiene nivel 3+ en ese módulo. Si el técnico es nivel 2, mostrar Block C es frustrante y genera click fatigue.

Implementación:
```sql
-- Función helper: determinar qué blocks mostrar para un técnico+módulo
CREATE OR REPLACE FUNCTION get_visible_blocks(
  p_technician_id UUID,
  p_module_code TEXT
) RETURNS TEXT[] AS $$
DECLARE
  v_current_level INT;
BEGIN
  SELECT COALESCE(current_level, 1) INTO v_current_level
  FROM technician_skills ts
  JOIN technological_modules tm ON tm.id = ts.module_id
  WHERE ts.technician_id = p_technician_id
    AND tm.code = p_module_code;

  IF v_current_level >= 3 THEN
    RETURN ARRAY['A', 'B', 'C'];
  ELSIF v_current_level >= 2 THEN
    RETURN ARRAY['A', 'B'];
  ELSE
    RETURN ARRAY['A'];
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;
```

#### ¿Quién marca una WO como auditable?

El Planner, al crear la WO o programar el PM schedule:
- `pm_schedules.is_auditable BOOLEAN DEFAULT false` — nuevo campo
- Al generar WO desde schedule: hereda `is_auditable`
- Planner puede override manual en WO individual

---

### D. UX Impact

#### Donde encaja en WorkOrderDrawer (420px, swipeable)

El drawer actual tiene esta estructura:
```
┌──────────────────────────┐
│ Header (WO info + close) │
├──────────────────────────┤
│ WorkOrderDetail          │
├──────────────────────────┤
│ Materiales (conditionally)│
├──────────────────────────┤
│ WorkOrderNotesForm        │
├──────────────────────────┤
│ WorkOrderActions (button) │
└──────────────────────────┘
```

**Propuesta UX**: Los checklists NO van dentro del drawer principal. Van en un **sub-drawer o tab lateral** accesible desde el drawer. Dos opciones:

**Opción UX1 — Stepped Drawer (Recomendada):**
```
Drawer principal (WorkOrderDrawer):
┌──────────────────────────────────────┐
│ Header + WorkOrderDetail             │
├──────────────────────────────────────┤
│ [Materiales] [Checklist] [Notas]     │ ← Tabs horizontales
├──────────────────────────────────────┤
│ Contenido del tab activo             │
│ (cada tab es un sub-componente)      │
├──────────────────────────────────────┤
│ WorkOrderActions (siempre visible)   │
└──────────────────────────────────────┘
```

- Tab "Checklist" muestra los bloques A/B/C aplicables (según sampling + nivel)
- Cada bloque es un acordeón expandible
- Dentro de cada bloque: ítems con PASS/FAIL/causa_falla
- Botón "Completar Checklist" guarda respuestas (no bloquea la WO)

**Opción UX2 — Modal Separado:**
- El drawer tiene un botón "Checklist de Competencia" que abre un modal/dialog
- El modal es más ancho (640px) y permite mejor visualización de los ítems
- El mecánico puede dejar el modal abierto mientras trabaja

**UX para el problema de 60 taps:**
- Agrupar por bloque (A, B, C) — no más de 5-8 ítems por bloque
- Block A (Seguridad): items cortos, CHECK/UNCHECK, 3-5 items
- Block B (Ejecución): items de procedimiento, PASS/FAIL, 5-8 items
- Block C (Precisión): solo visible si nivel >= 3, 3-5 items
- Checkbox inicial "Confirmo que leí y entendí cada ítem" antes de habilitar respuestas
- Botón "PASS ALL" con confirmación: "¿Estás seguro que todos los ítems se ejecutaron correctamente?"

#### Vista Supervisor vs Técnico

| Elemento | Técnico (SELF) | Supervisor (SUPERVISOR) |
|----------|---------------|------------------------|
| Block C | Solo si nivel >= 3 | Siempre visible |
| Sampling | Respeta sampling | Puede ver todos (override) |
| Editar respuestas | Una vez enviado, no | Siempre puede override |
| Verified_by | No visible | Botón "Verificar" |
| Causa falla | Selección simple | + Comentario obligatorio |
| Foto | Opcional | Requerido para FAIL |

---

### E. Integration with Existing Competency Engine

#### Flujo Completo de Datos

```
[Checklist Template] ──asignado_a──> [Job Plan / Module]
       │
       ▼
[WO creada desde PM Schedule]
       │
       ▼
[Checklist Instance] ──se generan──> [Checklist Item Responses]
       │                                     │
       │                              (trigger AFTER COMPLETED)
       ▼                                     ▼
[technician_skill_evidence] ──trigger──> [technician_skills.current_level]
       │                                     │
       │                              (soft-lock check)
       ▼                                     ▼
[Causa Falla]                         [check_competency_for_assignment()]
   │                                        │
   ▼                                        ▼
[Analytics: training vs tool gap]     [Planner Dashboard bypass]
```

#### Causa_falla Filtering

**Regla de negocio**: Si un técnico falla por `FALTA_HERRAMIENTA`, ESO NO DEBE contar como falta de competencia. Debe contar como gap de inversión/equipamiento.

Implementación en trigger de recálculo:
```sql
-- Modificar trg_recalculate_technician_level para filtrar
SELECT COUNT(*) INTO v_lv3_count
FROM technician_skill_evidence tse
LEFT JOIN causa_falla_catalog cfc ON cfc.id = tse.causa_falla_id
WHERE tse.technician_id = NEW.technician_id
  AND tse.modulo_gema = NEW.modulo_gema
  AND tse.nivel_evaluado = 3
  AND tse.status = true
  AND (tse.causa_falla_id IS NULL
       OR cfc.code NOT IN ('FALTA_HERRAMIENTA', 'CONDICION_INSEGURA'));
  -- FALTA_HERRAMIENTA y CONDICION_INSEGURA NO cuentan como FAIL de competencia
```

**IMPORTANTE — Revisar el trigger existente**: El trigger `trg_recalculate_technician_level` actualmente usa `status = true` como única condición. Al agregar `causa_falla_id` y `trust_score`, el trigger debe modificarse para:
1. Excluir FAILs por `FALTA_HERRAMIENTA` y `CONDICION_INSEGURA` (no afectan nivel)
2. Ponderar por `trust_score` para nivel 3 (5 PASS ponderados)
3. Mantener la lógica GREATEST actual

#### Trust Score y RLS

Actualmente: `evidence_insert` policy permite INSERT a PLANNER y ADMIN. El técnico no puede insertar evidencia directamente.

**¿Quién inserta en technician_skill_evidence?**
- **Opción A (backend trigger)**: El trigger `trg_checklist_to_evidence` inserta automáticamente. Usa SECURITY DEFINER, bypass RLS. Es la más limpia.
- **Opción B (frontend directo)**: El frontend (react) inserta tanto en checklist_instances como en technician_skill_evidence. Duplica lógica, riesgo de inconsistencia.

**Recomendación**: Opción A — el trigger es el único punto de entrada a evidence. El frontend solo escribe en checklist_instances/responses. Esto garantiza consistencia y permite cambiar la lógica de feeding sin tocar frontend.

#### Modificaciones al Trigger de Recálculo Existente

```sql
-- Modificar trg_recalculate_technician_level existente:
-- 1. Filtrar por trust_score
-- 2. Excluir FALTA_HERRAMIENTA/CONDICION_INSEGURA
-- 3. Mantener compatibilidad hacia atrás (registros legacy sin causa_falla)

-- Para nivel 3 (5+ PASS evidencia):
-- Actual: COUNT(*) WHERE status = true AND nivel_evaluado = 3
-- Nuevo: SUM(COALESCE(trust_score, 1.0)) WHERE status = true
--        AND nivel_evaluado = 3
--        AND (causa_falla_id IS NULL
--             OR cfc.code NOT IN ('FALTA_HERRAMIENTA', 'CONDICION_INSEGURA'))
```

---

### Análisis Comparativo de Enfoques

| Dimensión | A1: Embebido (job_plan) | A2: Genérico (módulo) | A3: Libre (ad-hoc) |
|-----------|------------------------|-----------------------|--------------------|
| **Blind Spot 1** (causa_falla) | ✅ Resuelto con catálogo | ✅ Resuelto | ✅ Resuelto |
| **Blind Spot 2** (evaluator_source) | ✅ Resuelto + verified_by | ✅ Resuelto | ✅ Resuelto |
| **Blind Spot 3** (sampling) | ✅ Por job_plan, módulo, block | ✅ Por módulo + block | ❌ Sin sampling |
| **Mantenimiento Planner** | Alto (por job_plan) | Medio (por módulo) | Bajo (sin templates) |
| **Consistencia** | Alta (trazable por plan) | Alta (reutilizable) | Baja (ad-hoc) |
| **Feeding a Competency Engine** | ✅ Directo por job_plan→module | ✅ Por module | ⚠️ Mapping ad-hoc |
| **Escalabilidad** | ⚠️ 100+ job_plans | ✅ 8 módulos | ❌ No escala |
| **Complejidad técnica** | Alta (7 tablas + 2 triggers) | Media (5 tablas + 1 trigger) | Baja (3 tablas) |
| **Esfuerzo** | ~8-10 días | ~5-7 días | ~3-4 días |

---

### Recomendación

**Approach combinado: A2 (Genérico por Módulo) como base, con capacidad de override por job_plan.**

La razón principal: **8 módulos tecnológicos vs ~100+ job_plans a futuro**. Tener templates por módulo reduce drásticamente el mantenimiento. Pero necesitamos la flexibilidad de que ciertos job_plans críticos (OVERHAUL, intervenciones mayores) puedan tener templates específicos.

**Schema resultante:**

```sql
checklist_templates:
  module_id UUID NOT NULL           -- REQUERIDO (hereda por defecto)
  job_plan_id UUID NULL             -- OVERRIDE opcional para planes específicos
  block_type TEXT NOT NULL
  sampling_rate INT DEFAULT 1
  is_auditable BOOLEAN DEFAULT false
  intervention_type TEXT NULL        -- Filtro adicional

-- Regla: si job_plan_id IS NOT NULL, este template SOLO aplica a ese plan.
-- Si job_plan_id IS NULL, aplica a TODOS los job_plans del módulo.
```

**Decisiones congeladas para Proposal:**

1. **Data Model**: Approach A2 + override por job_plan. No ad-hoc.
2. **Causa falla catalog**: 6 valores (FALTA_HERRAMIENTA, FALTA_CONOCIMIENTO, DESVIACION_INTENCIONAL, NO_APLICA, CONDICION_INSEGURA, OTRO).
3. **Evaluator source**: SELF | SUPERVISOR | PEER. Trust score: SUPERVISOR=1.0, PEER=0.8, SELF=0.5.
4. **Verified_by**: Supervisor puede confirmar self-evaluation, upgrade a SUPERVISOR trust.
5. **Sampling**: Config por módulo+block con override por job_plan. Hash determinístico para consistencia.
6. **Block C gate**: Solo visible si technician.current_level >= 3 en ese módulo.
7. **Feeding**: Trigger `trg_checklist_to_evidence` AFTER COMPLETED en checklist_instances. No frontend directo.
8. **UX**: Tabs horizontales en WorkOrderDrawer (Materiales | Checklist | Notas). Block C oculto por nivel.
9. **Causa_falla filtering**: FALTA_HERRAMIENTA y CONDICION_INSEGURA no cuentan como FAIL de competencia.
10. **Trust score integration**: Modificar trigger existente para usar SUM(trust_score) en nivel 3.

---

### Riesgos

| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| **Trigger de recálculo existente debe modificarse** — riesgo de regression en cálculo de niveles actuales | 🔴 ALTO | Tests pgTAP extensivos. No eliminar lógica legacy, solo agregar condiciones con COALESCE para compatibilidad. |
| **Causa_falla NO_APLICA como loophole** — técnicos pueden marcar NO_APLICA en todo para evitar FAILS | 🟡 MEDIO | NO_APLICA no cuenta como PASS ni FAIL para el nivel. Es neutro. Auditoría semanal de NO_APLICA excesivos. |
| **Self-evaluation con trust_score=0.5** — técnicos pueden sentir que su auto-evaluación no vale | 🟡 MEDIO | Comunicación clara: "Tu auto-evaluación es el primer paso. El supervisor confirmará en terreno." |
| **Sampling hash determinístico puede ser confuso** — misma WO siempre muestra/oculta los mismos templates | 🟢 BAJO | Documentar que es intencional: si siempre muestras Block C, el técnico se acostumbra. Si nunca aparece, no. |
| **Offline-first complexity** — checklist_instances creadas offline deben sincronizar correctamente | 🟡 MEDIO | Usar device_timestamp + conflict resolution. RxDB con checkpoint-based sync ya maneja conflictos. |
| **Block C gate desactualizado** — el técnico subió a nivel 3 offline pero el level local no se actualizó | 🟢 BAJO | Mostrar Block C si el nivel local (RxDB) es >= 3. Si está desactualizado, se muestra de más (seguro) o de menos (pierde oportunidad, no crítica). |

---

### Áreas Afectadas

- `supabase/migrations/202605<next>_checklist_evidence.sql` — **NUEVA**: 7 tablas (causa_falla_catalog, checklist_templates, checklist_template_items, checklist_instances, checklist_item_responses, checklist_sampling_config) + alter technician_skill_evidence + alter work_orders + trigger trg_checklist_to_evidence + modify trg_recalculate_technician_level
- `supabase/tests/database/checklist_evidence_test.sql` — **NUEVA**: pgTAP: schema constraints, trigger feeding, sampling visibility, causa_falla filtering, RLS
- `src/lib/rxdb.js` — **MODIFICAR**: Agregar colecciones: checklist_templates, checklist_instances, checklist_item_responses, causa_falla_catalog. Agregar replication handlers.
- `src/hooks/useChecklists.js` — **NUEVO**: Hook RxDB: getTemplatesForWO(), submitChecklist(), getVisibleBlocks()
- `src/components/mechanic/ChecklistSection.jsx` — **NUEVO**: Componente de checklist dentro del drawer (tabs)
- `src/components/mechanic/ChecklistBlock.jsx` — **NUEVO**: Bloque individual (A/B/C) con ítems
- `src/components/mechanic/ChecklistItem.jsx` — **NUEVO**: Item individual con PASS/FAIL + causa_falla selector
- `src/components/mechanic/WorkOrderDrawer.jsx` — **MODIFICAR**: Agregar tabs (Materiales | Checklist | Notas)
- `src/components/mechanic/WorkOrderActions.jsx` — **MODIFICAR**: Opcional: requerir checklist completado antes de COMP
- `src/lib/adapters/checklistAdapter.js` — **NUEVO**: RxDB doc → ViewModel mapper
- `src/pages/PlannerDashboard.jsx` — **MODIFICAR**: Agregar sección de gestión de templates + sampling config
- `src/components/planner/ChecklistTemplateEditor.jsx` — **NUEVO**: Editor de templates para Planner
- `src/components/planner/SamplingConfigPanel.jsx` — **NUEVO**: Panel de configuración de sampling
- `src/pages/SupervisorDashboard.jsx` (si existe) — **MODIFICAR**: Vista de spot-checks pendientes
- `src/components/supervisor/SpotCheckPanel.jsx` — **NUEVO**: Panel de verificación/override de checklists

---

### Ready for Proposal

**Yes**. La exploración cubre los 5 dominios solicitados y aborda explícitamente los 3 Blind Spots. El enfoque recomendado (A2 + override por job_plan) balancea mantenibilidad, escalabilidad y trazabilidad.

El orchestrator debe presentar al usuario las siguientes preguntas antes de pasar a Propuesta:

1. ✅ **Confirmar Approach A2 con override por job_plan** — ¿Está de acuerdo con templates por módulo + override opcional por job_plan?
2. ✅ **Trust scores**: SUPERVISOR=1.0, PEER=0.8, SELF=0.5 — ¿Conforme?
3. ❓ **Causa falla**: ¿Los 6 valores propuestos cubren todos los casos? ¿Falta alguno (ej: `FALTA_REPUESTO`, `ERROR_LUP`)?
4. ❓ **Verified_by**: ¿Quién puede verificar? ¿Solo PLANNER o también SAFETY_OFFICER?
5. ❓ **UX**: ¿Stepped drawer con tabs o modal separado para checklists?
6. ❓ **WO lifecycle**: ¿Requerir checklist completado antes de permitir INPRG→COMP (hard gate) o solo recomendado (soft)?
7. ❓ **Sampling default**: ¿Cuál debe ser el sampling_rate por defecto para Block C? ¿1 de cada 3? ¿1 de cada 5?
