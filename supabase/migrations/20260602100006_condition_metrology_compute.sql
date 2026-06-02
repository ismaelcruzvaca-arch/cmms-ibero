-- ============================================================
-- MIGRATION: condition_metrology_compute — Análisis + Reglas (PR 2a)
-- Change: condition-monitoring-base-metrology (PR 2a)
-- ============================================================
-- Crea las tablas de resultados de análisis y reglas de condición:
--   condition_analysis_results — resultados de HI, tendencias, residuales
--   condition_rules            — reglas versionadas con evaluación contextual
--
-- Idempotente: usa CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
--   DROP POLICY IF EXISTS + CREATE POLICY, COMMENT ON.
--
-- Dependencias:
--   condition_feature_definitions (FK feature_definition_id)
--   condition_analysis_methods  (FK method_key → method_key UNIQUE)
--   condition_windows           (input_window_ids UUID[] referencia lógica)
--
-- RLS:
--   condition_analysis_results:
--     SELECT → authenticated (todos los roles)
--     INSERT/UPDATE/DELETE → ADMIN solamente (resultados computados por el sistema)
--   condition_rules:
--     SELECT → authenticated (todos los roles)
--     INSERT/UPDATE/DELETE → PLANNER, ADMIN
-- ============================================================

-- ============================================================
-- 1. TABLA: condition_analysis_results
--    Resultados de análisis derivados: Health Index, pendiente de
--    tendencia, residuales, estado de filtro Kalman, RUL estimado.
--    Separados de los feature_values crudos para trazabilidad del
--    pipeline analítico.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.condition_analysis_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id TEXT NOT NULL,
  feature_definition_id UUID REFERENCES public.condition_feature_definitions(id),
  analysis_type TEXT NOT NULL CHECK (analysis_type IN (
    'health_index', 'trend_slope', 'residual', 'kalman_state', 'rul_estimate'
  )),
  method_key TEXT NOT NULL REFERENCES public.condition_analysis_methods(method_key),
  method_version TEXT NOT NULL,
  parameters JSONB DEFAULT '{}',
  result_value NUMERIC,
  result_unit TEXT,
  confidence NUMERIC CHECK (confidence >= 0 AND confidence <= 1),
  r_squared NUMERIC,
  window_start TIMESTAMPTZ,
  window_end TIMESTAMPTZ,
  input_window_ids UUID[] DEFAULT '{}',
  validation_status TEXT DEFAULT 'draft' CHECK (validation_status IN (
    'draft', 'candidate', 'bench_validated', 'field_trial', 'active', 'deprecated', 'rejected'
  )),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.condition_analysis_results
  IS 'Resultados de análisis derivados: HI, tendencias, residuales, estados Kalman, RUL';

COMMENT ON COLUMN public.condition_analysis_results.asset_id
  IS 'Referencia al activo monitoreado';

COMMENT ON COLUMN public.condition_analysis_results.feature_definition_id
  IS 'FK a condition_feature_definitions. NULL si el resultado es compuesto (ej: HI multi-feature)';

COMMENT ON COLUMN public.condition_analysis_results.analysis_type
  IS 'Tipo de análisis: health_index, trend_slope, residual, kalman_state, rul_estimate';

COMMENT ON COLUMN public.condition_analysis_results.method_key
  IS 'FK a condition_analysis_methods — método usado para el cómputo';

COMMENT ON COLUMN public.condition_analysis_results.method_version
  IS 'Versión del método usado (obligatorio para trazabilidad)';

COMMENT ON COLUMN public.condition_analysis_results.parameters
  IS 'Parámetros usados en el cómputo (JSONB)';

COMMENT ON COLUMN public.condition_analysis_results.result_value
  IS 'Valor numérico del resultado (HI, pendiente, residual, etc.)';

COMMENT ON COLUMN public.condition_analysis_results.result_unit
  IS 'Unidad del resultado (ej: HI, HI/day, mm/s)';

COMMENT ON COLUMN public.condition_analysis_results.confidence
  IS 'Confianza del resultado (0-1). Heredado de los feature_values fuente';

COMMENT ON COLUMN public.condition_analysis_results.r_squared
  IS 'R² del ajuste — usado en trend_slope para regresiones';

COMMENT ON COLUMN public.condition_analysis_results.window_start
  IS 'Inicio del período cubierto por este análisis';

COMMENT ON COLUMN public.condition_analysis_results.window_end
  IS 'Fin del período cubierto por este análisis';

COMMENT ON COLUMN public.condition_analysis_results.input_window_ids
  IS 'UUID[] de condition_windows que alimentaron este análisis — trazabilidad completa';

COMMENT ON COLUMN public.condition_analysis_results.validation_status
  IS 'Ciclo de validación: draft → candidate → bench_validated → field_trial → active → deprecated';

COMMENT ON COLUMN public.condition_analysis_results.created_at
  IS 'Fecha de creación del resultado';

-- ============================================================
-- 2. ÍNDICES: condition_analysis_results
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_ar_asset
  ON public.condition_analysis_results(asset_id);

CREATE INDEX IF NOT EXISTS idx_ar_type
  ON public.condition_analysis_results(analysis_type);

CREATE INDEX IF NOT EXISTS idx_ar_method_key
  ON public.condition_analysis_results(method_key);

CREATE INDEX IF NOT EXISTS idx_ar_window_end
  ON public.condition_analysis_results(window_end DESC);

CREATE INDEX IF NOT EXISTS idx_ar_created_at
  ON public.condition_analysis_results(created_at);

-- ============================================================
-- 3. TABLA: condition_rules
--    Reglas de condición versionadas con evaluación contextualizada
--    por asset_class + feature_key + method_key + regime.
--    Soporta evaluación threshold, trend, compound, y residual.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.condition_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name TEXT NOT NULL,
  description TEXT,
  asset_class TEXT,
  feature_key TEXT,
  method_key TEXT,
  regime TEXT,
  min_quality_flag TEXT DEFAULT 'G2' CHECK (min_quality_flag IN ('G0', 'G1', 'G2', 'G3')),
  evaluation_type TEXT NOT NULL CHECK (evaluation_type IN (
    'threshold', 'trend', 'compound', 'residual'
  )),
  rule_config JSONB NOT NULL DEFAULT '{}',
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  action TEXT NOT NULL DEFAULT 'log_event' CHECK (action IN ('log_event', 'create_wo', 'notify')),
  validation_status TEXT DEFAULT 'draft' CHECK (validation_status IN (
    'draft', 'candidate', 'bench_validated', 'field_trial', 'active', 'deprecated', 'rejected'
  )),
  version INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(rule_name, version)
);

COMMENT ON TABLE public.condition_rules
  IS 'Reglas de condición versionadas con evaluación contextualizada';

COMMENT ON COLUMN public.condition_rules.rule_name
  IS 'Nombre descriptivo de la regla (ej: vibration.rms HIGH)';

COMMENT ON COLUMN public.condition_rules.description
  IS 'Descripción detallada de la regla y su propósito';

COMMENT ON COLUMN public.condition_rules.asset_class
  IS 'Clase de activo a la que aplica (NULL = aplica a cualquier clase)';

COMMENT ON COLUMN public.condition_rules.feature_key
  IS 'Feature al que aplica (NULL si regla compuesta definida en rule_config)';

COMMENT ON COLUMN public.condition_rules.method_key
  IS 'Método al que aplica (NULL = aplica a cualquier método para ese feature_key)';

COMMENT ON COLUMN public.condition_rules.regime
  IS 'Régimen operativo al que aplica (NULL = aplica a cualquier régimen)';

COMMENT ON COLUMN public.condition_rules.min_quality_flag
  IS 'Calidad mínima requerida: G0(excelente), G1(buena), G2(aceptable), G3(no confiable)';

COMMENT ON COLUMN public.condition_rules.evaluation_type
  IS 'Tipo de evaluación: threshold, trend, compound, residual';

