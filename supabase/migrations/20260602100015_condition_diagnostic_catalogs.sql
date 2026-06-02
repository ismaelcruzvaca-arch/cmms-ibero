-- ============================================================
-- MIGRATION: condition_diagnostic_catalogs — Catálogos de
--   Diagnóstico para SDD 4
-- Change: condition-monitoring-diagnostics-prognostics (PR 1a)
-- ============================================================
-- Crea las tablas de catálogo para el pipeline de diagnóstico
-- basado en condición:
--   1. condition_failure_mode_catalog — modos de falla CBM
--   2. fmea_cbm_cross_reference — puente FMEA RxDB ↔ CBM
--   3. diagnostic_evidence_matrix — patrones multi-feature
--   4. condition_pf_curves — curvas Potencial-Funcional
--
-- Idempotente: CREATE TABLE IF NOT EXISTS, CREATE INDEX
--   IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE POLICY.
--
-- RLS:
--   SELECT → authenticated (todos los roles)
--   INSERT/UPDATE/DELETE → PLANNER, ADMIN
--
-- Dependencias:
--   Ninguna — tablas autónomas de catálogo.
--   condition_failure_mode_catalog es FK destino de las otras 3.
--
-- SQL comments en español.
-- ============================================================

-- ============================================================
-- 1. TABLA: condition_failure_mode_catalog
--    Catálogo CBM de modos de falla por asset_class.
--    Separado del FMEA de diseño en RxDB.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.condition_failure_mode_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  failure_mode_key TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  failure_mechanism TEXT,
  typical_causes TEXT[] DEFAULT '{}',
  typical_effects TEXT[] DEFAULT '{}',
  severity_default TEXT NOT NULL DEFAULT 'medium'
    CHECK (severity_default IN ('low', 'medium', 'high', 'critical')),
  detectability TEXT NOT NULL DEFAULT 'medium'
    CHECK (detectability IN ('easy', 'medium', 'hard')),
  iso14224_taxonomy_ref TEXT,
  fmea_ref TEXT,
  validation_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (validation_status IN ('draft', 'seed', 'bench_validated', 'field_validated', 'superseded')),
  category TEXT NOT NULL DEFAULT 'asset'
    CHECK (category IN ('asset', 'sensor', 'process')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(failure_mode_key)
);

COMMENT ON TABLE public.condition_failure_mode_catalog
  IS 'Catálogo CBM de modos de falla por asset_class. Separado del FMEA de diseño en RxDB.';

COMMENT ON COLUMN public.condition_failure_mode_catalog.id
  IS 'Identificador único del modo de falla CBM';
COMMENT ON COLUMN public.condition_failure_mode_catalog.failure_mode_key
  IS 'Clave única del modo de falla (ej: pump.cavitation, sensor.drift)';
COMMENT ON COLUMN public.condition_failure_mode_catalog.asset_class
  IS 'Clase de activo al que aplica este modo (centrifugal_pump, electric_motor, sensor)';
COMMENT ON COLUMN public.condition_failure_mode_catalog.name
  IS 'Nombre descriptivo del modo de falla';
COMMENT ON COLUMN public.condition_failure_mode_catalog.description
  IS 'Descripción detallada del modo de falla';
COMMENT ON COLUMN public.condition_failure_mode_catalog.failure_mechanism
  IS 'Mecanismo físico/químico que causa la falla';
COMMENT ON COLUMN public.condition_failure_mode_catalog.typical_causes
  IS 'Causas típicas del modo de falla (array de texto)';
COMMENT ON COLUMN public.condition_failure_mode_catalog.typical_effects
  IS 'Efectos típicos del modo de falla (array de texto)';
COMMENT ON COLUMN public.condition_failure_mode_catalog.severity_default
  IS 'Severidad por defecto: low, medium, high, critical';
COMMENT ON COLUMN public.condition_failure_mode_catalog.detectability
  IS 'Detectabilidad CBM: easy, medium, hard';
COMMENT ON COLUMN public.condition_failure_mode_catalog.iso14224_taxonomy_ref
  IS 'Código de referencia según norma ISO 14224 (ej: PMP/CP/CAV)';
COMMENT ON COLUMN public.condition_failure_mode_catalog.fmea_ref
  IS 'Referencia al FMEA de diseño en RxDB (failure_mode_catalog.id)';
COMMENT ON COLUMN public.condition_failure_mode_catalog.validation_status
  IS 'Estado de validación: draft, seed, bench_validated, field_validated, superseded';
COMMENT ON COLUMN public.condition_failure_mode_catalog.category
  IS 'Categoría del modo: asset (falla de activo), sensor (falla de instrumentación), process (falla de proceso)';
COMMENT ON COLUMN public.condition_failure_mode_catalog.created_at
  IS 'Fecha de creación del registro';

-- Índices
CREATE INDEX IF NOT EXISTS idx_fmc_asset_class
  ON public.condition_failure_mode_catalog(asset_class);

