-- ============================================================
-- MIGRACIÓN 17: Sistema de Checklists y Evidencia
-- Change: checklist-evidence-system
-- ============================================================
-- Construye el sistema estructurado de checklists que alimenta
-- evidencia calificada al Motor de Competencias. Resuelve los
-- 3 Puntos Ciegos: causa_falla (por qué falló), evaluator_source
-- (quién evalúa), sampling (fatiga de clic).
-- ============================================================

-- ============================================================
-- SECCIÓN 1: Catálogos Base
-- ============================================================

-- -----------------------------------------------------------
-- 1.1 causa_falla_catalog — Catálogo de causas de falla
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS causa_falla_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT
);

COMMENT ON TABLE causa_falla_catalog IS
  'Catálogo de causas de falla para checklists. Cada causa gatilla una acción distinta: capacitación, compra, acción administrativa, auditoría de estándar, etc.';

COMMENT ON COLUMN causa_falla_catalog.code IS
  'Código único de la causa: BRECHA_CONOCIMIENTO, FALTA_HERRAMIENTA, DESVIACION_DISCIPLINARIA, FALTA_REPUESTO, ERROR_DOCUMENTACION, NO_APLICA';

COMMENT ON COLUMN causa_falla_catalog.name IS
  'Nombre descriptivo de la causa';

COMMENT ON COLUMN causa_falla_catalog.description IS
  'Descripción detallada y acción que gatilla esta causa';

INSERT INTO causa_falla_catalog (code, name, description) VALUES
  ('BRECHA_CONOCIMIENTO', 'Brecha de Conocimiento', 'El técnico no sabe cómo ejecutar el estándar. Gatilla capacitación.'),
  ('FALTA_HERRAMIENTA', 'Falta de Herramienta', 'El técnico sabe cómo, pero la herramienta especializada no está disponible o está dañada. Gatilla compra/mantenimiento de herramientas.'),
  ('DESVIACION_DISCIPLINARIA', 'Desviación Disciplinaria', 'El técnico tiene la habilidad y la herramienta, pero decidió omitir el paso. Gatilla acción administrativa.'),
  ('FALTA_REPUESTO', 'Falta de Repuesto', 'No se pudo validar la precisión porque la refacción nueva no llegó o venía defectuosa de proveedor. Gatilla auditoría a compras/almacén.'),
  ('ERROR_DOCUMENTACION', 'Error de Documentación', 'El SOP/LUP está mal escrito, desactualizado o la foto no corresponde a la máquina actual. Gatilla revisión del estándar.'),
  ('NO_APLICA', 'No Aplica', 'Para pasos opcionales según el contexto de la orden. Neutro para competencia — overridea FAIL a PASS.')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- SECCIÓN 2: Tablas de Templates de Checklist
-- ============================================================

-- -----------------------------------------------------------
-- 2.1 checklist_templates — Plantillas por módulo (+ override job_plan)
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS checklist_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL,
  module_id UUID NOT NULL REFERENCES technological_modules(id),
  job_plan_id UUID REFERENCES job_plans(id),
  block_type TEXT NOT NULL CHECK (block_type IN ('A', 'B', 'C')),
  sampling_rate INT DEFAULT 1 CHECK (sampling_rate BETWEEN 0 AND 100),
  is_auditable BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE checklist_templates IS
  'Plantillas de checklist por módulo tecnológico. Define qué ítems evaluar (Bloques A/B/C) y con qué frecuencia (sampling). Opcionalmente override por job_plan.';

COMMENT ON COLUMN checklist_templates.code IS
  'Código único del template (ej: CHK-MPACK-A-001)';

COMMENT ON COLUMN checklist_templates.module_id IS
  'Módulo tecnológico al que aplica este template (FK a technological_modules)';

COMMENT ON COLUMN checklist_templates.job_plan_id IS
  'Override opcional: si se especifica, este template SOLO aplica a este job_plan. Si NULL, aplica a todos los planes del módulo.';

