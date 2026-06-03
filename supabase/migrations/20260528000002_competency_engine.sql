-- ============================================================
-- MIGRACIÓN 16: Motor de Competencias
-- Change: competency-engine
-- ============================================================
-- Motor de competencias: niveles de proficiencia, evidencia de
-- habilidades, requisitos por plan de trabajo, y cálculo
-- automático del nivel vía triggers. Incluye función de
-- soft-lock para validar competencia al asignar técnicos.
-- ============================================================

-- ============================================================
-- SECCIÓN 1: proficiency_levels — Catálogo de niveles
-- ============================================================

CREATE TABLE IF NOT EXISTS proficiency_levels (
  level INT PRIMARY KEY CHECK (level BETWEEN 1 AND 5),
  name TEXT NOT NULL,
  trigger_description TEXT NOT NULL
);

COMMENT ON TABLE proficiency_levels IS
  'Catálogo de niveles de proficiencia del 1 (Awareness) al 5 (Master). Cada nivel describe el método de obtención';

COMMENT ON COLUMN proficiency_levels.level IS
  'Nivel de proficiencia (1-5, llave primaria)';

COMMENT ON COLUMN proficiency_levels.name IS
  'Nombre del nivel: Awareness (1), Assisted (2), Independent (3), Specialist (4), Master (5)';

COMMENT ON COLUMN proficiency_levels.trigger_description IS
  'Descripción de la condición que dispara la obtención del nivel';

INSERT INTO proficiency_levels (level, name, trigger_description) VALUES
  (1, 'Awareness', 'Inducción completada por Admin'),
  (2, 'Assisted', 'Bloque A (Seguridad) aprobado en campo'),
  (3, 'Independent', 'Bloque B (Ejecución) consistente en 5+ OTs'),
  (4, 'Specialist', 'Bloque C (Precisión) desbloqueado'),
  (5, 'Master', 'Autor de estándares aprobados')
ON CONFLICT (level) DO NOTHING;

-- ============================================================
-- SECCIÓN 2: technician_skills — Nivel actual por técnico+módulo
-- ============================================================

CREATE TABLE IF NOT EXISTS technician_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id UUID NOT NULL REFERENCES user_profiles(id),
  module_id UUID NOT NULL REFERENCES technological_modules(id),
  current_level INT NOT NULL DEFAULT 1,
  calculated_at TIMESTAMPTZ,
  UNIQUE(technician_id, module_id)
);

COMMENT ON TABLE technician_skills IS
  'Nivel de competencia actual del técnico por módulo tecnológico. Se actualiza automáticamente vía triggers al insertar evidencia o cambiar indicadores de progreso';

COMMENT ON COLUMN technician_skills.id IS
  'Identificador único del registro de competencia';

COMMENT ON COLUMN technician_skills.technician_id IS
  'Técnico evaluado (FK a user_profiles)';

COMMENT ON COLUMN technician_skills.module_id IS
  'Módulo tecnológico evaluado (FK a technological_modules)';

COMMENT ON COLUMN technician_skills.current_level IS
  'Nivel actual calculado (1-5). Default 1 (Awareness)';

COMMENT ON COLUMN technician_skills.calculated_at IS
  'Momento del último cálculo del nivel por trigger';

CREATE INDEX IF NOT EXISTS idx_technician_skills_technician ON technician_skills(technician_id);
CREATE INDEX IF NOT EXISTS idx_technician_skills_module ON technician_skills(module_id);

-- ============================================================
-- SECCIÓN 3: skill_requirements — Requisitos mínimos por job_plan
-- ============================================================

CREATE TABLE IF NOT EXISTS skill_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_plan_id UUID REFERENCES job_plans(id),
  work_type TEXT,
  module_id UUID NOT NULL REFERENCES technological_modules(id),
  minimum_level_required INT NOT NULL CHECK (minimum_level_required BETWEEN 1 AND 5),
  UNIQUE(job_plan_id, module_id)
);

COMMENT ON TABLE skill_requirements IS
  'Requisitos mínimos de competencia por plan de trabajo y módulo tecnológico. Define qué nivel se exige para ejecutar un job_plan en un módulo específico';