CREATE INDEX IF NOT EXISTS idx_fmc_validation
  ON public.condition_failure_mode_catalog(validation_status);

CREATE INDEX IF NOT EXISTS idx_fmc_category
  ON public.condition_failure_mode_catalog(category);

-- ============================================================
-- 2. TABLA: fmea_cbm_cross_reference
--    Puente entre modos de falla CBM (PostgreSQL) y FMEA (RxDB).
--    Sin migración completa de FMEA.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.fmea_cbm_cross_reference (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  condition_failure_mode_id UUID NOT NULL
    REFERENCES public.condition_failure_mode_catalog(id) ON DELETE CASCADE,
  fmea_failure_mode_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL
    CHECK (relationship_type IN ('same_as', 'related_to', 'evidence_for', 'supersedes', 'unknown')),
  confidence NUMERIC DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(condition_failure_mode_id, fmea_failure_mode_id)
);

COMMENT ON TABLE public.fmea_cbm_cross_reference
  IS 'Puente entre modos de falla CBM (PostgreSQL) y FMEA (RxDB). Sin migración completa de FMEA.';

COMMENT ON COLUMN public.fmea_cbm_cross_reference.id
  IS 'Identificador único de la referencia cruzada';
COMMENT ON COLUMN public.fmea_cbm_cross_reference.condition_failure_mode_id
  IS 'FK al modo de falla CBM en condition_failure_mode_catalog';
COMMENT ON COLUMN public.fmea_cbm_cross_reference.fmea_failure_mode_id
  IS 'ID del modo de falla FMEA en RxDB (failure_mode_catalog.id)';
COMMENT ON COLUMN public.fmea_cbm_cross_reference.relationship_type
  IS 'Tipo de relación: same_as, related_to, evidence_for, supersedes, unknown';
COMMENT ON COLUMN public.fmea_cbm_cross_reference.confidence
  IS 'Confianza en la relación [0.0, 1.0]';
COMMENT ON COLUMN public.fmea_cbm_cross_reference.notes
  IS 'Notas sobre la relación entre ambos modos de falla';
COMMENT ON COLUMN public.fmea_cbm_cross_reference.created_at
  IS 'Fecha de creación del registro';

-- Índices
CREATE INDEX IF NOT EXISTS idx_fmea_cross_condition
  ON public.fmea_cbm_cross_reference(condition_failure_mode_id);

CREATE INDEX IF NOT EXISTS idx_fmea_cross_fmea
  ON public.fmea_cbm_cross_reference(fmea_failure_mode_id);