COMMENT ON COLUMN checklist_templates.block_type IS
  'Bloque: A (Seguridad/LOTO, nivel 2), B (Ejecución, nivel 3), C (Precisión, nivel 4)';

COMMENT ON COLUMN checklist_templates.sampling_rate IS
  'Frecuencia de muestreo: 1 = siempre, 3 = 1 de cada 3, 0 = solo si WO es auditable';

COMMENT ON COLUMN checklist_templates.is_auditable IS
  'TRUE = este template solo aparece en WOs marcadas como auditables';

-- Índices únicos parciales para evitar duplicados
CREATE UNIQUE INDEX IF NOT EXISTS idx_ct_module_block
  ON checklist_templates(module_id, block_type)
  WHERE job_plan_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ct_module_jobplan_block
  ON checklist_templates(module_id, job_plan_id, block_type)
  WHERE job_plan_id IS NOT NULL;

-- -----------------------------------------------------------
-- 2.2 checklist_template_items — Ítems individuales del template
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS checklist_template_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_template_id UUID NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
  step_sequence INT NOT NULL,
  item_text TEXT NOT NULL,
  item_type TEXT DEFAULT 'PASS_FAIL' CHECK (item_type IN ('PASS_FAIL', 'MEASUREMENT', 'YES_NO', 'TEXT')),
  requires_photo BOOLEAN DEFAULT false,
  requires_comment BOOLEAN DEFAULT false,
  optional BOOLEAN DEFAULT false,
  UNIQUE(checklist_template_id, step_sequence)
);

COMMENT ON TABLE checklist_template_items IS
  'Ítems individuales que componen un template de checklist. Cada ítem es una pregunta/evaluación con tipo configurable.';

COMMENT ON COLUMN checklist_template_items.step_sequence IS
  'Orden del ítem dentro del template (único por template)';

COMMENT ON COLUMN checklist_template_items.item_text IS
  'Texto de la pregunta/evaluación (ej: ¿Usó el alineador láser?)';

COMMENT ON COLUMN checklist_template_items.item_type IS
  'Tipo de respuesta: PASS_FAIL, MEASUREMENT (valor numérico), YES_NO, TEXT (comentario libre)';

COMMENT ON COLUMN checklist_template_items.requires_photo IS
  'Si TRUE, el ítem requiere foto como evidencia';

COMMENT ON COLUMN checklist_template_items.requires_comment IS
  'Si TRUE, el ítem requiere comentario explicativo';

COMMENT ON COLUMN checklist_template_items.optional IS
  'Si TRUE, el ítem puede saltarse sin afectar el resultado del bloque';

CREATE INDEX IF NOT EXISTS idx_cti_template ON checklist_template_items(checklist_template_id);

-- ============================================================
-- SECCIÓN 3: Tablas de Instancias en Runtime
-- ============================================================

-- -----------------------------------------------------------
-- 3.1 checklist_instances — Instancia de checklist por WO
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS checklist_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  checklist_template_id UUID NOT NULL REFERENCES checklist_templates(id),
  technician_id UUID NOT NULL REFERENCES user_profiles(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  evaluator_source TEXT NOT NULL DEFAULT 'SELF' CHECK (evaluator_source IN ('SELF', 'SUPERVISOR', 'PEER')),
  evaluated_by UUID NOT NULL DEFAULT auth.uid() REFERENCES user_profiles(id),
  verified_by UUID REFERENCES user_profiles(id),
  verified_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'VOID')),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE checklist_instances IS
  'Instancia de checklist asociada a una orden de trabajo. Creada al transicionar la WO a INPRG. Al completarse, dispara trigger que alimenta technician_skill_evidence.';

COMMENT ON COLUMN checklist_instances.work_order_id IS
  'Orden de trabajo asociada (FK a work_orders)';

COMMENT ON COLUMN checklist_instances.technician_id IS
  'Técnico evaluado (FK a user_profiles, puede ser distinto de evaluated_by si el supervisor evalúa)';