COMMENT ON COLUMN skill_requirements.id IS
  'Identificador único del requisito';

COMMENT ON COLUMN skill_requirements.job_plan_id IS
  'Plan de trabajo asociado (FK a job_plans, nullable para requisitos genéricos futuros)';

COMMENT ON COLUMN skill_requirements.work_type IS
  'Tipo de trabajo alternativo para requisitos no asociados a un job_plan (nullable, reservado para uso futuro)';

COMMENT ON COLUMN skill_requirements.module_id IS
  'Módulo tecnológico sobre el que se exige competencia';

COMMENT ON COLUMN skill_requirements.minimum_level_required IS
  'Nivel mínimo requerido (1-5) para ejecutar tareas de este job_plan en el módulo';

CREATE INDEX IF NOT EXISTS idx_skill_requirements_job_plan ON skill_requirements(job_plan_id);
CREATE INDEX IF NOT EXISTS idx_skill_requirements_module ON skill_requirements(module_id);

-- ============================================================
-- SECCIÓN 4: technician_skill_evidence — Evidencia de evaluación
-- ============================================================

CREATE TABLE IF NOT EXISTS technician_skill_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  technician_id UUID NOT NULL REFERENCES user_profiles(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  modulo_gema TEXT NOT NULL,
  nivel_evaluado INT NOT NULL CHECK (nivel_evaluado IN (2, 3, 4)),
  item_evaluado TEXT NOT NULL,
  status BOOLEAN NOT NULL,
  evaluated_at TIMESTAMPTZ DEFAULT NOW(),
  evaluated_by UUID NOT NULL DEFAULT auth.uid() REFERENCES user_profiles(id)
);

COMMENT ON TABLE technician_skill_evidence IS
  'Evidencia de evaluación de competencia en campo. Cada fila representa un ítem evaluado (PASS/FAIL) para un técnico en una orden de trabajo';

COMMENT ON COLUMN technician_skill_evidence.id IS
  'Identificador único de la evidencia';

COMMENT ON COLUMN technician_skill_evidence.work_order_id IS
  'Orden de trabajo donde se realizó la evaluación (FK a work_orders)';

COMMENT ON COLUMN technician_skill_evidence.technician_id IS
  'Técnico evaluado (FK a user_profiles)';

COMMENT ON COLUMN technician_skill_evidence.asset_id IS
  'Activo sobre el que se evaluó la competencia (FK a assets)';

COMMENT ON COLUMN technician_skill_evidence.modulo_gema IS
  'Código del módulo tecnológico evaluado (ej: M-PACK). Almacenado como TEXT para resiliencia offline';

COMMENT ON COLUMN technician_skill_evidence.nivel_evaluado IS
  'Nivel evaluado en esta evidencia: 2 (Assisted), 3 (Independent), o 4 (Specialist). No se evalúa 1 (inducción) ni 5 (autor) en campo';

COMMENT ON COLUMN technician_skill_evidence.item_evaluado IS
  'Descripción del ítem o habilidad específica evaluada';

COMMENT ON COLUMN technician_skill_evidence.status IS
  'Resultado de la evaluación: true = PASS (aprobado), false = FAIL (reprobado)';

COMMENT ON COLUMN technician_skill_evidence.evaluated_at IS
  'Momento de la evaluación (default NOW())';

COMMENT ON COLUMN technician_skill_evidence.evaluated_by IS
  'Evaluador que registró la evidencia (FK a user_profiles, default al usuario autenticado)';

CREATE INDEX IF NOT EXISTS idx_evidence_technician ON technician_skill_evidence(technician_id);
CREATE INDEX IF NOT EXISTS idx_evidence_work_order ON technician_skill_evidence(work_order_id);
CREATE INDEX IF NOT EXISTS idx_evidence_modulo ON technician_skill_evidence(modulo_gema);
CREATE INDEX IF NOT EXISTS idx_evidence_status ON technician_skill_evidence(status);

-- ============================================================
-- SECCIÓN 5: technician_module_progress — Progreso por técnico+módulo
-- ============================================================