-- ============================================================
-- 3. TABLA: diagnostic_evidence_matrix
--    Patrones de evidencia multi-feature para cada modo de falla.
--    Soporta required/supporting/contradictory evidence.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.diagnostic_evidence_matrix (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  failure_mode_id UUID NOT NULL
    REFERENCES public.condition_failure_mode_catalog(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  condition_type TEXT NOT NULL DEFAULT 'threshold'
    CHECK (condition_type IN ('threshold', 'residual', 'trend')),
  evidence_role TEXT NOT NULL DEFAULT 'supporting'
    CHECK (evidence_role IN ('required', 'supporting', 'contradictory')),
  op TEXT NOT NULL DEFAULT '>'
    CHECK (op IN ('>', '>=', '<', '<=', '=', 'between')),
  value NUMERIC,
  logical_operator TEXT DEFAULT 'AND'
    CHECK (logical_operator IN ('AND', 'OR')),
  min_quality TEXT DEFAULT 'G1'
    CHECK (min_quality IN ('G0', 'G1', 'G2', 'G3')),
  min_confidence NUMERIC DEFAULT 0.5 CHECK (min_confidence >= 0 AND min_confidence <= 1),
  required_regime TEXT,
  window_count INTEGER DEFAULT 1,
  weight NUMERIC DEFAULT 1.0 CHECK (weight >= 0 AND weight <= 10),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.diagnostic_evidence_matrix
  IS 'Patrones de evidencia multi-feature para cada modo de falla. Soporta required/supporting/contradictory evidence.';

COMMENT ON COLUMN public.diagnostic_evidence_matrix.id
  IS 'Identificador único de la evidencia';
COMMENT ON COLUMN public.diagnostic_evidence_matrix.failure_mode_id
  IS 'FK al modo de falla en condition_failure_mode_catalog';
COMMENT ON COLUMN public.diagnostic_evidence_matrix.feature_key
  IS 'Clave del feature de condición (vibration.rms, pressure.discharge, etc.)';
COMMENT ON COLUMN public.diagnostic_evidence_matrix.condition_type
  IS 'Tipo de condición: threshold, residual, trend';
COMMENT ON COLUMN public.diagnostic_evidence_matrix.evidence_role
  IS 'Rol de la evidencia: required (obligatoria), supporting (de apoyo), contradictory (contradice)';
COMMENT ON COLUMN public.diagnostic_evidence_matrix.op
  IS 'Operador de comparación: >, >=, <, <=, =, between';
COMMENT ON COLUMN public.diagnostic_evidence_matrix.value
  IS 'Valor de referencia para la comparación';
COMMENT ON COLUMN public.diagnostic_evidence_matrix.logical_operator
  IS 'Operador lógico entre evidencias del mismo rol: AND, OR';
COMMENT ON COLUMN public.diagnostic_evidence_matrix.min_quality
  IS 'Calidad mínima requerida del feature_value: G0, G1, G2, G3';
COMMENT ON COLUMN public.diagnostic_evidence_matrix.min_confidence
  IS 'Confianza mínima requerida del feature_value [0.0, 1.0]';
COMMENT ON COLUMN public.diagnostic_evidence_matrix.required_regime
  IS 'Régimen operativo requerido (NULL = cualquier régimen)';
COMMENT ON COLUMN public.diagnostic_evidence_matrix.window_count
  IS 'Cantidad de ventanas consecutivas que deben cumplir la condición';
COMMENT ON COLUMN public.diagnostic_evidence_matrix.weight
  IS 'Peso de esta evidencia en el score de confianza [0.0, 10.0]';
COMMENT ON COLUMN public.diagnostic_evidence_matrix.created_at
  IS 'Fecha de creación del registro';

-- Índices
CREATE INDEX IF NOT EXISTS idx_dem_failure_mode
  ON public.diagnostic_evidence_matrix(failure_mode_id);

CREATE INDEX IF NOT EXISTS idx_dem_feature
  ON public.diagnostic_evidence_matrix(feature_key);

CREATE INDEX IF NOT EXISTS idx_dem_fm_feature
  ON public.diagnostic_evidence_matrix(failure_mode_id, feature_key);

-- ============================================================
-- 4. TABLA: condition_pf_curves
--    Curvas P-F que definen intervalos entre detección
--    potencial (P) y falla funcional (F) por asset_class
--    + failure_mode.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.condition_pf_curves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_class TEXT NOT NULL,
  failure_mode_key TEXT NOT NULL,
  potential_failure_point TEXT,
  functional_failure_point TEXT,
  pf_interval_days INTEGER NOT NULL CHECK (pf_interval_days > 0),
  inspection_interval_days INTEGER CHECK (inspection_interval_days > 0),
  intervention_window_days INTEGER CHECK (intervention_window_days > 0),
  confidence NUMERIC DEFAULT 0.7 CHECK (confidence >= 0 AND confidence <= 1),
  validation_status TEXT DEFAULT 'seed'
    CHECK (validation_status IN ('draft', 'seed', 'bench_validated', 'field_validated', 'superseded')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(asset_class, failure_mode_key)
);

COMMENT ON TABLE public.condition_pf_curves
  IS 'Curvas P-F que definen intervalos entre detección potencial (P) y falla funcional (F) por asset_class + failure_mode.';

COMMENT ON COLUMN public.condition_pf_curves.id
  IS 'Identificador único de la curva P-F';
COMMENT ON COLUMN public.condition_pf_curves.asset_class
  IS 'Clase de activo (centrifugal_pump, electric_motor, centrifugal_fan)';
COMMENT ON COLUMN public.condition_pf_curves.failure_mode_key
  IS 'Clave del modo de falla (FK lógica a condition_failure_mode_catalog)';
COMMENT ON COLUMN public.condition_pf_curves.potential_failure_point
  IS 'Descripción del punto P — momento en que la falla es detectabile';
COMMENT ON COLUMN public.condition_pf_curves.functional_failure_point
  IS 'Descripción del punto F — momento en que ocurre la falla funcional';
COMMENT ON COLUMN public.condition_pf_curves.pf_interval_days
  IS 'Intervalo P-F en días: desde detección potencial hasta falla funcional';
COMMENT ON COLUMN public.condition_pf_curves.inspection_interval_days
  IS 'Intervalo de inspección recomendado en días';
COMMENT ON COLUMN public.condition_pf_curves.intervention_window_days
  IS 'Ventana de intervención recomendada en días';
COMMENT ON COLUMN public.condition_pf_curves.confidence
  IS 'Confianza en los valores de la curva [0.0, 1.0]';
COMMENT ON COLUMN public.condition_pf_curves.validation_status
  IS 'Estado de validación: draft, seed, bench_validated, field_validated, superseded';
COMMENT ON COLUMN public.condition_pf_curves.notes
  IS 'Notas técnicas sobre la curva P-F';
COMMENT ON COLUMN public.condition_pf_curves.created_at
  IS 'Fecha de creación del registro';

-- Índices
CREATE INDEX IF NOT EXISTS idx_pf_asset_class
  ON public.condition_pf_curves(asset_class);

CREATE INDEX IF NOT EXISTS idx_pf_fm
  ON public.condition_pf_curves(failure_mode_key);

-- ============================================================
-- 5. ROW-LEVEL SECURITY
--    Patrón: SELECT → authenticated (todos los roles)
--    INSERT/UPDATE/DELETE → PLANNER, ADMIN
--    Usa get_user_role() de la migración RBAC.
-- ============================================================

-- ----- condition_failure_mode_catalog -----
ALTER TABLE public.condition_failure_mode_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS condition_failure_mode_catalog_select ON public.condition_failure_mode_catalog;
CREATE POLICY condition_failure_mode_catalog_select ON public.condition_failure_mode_catalog
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS condition_failure_mode_catalog_insert ON public.condition_failure_mode_catalog;
CREATE POLICY condition_failure_mode_catalog_insert ON public.condition_failure_mode_catalog
  FOR INSERT TO authenticated WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

DROP POLICY IF EXISTS condition_failure_mode_catalog_update ON public.condition_failure_mode_catalog;
CREATE POLICY condition_failure_mode_catalog_update ON public.condition_failure_mode_catalog
  FOR UPDATE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

DROP POLICY IF EXISTS condition_failure_mode_catalog_delete ON public.condition_failure_mode_catalog;
CREATE POLICY condition_failure_mode_catalog_delete ON public.condition_failure_mode_catalog
  FOR DELETE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'));

-- ----- fmea_cbm_cross_reference -----
ALTER TABLE public.fmea_cbm_cross_reference ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fmea_cbm_cross_reference_select ON public.fmea_cbm_cross_reference;
CREATE POLICY fmea_cbm_cross_reference_select ON public.fmea_cbm_cross_reference
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS fmea_cbm_cross_reference_insert ON public.fmea_cbm_cross_reference;
CREATE POLICY fmea_cbm_cross_reference_insert ON public.fmea_cbm_cross_reference
  FOR INSERT TO authenticated WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

DROP POLICY IF EXISTS fmea_cbm_cross_reference_update ON public.fmea_cbm_cross_reference;
CREATE POLICY fmea_cbm_cross_reference_update ON public.fmea_cbm_cross_reference
  FOR UPDATE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

DROP POLICY IF EXISTS fmea_cbm_cross_reference_delete ON public.fmea_cbm_cross_reference;
CREATE POLICY fmea_cbm_cross_reference_delete ON public.fmea_cbm_cross_reference
  FOR DELETE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'));

-- ----- diagnostic_evidence_matrix -----
ALTER TABLE public.diagnostic_evidence_matrix ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS diagnostic_evidence_matrix_select ON public.diagnostic_evidence_matrix;
CREATE POLICY diagnostic_evidence_matrix_select ON public.diagnostic_evidence_matrix
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS diagnostic_evidence_matrix_insert ON public.diagnostic_evidence_matrix;
CREATE POLICY diagnostic_evidence_matrix_insert ON public.diagnostic_evidence_matrix
  FOR INSERT TO authenticated WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

DROP POLICY IF EXISTS diagnostic_evidence_matrix_update ON public.diagnostic_evidence_matrix;
CREATE POLICY diagnostic_evidence_matrix_update ON public.diagnostic_evidence_matrix
  FOR UPDATE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

DROP POLICY IF EXISTS diagnostic_evidence_matrix_delete ON public.diagnostic_evidence_matrix;
CREATE POLICY diagnostic_evidence_matrix_delete ON public.diagnostic_evidence_matrix
  FOR DELETE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'));

-- ----- condition_pf_curves -----
ALTER TABLE public.condition_pf_curves ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS condition_pf_curves_select ON public.condition_pf_curves;
CREATE POLICY condition_pf_curves_select ON public.condition_pf_curves
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS condition_pf_curves_insert ON public.condition_pf_curves;
CREATE POLICY condition_pf_curves_insert ON public.condition_pf_curves
  FOR INSERT TO authenticated WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

DROP POLICY IF EXISTS condition_pf_curves_update ON public.condition_pf_curves;
CREATE POLICY condition_pf_curves_update ON public.condition_pf_curves
  FOR UPDATE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

DROP POLICY IF EXISTS condition_pf_curves_delete ON public.condition_pf_curves;
CREATE POLICY condition_pf_curves_delete ON public.condition_pf_curves
  FOR DELETE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'));

-- ============================================================
-- 6. SEED DATA: condition_failure_mode_catalog (12 modos)
--    Tres categorías: asset (activo), sensor (instrumentación),
--    process (proceso).
-- ============================================================
INSERT INTO public.condition_failure_mode_catalog
  (failure_mode_key, asset_class, name, description, failure_mechanism,
   typical_causes, typical_effects, severity_default, detectability,
   iso14224_taxonomy_ref, validation_status, category)
VALUES
  (
    'pump.cavitation', 'centrifugal_pump',
    'Cavitación en Bomba Centrífuga',
    'Vaporización del fluido en la succión por baja presión, causando implosión de burbujas que erosionan el impulsor y las paredes internas.',
    'Erosión por implosión de burbujas de vapor en zonas de baja presión.',
    ARRAY['Bajo NPSH disponible', 'Fluido a temperatura elevada', 'Succión obstruida parcialmente', 'Velocidad excesiva de la bomba'],
    ARRAY['Ruido de grava/choque metálico', 'Caída de presión de descarga', 'Vibración de alta frecuencia errática', 'Erosión del impulsor'],
    'critical', 'medium', 'PMP/CP/CAV', 'seed', 'asset'
  ),
  (
    'pump.suction_restriction', 'centrifugal_pump',
    'Restricción en Succión de Bomba',
    'Obstrucción parcial en la línea de succión que reduce el caudal disponible y puede inducir cavitación incipiente.',
    'Reducción del área de paso en la línea de succión por obstrucción o válvula parcialmente cerrada.',
    ARRAY['Válvula de succión parcialmente cerrada', 'Filtro de succión obstruido', 'Sedimentos en la tubería', 'Colapso de manguera flexible'],
    ARRAY['Caudal reducido', 'Presión de succión baja', 'Vibración leve', 'Aumento de temperatura del fluido'],
    'high', 'medium', 'PMP/CP/SRC', 'seed', 'asset'
  ),
  (
    'rotating.misalignment', 'centrifugal_pump',
    'Desalineación Rotativa',
    'Desalineación angular o paralela entre ejes acoplados que genera fuerzas radiales y axiales cíclicas.',
    'Desalineación de ejes: paralela (offset) o angular (gap desigual) en el acoplamiento.',
    ARRAY['Montaje incorrecto del acoplamiento', 'Expansión térmica diferencial', 'Desgaste de base/skid', 'Asentamiento de la fundación'],
    ARRAY['Vibración radial 1X y 2X RPM', 'Desgaste prematuro de acoplamiento', 'Calentamiento en rodamientos', 'Ruido en acoplamiento'],
    'high', 'medium', 'PMP/CP/MAL', 'seed', 'asset'
  ),
  (
    'rotating.unbalance', 'centrifugal_pump',
    'Desequilibrio Rotativo',
    'Distribución no uniforme de masa alrededor del eje de rotación, generando fuerza centrífuga desbalanceada.',
    'Distribución asimétrica de masa en el rotor: desbalance estático, de momento o dinámico.',
    ARRAY['Desgaste asimétrico del impulsor', 'Depósitos desiguales en el rotor', 'Masa de balance perdida', 'Impulsor reparado sin balancear'],
    ARRAY['Vibración radial 1X RPM dominante', 'Fase estable', 'Desgaste acelerado de rodamientos', 'Sobrecarga del sello mecánico'],
    'high', 'easy', 'PMP/CP/UNB', 'seed', 'asset'
  ),
  (
    'bearing.outer_race_defect', 'centrifugal_pump',
    'Defecto en Pista Exterior de Rodamiento',
    'Picadura o descascarado en la pista exterior del rodamiento, típicamente por fatiga superficial o contaminación.',
    'Fatiga por contacto rodante (spalling) en la pista exterior inducida por cargas cíclicas y contaminación del lubricante.',
    ARRAY['Contaminación del lubricante', 'Fatiga cíclica por sobrecarga', 'Lubricación insuficiente', 'Desalineación del eje'],
    ARRAY['Vibración de alta frecuencia a 1X BPFO', 'Picos en FFT a BPFO y armónicos', 'Ruido metálico intermitente', 'Aumento de temperatura local'],
    'high', 'medium', 'PMP/CP/BRG', 'seed', 'asset'
  ),
  (
    'bearing.inner_race_defect', 'electric_motor',
    'Defecto en Pista Interior de Rodamiento',
    'Picadura o descascarado en la pista interior del rodamiento del motor eléctrico.',
    'Fatiga por contacto rodante (spalling) en la pista interior con modulación a 1X RPM.',
    ARRAY['Sobrecarga del motor', 'Contaminación del lubricante', 'Desbalance del rotor', 'Juego excesivo del rodamiento'],
    ARRAY['Vibración a BPFI modulada por 1X RPM', 'Picos laterales en FFT', 'Calentamiento del rodamiento', 'Ruido chirriante'],
    'high', 'hard', 'MOT/AC/BRG', 'seed', 'asset'
  ),
  (
    'impeller.damage', 'centrifugal_pump',
    'Daño en Impulsor',
    'Degradación física del impulsor por erosión, corrosión o impacto de partículas sólidas.',
    'Erosión/abrasión del material del impulsor por partículas sólidas o corrosión química del fluido.',
    ARRAY['Partículas sólidas en el fluido', 'Fluido corrosivo', 'Cavitación prolongada', 'Golpe de ariete'],
    ARRAY['Caudal reducido', 'Vibración por desbalance progresivo', 'Aumento de la corriente del motor', 'Pérdida de eficiencia hidráulica'],
    'medium', 'medium', 'PMP/CP/IMP', 'seed', 'asset'
  ),
  (
    'seal.leakage', 'centrifugal_pump',
    'Fuga de Sello Mecánico',
    'Pérdida de estanqueidad del sello mecánico por desgaste de caras de sellado, deterioro de elastómeros o mala instalación.',
    'Desgaste de la interfaz de sellado primaria o degradación de elastómeros secundarios por temperatura/químicos.',
    ARRAY['Desgaste normal de la cara de sellado', 'Operación en seco', 'Fluido abrasivo', 'Mala instalación del sello'],
    ARRAY['Fuga visible por el drenaje del sello', 'Olor a fluido de proceso', 'Pérdida de producto', 'Aumento de temperatura del sello'],
    'medium', 'easy', 'PMP/CP/SEA', 'seed', 'asset'
  ),
  (
    'electrical.stator_fault', 'electric_motor',
    'Falla de Estator Eléctrico',
    'Falla en el devanado del estator por degradación del aislamiento, cortocircuito entre espiras o conexión suelta.',
    'Degradación del sistema de aislamiento del devanado por estrés térmico, eléctrico, mecánico o ambiental.',
    ARRAY['Degradación del aislamiento por temperatura', 'Sobrecarga sostenida', 'Humedad/contaminación en devanados', 'Transitorios de tensión'],
    ARRAY['Corriente desbalanceada', 'Aumento de temperatura del motor', 'Olor a quemado', 'Disparo por sobrecarga/protección térmica'],
    'critical', 'hard', 'MOT/AC/STA', 'seed', 'asset'
  ),
  (
    'sensor.stuck_signal', 'sensor',
    'Señal de Sensor Pegada',
    'El sensor reporta un valor constante que no cambia con la variable medida, típicamente por falla del elemento sensor o electrónica.',
    'Fallo del elemento sensor primario o de la electrónica de acondicionamiento que congela el valor de salida.',
    ARRAY['Falla del elemento sensor', 'Cableado roto o en corto', 'Falla de la electrónica del transmisor', 'Pérdida de alimentación del lazo'],
    ARRAY['Valor constante sin variación natural', 'Desviación estándar cero en ventana', 'Correlación nula con otras variables', 'Alarma de señal muerta'],
    'low', 'easy', NULL, 'seed', 'sensor'
  ),
  (
    'sensor.dropout', 'sensor',
    'Pérdida de Señal de Sensor',
    'Pérdida intermitente de la señal del sensor, con periodos de datos válidos alternados con vacíos de comunicación.',
    'Desconexión intermitente del lazo de comunicación entre el sensor y el sistema de adquisición.',
    ARRAY['Conexión eléctrica intermitente', 'Interferencia electromagnética', 'Falla de la tarjeta de adquisición', 'Batería del sensor inalámbrico baja'],
    ARRAY['Datos faltantes en ventanas consecutivas', 'Timestamp saltado', 'Paquetes de datos incompletos', 'Alarma de comunicación'],
    'low', 'easy', NULL, 'seed', 'sensor'
  ),
  (
    'sensor.drift', 'sensor',
    'Deriva de Sensor',
    'Desviación lenta y progresiva del valor del sensor respecto al valor real de la variable medida.',
    'Degradación del elemento sensor o de la electrónica que causa un cambio gradual en la calibración.',
    ARRAY['Envejecimiento del elemento sensor', 'Efectos de temperatura en la electrónica', 'Contaminación del elemento sensor', 'Fatiga de componentes electrónicos'],
    ARRAY['Valor que se desvía lentamente del baseline', 'Tendencia suave sin correlación con operación', 'Error de medición creciente', 'Descalibración progresiva'],
    'medium', 'hard', NULL, 'seed', 'sensor'
  )
ON CONFLICT (failure_mode_key) DO NOTHING;

-- ============================================================
-- 7. SEED DATA: fmea_cbm_cross_reference (3 enlaces)
--    Vincula modos CBM seed con modos FMEA existentes en RxDB.
--    fmea_failure_mode_id referencia hypotéticos IDs del
--    failure_mode_catalog en RxDB.
-- ============================================================
INSERT INTO public.fmea_cbm_cross_reference
  (condition_failure_mode_id, fmea_failure_mode_id, relationship_type, confidence, notes)
SELECT
  fm.id, 'FMEA-CAV-001', 'same_as', 0.95,
  'pump.cavitation en CBM corresponde al modo CAV-001 del FMEA de diseño para bombas centrífugas.'
FROM public.condition_failure_mode_catalog fm
WHERE fm.failure_mode_key = 'pump.cavitation'
  AND NOT EXISTS (
    SELECT 1 FROM public.fmea_cbm_cross_reference x
    WHERE x.condition_failure_mode_id = fm.id
      AND x.fmea_failure_mode_id = 'FMEA-CAV-001'
  );

INSERT INTO public.fmea_cbm_cross_reference
  (condition_failure_mode_id, fmea_failure_mode_id, relationship_type, confidence, notes)
SELECT
  fm.id, 'FMEA-MAL-002', 'related_to', 0.80,
  'rotating.misalignment en CBM se relaciona con FMEA MAL-002; el FMEA original no distingue desalineación paralela vs angular.'
FROM public.condition_failure_mode_catalog fm
WHERE fm.failure_mode_key = 'rotating.misalignment'
  AND NOT EXISTS (
    SELECT 1 FROM public.fmea_cbm_cross_reference x
    WHERE x.condition_failure_mode_id = fm.id
      AND x.fmea_failure_mode_id = 'FMEA-MAL-002'
  );

INSERT INTO public.fmea_cbm_cross_reference
  (condition_failure_mode_id, fmea_failure_mode_id, relationship_type, confidence, notes)
SELECT
  fm.id, 'FMEA-BRG-003', 'same_as', 0.90,
  'bearing.outer_race_defect en CBM corresponde al modo de falla de rodamiento BRG-003 del FMEA de diseño.'
FROM public.condition_failure_mode_catalog fm
WHERE fm.failure_mode_key = 'bearing.outer_race_defect'
  AND NOT EXISTS (
    SELECT 1 FROM public.fmea_cbm_cross_reference x
    WHERE x.condition_failure_mode_id = fm.id
      AND x.fmea_failure_mode_id = 'FMEA-BRG-003'
  );

-- ============================================================
-- 8. SEED DATA: diagnostic_evidence_matrix (2 patrones completos)
--    Patrón 1: pump.cavitation
--      - Required: pressure residual negativo (presión descarga baja)
--      - Required: HF vibration high (vibración alta frecuencia alta)
--      - Supporting: temperature bearing elevada
--      - Contradictory: pressure discharge normal
--    Patrón 2: rotating.unbalance
--      - Required: 1X vibration high (vibración 1X RPM alta)
--      - Required: radial vibration high (vibración radial alta)
--      - Supporting: phase stable
--      - Contradictory: harmonics > 5 (indica desalineación, no desbalance)
-- ============================================================
INSERT INTO public.diagnostic_evidence_matrix
  (failure_mode_id, feature_key, condition_type, evidence_role, op, value,
   logical_operator, min_quality, min_confidence, weight)
SELECT
  fm.id, 'pressure.residual', 'residual', 'required', '<', -2.0,
  'AND', 'G1', 0.6, 2.0
FROM public.condition_failure_mode_catalog fm
WHERE fm.failure_mode_key = 'pump.cavitation'
  AND NOT EXISTS (
    SELECT 1 FROM public.diagnostic_evidence_matrix dem
    WHERE dem.failure_mode_id = fm.id
      AND dem.feature_key = 'pressure.residual'
      AND dem.evidence_role = 'required'
  );

INSERT INTO public.diagnostic_evidence_matrix
  (failure_mode_id, feature_key, condition_type, evidence_role, op, value,
   logical_operator, min_quality, min_confidence, weight)
SELECT
  fm.id, 'vibration.high_frequency', 'threshold', 'required', '>=', 7.1,
  'AND', 'G1', 0.6, 2.0
FROM public.condition_failure_mode_catalog fm
WHERE fm.failure_mode_key = 'pump.cavitation'
  AND NOT EXISTS (
    SELECT 1 FROM public.diagnostic_evidence_matrix dem
    WHERE dem.failure_mode_id = fm.id
      AND dem.feature_key = 'vibration.high_frequency'
      AND dem.evidence_role = 'required'
  );

INSERT INTO public.diagnostic_evidence_matrix
  (failure_mode_id, feature_key, condition_type, evidence_role, op, value,
   logical_operator, min_quality, min_confidence, weight)
SELECT
  fm.id, 'temperature.bearing', 'threshold', 'supporting', '>', 75.0,
  'AND', 'G2', 0.4, 0.7
FROM public.condition_failure_mode_catalog fm
WHERE fm.failure_mode_key = 'pump.cavitation'
  AND NOT EXISTS (
    SELECT 1 FROM public.diagnostic_evidence_matrix dem
    WHERE dem.failure_mode_id = fm.id
      AND dem.feature_key = 'temperature.bearing'
      AND dem.evidence_role = 'supporting'
  );

INSERT INTO public.diagnostic_evidence_matrix
  (failure_mode_id, feature_key, condition_type, evidence_role, op, value,
   logical_operator, min_quality, min_confidence, weight)
SELECT
  fm.id, 'pressure.discharge', 'threshold', 'contradictory', '>=', 85.0,
  'AND', 'G2', 0.5, 1.5
FROM public.condition_failure_mode_catalog fm
WHERE fm.failure_mode_key = 'pump.cavitation'
  AND NOT EXISTS (
    SELECT 1 FROM public.diagnostic_evidence_matrix dem
    WHERE dem.failure_mode_id = fm.id
      AND dem.feature_key = 'pressure.discharge'
      AND dem.evidence_role = 'contradictory'
  );

-- Patrón: rotating.unbalance
INSERT INTO public.diagnostic_evidence_matrix
  (failure_mode_id, feature_key, condition_type, evidence_role, op, value,
   logical_operator, min_quality, min_confidence, weight)
SELECT
  fm.id, 'vibration.1x_rpm', 'threshold', 'required', '>=', 4.5,
  'AND', 'G1', 0.6, 2.0
FROM public.condition_failure_mode_catalog fm
WHERE fm.failure_mode_key = 'rotating.unbalance'
  AND NOT EXISTS (
    SELECT 1 FROM public.diagnostic_evidence_matrix dem
    WHERE dem.failure_mode_id = fm.id
      AND dem.feature_key = 'vibration.1x_rpm'
      AND dem.evidence_role = 'required'
  );

INSERT INTO public.diagnostic_evidence_matrix
  (failure_mode_id, feature_key, condition_type, evidence_role, op, value,
   logical_operator, min_quality, min_confidence, weight)
SELECT
  fm.id, 'vibration.radial', 'threshold', 'required', '>=', 5.0,
  'AND', 'G1', 0.6, 2.0
FROM public.condition_failure_mode_catalog fm
WHERE fm.failure_mode_key = 'rotating.unbalance'
  AND NOT EXISTS (
    SELECT 1 FROM public.diagnostic_evidence_matrix dem
    WHERE dem.failure_mode_id = fm.id
      AND dem.feature_key = 'vibration.radial'
      AND dem.evidence_role = 'required'
  );

INSERT INTO public.diagnostic_evidence_matrix
  (failure_mode_id, feature_key, condition_type, evidence_role, op, value,
   logical_operator, min_quality, min_confidence, weight)
SELECT
  fm.id, 'vibration.phase_stability', 'threshold', 'supporting', '<=', 10.0,
  'AND', 'G2', 0.4, 0.7
FROM public.condition_failure_mode_catalog fm
WHERE fm.failure_mode_key = 'rotating.unbalance'
  AND NOT EXISTS (
    SELECT 1 FROM public.diagnostic_evidence_matrix dem
    WHERE dem.failure_mode_id = fm.id
      AND dem.feature_key = 'vibration.phase_stability'
      AND dem.evidence_role = 'supporting'
  );

INSERT INTO public.diagnostic_evidence_matrix
  (failure_mode_id, feature_key, condition_type, evidence_role, op, value,
   logical_operator, min_quality, min_confidence, weight)
SELECT
  fm.id, 'vibration.harmonics', 'threshold', 'contradictory', '>', 5.0,
  'AND', 'G2', 0.5, 1.5
FROM public.condition_failure_mode_catalog fm
WHERE fm.failure_mode_key = 'rotating.unbalance'
  AND NOT EXISTS (
    SELECT 1 FROM public.diagnostic_evidence_matrix dem
    WHERE dem.failure_mode_id = fm.id
      AND dem.feature_key = 'vibration.harmonics'
      AND dem.evidence_role = 'contradictory'
  );

-- ============================================================
-- 9. SEED DATA: condition_pf_curves (3 curvas por defecto)
--    Basadas en datos de confiabilidad de referencia:
--      - Rodamiento: P-F 30 días (inspección cada 7, intervención 14)
--      - Desalineación: P-F 60 días (inspección cada 15, intervención 30)
--      - Cavitación: P-F 14 días (inspección cada 3, intervención 7)
-- ============================================================
INSERT INTO public.condition_pf_curves
  (asset_class, failure_mode_key, potential_failure_point, functional_failure_point,
   pf_interval_days, inspection_interval_days, intervention_window_days,
   confidence, validation_status, notes)
VALUES
  (
    'centrifugal_pump',
    'bearing.outer_race_defect',
    'Inicio de picadura en pista exterior — detectable por vibración HF (BPFO)',
    'Descascarado generalizado — juego excesivo con ruido audible y temperatura elevada',
    30, 7, 14,
    0.75, 'seed',
    'Curva P-F estándar para rodamientos de bolas en bombas centrífugas (NSK/NTN). P-F típico 20-40 días según carga y lubricación.'
  ),
  (
    'centrifugal_pump',
    'rotating.misalignment',
    'Aumento detectable de vibración 1X-2X RPM — fase axial estable',
    'Desgaste severo de acoplamiento con vibración > 15 mm/s — riesgo de rotura de eje',
    60, 15, 30,
    0.70, 'seed',
    'Curva P-F para desalineación de ejes acoplados. P-F varía según tipo de acoplamiento (flexible vs rígido).'
  ),
  (
    'centrifugal_pump',
    'pump.cavitation',
    'Detección de vibración HF errática + caída de presión de descarga',
    'Erosión severa del impulsor con pérdida de caudal > 30% y daño estructural',
    14, 3, 7,
    0.65, 'seed',
    'Curva P-F para cavitación en bombas centrífugas. Progresión rápida — P-F corto (7-21 días) por naturaleza erosiva del fenómeno.'
  )
ON CONFLICT (asset_class, failure_mode_key) DO NOTHING;