COMMENT ON COLUMN checklist_instances.asset_id IS
  'Activo sobre el que se ejecuta la WO (desnormalizado de work_orders para consultas eficientes)';

COMMENT ON COLUMN checklist_instances.evaluator_source IS
  'Fuente de evaluación: SELF (auto-evaluación), SUPERVISOR (spot-check), PEER (evaluación por par)';

COMMENT ON COLUMN checklist_instances.evaluated_by IS
  'Usuario que realizó la evaluación (FK a user_profiles, default auth.uid())';

COMMENT ON COLUMN checklist_instances.verified_by IS
  'Supervisor que verificó/confirmó la evaluación (FK a user_profiles, NULL si no verificado)';

COMMENT ON COLUMN checklist_instances.status IS
  'Estado de la instancia: IN_PROGRESS (en progreso), COMPLETED (completada), VOID (anulada)';

CREATE INDEX IF NOT EXISTS idx_ci_work_order ON checklist_instances(work_order_id);
CREATE INDEX IF NOT EXISTS idx_ci_technician ON checklist_instances(technician_id);
CREATE INDEX IF NOT EXISTS idx_ci_status ON checklist_instances(status);

-- -----------------------------------------------------------
-- 3.2 checklist_item_responses — Respuestas por ítem
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS checklist_item_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_instance_id UUID NOT NULL REFERENCES checklist_instances(id) ON DELETE CASCADE,
  template_item_id UUID NOT NULL REFERENCES checklist_template_items(id),
  status TEXT NOT NULL CHECK (status IN ('PASS', 'FAIL', 'NA', 'SKIPPED')),
  causa_falla_id UUID REFERENCES causa_falla_catalog(id),
  comment TEXT,
  photo_url TEXT,
  measurement_value NUMERIC,
  answered_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(checklist_instance_id, template_item_id)
);

COMMENT ON TABLE checklist_item_responses IS
  'Respuestas individuales a cada ítem del checklist. Captura PASS/FAIL, causa de falla, evidencia fotográfica y comentarios.';

COMMENT ON COLUMN checklist_item_responses.status IS
  'Resultado: PASS (aprobado), FAIL (falló), NA (no aplica), SKIPPED (saltado por ser opcional)';

COMMENT ON COLUMN checklist_item_responses.causa_falla_id IS
  'Causa de la falla (FK a causa_falla_catalog, NULL si PASS). Determina qué acción gatilla: capacitación, compra, administrativa, etc.';

COMMENT ON COLUMN checklist_item_responses.comment IS
  'Comentario del evaluador (requerido si FAIL + causa_falla)';

COMMENT ON COLUMN checklist_item_responses.photo_url IS
  'URL de evidencia fotográfica (requerido si template_item.requires_photo = true)';

COMMENT ON COLUMN checklist_item_responses.measurement_value IS
  'Valor de medición (si template_item.item_type = MEASUREMENT)';

CREATE INDEX IF NOT EXISTS idx_cir_instance ON checklist_item_responses(checklist_instance_id);

-- ============================================================
-- SECCIÓN 4: Configuración de Sampling
-- ============================================================

CREATE TABLE IF NOT EXISTS checklist_sampling_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID REFERENCES technological_modules(id),
  job_plan_id UUID REFERENCES job_plans(id),
  block_type TEXT NOT NULL CHECK (block_type IN ('A', 'B', 'C')),
  default_sampling_rate INT DEFAULT 1 CHECK (default_sampling_rate BETWEEN 0 AND 100),
  is_auditable_only BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  UNIQUE(module_id, job_plan_id, block_type)
);

COMMENT ON TABLE checklist_sampling_config IS
  'Configuración de muestreo por módulo+bloque. Override global sobre el sampling_rate del template. Permite ajustar la frecuencia sin modificar templates.';

COMMENT ON COLUMN checklist_sampling_config.module_id IS
  'Módulo tecnológico (NULL = configuración global)';

COMMENT ON COLUMN checklist_sampling_config.job_plan_id IS
  'Plan de trabajo (NULL = aplica a todo el módulo o global)';