CREATE TABLE IF NOT EXISTS technician_module_progress (
  technician_id UUID NOT NULL REFERENCES user_profiles(id),
  module_id UUID NOT NULL REFERENCES technological_modules(id),
  induccion_completada BOOLEAN DEFAULT false,
  autor_estandar BOOLEAN DEFAULT false,
  updated_by UUID NOT NULL DEFAULT auth.uid() REFERENCES user_profiles(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (technician_id, module_id)
);

COMMENT ON TABLE technician_module_progress IS
  'Indicadores de progreso del técnico por módulo: inducción completada (nivel 1) y autor de estándar (nivel 5). Estos flags controlan los niveles que no se evalúan en campo';

COMMENT ON COLUMN technician_module_progress.technician_id IS
  'Técnico (FK a user_profiles, parte de la llave primaria compuesta)';

COMMENT ON COLUMN technician_module_progress.module_id IS
  'Módulo tecnológico (FK a technological_modules, parte de la llave primaria compuesta)';

COMMENT ON COLUMN technician_module_progress.induccion_completada IS
  'TRUE si el técnico completó la inducción del módulo (desbloquea nivel 1 — Awareness)';

COMMENT ON COLUMN technician_module_progress.autor_estandar IS
  'TRUE si el técnico es autor de estándares aprobados (desbloquea nivel 5 — Master)';

COMMENT ON COLUMN technician_module_progress.updated_by IS
  'Usuario que actualizó los indicadores (FK a user_profiles, default al usuario autenticado)';

COMMENT ON COLUMN technician_module_progress.updated_at IS
  'Última modificación de los indicadores';

-- ============================================================
-- SECCIÓN 6: Trigger updated_at en technician_module_progress
-- ============================================================

CREATE OR REPLACE FUNCTION set_progress_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_progress_updated_at ON technician_module_progress;

CREATE TRIGGER trg_progress_updated_at
  BEFORE UPDATE ON technician_module_progress
  FOR EACH ROW
  EXECUTE FUNCTION set_progress_updated_at();

COMMENT ON TRIGGER trg_progress_updated_at ON technician_module_progress IS
  'Actualiza updated_at automáticamente al modificar los indicadores de progreso';

-- ============================================================
-- SECCIÓN 7: Trigger trg_recalculate_technician_level
--   AFTER INSERT ON technician_skill_evidence
--   Calcula el nivel máximo alcanzado por técnico+módulo
--   basado en evidencia PASS y banderas de progreso.
-- ============================================================

CREATE OR REPLACE FUNCTION trg_recalculate_technician_level()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_module_id UUID;
  v_level INT;
  v_has_lv2 BOOLEAN;
  v_lv3_count INT;
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

  -- Verificar nivel 3: 5 o más evidencias PASS en nivel 3
  SELECT COUNT(*) INTO v_lv3_count
  FROM technician_skill_evidence
  WHERE technician_id = NEW.technician_id
    AND modulo_gema = NEW.modulo_gema
    AND nivel_evaluado = 3
    AND status = true;

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

  -- Calcular nivel máximo: se toma el GREATEST de todos los niveles alcanzados.
  -- La lógica permite saltos (ej: nivel 4 sin nivel 3 completo es válido).
  v_level := 1;
  IF v_has_lv2 THEN v_level := GREATEST(v_level, 2); END IF;
  IF v_lv3_count >= 5 THEN v_level := GREATEST(v_level, 3); END IF;
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
  'Recalcula el nivel de competencia del técnico al insertar nueva evidencia. Evalúa PASS en niveles 2-4 y banderas de progreso (inducción, autor). UPSERT en technician_skills';

COMMENT ON TRIGGER trg_recalculate_technician_level ON technician_skill_evidence IS
  'Trigger que dispara el recálculo de nivel automático tras cada inserción de evidencia';

-- ============================================================
-- SECCIÓN 8: Trigger trg_update_module_progress
--   AFTER UPDATE ON technician_module_progress
--   Recalcula el nivel cuando cambian las banderas de
--   inducción o autor de estándar.
-- ============================================================

CREATE OR REPLACE FUNCTION trg_update_module_progress()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_module_code TEXT;
  v_level INT;
  v_has_lv2 BOOLEAN;
  v_lv3_count INT;
  v_has_lv4 BOOLEAN;
BEGIN
  -- Obtener código del módulo para consultar evidencia (almacenada por código TEXT)
  SELECT code INTO v_module_code
  FROM technological_modules
  WHERE id = NEW.module_id;

  IF v_module_code IS NULL THEN
    RETURN NEW;
  END IF;

  -- Verificar nivel 2
  SELECT EXISTS(
    SELECT 1 FROM technician_skill_evidence
    WHERE technician_id = NEW.technician_id
      AND modulo_gema = v_module_code
      AND nivel_evaluado = 2
      AND status = true
  ) INTO v_has_lv2;

  -- Verificar nivel 3
  SELECT COUNT(*) INTO v_lv3_count
  FROM technician_skill_evidence
  WHERE technician_id = NEW.technician_id
    AND modulo_gema = v_module_code
    AND nivel_evaluado = 3
    AND status = true;

  -- Verificar nivel 4
  SELECT EXISTS(
    SELECT 1 FROM technician_skill_evidence
    WHERE technician_id = NEW.technician_id
      AND modulo_gema = v_module_code
      AND nivel_evaluado = 4
      AND status = true
  ) INTO v_has_lv4;

  -- Calcular nivel máximo usando las banderas NUEVAS y la evidencia existente
  v_level := 1;
  IF v_has_lv2 THEN v_level := GREATEST(v_level, 2); END IF;
  IF v_lv3_count >= 5 THEN v_level := GREATEST(v_level, 3); END IF;
  IF v_has_lv4 THEN v_level := GREATEST(v_level, 4); END IF;
  IF NEW.autor_estandar THEN v_level := GREATEST(v_level, 5); END IF;

  -- UPSERT en technician_skills
  INSERT INTO technician_skills (technician_id, module_id, current_level, calculated_at)
  VALUES (NEW.technician_id, NEW.module_id, v_level, NOW())
  ON CONFLICT (technician_id, module_id)
  DO UPDATE SET current_level = v_level, calculated_at = NOW();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_module_progress ON technician_module_progress;

CREATE TRIGGER trg_update_module_progress
  AFTER UPDATE ON technician_module_progress
  FOR EACH ROW
  EXECUTE FUNCTION trg_update_module_progress();

COMMENT ON FUNCTION trg_update_module_progress IS
  'Recalcula el nivel de competencia al actualizar banderas de progreso (inducción_completada, autor_estandar)';

COMMENT ON TRIGGER trg_update_module_progress ON technician_module_progress IS
  'Trigger que dispara recálculo de nivel tras cambios en las banderas de progreso del técnico';

-- ============================================================
-- SECCIÓN 9: Función check_competency_for_assignment()
--   Valida si un técnico cumple con el nivel mínimo requerido
--   para una orden de trabajo. Retorna advertencia (WARNING)
--   si está por debajo, sin bloquear la asignación (soft-lock).
-- ============================================================

CREATE OR REPLACE FUNCTION check_competency_for_assignment(
  p_technician_id UUID,
  p_work_order_id TEXT
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_asset_id TEXT;
  v_job_plan_id UUID;
  v_module_id UUID;
  v_required_level INT;
  v_current_level INT;
  v_found_requirement BOOLEAN := false;
BEGIN
  -- Obtener activo y plan de trabajo de la orden de trabajo
  SELECT asset_id, job_plan_id INTO v_asset_id, v_job_plan_id
  FROM work_orders
  WHERE id = p_work_order_id;

  IF v_asset_id IS NULL THEN
    RETURN json_build_object(
      'status', 'OK',
      'current_level', NULL::INT,
      'required_level', NULL::INT,
      'message', 'No se encontró la orden de trabajo o no tiene activo asignado'
    );
  END IF;

  -- Obtener módulo tecnológico del activo
  SELECT module_id INTO v_module_id
  FROM assets
  WHERE id = v_asset_id;

  IF v_module_id IS NULL THEN
    RETURN json_build_object(
      'status', 'OK',
      'current_level', NULL::INT,
      'required_level', NULL::INT,
      'message', 'El activo no tiene módulo tecnológico asignado'
    );
  END IF;

  -- Buscar requisito de competencia por job_plan (si existe)
  IF v_job_plan_id IS NOT NULL THEN
    SELECT minimum_level_required INTO v_required_level
    FROM skill_requirements
    WHERE job_plan_id = v_job_plan_id AND module_id = v_module_id;

    IF FOUND THEN
      v_found_requirement := true;
    END IF;
  END IF;

  -- Si no hay requisito definido, pasa OK sin restricción
  IF NOT v_found_requirement THEN
    RETURN json_build_object(
      'status', 'OK',
      'current_level', NULL::INT,
      'required_level', NULL::INT,
      'message', 'No hay requisito de competencia definido para esta combinación'
    );
  END IF;

  -- Obtener nivel actual del técnico en el módulo
  SELECT current_level INTO v_current_level
  FROM technician_skills
  WHERE technician_id = p_technician_id AND module_id = v_module_id;

  IF NOT FOUND THEN
    v_current_level := 1;
  END IF;

  -- Comparar: si cumple o supera el mínimo, OK; si no, WARNING
  IF v_current_level >= v_required_level THEN
    RETURN json_build_object(
      'status', 'OK',
      'current_level', v_current_level,
      'required_level', v_required_level,
      'message', 'El técnico cumple con el nivel de competencia requerido'
    );
  ELSE
    RETURN json_build_object(
      'status', 'WARNING',
      'current_level', v_current_level,
      'required_level', v_required_level,
      'message', 'El técnico seleccionado no cuenta con la competencia registrada para este módulo. Se requiere supervisión.'
    );
  END IF;
END;
$$;

COMMENT ON FUNCTION check_competency_for_assignment IS
  'Valida si un técnico cumple con el nivel mínimo de competencia requerido para una orden de trabajo. Retorna OK si cumple o no hay requisito; WARNING si está por debajo. No bloquea la asignación (soft-lock)';

-- ============================================================
-- SECCIÓN 10: Row Level Security (RLS)
-- ============================================================
-- Matriz de acceso:
--   TECHNICIAN = SELECT en todas las tablas
--   PLANNER    = SELECT en todas + INSERT/UPDATE en evidence y progress
--   ADMIN      = ALL
-- ============================================================

-- -----------------------------------------------------------
-- 10.1 proficiency_levels — Catálogo de solo lectura
-- -----------------------------------------------------------
ALTER TABLE proficiency_levels ENABLE ROW LEVEL SECURITY;

CREATE POLICY proficiency_levels_select ON proficiency_levels
  FOR SELECT TO authenticated USING (
    get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN')
  );

CREATE POLICY proficiency_levels_insert ON proficiency_levels
  FOR INSERT TO authenticated WITH CHECK (
    get_user_role() = 'ADMIN'
  );

CREATE POLICY proficiency_levels_update ON proficiency_levels
  FOR UPDATE TO authenticated USING (
    get_user_role() = 'ADMIN'
  ) WITH CHECK (
    get_user_role() = 'ADMIN'
  );

CREATE POLICY proficiency_levels_delete ON proficiency_levels
  FOR DELETE TO authenticated USING (
    get_user_role() = 'ADMIN'
  );

-- -----------------------------------------------------------
-- 10.2 technician_skills — Solo lectura para TECHNICIAN/PLANNER
-- -----------------------------------------------------------
ALTER TABLE technician_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY technician_skills_select ON technician_skills
  FOR SELECT TO authenticated USING (
    get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN')
  );

-- technician_skills se actualiza automáticamente por triggers SECURITY DEFINER
CREATE POLICY technician_skills_insert ON technician_skills
  FOR INSERT TO authenticated WITH CHECK (
    get_user_role() = 'ADMIN'
  );

CREATE POLICY technician_skills_update ON technician_skills
  FOR UPDATE TO authenticated USING (
    get_user_role() = 'ADMIN'
  ) WITH CHECK (
    get_user_role() = 'ADMIN'
  );

CREATE POLICY technician_skills_delete ON technician_skills
  FOR DELETE TO authenticated USING (
    get_user_role() = 'ADMIN'
  );

-- -----------------------------------------------------------
-- 10.3 skill_requirements — PLANNER puede gestionar requisitos
-- -----------------------------------------------------------
ALTER TABLE skill_requirements ENABLE ROW LEVEL SECURITY;

CREATE POLICY skill_requirements_select ON skill_requirements
  FOR SELECT TO authenticated USING (
    get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN')
  );

CREATE POLICY skill_requirements_insert ON skill_requirements
  FOR INSERT TO authenticated WITH CHECK (
    get_user_role() IN ('PLANNER', 'ADMIN')
  );

CREATE POLICY skill_requirements_update ON skill_requirements
  FOR UPDATE TO authenticated USING (
    get_user_role() IN ('PLANNER', 'ADMIN')
  ) WITH CHECK (
    get_user_role() IN ('PLANNER', 'ADMIN')
  );

CREATE POLICY skill_requirements_delete ON skill_requirements
  FOR DELETE TO authenticated USING (
    get_user_role() = 'ADMIN'
  );

-- -----------------------------------------------------------
-- 10.4 technician_skill_evidence — PLANNER insert/update, no delete
-- -----------------------------------------------------------
ALTER TABLE technician_skill_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY evidence_select ON technician_skill_evidence
  FOR SELECT TO authenticated USING (
    get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN')
  );

CREATE POLICY evidence_insert ON technician_skill_evidence
  FOR INSERT TO authenticated WITH CHECK (
    get_user_role() IN ('PLANNER', 'ADMIN')
  );

CREATE POLICY evidence_update ON technician_skill_evidence
  FOR UPDATE TO authenticated USING (
    get_user_role() IN ('PLANNER', 'ADMIN')
  ) WITH CHECK (
    get_user_role() IN ('PLANNER', 'ADMIN')
  );

-- Sin DELETE para PLANNER (solo ADMIN)
CREATE POLICY evidence_delete ON technician_skill_evidence
  FOR DELETE TO authenticated USING (
    get_user_role() = 'ADMIN'
  );

-- -----------------------------------------------------------
-- 10.5 technician_module_progress — PLANNER insert/update, no delete
-- -----------------------------------------------------------
ALTER TABLE technician_module_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY progress_select ON technician_module_progress
  FOR SELECT TO authenticated USING (
    get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN')
  );

CREATE POLICY progress_insert ON technician_module_progress
  FOR INSERT TO authenticated WITH CHECK (
    get_user_role() IN ('PLANNER', 'ADMIN')
  );

CREATE POLICY progress_update ON technician_module_progress
  FOR UPDATE TO authenticated USING (
    get_user_role() IN ('PLANNER', 'ADMIN')
  ) WITH CHECK (
    get_user_role() IN ('PLANNER', 'ADMIN')
  );

-- Sin DELETE para PLANNER (solo ADMIN)
CREATE POLICY progress_delete ON technician_module_progress
  FOR DELETE TO authenticated USING (
    get_user_role() = 'ADMIN'
  );

-- ============================================================
-- SECCIÓN 11: Triggers de Auditoría
-- ============================================================
-- Reutiliza audit_trigger_func() definida en Migration 1
-- (rbac_audit.sql). Se adjunta a las tablas transaccionales
-- que registran actividad humana: evidencia y progreso.
-- ============================================================

-- -----------------------------------------------------------
-- 11.1 technician_skill_evidence
-- -----------------------------------------------------------
DROP TRIGGER IF EXISTS technician_skill_evidence_audit ON technician_skill_evidence;
CREATE TRIGGER technician_skill_evidence_audit
  AFTER INSERT OR UPDATE OR DELETE ON technician_skill_evidence
  FOR EACH ROW
  EXECUTE FUNCTION audit_trigger_func();

-- NOTA: technician_module_progress NO tiene audit trigger porque
-- usa PK compuesta (technician_id, module_id) sin columna id.
-- audit_trigger_func() espera NEW.id, lo que causa error en esta tabla.
-- Es una tabla de configuración (flags), no transaccional.
-- updated_at trigger + RLS son suficientes para v1.