COMMENT ON COLUMN public.condition_rules.rule_config
  IS 'Configuración JSON: thresholds, duration_windows, condiciones compuestas, min_confidence';

COMMENT ON COLUMN public.condition_rules.severity
  IS 'Severidad del evento generado: info, warning, critical';

COMMENT ON COLUMN public.condition_rules.action
  IS 'Acción a ejecutar: log_event, create_wo, notify';

COMMENT ON COLUMN public.condition_rules.validation_status
  IS 'Ciclo de validación: draft → candidate → bench_validated → field_trial → active → deprecated';

COMMENT ON COLUMN public.condition_rules.version
  IS 'Versión de la regla; modificaciones crean nueva versión, anterior se depreca';

COMMENT ON COLUMN public.condition_rules.created_at
  IS 'Fecha de creación de la regla';

COMMENT ON COLUMN public.condition_rules.updated_at
  IS 'Fecha de última modificación de la regla';

-- ============================================================
-- 4. ÍNDICES: condition_rules
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_rules_feature
  ON public.condition_rules(feature_key);

CREATE INDEX IF NOT EXISTS idx_rules_asset_class
  ON public.condition_rules(asset_class);

CREATE INDEX IF NOT EXISTS idx_rules_validation
  ON public.condition_rules(validation_status);

CREATE INDEX IF NOT EXISTS idx_rules_severity
  ON public.condition_rules(severity);

-- ============================================================
-- 5. TRIGGER: actualización automática de updated_at en rules
-- ============================================================
CREATE OR REPLACE FUNCTION public.tgr_condition_rules_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_condition_rules_updated_at ON public.condition_rules;
CREATE TRIGGER trg_condition_rules_updated_at
  BEFORE UPDATE ON public.condition_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.tgr_condition_rules_updated_at();

-- ============================================================
-- 6. SEED DATA: Reglas de ejemplo (2 reglas)
-- ============================================================
INSERT INTO public.condition_rules (
  rule_name, description, asset_class, feature_key, method_key,
  regime, min_quality_flag, evaluation_type, rule_config,
  severity, action, validation_status
) VALUES
(
  'vibration.rms HIGH',
  'Vibración RMS alta en bomba centrífuga — umbral ISO 10816-7 zona D (>7.1 mm/s). Dispara OT crítica para intervención inmediata.',
  'centrifugal_pump',
  'vibration.rms',
  'rms_velocity_window',
  'FULL_LOAD',
  'G2',
  'threshold',
  '{"threshold": 7.1, "duration_windows": 3, "min_confidence": 0.9}',
  'critical',
  'create_wo',
  'draft'
),
(
  'temperature.bearing WARNING',
  'Temperatura de rodamiento elevada en motor eléctrico — alerta temprana. Registra evento para monitoreo sin generar OT.',
  'electric_motor',
  'temperature.bearing',
  'window_average',
  'FULL_LOAD',
  'G2',
  'threshold',
  '{"threshold": 85, "duration_windows": 2, "min_confidence": 0.8}',
  'warning',
  'log_event',
  'draft'
)
ON CONFLICT (rule_name, version) DO NOTHING;

-- ============================================================
-- 7. ROW-LEVEL SECURITY: condition_analysis_results
--    Resultados computados por el sistema — solo ADMIN modifica
-- ============================================================
ALTER TABLE public.condition_analysis_results ENABLE ROW LEVEL SECURITY;

-- SELECT: cualquier usuario autenticado puede leer resultados
DROP POLICY IF EXISTS condition_analysis_results_select ON public.condition_analysis_results;
CREATE POLICY condition_analysis_results_select ON public.condition_analysis_results
  FOR SELECT TO authenticated USING (true);

-- INSERT: solo ADMIN (resultados generados por compute_health_index y EFs)
DROP POLICY IF EXISTS condition_analysis_results_insert ON public.condition_analysis_results;
CREATE POLICY condition_analysis_results_insert ON public.condition_analysis_results
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = 'ADMIN');

-- UPDATE: solo ADMIN
DROP POLICY IF EXISTS condition_analysis_results_update ON public.condition_analysis_results;
CREATE POLICY condition_analysis_results_update ON public.condition_analysis_results
  FOR UPDATE TO authenticated USING (get_user_role() = 'ADMIN')
  WITH CHECK (get_user_role() = 'ADMIN');

-- DELETE: solo ADMIN
DROP POLICY IF EXISTS condition_analysis_results_delete ON public.condition_analysis_results;
CREATE POLICY condition_analysis_results_delete ON public.condition_analysis_results
  FOR DELETE TO authenticated USING (get_user_role() = 'ADMIN');

-- ============================================================
-- 8. ROW-LEVEL SECURITY: condition_rules
--    PLANNER y ADMIN gestionan reglas; todos leen
-- ============================================================
ALTER TABLE public.condition_rules ENABLE ROW LEVEL SECURITY;

-- SELECT: cualquier usuario autenticado puede leer reglas
DROP POLICY IF EXISTS condition_rules_select ON public.condition_rules;
CREATE POLICY condition_rules_select ON public.condition_rules
  FOR SELECT TO authenticated USING (true);

-- INSERT: PLANNER y ADMIN pueden crear reglas
DROP POLICY IF EXISTS condition_rules_insert ON public.condition_rules;
CREATE POLICY condition_rules_insert ON public.condition_rules
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

-- UPDATE: PLANNER y ADMIN pueden modificar reglas
DROP POLICY IF EXISTS condition_rules_update ON public.condition_rules;
CREATE POLICY condition_rules_update ON public.condition_rules
  FOR UPDATE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

-- DELETE: PLANNER y ADMIN pueden eliminar reglas
DROP POLICY IF EXISTS condition_rules_delete ON public.condition_rules;
CREATE POLICY condition_rules_delete ON public.condition_rules
  FOR DELETE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'));

-- ============================================================
-- MIGRATION: condition_metrology_compute — PR 2b extension
-- ============================================================
-- Extiende PR 2a con:
--   9.  ALTER work_orders ADD condition_event_id FK→condition_events
--   10. ALTER condition_events ADD FK rule_id→condition_rules
--   11. trg_condition_event_to_wo: AFTER INSERT en condition_events,
--       eventos critical → work_order CBM automática, anti-spam
--   12. is_valid_validation_transition(): helper IMMUTABLE
--   13. trg_enforce_validation_lifecycle(): BEFORE UPDATE en 5 tablas
--       con campo validation_status; service_role bypass
--   14. Triggers adjuntados a las 5 tablas
--
-- Idempotente: usa ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE,
--   DROP TRIGGER IF EXISTS + CREATE TRIGGER, DO blocks para FKs.
-- ============================================================

-- ============================================================
-- 9. ALTER work_orders: ADD COLUMN condition_event_id
--    Vincula OT generadas por CBM con el evento de condición
--    que las disparó. Trazabilidad ISO 17359 / ISO 13374.
-- ============================================================
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS condition_event_id UUID;

COMMENT ON COLUMN public.work_orders.condition_event_id
  IS 'Evento de condición que disparó esta OT (CBM avanzado)';