COMMENT ON COLUMN checklist_sampling_config.block_type IS
  'Bloque: A (Seguridad), B (Ejecución), C (Precisión)';

COMMENT ON COLUMN checklist_sampling_config.default_sampling_rate IS
  'Frecuencia por defecto para este módulo+bloque. NULL = usar el sampling_rate del template.';

-- ============================================================
-- SECCIÓN 5: ALTER technician_skill_evidence
-- ============================================================
-- Agrega columnas para los 3 Puntos Ciegos:
--   evaluation_source — quién evalúa (punto ciego 2)
--   causa_falla_id — por qué falló (punto ciego 1)
--   trust_score — ponderación por fuente (punto ciego 2)
-- ============================================================

ALTER TABLE technician_skill_evidence
  ADD COLUMN IF NOT EXISTS evaluation_source TEXT CHECK (evaluation_source IN ('SELF', 'SUPERVISOR', 'PEER'));

ALTER TABLE technician_skill_evidence
  ADD COLUMN IF NOT EXISTS causa_falla_id UUID REFERENCES causa_falla_catalog(id);

ALTER TABLE technician_skill_evidence
  ADD COLUMN IF NOT EXISTS trust_score NUMERIC DEFAULT 1.0 CHECK (trust_score BETWEEN 0 AND 1);

COMMENT ON COLUMN technician_skill_evidence.evaluation_source IS
  'Fuente de evaluación: SELF (auto-evaluación, trust=0.5), SUPERVISOR (spot-check, trust=1.0), PEER (evaluación por par, trust=0.8)';

COMMENT ON COLUMN technician_skill_evidence.causa_falla_id IS
  'Causa de la falla (FK a causa_falla_catalog). NULL si PASS o evidencia legacy. FALTA_HERRAMIENTA, FALTA_REPUESTO y ERROR_DOCUMENTACION no cuentan contra competencia.';

COMMENT ON COLUMN technician_skill_evidence.trust_score IS
  'Factor de ponderación (0-1). Legacy NULL = 1.0. SELF=0.5, PEER=0.8, SUPERVISOR=1.0. Afecta el conteo ponderado para nivel 3.';

-- ============================================================
-- SECCIÓN 6: ALTER work_orders
-- ============================================================
-- Agrega flag de auditoría para sampling
-- ============================================================

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS is_auditable BOOLEAN DEFAULT false;

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS audit_reason TEXT;

COMMENT ON COLUMN work_orders.is_auditable IS
  'TRUE si esta WO fue marcada como auditable (muestra todos los checklists sin importar sampling)';

COMMENT ON COLUMN work_orders.audit_reason IS
  'Razón por la que la WO fue marcada como auditable';

-- ============================================================
-- SECCIÓN 7: Trigger trg_checklist_to_evidence
--   AFTER UPDATE ON checklist_instances
--   Al completarse una instancia, alimenta
--   technician_skill_evidence con la evidencia agregada
--   del bloque completo.
-- ============================================================

CREATE OR REPLACE FUNCTION trg_checklist_to_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_module_code TEXT;
  v_block_level INT;
  v_template RECORD;
  v_trust_score NUMERIC;
  v_any_fail BOOLEAN;
  v_first_causa_falla_id UUID;
  v_has_noaplica BOOLEAN;
  v_item RECORD;
BEGIN
  -- Solo ejecutar al marcar como COMPLETED
  IF NEW.status <> 'COMPLETED' THEN
    RETURN NEW;
  END IF;

  -- Obtener info del template
  SELECT ct.block_type, ct.module_id, ct.description
  INTO v_template
  FROM checklist_templates ct
  WHERE ct.id = NEW.checklist_template_id;

  -- Resolver código de módulo
  IF v_template.module_id IS NOT NULL THEN
    SELECT code INTO v_module_code
    FROM technological_modules
    WHERE id = v_template.module_id;
  ELSE
    SELECT tm.code INTO v_module_code
    FROM work_orders wo
    JOIN assets a ON a.id = wo.asset_id
    JOIN technological_modules tm ON tm.id = a.module_id
    WHERE wo.id = NEW.work_order_id;
  END IF;

  IF v_module_code IS NULL THEN
    RAISE WARNING 'trg_checklist_to_evidence: No se pudo resolver módulo para WO %', NEW.work_order_id;
    RETURN NEW;
  END IF;

  -- Mapear bloque a nivel
  v_block_level := CASE v_template.block_type
    WHEN 'A' THEN 2
    WHEN 'B' THEN 3
    WHEN 'C' THEN 4
  END;

  -- Determinar trust_score según fuente
  v_trust_score := CASE NEW.evaluator_source
    WHEN 'SELF' THEN 0.5
    WHEN 'PEER' THEN 0.8
    WHEN 'SUPERVISOR' THEN 1.0
    ELSE 1.0
  END;

  -- Evaluar respuestas del bloque
  v_any_fail := false;
  v_first_causa_falla_id := NULL;
  v_has_noaplica := false;

  FOR v_item IN
    SELECT cir.status, cir.causa_falla_id, cfc.code as causa_falla_code
    FROM checklist_item_responses cir
    LEFT JOIN causa_falla_catalog cfc ON cfc.id = cir.causa_falla_id
    WHERE cir.checklist_instance_id = NEW.id
  LOOP
    IF v_item.causa_falla_code = 'NO_APLICA' THEN
      -- NO_APLICA override: el ítem no es FAIL aunque marque FAIL
      v_has_noaplica := true;
      -- Registrar causa NO_APLICA para trazabilidad
      IF v_first_causa_falla_id IS NULL THEN
        v_first_causa_falla_id := v_item.causa_falla_id;
      END IF;
      CONTINUE;
    END IF;

    IF v_item.status = 'FAIL' THEN
      v_any_fail := true;
      IF v_first_causa_falla_id IS NULL THEN
        v_first_causa_falla_id := v_item.causa_falla_id;
      END IF;
    END IF;
  END LOOP;

  -- Insertar evidencia en technician_skill_evidence
  -- Si NO_APLICA overrideó todos los FAILs, se registra como PASS
  INSERT INTO technician_skill_evidence (
    work_order_id, technician_id, asset_id,
    modulo_gema, nivel_evaluado, item_evaluado,
    status, evaluated_by, evaluated_at,
    evaluation_source, causa_falla_id, trust_score
  ) VALUES (
    NEW.work_order_id,
    NEW.technician_id,
    NEW.asset_id,
    v_module_code,
    v_block_level,
    v_template.description || ' - Block ' || v_template.block_type,
    NOT v_any_fail, -- true si no hay FAIL, false si hay al menos un FAIL
    NEW.evaluated_by,
    COALESCE(NEW.completed_at, NOW()),
    NEW.evaluator_source,
    v_first_causa_falla_id,
    v_trust_score
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_checklist_to_evidence ON checklist_instances;

CREATE TRIGGER trg_checklist_to_evidence
  AFTER UPDATE ON checklist_instances
  FOR EACH ROW
  WHEN (NEW.status = 'COMPLETED')
  EXECUTE FUNCTION trg_checklist_to_evidence();

COMMENT ON FUNCTION trg_checklist_to_evidence IS
  'Al completar una instancia de checklist, alimenta technician_skill_evidence con la evidencia agregada del bloque. Aplica NO_APLICA override (FAIL→PASS) y asigna trust_score según evaluator_source.';

COMMENT ON TRIGGER trg_checklist_to_evidence ON checklist_instances IS
  'Trigger que dispara la alimentación de evidencia al completar un checklist';

-- ============================================================
-- SECCIÓN 8: Modificar trg_recalculate_technician_level
--   Se DROP y recrea para incorporar:
--   1. SUM(trust_score) en lugar de COUNT(*) para nivel 3
--   2. Filtro de causa_falla (FALTA_HERRAMIENTA, FALTA_REPUESTO,
--      ERROR_DOCUMENTACION no cuentan contra competencia)
--   3. Compatibilidad hacia atrás (NULL trust_score = 1.0)
-- ============================================================

DROP TRIGGER IF EXISTS trg_recalculate_technician_level ON technician_skill_evidence;
DROP FUNCTION IF EXISTS trg_recalculate_technician_level;

CREATE OR REPLACE FUNCTION trg_recalculate_technician_level()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_module_id UUID;
  v_level INT;
  v_has_lv2 BOOLEAN;
  v_lv3_weighted NUMERIC;
  v_has_lv4 BOOLEAN;
  v_induccion BOOLEAN;
  v_autor BOOLEAN;
BEGIN
  -- Resolver código de módulo a UUID
  SELECT id INTO v_module_id
  FROM technological_modules
  WHERE code = NEW.modulo_gema;

  IF v_module_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Verificar nivel 2: al menos 1 evidencia PASS en nivel 2
  SELECT EXISTS(
    SELECT 1 FROM technician_skill_evidence
    WHERE technician_id = NEW.technician_id
      AND modulo_gema = NEW.modulo_gema
      AND nivel_evaluado = 2
      AND status = true
  ) INTO v_has_lv2;

  -- Verificar nivel 3: suma ponderada de trust_score >= 5
  -- Excluye FAILs donde causa_falla es FALTA_HERRAMIENTA, FALTA_REPUESTO o ERROR_DOCUMENTACION
  -- (no cuentan contra competencia — son problemas de herramientas/repuestos/documentación)
  -- Legacy NULL causa_falla = FAIL normal (cuenta contra competencia)
  -- Legacy NULL trust_score = 1.0
  SELECT COALESCE(SUM(COALESCE(tse.trust_score, 1.0)), 0) INTO v_lv3_weighted
  FROM technician_skill_evidence tse
  LEFT JOIN causa_falla_catalog cfc ON cfc.id = tse.causa_falla_id
  WHERE tse.technician_id = NEW.technician_id
    AND tse.modulo_gema = NEW.modulo_gema
    AND tse.nivel_evaluado = 3
    AND tse.status = true
    AND (tse.causa_falla_id IS NULL
         OR cfc.code NOT IN ('FALTA_HERRAMIENTA', 'FALTA_REPUESTO', 'ERROR_DOCUMENTACION'));

  -- Verificar nivel 4: al menos 1 evidencia PASS en nivel 4
  SELECT EXISTS(
    SELECT 1 FROM technician_skill_evidence
    WHERE technician_id = NEW.technician_id
      AND modulo_gema = NEW.modulo_gema
      AND nivel_evaluado = 4
      AND status = true
  ) INTO v_has_lv4;

  -- Verificar banderas de progreso (niveles 1 y 5)
  SELECT induccion_completada, autor_estandar INTO v_induccion, v_autor
  FROM technician_module_progress
  WHERE technician_id = NEW.technician_id AND module_id = v_module_id;

  IF NOT FOUND THEN
    v_induccion := false;
    v_autor := false;
  END IF;

  -- Calcular nivel máximo: GREATEST de todos los niveles alcanzados
  v_level := 1;
  IF v_has_lv2 THEN v_level := GREATEST(v_level, 2); END IF;
  IF v_lv3_weighted >= 5 THEN v_level := GREATEST(v_level, 3); END IF;
  IF v_has_lv4 THEN v_level := GREATEST(v_level, 4); END IF;
  IF v_autor THEN v_level := GREATEST(v_level, 5); END IF;

  -- UPSERT: crea o actualiza el nivel del técnico en el módulo
  INSERT INTO technician_skills (technician_id, module_id, current_level, calculated_at)
  VALUES (NEW.technician_id, v_module_id, v_level, NOW())
  ON CONFLICT (technician_id, module_id)
  DO UPDATE SET current_level = v_level, calculated_at = NOW();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalculate_technician_level ON technician_skill_evidence;

CREATE TRIGGER trg_recalculate_technician_level
  AFTER INSERT ON technician_skill_evidence
  FOR EACH ROW
  EXECUTE FUNCTION trg_recalculate_technician_level();

COMMENT ON FUNCTION trg_recalculate_technician_level IS
  'Recalcula el nivel de competencia del técnico al insertar nueva evidencia. Usa SUM(trust_score) para nivel 3 (ponderado por fuente). Excluye FALTA_HERRAMIENTA, FALTA_REPUESTO y ERROR_DOCUMENTACION del conteo. Legacy NULL trust_score = 1.0.';

COMMENT ON TRIGGER trg_recalculate_technician_level ON technician_skill_evidence IS
  'Trigger que dispara el recálculo de nivel automático tras cada inserción de evidencia';

-- ============================================================
-- SECCIÓN 9: Row Level Security (RLS)
-- ============================================================
-- Matriz de acceso:
--   TECHNICIAN = SELECT en catálogos + INSERT/READ en instancias propias
--   PLANNER    = SELECT en todas + INSERT/UPDATE en instancias/respuestas
--   SUPERVISOR = SELECT en todas + INSERT/UPDATE + verified_by
--   ADMIN      = ALL
-- ============================================================

-- -----------------------------------------------------------
-- 9.1 causa_falla_catalog — Solo lectura
-- -----------------------------------------------------------
ALTER TABLE causa_falla_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY cfc_select ON causa_falla_catalog
  FOR SELECT TO authenticated USING (
    get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN')
  );

CREATE POLICY cfc_insert ON causa_falla_catalog
  FOR INSERT TO authenticated WITH CHECK (
    get_user_role() = 'ADMIN'
  );

CREATE POLICY cfc_update ON causa_falla_catalog
  FOR UPDATE TO authenticated USING (
    get_user_role() = 'ADMIN'
  ) WITH CHECK (
    get_user_role() = 'ADMIN'
  );

CREATE POLICY cfc_delete ON causa_falla_catalog
  FOR DELETE TO authenticated USING (
    get_user_role() = 'ADMIN'
  );

-- -----------------------------------------------------------
-- 9.2 checklist_templates — Solo lectura para TECHNICIAN
-- -----------------------------------------------------------
ALTER TABLE checklist_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY ct_select ON checklist_templates
  FOR SELECT TO authenticated USING (
    get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN')
  );

CREATE POLICY ct_insert ON checklist_templates
  FOR INSERT TO authenticated WITH CHECK (
    get_user_role() IN ('PLANNER', 'ADMIN')
  );

CREATE POLICY ct_update ON checklist_templates
  FOR UPDATE TO authenticated USING (
    get_user_role() IN ('PLANNER', 'ADMIN')
  ) WITH CHECK (
    get_user_role() IN ('PLANNER', 'ADMIN')
  );

CREATE POLICY ct_delete ON checklist_templates
  FOR DELETE TO authenticated USING (
    get_user_role() = 'ADMIN'
  );

-- -----------------------------------------------------------
-- 9.3 checklist_template_items — Mismas reglas que templates
-- -----------------------------------------------------------
ALTER TABLE checklist_template_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY cti_select ON checklist_template_items
  FOR SELECT TO authenticated USING (
    get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN')
  );

CREATE POLICY cti_insert ON checklist_template_items
  FOR INSERT TO authenticated WITH CHECK (
    get_user_role() IN ('PLANNER', 'ADMIN')
  );

CREATE POLICY cti_update ON checklist_template_items
  FOR UPDATE TO authenticated USING (
    get_user_role() IN ('PLANNER', 'ADMIN')
  ) WITH CHECK (
    get_user_role() IN ('PLANNER', 'ADMIN')
  );

CREATE POLICY cti_delete ON checklist_template_items
  FOR DELETE TO authenticated USING (
    get_user_role() = 'ADMIN'
  );

-- -----------------------------------------------------------
-- 9.4 checklist_instances — TECHNICIAN solo propias, PLANNER todas
-- -----------------------------------------------------------
ALTER TABLE checklist_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY ci_select ON checklist_instances
  FOR SELECT TO authenticated USING (
    get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN')
  );

CREATE POLICY ci_insert ON checklist_instances
  FOR INSERT TO authenticated WITH CHECK (
    get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN')
    AND (get_user_role() != 'TECHNICIAN' OR technician_id = auth.uid())
  );

CREATE POLICY ci_update ON checklist_instances
  FOR UPDATE TO authenticated USING (
    get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN')
    AND (get_user_role() != 'TECHNICIAN' OR technician_id = auth.uid())
  ) WITH CHECK (
    get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN')
    AND (get_user_role() != 'TECHNICIAN' OR technician_id = auth.uid())
  );

CREATE POLICY ci_delete ON checklist_instances
  FOR DELETE TO authenticated USING (
    get_user_role() = 'ADMIN'
  );

-- -----------------------------------------------------------
-- 9.5 checklist_item_responses — TECHNICIAN solo respuestas propias
-- -----------------------------------------------------------
ALTER TABLE checklist_item_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY cir_select ON checklist_item_responses
  FOR SELECT TO authenticated USING (
    get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN')
  );

CREATE POLICY cir_insert ON checklist_item_responses
  FOR INSERT TO authenticated WITH CHECK (
    get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN')
  );

CREATE POLICY cir_update ON checklist_item_responses
  FOR UPDATE TO authenticated USING (
    get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN')
  ) WITH CHECK (
    get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN')
  );

CREATE POLICY cir_delete ON checklist_item_responses
  FOR DELETE TO authenticated USING (
    get_user_role() = 'ADMIN'
  );

-- -----------------------------------------------------------
-- 9.6 checklist_sampling_config — Solo lectura para TECHNICIAN
-- -----------------------------------------------------------
ALTER TABLE checklist_sampling_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY csc_select ON checklist_sampling_config
  FOR SELECT TO authenticated USING (
    get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN')
  );

CREATE POLICY csc_insert ON checklist_sampling_config
  FOR INSERT TO authenticated WITH CHECK (
    get_user_role() IN ('PLANNER', 'ADMIN')
  );

CREATE POLICY csc_update ON checklist_sampling_config
  FOR UPDATE TO authenticated USING (
    get_user_role() IN ('PLANNER', 'ADMIN')
  ) WITH CHECK (
    get_user_role() IN ('PLANNER', 'ADMIN')
  );

CREATE POLICY csc_delete ON checklist_sampling_config
  FOR DELETE TO authenticated USING (
    get_user_role() = 'ADMIN'
  );

-- ============================================================
-- SECCIÓN 10: Triggers de Mantenimiento y Auditoría
-- ============================================================

-- -----------------------------------------------------------
-- 10.1 updated_at en checklist_templates
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION set_checklist_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_checklist_templates_updated_at ON checklist_templates;

CREATE TRIGGER trg_checklist_templates_updated_at
  BEFORE UPDATE ON checklist_templates
  FOR EACH ROW
  EXECUTE FUNCTION set_checklist_updated_at();

COMMENT ON TRIGGER trg_checklist_templates_updated_at ON checklist_templates IS
  'Actualiza updated_at automáticamente al modificar un template';

-- -----------------------------------------------------------
-- 10.2 Auditoría en checklist_instances
-- -----------------------------------------------------------
DROP TRIGGER IF EXISTS checklist_instances_audit ON checklist_instances;
CREATE TRIGGER checklist_instances_audit
  AFTER INSERT OR UPDATE OR DELETE ON checklist_instances
  FOR EACH ROW
  EXECUTE FUNCTION audit_trigger_func();

-- -----------------------------------------------------------
-- 10.3 Auditoría en checklist_item_responses
-- -----------------------------------------------------------
DROP TRIGGER IF EXISTS checklist_item_responses_audit ON checklist_item_responses;
CREATE TRIGGER checklist_item_responses_audit
  AFTER INSERT OR UPDATE OR DELETE ON checklist_item_responses
  FOR EACH ROW
  EXECUTE FUNCTION audit_trigger_func();