-- FK: ON DELETE SET NULL — si el evento se elimina, la OT no se pierde
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_wo_condition_event'
      AND conrelid = 'public.work_orders'::regclass
  ) THEN
    ALTER TABLE public.work_orders ADD CONSTRAINT fk_wo_condition_event
      FOREIGN KEY (condition_event_id) REFERENCES public.condition_events(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_wo_condition_event
  ON public.work_orders(condition_event_id);

COMMENT ON CONSTRAINT fk_wo_condition_event ON public.work_orders
  IS 'FK a condition_events — evento CBM que disparó esta orden de trabajo';

-- ============================================================
-- 10. ALTER condition_events: ADD FK rule_id→condition_rules
--    rule_id ya existe como UUID nullable desde PR 1d.
--    Se agrega la FK ahora que condition_rules existe (PR 2a).
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_ce_rule'
      AND conrelid = 'public.condition_events'::regclass
  ) THEN
    ALTER TABLE public.condition_events ADD CONSTRAINT fk_ce_rule
      FOREIGN KEY (rule_id) REFERENCES public.condition_rules(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_events_rule
  ON public.condition_events(rule_id);

COMMENT ON CONSTRAINT fk_ce_rule ON public.condition_events
  IS 'FK a condition_rules — regla que disparó este evento de condición';

-- ============================================================
-- 11. FUNCIÓN: trg_condition_event_to_wo_func()
--    AFTER INSERT en condition_events
--    Crea work_order CBM automática cuando severity='critical'.
--    Anti-spam: no duplica WO para el mismo evento.
--    SECURITY DEFINER para bypass RLS de INSERT en work_orders.
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_condition_event_to_wo_func()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_equip_id VARCHAR;
  v_wo_id UUID;
  v_existing_wo_id UUID;
BEGIN
  -- Solo eventos critical + open disparan WO
  IF NEW.severity != 'critical' OR NEW.status != 'open' THEN
    RETURN NEW;
  END IF;

  -- Anti-spam: ¿ya existe WO vinculada a este mismo evento?
  SELECT id INTO v_existing_wo_id FROM work_orders
  WHERE condition_event_id = NEW.id
  LIMIT 1;

  IF FOUND THEN
    -- El evento ya tiene WO vinculada; solo actualizar status si es necesario
    IF NEW.status = 'open' THEN
      UPDATE public.condition_events SET status = 'linked_to_wo' WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  -- Resolver equipment_id desde assets (assets.id es INTEGER, asset_id es TEXT)
  SELECT equipment_id INTO v_equip_id FROM assets WHERE id::TEXT = NEW.asset_id;

  -- Insertar work_order CBM (Condition Based Maintenance)
  INSERT INTO work_orders (
    id, asset_id, equipment_id, wo_type, lifecycle_phase, condition_event_id,
    reported_at, criticality, symptom_note
  ) VALUES (
    gen_random_uuid(), NEW.asset_id, COALESCE(v_equip_id, NEW.asset_id), 'CBM', 'WAPPR', NEW.id,
    NOW(), 'A',
    format('Evento CBM [%s]: %s (HI: %s, dHI/dt: %s)',
      NEW.severity, NEW.message,
      COALESCE(NEW.hi_value::TEXT, 'N/D'),
      COALESCE(NEW.dhi_dt_value::TEXT, 'N/D')
    )
  ) RETURNING id INTO v_wo_id;

  -- Vincular evento a WO (actualiza status en la misma tabla)
  UPDATE public.condition_events SET status = 'linked_to_wo' WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_condition_event_to_wo_func()
  IS 'AFTER INSERT en condition_events: eventos critical → work_order CBM automática. Anti-spam por condition_event_id.';

DROP TRIGGER IF EXISTS trg_condition_event_to_wo ON public.condition_events;
CREATE TRIGGER trg_condition_event_to_wo
  AFTER INSERT ON public.condition_events
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_condition_event_to_wo_func();

-- ============================================================
-- 12. FUNCIÓN: is_valid_validation_transition()
--    Helper IMMUTABLE que define la máquina de estados del
--    ciclo de vida de validación para todas las entidades
--    del dominio de condición.
--
--    Transiciones válidas:
--      draft       → candidate, rejected
--      candidate   → bench_validated, draft, rejected
--      bench_validated → field_trial, candidate, deprecated
--      field_trial → active, bench_validated, deprecated
--      active      → deprecated
--      deprecated  → candidate (revisión explícita)
--      rejected    → draft (re-evaluación)
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_valid_validation_transition(
  old_status TEXT,
  new_status TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  -- Sin cambio → siempre válido
  IF old_status = new_status THEN RETURN true; END IF;

  -- draft: punto de partida — puede promover a candidate o ser rechazado
  IF old_status = 'draft' THEN
    IF new_status IN ('candidate', 'rejected') THEN RETURN true; END IF;
    RETURN false;
  END IF;

  -- candidate: puede avanzar, retroceder, o ser rechazado
  IF old_status = 'candidate' THEN
    IF new_status IN ('bench_validated', 'draft', 'rejected') THEN RETURN true; END IF;
    RETURN false;
  END IF;

  -- bench_validated: puede avanzar, retroceder, o deprecarse
  IF old_status = 'bench_validated' THEN
    IF new_status IN ('field_trial', 'candidate', 'deprecated') THEN RETURN true; END IF;
    RETURN false;
  END IF;

  -- field_trial: puede activarse, retroceder, o deprecarse
  IF old_status = 'field_trial' THEN
    IF new_status IN ('active', 'bench_validated', 'deprecated') THEN RETURN true; END IF;
    RETURN false;
  END IF;

  -- active: estado productivo — solo puede deprecarse
  IF old_status = 'active' THEN
    IF new_status = 'deprecated' THEN RETURN true; END IF;
    RETURN false;
  END IF;

  -- deprecated: solo puede volver a candidate por revisión explícita
  IF old_status = 'deprecated' THEN
    IF new_status = 'candidate' THEN RETURN true; END IF;
    RETURN false;
  END IF;

  -- rejected: solo puede volver a draft para re-evaluación
  IF old_status = 'rejected' THEN
    IF new_status = 'draft' THEN RETURN true; END IF;
    RETURN false;
  END IF;

  -- Estado desconocido → rechazar por seguridad
  RETURN false;
END;
$$;

COMMENT ON FUNCTION public.is_valid_validation_transition(TEXT, TEXT)
  IS 'Valida transiciones del ciclo de vida de validación: draft→candidate→bench_validated→field_trial→active→deprecated';

-- ============================================================
-- 13. FUNCIÓN: trg_enforce_validation_lifecycle()
--    BEFORE UPDATE genérica que valida transiciones de
--    validation_status en las 5 tablas del dominio de
--    condición.
--    Service_role bypass: permite override administrativo
--    (útil para migraciones y correcciones del sistema).
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_enforce_validation_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_jwt_role TEXT;
BEGIN
  -- Service role bypass: administradores del sistema pueden forzar
  -- cualquier transición. En contexto HTTP (Supabase API), se
  -- verifica el claim JWT. Fuera de contexto HTTP (migraciones,
  -- psql directo), el bypass no aplica y se valida normalmente.
  BEGIN
    v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF v_jwt_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Si validation_status no cambió, permitir sin validar
  IF OLD.validation_status IS NOT DISTINCT FROM NEW.validation_status THEN
    RETURN NEW;
  END IF;

  -- Validar la transición
  IF NOT public.is_valid_validation_transition(OLD.validation_status, NEW.validation_status) THEN
    RAISE EXCEPTION 'Transición de validación inválida: % → %', OLD.validation_status, NEW.validation_status;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_enforce_validation_lifecycle()
  IS 'BEFORE UPDATE: fuerza ciclo de validación (draft→candidate→bench_validated→field_trial→active→deprecated). Service_role bypass.';

-- ============================================================
-- 14. TRIGGERS: Adjuntar trg_enforce_validation_lifecycle
--    a las 5 tablas con campo validation_status.
--    Se usa WHEN clause para solo disparar si cambió el campo.
-- ============================================================

-- 14a. condition_analysis_methods
DROP TRIGGER IF EXISTS trg_validation_methods ON public.condition_analysis_methods;
CREATE TRIGGER trg_validation_methods
  BEFORE UPDATE ON public.condition_analysis_methods
  FOR EACH ROW
  WHEN (OLD.validation_status IS DISTINCT FROM NEW.validation_status)
  EXECUTE FUNCTION public.trg_enforce_validation_lifecycle();

-- 14b. condition_threshold_catalog
DROP TRIGGER IF EXISTS trg_validation_thresholds ON public.condition_threshold_catalog;
CREATE TRIGGER trg_validation_thresholds
  BEFORE UPDATE ON public.condition_threshold_catalog
  FOR EACH ROW
  WHEN (OLD.validation_status IS DISTINCT FROM NEW.validation_status)
  EXECUTE FUNCTION public.trg_enforce_validation_lifecycle();

-- 14c. condition_source_capabilities
DROP TRIGGER IF EXISTS trg_validation_sources ON public.condition_source_capabilities;
CREATE TRIGGER trg_validation_sources
  BEFORE UPDATE ON public.condition_source_capabilities
  FOR EACH ROW
  WHEN (OLD.validation_status IS DISTINCT FROM NEW.validation_status)
  EXECUTE FUNCTION public.trg_enforce_validation_lifecycle();

-- 14d. condition_rules
DROP TRIGGER IF EXISTS trg_validation_rules ON public.condition_rules;
CREATE TRIGGER trg_validation_rules
  BEFORE UPDATE ON public.condition_rules
  FOR EACH ROW
  WHEN (OLD.validation_status IS DISTINCT FROM NEW.validation_status)
  EXECUTE FUNCTION public.trg_enforce_validation_lifecycle();

-- 14e. condition_analysis_results
DROP TRIGGER IF EXISTS trg_validation_analysis ON public.condition_analysis_results;
CREATE TRIGGER trg_validation_analysis
  BEFORE UPDATE ON public.condition_analysis_results
  FOR EACH ROW
  WHEN (OLD.validation_status IS DISTINCT FROM NEW.validation_status)
  EXECUTE FUNCTION public.trg_enforce_validation_lifecycle();

-- ============================================================
-- MIGRATION: condition_metrology_compute — PR 2c extension
-- ============================================================
-- Agrega funciones de cómputo de Health Index y Degradation Velocity:
--   15. compute_health_index() — índice de salud ponderado multi-feature
--      con mapeo lineal por tramos ISO (piecewise linear)
--   16. compute_degradation_velocity() — velocidad de degradación dHI/dt
--      mediante regresión lineal simple (regr_slope/regr_r2)
--
-- Idempotente: usa CREATE OR REPLACE FUNCTION.
-- Dependencias: condition_feature_values, condition_threshold_catalog,
--   condition_analysis_results, condition_analysis_methods.
-- ============================================================

-- ============================================================
-- 15. FUNCIÓN: compute_health_index(p_asset_id, p_window_end, p_asset_class)
--    Calcula el índice de salud ponderado multi-feature usando
--    mapeo lineal por tramos según zonas ISO:
--      Zona A (value ≤ zone_a_max):                h = 1.0
--      Zona B (zone_a_max < value ≤ zone_b_max):   h = 1.0 - 0.3*(v-a)/(b-a)
--      Zona C (zone_b_max < value ≤ zone_c_max):   h = 0.7 - 0.5*(v-b)/(c-b)
--      Zona D (value > zone_c_max):                h = max(0, 0.2 - 0.2*(v-c)/(c*0.5))
--    Modificadores de calidad: G0=1.0, G1=0.8, G2=0.5, G3=0.0
--    HI = SUM(w_i * q_i * h_i) / SUM(w_i * q_i)
--    Si todas las features son G3 → HI=NULL, confidence=0.0
--    Almacena el resultado en condition_analysis_results.
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_health_index(
  p_asset_id TEXT,
  p_window_end TIMESTAMPTZ DEFAULT NOW(),
  p_asset_class TEXT DEFAULT NULL
) RETURNS TABLE(
  health_index NUMERIC,
  confidence NUMERIC
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_regime TEXT;
  v_total_weighted_h NUMERIC := 0;
  v_total_quality_weight NUMERIC := 0;
  v_total_confidence NUMERIC := 0;
  v_features_used INT := 0;
  v_features_total INT := 0;
  rec RECORD;
  v_thr RECORD;
  v_h NUMERIC;
  v_q NUMERIC;
  v_w NUMERIC;
  v_quality_weight NUMERIC;
  v_computed_hi NUMERIC;
  v_computed_conf NUMERIC;
BEGIN
  -- Determinar régimen operativo desde la ventana más reciente
  SELECT operational_context->>'regime' INTO v_regime
  FROM public.condition_windows
  WHERE asset_id = p_asset_id
    AND window_end <= p_window_end
  ORDER BY window_end DESC
  LIMIT 1;

  IF v_regime IS NULL THEN
    v_regime := 'FULL_LOAD';
  END IF;

  -- Recorrer el último feature_value por cada feature_definition_id
  -- dentro de los 7 días anteriores a p_window_end
  FOR rec IN
    SELECT DISTINCT ON (cfv.feature_definition_id)
      cfv.feature_definition_id,
      cfv.value,
      cfv.quality_flag,
      cfv.method_key,
      cfv.confidence AS fv_confidence,
      cfd.default_weight
    FROM public.condition_feature_values cfv
    JOIN public.condition_windows cw ON cfv.window_id = cw.id
    JOIN public.condition_feature_definitions cfd
      ON cfv.feature_definition_id = cfd.id
    WHERE cw.asset_id = p_asset_id
      AND cw.window_end > p_window_end - INTERVAL '7 days'
      AND cw.window_end <= p_window_end
    ORDER BY cfv.feature_definition_id, cw.window_end DESC
  LOOP
    v_features_total := v_features_total + 1;

    -- Modificador de calidad (q)
    v_q := CASE rec.quality_flag
      WHEN 'G0' THEN 1.0
      WHEN 'G1' THEN 0.8
      WHEN 'G2' THEN 0.5
      WHEN 'G3' THEN 0.0
      ELSE 0.0
    END;

    -- Peso del feature (w) desde el catálogo
    v_w := COALESCE(rec.default_weight, 1.0);

    -- Peso efectivo = w * q (denominador del HI)
    v_quality_weight := v_w * v_q;

    -- Si q = 0 (G3), el feature no contribuye → excluir
    IF v_q = 0.0 THEN
      CONTINUE;
    END IF;

    -- Buscar threshold: feature_definition_id + method_key + asset_class + regime
    -- Si p_asset_class es NULL, usar thresholds genéricos (asset_class=NULL).
    -- Si hay valor, emparejar exacto.
    SELECT zone_a_max, zone_b_max, zone_c_max INTO v_thr
    FROM public.condition_threshold_catalog
    WHERE feature_definition_id = rec.feature_definition_id
      AND method_key = rec.method_key
      AND (
        asset_class = p_asset_class
        OR (p_asset_class IS NULL AND asset_class IS NULL)
      )
      AND (regime = v_regime OR regime = 'FULL_LOAD')
    ORDER BY
      CASE WHEN asset_class IS NOT DISTINCT FROM p_asset_class THEN 0 ELSE 1 END,
      CASE WHEN regime = v_regime THEN 0 ELSE 1 END
    LIMIT 1;

    -- Sin threshold → feature excluido (no hay referencia para zonificar)
    IF v_thr.zone_a_max IS NULL THEN
      CONTINUE;
    END IF;

    -- Mapeo lineal por tramos según zonas ISO
    IF rec.value <= v_thr.zone_a_max THEN
      -- Zona A: condición buena
      v_h := 1.0;
    ELSIF rec.value <= v_thr.zone_b_max THEN
      -- Zona B: condición aceptable — interpolación lineal A→B
      v_h := 1.0 - 0.3 * (rec.value - v_thr.zone_a_max)
             / NULLIF(v_thr.zone_b_max - v_thr.zone_a_max, 0);
    ELSIF rec.value <= v_thr.zone_c_max THEN
      -- Zona C: alerta — interpolación lineal B→C
      v_h := 0.7 - 0.5 * (rec.value - v_thr.zone_b_max)
             / NULLIF(v_thr.zone_c_max - v_thr.zone_b_max, 0);
    ELSE
      -- Zona D: crítica — extrapolación lineal con piso en 0
      v_h := GREATEST(0.0, 0.2 - 0.2 * (rec.value - v_thr.zone_c_max)
             / NULLIF(v_thr.zone_c_max * 0.5, 0));
    END IF;

    -- Acumular para promedio ponderado
    --   HI = SUM(w_i * q_i * h_i) / SUM(w_i * q_i)
    v_total_weighted_h := v_total_weighted_h + v_quality_weight * v_h;
    v_total_quality_weight := v_total_quality_weight + v_quality_weight;
    v_total_confidence := v_total_confidence
      + v_quality_weight * COALESCE(rec.fv_confidence, 1.0);
    v_features_used := v_features_used + 1;
  END LOOP;

  -- Calcular HI final y confianza
  IF v_total_quality_weight > 0 THEN
    v_computed_hi := v_total_weighted_h / v_total_quality_weight;
    v_computed_conf := v_total_confidence / v_total_quality_weight;
  ELSE
    -- Sin features válidas (todas G3 o sin thresholds)
    v_computed_hi := NULL;
    v_computed_conf := 0.0;
  END IF;

  health_index := v_computed_hi;
  confidence := v_computed_conf;

  -- Almacenar resultado en condition_analysis_results
  -- SECURITY DEFINER → el INSERT sortea RLS (owner = postgres/supabase_admin)
  INSERT INTO public.condition_analysis_results (
    asset_id, analysis_type, method_key, method_version,
    parameters, result_value, result_unit,
    confidence, window_end, validation_status
  ) VALUES (
    p_asset_id,
    'health_index',
    'weighted_health_index',
    '1.0.0',
    jsonb_build_object(
      'features_used', v_features_used,
      'features_total', v_features_total,
      'asset_class', p_asset_class
    ),
    v_computed_hi,
    'HI',
    COALESCE(v_computed_conf, 0.0),
    p_window_end,
    COALESCE(
      (SELECT validation_status
       FROM public.condition_analysis_methods
       WHERE method_key = 'weighted_health_index'),
      'candidate'
    )
  );

  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.compute_health_index(TEXT, TIMESTAMPTZ, TEXT)
  IS 'Calcula el índice de salud (HI) ponderado multi-feature usando mapeo lineal por tramos ISO. Modificadores de calidad: G0=1.0, G1=0.8, G2=0.5, G3=0.0. Almacena el resultado en condition_analysis_results.';

-- ============================================================
-- 16. FUNCIÓN: compute_degradation_velocity(p_asset_id, p_window_hours)
--    Calcula dHI/dt mediante regresión lineal simple sobre
--    los resultados de HI almacenados en condition_analysis_results.
--    Requiere ≥5 puntos y R² ≥ 0.5 para que la pendiente sea
--    accionable.
--    Convierte el slope de HI/segundo a HI/día (×86400).
--    Almacena el resultado si R² ≥ 0.5 en condition_analysis_results
--    con analysis_type='trend_slope', method_key='linear_regression'.
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_degradation_velocity(
  p_asset_id TEXT,
  p_window_hours INT DEFAULT 168
) RETURNS TABLE(
  slope NUMERIC,
  r_squared NUMERIC,
  point_count INT
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_slope NUMERIC;
  v_r2 NUMERIC;
  v_count INT;
  v_slope_per_day NUMERIC;
  v_window_end TIMESTAMPTZ;
BEGIN
  -- Leer resultados de HI para este activo dentro de la ventana
  SELECT
    regr_slope(ar.result_value, EXTRACT(EPOCH FROM ar.window_end))::NUMERIC,
    regr_r2(ar.result_value, EXTRACT(EPOCH FROM ar.window_end))::NUMERIC,
    COUNT(*)::INT,
    MAX(ar.window_end)
  INTO
    v_slope, v_r2, v_count, v_window_end
  FROM public.condition_analysis_results ar
  WHERE ar.asset_id = p_asset_id
    AND ar.analysis_type = 'health_index'
    AND ar.result_value IS NOT NULL
    AND ar.window_end > NOW() - (p_window_hours || ' hours')::INTERVAL;

  point_count := COALESCE(v_count, 0);

  -- Datos insuficientes: se requieren ≥ 5 puntos
  IF v_count < 5 THEN
    slope := NULL;
    r_squared := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Convertir slope de HI/segundo (epoch) a HI/día
  v_slope_per_day := v_slope * 86400;
  slope := v_slope_per_day;
  r_squared := v_r2;

  -- R² bajo: pendiente no accionable → no almacenar
  IF v_r2 < 0.5 THEN
    RETURN NEXT;
    RETURN;
  END IF;

  -- Almacenar resultado de tendencia si R² ≥ 0.5
  INSERT INTO public.condition_analysis_results (
    asset_id, analysis_type, method_key, method_version,
    parameters, result_value, result_unit,
    r_squared, window_end, validation_status
  ) VALUES (
    p_asset_id,
    'trend_slope',
    'linear_regression',
    '1.0.0',
    jsonb_build_object(
      'window_hours', p_window_hours,
      'point_count', v_count,
      'slope_raw_per_second', v_slope
    ),
    v_slope_per_day,
    'HI/day',
    v_r2,
    v_window_end,
    COALESCE(
      (SELECT validation_status
       FROM public.condition_analysis_methods
       WHERE method_key = 'linear_regression'),
      'candidate'
    )
  );

  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.compute_degradation_velocity(TEXT, INT)
  IS 'Calcula dHI/dt (HI/día) mediante regresión lineal simple (regr_slope/regr_r2). Requiere ≥5 puntos y R² ≥ 0.5. Almacena el resultado en condition_analysis_results si es accionable.';

-- ============================================================
-- MIGRATION: condition_metrology_compute — PR 2d extension
-- ============================================================
-- Agrega el motor de reglas de condición y vistas de mejora continua:
--   17. evaluate_condition_rules(p_asset_id TEXT) → INT
--       Evalúa reglas activas (threshold, trend, compound) por asset
--       con contexto de feature, método, régimen y clase de activo.
--       Severidad limitada a warning si el método está en draft/candidate.
--       Retorna cantidad de reglas disparadas.
--   18. Views: v_condition_data_quality, v_condition_rule_performance,
--       v_condition_metrology_status
--       Métricas de mejora continua: calidad de datos, desempeño de
--       reglas y estado metrológico de fuentes.
--
-- Idempotente: usa CREATE OR REPLACE FUNCTION, CREATE OR REPLACE VIEW.
-- Dependencias: condition_rules, condition_feature_values,
--   condition_analysis_results, condition_events, condition_event_sources,
--   condition_analysis_methods, condition_source_capabilities, assets.
-- ============================================================

-- ============================================================
-- 17. FUNCIÓN: evaluate_condition_rules(p_asset_id)
--    Motor de evaluación de reglas de condición (ISO 13374 Bloque 4).
--    Para cada regla activa/field_trial que coincide con el activo
--    (asset_class + regime + feature_key + method_key):
--
--    a) Obtiene el último feature_value del feature_key y method_key
--       (si method_key es NULL, aplica a cualquier método)
--    b) Verifica que quality_flag cumpla min_quality_flag
--    c) Evalúa según evaluation_type:
--       - threshold: value > rule_config.threshold por
--         duration_windows ventanas consecutivas
--       - trend: recupera el último analysis_result de tipo
--         trend_slope y verifica pendiente
--       - compound: evalúa rule_config.conditions con AND/OR
--    d) Si la regla dispara:
--       - Crea condition_event con severity de la regla
--       - Gate de severidad: si method_key referencia un método
--         con validation_status ∉ {active, field_trial, bench_validated},
--         limita severity máximo a 'warning'
--       - Inserta en condition_event_sources (feature_values +
--         analysis_results que contribuyeron)
--    e) Omite reglas con validation_status NO IN ('active','field_trial')
--
--    Retorna: cantidad de reglas que dispararon (INT).
-- ============================================================
CREATE OR REPLACE FUNCTION public.evaluate_condition_rules(
  p_asset_id TEXT
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rule RECORD;
  v_fv RECORD;
  v_regime TEXT;
  v_asset_class TEXT;
  v_count INT := 0;
  v_consecutive INT;
  v_event_severity TEXT;
  v_method_status TEXT;
  v_event_id UUID;
  v_analysis RECORD;
  v_condition_met BOOLEAN;
  v_quality_num INT;
  v_min_quality_num INT;
  v_duration_windows INT;
  v_threshold NUMERIC;
  v_latest_window_end TIMESTAMPTZ;
  v_compound_result BOOLEAN;
BEGIN
  -- ── 0. Resolver asset_class desde assets ──────────────────
  SELECT a.asset_type_id INTO v_asset_class
  FROM public.assets a
  WHERE a.id = p_asset_id;

  -- ── 1. Determinar régimen operativo actual ────────────────
  SELECT operational_context->>'regime' INTO v_regime
  FROM public.condition_windows
  WHERE asset_id = p_asset_id
  ORDER BY window_end DESC
  LIMIT 1;

  IF v_regime IS NULL THEN
    v_regime := 'FULL_LOAD';
  END IF;

  -- ── 2. Iterar reglas activas que coinciden con el activo ──
  FOR v_rule IN
    SELECT *
    FROM public.condition_rules
    WHERE validation_status IN ('active', 'field_trial')
      AND (asset_class IS NULL OR asset_class = v_asset_class)
      AND (regime IS NULL OR regime = v_regime)
    ORDER BY severity DESC  -- evaluar primero las críticas
  LOOP
    -- ── 2a. Obtener último feature_value ────────────────────
    IF v_rule.feature_key IS NOT NULL THEN
      SELECT cfv.value, cfv.quality_flag, cfv.method_key,
             cfv.id AS fv_id, cw.window_end
      INTO v_fv
      FROM public.condition_feature_values cfv
      JOIN public.condition_windows cw ON cfv.window_id = cw.id
      JOIN public.condition_feature_definitions cfd
        ON cfv.feature_definition_id = cfd.id
      WHERE cw.asset_id = p_asset_id
        AND cfd.feature_key = v_rule.feature_key
        AND (v_rule.method_key IS NULL OR cfv.method_key = v_rule.method_key)
        AND cw.window_end > NOW() - INTERVAL '30 days'
      ORDER BY cw.window_end DESC
      LIMIT 1;

      -- Sin feature_value para este feature → skip rule
      IF v_fv.value IS NULL THEN
        CONTINUE;
      END IF;

      -- ── 2b. Verificar calidad ─────────────────────────────
      v_quality_num := CASE v_fv.quality_flag
        WHEN 'G0' THEN 0 WHEN 'G1' THEN 1 WHEN 'G2' THEN 2 WHEN 'G3' THEN 3 ELSE 4 END;
      v_min_quality_num := CASE v_rule.min_quality_flag
        WHEN 'G0' THEN 0 WHEN 'G1' THEN 1 WHEN 'G2' THEN 2 WHEN 'G3' THEN 3 ELSE 4 END;

      IF v_quality_num > v_min_quality_num THEN
        CONTINUE;  -- calidad insuficiente → no evaluar
      END IF;

      v_latest_window_end := v_fv.window_end;
    ELSE
      -- Regla sin feature_key (ej: regla compuesta pura)
      -- Para compound eval, los features se evalúan dentro del loop
      v_latest_window_end := NOW();
    END IF;

    -- ── 2c. Evaluar según evaluation_type ───────────────────
    v_condition_met := false;

    IF v_rule.evaluation_type = 'threshold' THEN
      v_threshold := (v_rule.rule_config->>'threshold')::NUMERIC;
      v_duration_windows := COALESCE((v_rule.rule_config->>'duration_windows')::INT, 1);

      IF v_fv.value > v_threshold THEN
        -- Contar ventanas consecutivas donde el valor excede el umbral
        WITH ordered_windows AS (
          SELECT
            cfv2.value,
            cw2.window_end,
            cfv2.value > v_threshold AS exceeds,
            ROW_NUMBER() OVER (ORDER BY cw2.window_end DESC) AS rn
          FROM public.condition_feature_values cfv2
          JOIN public.condition_windows cw2 ON cfv2.window_id = cw2.id
          JOIN public.condition_feature_definitions cfd2
            ON cfv2.feature_definition_id = cfd2.id
          WHERE cw2.asset_id = p_asset_id
            AND cfd2.feature_key = v_rule.feature_key
            AND (v_rule.method_key IS NULL OR cfv2.method_key = v_rule.method_key)
            AND cw2.window_end <= v_latest_window_end
          ORDER BY cw2.window_end DESC
          LIMIT v_duration_windows
        )
        SELECT COUNT(*) INTO v_consecutive
        FROM ordered_windows
        WHERE exceeds = true;

        IF v_consecutive >= v_duration_windows THEN
          v_condition_met := true;
        END IF;
      END IF;

    ELSIF v_rule.evaluation_type = 'trend' THEN
      -- Obtener último resultado de tendencia (dHI/dt)
      SELECT ar.result_value, ar.r_squared, ar.id AS ar_id
      INTO v_analysis
      FROM public.condition_analysis_results ar
      WHERE ar.asset_id = p_asset_id
        AND ar.analysis_type = 'trend_slope'
        AND ar.result_value IS NOT NULL
      ORDER BY ar.window_end DESC
      LIMIT 1;

      IF v_analysis.result_value IS NOT NULL THEN
        v_threshold := (v_rule.rule_config->>'threshold')::NUMERIC;
        -- trend_slope negativo = degradación. Regla dispara si
        -- la pendiente es más negativa que el threshold (más rápida).
        -- Ej: slope=-0.05, threshold=-0.02 → -0.05 < -0.02 → TRUE (dispara)
        IF v_analysis.result_value < v_threshold THEN
          -- Verificar R² mínimo si está configurado
          IF (v_rule.rule_config->>'min_r_squared')::NUMERIC IS NULL
             OR v_analysis.r_squared >= (v_rule.rule_config->>'min_r_squared')::NUMERIC THEN
            v_condition_met := true;
          END IF;
        END IF;
      END IF;

    ELSIF v_rule.evaluation_type = 'compound' THEN
      -- Evaluar condiciones compuestas con AND/OR
      -- Estructura esperada: {"operator":"AND","conditions":[
      --   {"feature":"vibration.rms","threshold":7.1},
      --   {"feature":"temperature.bearing","threshold":85}
      -- ]}
      v_compound_result := evaluate_compound_conditions(
        p_asset_id,
        v_rule.rule_config,
        v_rule.min_quality_flag
      );
      v_condition_met := v_compound_result;

    ELSIF v_rule.evaluation_type = 'residual' THEN
      -- Residual evaluation: placeholder — requiere modelo entrenado
      NULL;

    END IF;

    -- ── 2d. Si la regla dispara: crear evento ───────────────
    IF v_condition_met THEN
      -- Gate de severidad por estado del método
      v_event_severity := v_rule.severity;

      IF v_rule.method_key IS NOT NULL THEN
        SELECT validation_status INTO v_method_status
        FROM public.condition_analysis_methods
        WHERE method_key = v_rule.method_key;

        IF v_method_status IS NOT NULL
           AND v_method_status NOT IN ('active', 'field_trial', 'bench_validated') THEN
          -- Limitar severidad a warning como máximo
          IF v_event_severity = 'critical' THEN
            v_event_severity := 'warning';
          END IF;
        END IF;
      END IF;

      -- Insertar condition_event
      INSERT INTO public.condition_events (
        asset_id, rule_id, event_type, severity,
        hi_value, dhi_dt_value, message
      ) VALUES (
        p_asset_id,
        v_rule.id,
        CASE v_rule.evaluation_type
          WHEN 'threshold' THEN 'threshold_exceeded'
          WHEN 'trend' THEN 'trend_detected'
          WHEN 'compound' THEN 'threshold_exceeded'
          WHEN 'residual' THEN 'quality_degraded'
          ELSE 'threshold_exceeded'
        END,
        v_event_severity,
        (SELECT result_value FROM public.condition_analysis_results
         WHERE asset_id = p_asset_id AND analysis_type = 'health_index'
         ORDER BY window_end DESC LIMIT 1),
        (SELECT result_value FROM public.condition_analysis_results
         WHERE asset_id = p_asset_id AND analysis_type = 'trend_slope'
         ORDER BY window_end DESC LIMIT 1),
        format(
          'Regla [%s v%s]: %s. Feature=%s, Método=%s, Valor=%.4f (umbral=%s)',
          v_rule.rule_name,
          v_rule.version,
          COALESCE(v_rule.description, 'Sin descripción'),
          COALESCE(v_rule.feature_key, 'N/A'),
          COALESCE(v_rule.method_key, 'N/A'),
          COALESCE(v_fv.value, 0),
          v_rule.rule_config->>'threshold'
        )
      ) RETURNING id INTO v_event_id;

      -- Vincular fuentes del evento
      IF v_fv.id IS NOT NULL THEN
        INSERT INTO public.condition_event_sources (
          event_id, feature_value_id
        ) VALUES (v_event_id, v_fv.id);
      END IF;

      IF v_analysis.id IS NOT NULL THEN
        INSERT INTO public.condition_event_sources (
          event_id, analysis_result_id
        ) VALUES (v_event_id, v_analysis.id);
      END IF;

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.evaluate_condition_rules(TEXT)
  IS 'Evalúa todas las reglas de condición activas/field_trial para un activo. Retorna cantidad de reglas disparadas. Gate de severidad: métodos draft/candidate → eventos limitados a warning.';


-- ============================================================
-- 17b. FUNCIÓN AUXILIAR: evaluate_compound_conditions()
--    Evalúa condiciones compuestas (AND/OR) del rule_config
--    para reglas de tipo compound. Soporta anidamiento de un
--    nivel: {"operator":"AND","conditions":[...]}
--
--    Cada condition tiene: feature (feature_key), threshold, op
--    (opcional, default: ">"), method_key (opcional).
-- ============================================================
CREATE OR REPLACE FUNCTION public.evaluate_compound_conditions(
  p_asset_id TEXT,
  p_rule_config JSONB,
  p_min_quality TEXT DEFAULT 'G2'
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_operator TEXT;
  v_conditions JSONB;
  v_cond JSONB;
  v_i INT;
  v_result BOOLEAN;
  v_feature_result BOOLEAN;
  v_feature_key TEXT;
  v_feature_threshold NUMERIC;
  v_feature_op TEXT;
  v_feature_method TEXT;
  v_fv RECORD;
  v_min_q_num INT;
  v_q_num INT;
BEGIN
  v_operator := p_rule_config->>'operator';
  v_conditions := p_rule_config->'conditions';

  IF v_conditions IS NULL OR jsonb_array_length(v_conditions) = 0 THEN
    RETURN false;
  END IF;

  -- Determinar valor numérico de calidad mínima
  v_min_q_num := CASE p_min_quality
    WHEN 'G0' THEN 0 WHEN 'G1' THEN 1 WHEN 'G2' THEN 2 WHEN 'G3' THEN 3 ELSE 4 END;

  -- Evaluar cada condición individual
  v_result := (v_operator = 'AND');  -- AND → inicia true, OR → inicia false

  FOR v_i IN 0..jsonb_array_length(v_conditions) - 1 LOOP
    v_cond := v_conditions->v_i;
    v_feature_key := v_cond->>'feature';
    v_feature_threshold := (v_cond->>'threshold')::NUMERIC;
    v_feature_op := COALESCE(v_cond->>'op', '>');
    v_feature_method := v_cond->>'method_key';

    -- Obtener último valor del feature
    SELECT cfv.value, cfv.quality_flag,
           (CASE cfv.quality_flag
             WHEN 'G0' THEN 0 WHEN 'G1' THEN 1 WHEN 'G2' THEN 2 WHEN 'G3' THEN 3 ELSE 4
           END) AS q_num
    INTO v_fv
    FROM public.condition_feature_values cfv
    JOIN public.condition_windows cw ON cfv.window_id = cw.id
    JOIN public.condition_feature_definitions cfd
      ON cfv.feature_definition_id = cfd.id
    WHERE cw.asset_id = p_asset_id
      AND cfd.feature_key = v_feature_key
      AND (v_feature_method IS NULL OR cfv.method_key = v_feature_method)
      AND cw.window_end > NOW() - INTERVAL '30 days'
    ORDER BY cw.window_end DESC
    LIMIT 1;

    -- Evaluar condición individual
    v_feature_result := false;

    IF v_fv.value IS NOT NULL THEN
      -- Verificar calidad
      IF v_fv.q_num <= v_min_q_num THEN
        -- Evaluar operador
        CASE v_feature_op
          WHEN '>'  THEN v_feature_result := v_fv.value > v_feature_threshold;
          WHEN '>=' THEN v_feature_result := v_fv.value >= v_feature_threshold;
          WHEN '<'  THEN v_feature_result := v_fv.value < v_feature_threshold;
          WHEN '<=' THEN v_feature_result := v_fv.value <= v_feature_threshold;
          WHEN '='  THEN v_feature_result := v_fv.value = v_feature_threshold;
          ELSE v_feature_result := v_fv.value > v_feature_threshold;
        END CASE;
      END IF;
    END IF;

    -- Combinar con operador
    IF v_operator = 'AND' THEN
      v_result := v_result AND v_feature_result;
      IF NOT v_result THEN EXIT; END IF;  -- short-circuit
    ELSE  -- OR
      v_result := v_result OR v_feature_result;
      IF v_result THEN EXIT; END IF;  -- short-circuit
    END IF;
  END LOOP;

  RETURN COALESCE(v_result, false);
END;
$$;

COMMENT ON FUNCTION public.evaluate_compound_conditions(TEXT, JSONB, TEXT)
  IS 'Evalúa condiciones compuestas AND/OR de rule_config para reglas compound. Soporta operadores: >, >=, <, <=, =.';


-- ============================================================
-- 18. VIEWS: Métricas de Mejora Continua
--    Vistas consultables para monitorear calidad de datos,
--    desempeño de reglas y estado metrológico de las fuentes.
--    Requisito: REQ-CVAL-003.
-- ============================================================

-- ============================================================
-- 18a. VIEW: v_condition_data_quality
--    Porcentaje de features G0/G1/G2/G3 por activo y día.
--    Incluye conteo de muestras faltantes (sample_count NULL = 0)
--    y pérdida de muestras (windows sin features).
--    SQL comments en español.
-- ============================================================
CREATE OR REPLACE VIEW public.v_condition_data_quality AS
WITH feature_daily AS (
  SELECT
    cw.asset_id,
    DATE_TRUNC('day', cw.window_end)::DATE AS dia,
    cfv.quality_flag,
    COUNT(*) AS feature_count,
    COUNT(*) FILTER (WHERE cfv.sample_count IS NULL OR cfv.sample_count = 0) AS sample_loss_count
  FROM public.condition_feature_values cfv
  JOIN public.condition_windows cw ON cfv.window_id = cw.id
  GROUP BY cw.asset_id, DATE_TRUNC('day', cw.window_end)::DATE, cfv.quality_flag
),
daily_totals AS (
  SELECT
    asset_id,
    dia,
    SUM(feature_count) AS total_features,
    SUM(sample_loss_count) AS total_sample_loss
  FROM feature_daily
  GROUP BY asset_id, dia
),
pivoted AS (
  SELECT
    dt.asset_id,
    dt.dia,
    dt.total_features,
    COALESCE(SUM(fd.feature_count) FILTER (WHERE fd.quality_flag = 'G0'), 0) AS g0_count,
    COALESCE(SUM(fd.feature_count) FILTER (WHERE fd.quality_flag = 'G1'), 0) AS g1_count,
    COALESCE(SUM(fd.feature_count) FILTER (WHERE fd.quality_flag = 'G2'), 0) AS g2_count,
    COALESCE(SUM(fd.feature_count) FILTER (WHERE fd.quality_flag = 'G3'), 0) AS g3_count,
    dt.total_sample_loss
  FROM daily_totals dt
  LEFT JOIN feature_daily fd ON dt.asset_id = fd.asset_id AND dt.dia = fd.dia
  GROUP BY dt.asset_id, dt.dia, dt.total_features, dt.total_sample_loss
)
SELECT
  asset_id,
  dia,
  total_features,
  g0_count,
  g1_count,
  g2_count,
  g3_count,
  total_sample_loss,
  ROUND(100.0 * g0_count / NULLIF(total_features, 0), 1) AS pct_g0,
  ROUND(100.0 * g1_count / NULLIF(total_features, 0), 1) AS pct_g1,
  ROUND(100.0 * g2_count / NULLIF(total_features, 0), 1) AS pct_g2,
  ROUND(100.0 * g3_count / NULLIF(total_features, 0), 1) AS pct_g3
FROM pivoted
ORDER BY asset_id, dia DESC;

COMMENT ON VIEW public.v_condition_data_quality
  IS 'Métrica de calidad de datos de condición: % de features G0/G1/G2/G3 por activo y día, pérdida de muestras. Soporta mejora continua REQ-CVAL-003.';

COMMENT ON COLUMN public.v_condition_data_quality.asset_id
  IS 'Identificador del activo monitoreado';

COMMENT ON COLUMN public.v_condition_data_quality.dia
  IS 'Día de la ventana de ingesta (fecha truncada)';

COMMENT ON COLUMN public.v_condition_data_quality.g0_count
  IS 'Cantidad de features con calidad G0 (excelente)';

COMMENT ON COLUMN public.v_condition_data_quality.g1_count
  IS 'Cantidad de features con calidad G1 (buena)';

COMMENT ON COLUMN public.v_condition_data_quality.g2_count
  IS 'Cantidad de features con calidad G2 (aceptable)';

COMMENT ON COLUMN public.v_condition_data_quality.g3_count
  IS 'Cantidad de features con calidad G3 (no confiable)';

COMMENT ON COLUMN public.v_condition_data_quality.total_sample_loss
  IS 'Cantidad de features sin muestras o con sample_count=0 en el día';

COMMENT ON COLUMN public.v_condition_data_quality.pct_g0
  IS 'Porcentaje de features con calidad G0 respecto al total del día';


-- ============================================================
-- 18b. VIEW: v_condition_rule_performance
--    Eventos generados por regla, desglosados por severidad.
--    Permite identificar reglas con alta tasa de falsos positivos
--    (eventos dismissed) y evaluar su efectividad.
-- ============================================================
CREATE OR REPLACE VIEW public.v_condition_rule_performance AS
SELECT
  r.id AS rule_id,
  r.rule_name,
  r.version,
  r.evaluation_type,
  r.validation_status AS rule_validation,
  COUNT(e.id) AS eventos_generados,
  COUNT(e.id) FILTER (WHERE e.severity = 'critical') AS eventos_critical,
  COUNT(e.id) FILTER (WHERE e.severity = 'warning') AS eventos_warning,
  COUNT(e.id) FILTER (WHERE e.severity = 'info') AS eventos_info,
  COUNT(e.id) FILTER (WHERE e.status = 'dismissed') AS eventos_descartados,
  COUNT(e.id) FILTER (WHERE e.status = 'closed') AS eventos_confirmados,
  COUNT(e.id) FILTER (WHERE e.status = 'linked_to_wo') AS eventos_con_ot,
  MIN(e.created_at) FILTER (WHERE e.id IS NOT NULL) AS primer_evento,
  MAX(e.created_at) FILTER (WHERE e.id IS NOT NULL) AS ultimo_evento
FROM public.condition_rules r
LEFT JOIN public.condition_events e ON e.rule_id = r.id
GROUP BY r.id, r.rule_name, r.version, r.evaluation_type, r.validation_status
ORDER BY eventos_generados DESC;

COMMENT ON VIEW public.v_condition_rule_performance
  IS 'Desempeño de reglas de condición: eventos generados por regla, severidad, confirmados vs descartados. Soporte a mejora continua REQ-CVAL-003.';

COMMENT ON COLUMN public.v_condition_rule_performance.rule_id
  IS 'ID de la regla de condición';

COMMENT ON COLUMN public.v_condition_rule_performance.eventos_generados
  IS 'Total de eventos generados por esta regla (todas las versiones y severidades)';

COMMENT ON COLUMN public.v_condition_rule_performance.eventos_descartados
  IS 'Eventos descartados (dismissed) — indicador de falsos positivos';

COMMENT ON COLUMN public.v_condition_rule_performance.eventos_confirmados
  IS 'Eventos confirmados (closed) — indicador de precisión de la regla';

COMMENT ON COLUMN public.v_condition_rule_performance.eventos_con_ot
  IS 'Eventos que generaron orden de trabajo (linked_to_wo)';


-- ============================================================
-- 18c. VIEW: v_condition_metrology_status
--    Estado metrológico de las fuentes de datos de condición:
--    fuentes con incertidumbre faltante (uncertainty_available=false),
--    estado de validación, calidad esperada declarada.
-- ============================================================
CREATE OR REPLACE VIEW public.v_condition_metrology_status AS
SELECT
  sc.source_id,
  sc.source_type,
  sc.can_produce AS feature_key,
  sc.method_key,
  sc.quality_expected,
  sc.validation_status,
  sc.uncertainty_available,
  CASE
    WHEN sc.uncertainty_available = false THEN 'Falta incertidumbre — calidad declarada como ' || sc.quality_expected
    WHEN sc.validation_status NOT IN ('active', 'field_trial') THEN 'Fuente no activa — estado: ' || sc.validation_status
    ELSE 'OK'
  END AS status_observacion,
  sc.created_at AS registrada_en,
  (SELECT COUNT(*) FROM public.condition_windows cw
   WHERE cw.source_id = sc.source_id) AS ventanas_ingestadas
FROM public.condition_source_capabilities sc
ORDER BY
  CASE
    WHEN sc.uncertainty_available = false THEN 0
    WHEN sc.validation_status NOT IN ('active', 'field_trial') THEN 1
    ELSE 2
  END,
  sc.source_id;

COMMENT ON VIEW public.v_condition_metrology_status
  IS 'Estado metrológico de fuentes de condición: incertidumbre declarada, estado de validación, calidad esperada. Soporte a REQ-CVAL-003.';

COMMENT ON COLUMN public.v_condition_metrology_status.source_id
  IS 'Identificador de la fuente de datos de condición';

COMMENT ON COLUMN public.v_condition_metrology_status.uncertainty_available
  IS 'Indica si la fuente declara incertidumbre de medición (requisito metrológico)';

COMMENT ON COLUMN public.v_condition_metrology_status.status_observacion
  IS 'Observación de estado: indica si falta incertidumbre, estado no activo, o OK';

COMMENT ON COLUMN public.v_condition_metrology_status.ventanas_ingestadas
  IS 'Cantidad de ventanas ingesta recibidas de esta fuente';


-- ============================================================
-- 19. RLS: Views — acceso de lectura para authenticated
--    Las vistas son de solo lectura; heredan RLS de las tablas
--    subyacentes. Se asegura acceso SELECT para todos los roles.
--    No se requiere DROP/CREATE POLICY para vistas en PG,
--    pero se documenta la intención de acceso.
-- ============================================================

-- Las vistas v_condition_data_quality, v_condition_rule_performance y
-- v_condition_metrology_status consultan tablas con RLS habilitada
-- (condition_feature_values, condition_windows, condition_rules,
-- condition_events, condition_source_capabilities).
-- Dado que todas estas tablas tienen política SELECT → authenticated,
-- cualquier usuario autenticado puede consultar las vistas.
-- No se requiere configuración adicional de RLS para vistas en PostgreSQL.
