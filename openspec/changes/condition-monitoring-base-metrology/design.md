# Design: Condition Monitoring Base Metrology

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│ ISO 13374 Layer Mapping                                      │
│                                                              │
│  Bloque 1-2  (Edge/IIoT)  → FeatureSet v0.2 HTTP Payload    │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│  Bloque 3  (Detección)    → ingest-condition EF              │
│                           → condition_windows + feature_values│
│  Bloque 3b (Análisis)     → compute_health_index()           │
│                           → compute_degradation_velocity()    │
│                           → condition_analysis_results        │
│  Bloque 4  (Diagnóstico)  → evaluate_condition_rules()       │
│                           → condition_rules engine            │
│  Bloque 5  (Eventos)      → condition_events                 │
│                           → trg_condition_event_to_wo         │
│  Bloque 6  (Mantenimiento)→ work_orders (CBM)                │
│                                                              │
│  Transversal: Validation Lifecycle en methods, thresholds,   │
│  rules, sources, analysis_results                            │
└─────────────────────────────────────────────────────────────┘
```

**Principio**: "El edge mide/procesa; el CMMS evalúa, decide, genera eventos y conecta con mantenimiento."

---

## Migration Plan

### PR1 — Foundation Catalog + Ingest (4 migrations)

| # | Migration filename | Creates |
|---|---|---|
| 1 | `YYYYMMDDHHMMSS_condition_feature_definitions.sql` | `condition_feature_definitions` + seed data |
| 2 | `YYYYMMDDHHMMSS_condition_analysis_methods.sql` | `condition_analysis_methods` + seed data (11 methods) |
| 3 | `YYYYMMDDHHMMSS_condition_source_capabilities.sql` | `condition_source_capabilities` (FK→definitions, FK→methods) |
| 4 | `YYYYMMDDHHMMSS_condition_ingest_schema.sql` | `condition_windows`, `condition_feature_values`, `condition_threshold_catalog` (seed data), `condition_events`, RLS on all PR1 tables |

Migration 4 also deploys: `ingest-condition` EF, `ingest-events` EF.

**Dependencies**: 1→2→3→4 (sequential within PR1).

### PR2 — Computation + Rules + Lifecycle (1 migration)

| # | Migration filename | Creates |
|---|---|---|
| 5 | `YYYYMMDDHHMMSS_condition_metrology_compute.sql` | `condition_analysis_results`, `condition_rules`, `condition_event_sources`, `compute_health_index()`, `compute_degradation_velocity()`, `evaluate_condition_rules()`, `trg_condition_event_to_wo`, `trg_enforce_validation_lifecycle`, `ALTER work_orders ADD condition_event_id`, FK on `condition_events.rule_id`, RLS on all PR2 tables |

Migration 5 also deploys: `compute-hi` EF.

**Dependencies**: PR2 depends on all PR1 migrations. Must run after PR1 is merged.

---

## Schema Design

### condition_feature_definitions (Migration 1)

```sql
CREATE TABLE IF NOT EXISTS public.condition_feature_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key TEXT UNIQUE NOT NULL,            -- ej: vibration.rms
  unit TEXT NOT NULL,                          -- ej: mm/s
  category TEXT NOT NULL,                      -- ej: vibration, temperature, pressure
  description TEXT,
  default_weight NUMERIC DEFAULT 1.0 CHECK (default_weight >= 0),  -- peso en HI
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.condition_feature_definitions IS 'Catálogo EAV de features de condición medibles';
COMMENT ON COLUMN public.condition_feature_definitions.feature_key IS 'Clave única del feature (ej: vibration.rms, temperature.bearing)';
COMMENT ON COLUMN public.condition_feature_definitions.default_weight IS 'Peso por defecto en cálculo de Health Index (0=excluido)';
```

**Seed data**: 12 features (vibration.rms, vibration.peak, vibration.acceleration_rms, temperature.bearing, temperature.winding, pressure.suction, pressure.discharge, flow.rate, current.motor, speed.rpm, manual.noise_score, manual.visual_score).

### condition_analysis_methods (Migration 2)

```sql
CREATE TABLE IF NOT EXISTS public.condition_analysis_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  method_key TEXT UNIQUE NOT NULL,             -- ej: rms_velocity_window
  category TEXT NOT NULL CHECK (category IN (
    'time_domain', 'frequency_domain', 'statistical', 'model_based', 'hybrid'
  )),
  input_features TEXT[] DEFAULT '{}',          -- features de entrada requeridos
  output_features TEXT[] DEFAULT '{}',         -- features de salida producidos
  default_parameters JSONB DEFAULT '{}',       -- parámetros por defecto
  description TEXT,
  validation_status TEXT DEFAULT 'draft' CHECK (validation_status IN (
    'draft', 'candidate', 'bench_validated', 'field_trial', 'active', 'deprecated', 'rejected'
  )),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.condition_analysis_methods IS 'Catálogo de métodos científicos de análisis de condición';
COMMENT ON COLUMN public.condition_analysis_methods.method_key IS 'Clave única del método (ej: rms_velocity_window, fft_band_energy)';
COMMENT ON COLUMN public.condition_analysis_methods.category IS 'Categoría: time_domain, frequency_domain, statistical, model_based, hybrid';
COMMENT ON COLUMN public.condition_analysis_methods.validation_status IS 'Ciclo de vida: draft → candidate → bench_validated → field_trial → active → deprecated';

CREATE INDEX IF NOT EXISTS idx_methods_validation ON public.condition_analysis_methods(validation_status);
```

### condition_source_capabilities (Migration 3)

```sql
CREATE TABLE IF NOT EXISTS public.condition_source_capabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id TEXT NOT NULL,                     -- identificador de la fuente
  source_type TEXT NOT NULL CHECK (source_type IN (
    'edge', 'manual', 'portable', 'csv', 'modbus', 'mqtt', 'api', 'scada'
  )),
  can_produce TEXT NOT NULL,                   -- feature_key que puede producir
  method_key TEXT NOT NULL REFERENCES public.condition_analysis_methods(method_key),
  sample_rate_hz NUMERIC,                      -- NULL para fuentes manuales
  quality_expected TEXT DEFAULT 'G2' CHECK (quality_expected IN ('G0', 'G1', 'G2', 'G3')),
  uncertainty_available BOOLEAN DEFAULT false,
  validation_status TEXT DEFAULT 'draft' CHECK (validation_status IN (
    'draft', 'candidate', 'bench_validated', 'field_trial', 'active', 'deprecated', 'rejected'
  )),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_id, can_produce, method_key)
);

COMMENT ON TABLE public.condition_source_capabilities IS 'Capacidades declaradas por fuente: qué feature+ método puede producir con qué calidad';
COMMENT ON COLUMN public.condition_source_capabilities.source_id IS 'Identificador de la fuente (ej: edge_001, manual_op_juan)';
COMMENT ON COLUMN public.condition_source_capabilities.can_produce IS 'Feature key que la fuente puede producir (ej: vibration.rms)';
COMMENT ON COLUMN public.condition_source_capabilities.quality_expected IS 'Calidad esperada: G0(excelente), G1(buena), G2(aceptable), G3(no confiable)';

CREATE INDEX IF NOT EXISTS idx_scap_source ON public.condition_source_capabilities(source_id);
CREATE INDEX IF NOT EXISTS idx_scap_validation ON public.condition_source_capabilities(validation_status);
```

### condition_windows (Migration 4)

```sql
CREATE TABLE IF NOT EXISTS public.condition_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_window_id TEXT UNIQUE NOT NULL,     -- edge_001:BANDA-TR-01:2026-06-01T10:00:00Z:v2
  asset_id TEXT NOT NULL,                      -- referencia a assets(id)
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  pipeline_version TEXT,                       -- versión del pipeline edge
  config_version TEXT,                         -- versión de configuración edge
  operational_context JSONB DEFAULT '{}',       -- {regime, rpm, load_pct}
  status TEXT DEFAULT 'received' CHECK (status IN ('received', 'processed', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.condition_windows IS 'Ventanas de tiempo para ingesta batch de features de condición';
COMMENT ON COLUMN public.condition_windows.external_window_id IS 'ID único externo (edge_id:asset_id:timestamp:version)';
COMMENT ON COLUMN public.condition_windows.asset_id IS 'Referencia al activo monitoreado';

CREATE INDEX IF NOT EXISTS idx_windows_asset ON public.condition_windows(asset_id);
CREATE INDEX IF NOT EXISTS idx_windows_time ON public.condition_windows(window_end DESC);
CREATE INDEX IF NOT EXISTS idx_windows_status ON public.condition_windows(status);
```

### condition_feature_values (Migration 4)

```sql
CREATE TABLE IF NOT EXISTS public.condition_feature_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  window_id UUID NOT NULL REFERENCES public.condition_windows(id) ON DELETE CASCADE,
  feature_definition_id UUID NOT NULL REFERENCES public.condition_feature_definitions(id),
  value NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  quality_flag TEXT NOT NULL CHECK (quality_flag IN ('G0', 'G1', 'G2', 'G3')),
  method_key TEXT NOT NULL,                    -- no FK (soft validation en EF)
  method_version TEXT NOT NULL,                -- ej: 0.1.0
  parameters JSONB DEFAULT '{}',              -- parámetros usados por el método
  uncertainty NUMERIC,                         -- incertidumbre declarada (si disponible)
  confidence NUMERIC DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  measurement_point_id TEXT,                   -- punto de medición físico
  sample_count INT,                            -- cantidad de muestras en la ventana
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.condition_feature_values IS 'Valores de features de condición con trazabilidad completa de método y calidad';
COMMENT ON COLUMN public.condition_feature_values.quality_flag IS 'G0=excelente, G1=buena, G2=aceptable, G3=no confiable';
COMMENT ON COLUMN public.condition_feature_values.method_key IS 'Método de cálculo usado (no FK: soft validation en Edge Function)';
COMMENT ON COLUMN public.condition_feature_values.method_version IS 'Versión del método usado (obligatorio, trazabilidad)';

CREATE INDEX IF NOT EXISTS idx_fv_window ON public.condition_feature_values(window_id);
CREATE INDEX IF NOT EXISTS idx_fv_feature ON public.condition_feature_values(feature_definition_id);
CREATE INDEX IF NOT EXISTS idx_fv_method ON public.condition_feature_values(method_key);
CREATE INDEX IF NOT EXISTS idx_fv_quality ON public.condition_feature_values(quality_flag);
```

### condition_threshold_catalog (Migration 4)

```sql
CREATE TABLE IF NOT EXISTS public.condition_threshold_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_definition_id UUID NOT NULL REFERENCES public.condition_feature_definitions(id),
  method_key TEXT NOT NULL REFERENCES public.condition_analysis_methods(method_key),
  asset_class TEXT,                            -- NULL = fallback genérico (aplica a cualquier clase sin umbral específico)
  power_range_min NUMERIC,                     -- rango de potencia kW (opcional)
  power_range_max NUMERIC,
  mounting_type TEXT,                          -- rigid, flexible
  regime TEXT DEFAULT 'FULL_LOAD' CHECK (regime IN (
    'STOPPED', 'STARTUP', 'IDLE', 'PARTIAL_LOAD', 'FULL_LOAD', 'OVERLOAD'
  )),
  measurement_location TEXT,                   -- ej: motor_de, pump_de
  zone_a_max NUMERIC NOT NULL,                 -- zona A (buena) ≤ este valor
  zone_b_max NUMERIC NOT NULL,                 -- zona B (aceptable) ≤ este valor
  zone_c_max NUMERIC NOT NULL,                 -- zona C (alerta) ≤ este valor
  zone_d_max NUMERIC,                          -- zona D (crítica) ≤ este valor; NULL = sin límite superior
  unit TEXT NOT NULL,
  severity TEXT DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  iso_standard TEXT,                           -- ej: ISO 10816-7
  standard_reference TEXT,                     -- referencia específica de la norma
  validity_notes TEXT,
  validation_status TEXT DEFAULT 'draft' CHECK (validation_status IN (
    'draft', 'candidate', 'bench_validated', 'field_trial', 'active', 'deprecated', 'rejected'
  )),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.condition_threshold_catalog IS 'Catálogo de umbrales ISO 10816/20816 contextualizados por activo, feature, método y régimen';
COMMENT ON COLUMN public.condition_threshold_catalog.zone_a_max IS 'Límite superior zona A (buena condición)';
COMMENT ON COLUMN public.condition_threshold_catalog.zone_c_max IS 'Límite superior zona C (alerta). Valores > zone_c_max = zona D (crítica)';

CREATE INDEX IF NOT EXISTS idx_thr_feature ON public.condition_threshold_catalog(feature_definition_id);
CREATE INDEX IF NOT EXISTS idx_thr_method ON public.condition_threshold_catalog(method_key);
CREATE INDEX IF NOT EXISTS idx_thr_asset_class ON public.condition_threshold_catalog(asset_class);
CREATE INDEX IF NOT EXISTS idx_thr_regime ON public.condition_threshold_catalog(regime);
CREATE INDEX IF NOT EXISTS idx_thr_validation ON public.condition_threshold_catalog(validation_status);
```

### condition_events (Migration 4, expanded Migration 5)

```sql
-- Migration 4: create table with rule_id nullable, no FK yet
CREATE TABLE IF NOT EXISTS public.condition_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id TEXT NOT NULL,
  rule_id UUID,                                -- FK agregado en Migration 5
  event_type TEXT NOT NULL CHECK (event_type IN (
    'threshold_exceeded', 'trend_detected', 'quality_degraded', 'manual'
  )),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  hi_value NUMERIC,                            -- Health Index al momento del evento
  dhi_dt_value NUMERIC,                        -- dHI/dt al momento del evento
  message TEXT,                                -- descripción legible del evento
  status TEXT DEFAULT 'open' CHECK (status IN (
    'open', 'linked_to_wo', 'closed', 'dismissed'
  )),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.condition_events IS 'Registro de eventos de condición con ciclo de vida open → linked_to_wo → closed/dismissed';
COMMENT ON COLUMN public.condition_events.rule_id IS 'Regla que disparó el evento (FK agregado en Migration 5)';
COMMENT ON COLUMN public.condition_events.status IS 'Ciclo de vida: open → linked_to_wo → closed | dismissed';

CREATE INDEX IF NOT EXISTS idx_events_asset ON public.condition_events(asset_id);
CREATE INDEX IF NOT EXISTS idx_events_status ON public.condition_events(status);
CREATE INDEX IF NOT EXISTS idx_events_severity ON public.condition_events(severity);

-- Migration 5 adds:
-- ALTER TABLE public.condition_events ADD CONSTRAINT fk_ce_rule
--   FOREIGN KEY (rule_id) REFERENCES public.condition_rules(id);
```

### condition_analysis_results (Migration 5)

```sql
CREATE TABLE IF NOT EXISTS public.condition_analysis_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id TEXT NOT NULL,
  feature_definition_id UUID REFERENCES public.condition_feature_definitions(id), -- NULL si compuesto (HI)
  analysis_type TEXT NOT NULL CHECK (analysis_type IN (
    'health_index', 'trend_slope', 'residual', 'kalman_state', 'rul_estimate'
  )),
  method_key TEXT NOT NULL REFERENCES public.condition_analysis_methods(method_key),
  method_version TEXT NOT NULL,
  parameters JSONB DEFAULT '{}',
  result_value NUMERIC,
  result_unit TEXT,
  confidence NUMERIC CHECK (confidence >= 0 AND confidence <= 1),
  r_squared NUMERIC,                           -- para regresiones (trend_slope)
  window_start TIMESTAMPTZ,
  window_end TIMESTAMPTZ,
  input_window_ids UUID[] DEFAULT '{}',        -- ventanas fuente (trazabilidad)
  validation_status TEXT DEFAULT 'draft' CHECK (validation_status IN (
    'draft', 'candidate', 'bench_validated', 'field_trial', 'active', 'deprecated', 'rejected'
  )),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.condition_analysis_results IS 'Resultados de análisis derivados: HI, tendencias, residuales, estados Kalman, RUL';
COMMENT ON COLUMN public.condition_analysis_results.input_window_ids IS 'UUID[] de condition_windows que alimentaron este análisis';

CREATE INDEX IF NOT EXISTS idx_ar_asset ON public.condition_analysis_results(asset_id);
CREATE INDEX IF NOT EXISTS idx_ar_type ON public.condition_analysis_results(analysis_type);
CREATE INDEX IF NOT EXISTS idx_ar_window_end ON public.condition_analysis_results(window_end DESC);
```

### condition_rules (Migration 5)

```sql
CREATE TABLE IF NOT EXISTS public.condition_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name TEXT NOT NULL,
  description TEXT,
  asset_class TEXT,                            -- NULL = aplica a cualquier clase
  feature_key TEXT,                            -- NULL si regla compuesta (definida en rule_config)
  method_key TEXT,                             -- NULL = aplica a cualquier método para ese feature
  regime TEXT,                                 -- NULL = aplica a cualquier régimen
  min_quality_flag TEXT DEFAULT 'G2' CHECK (min_quality_flag IN ('G0', 'G1', 'G2', 'G3')),
  evaluation_type TEXT NOT NULL CHECK (evaluation_type IN (
    'threshold', 'trend', 'compound', 'residual'
  )),
  rule_config JSONB NOT NULL DEFAULT '{}',     -- {"threshold":7.1, "duration_windows":3}
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  action TEXT NOT NULL DEFAULT 'log_event' CHECK (action IN ('log_event', 'create_wo', 'notify')),
  validation_status TEXT DEFAULT 'draft' CHECK (validation_status IN (
    'draft', 'candidate', 'bench_validated', 'field_trial', 'active', 'deprecated', 'rejected'
  )),
  version INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(rule_name, version)
);

COMMENT ON TABLE public.condition_rules IS 'Reglas de condición versionadas con evaluación contextualizada';
COMMENT ON COLUMN public.condition_rules.rule_config IS 'Configuración JSON: thresholds, duration_windows, condiciones compuestas, min_confidence';
COMMENT ON COLUMN public.condition_rules.version IS 'Versión de la regla; modificaciones crean nueva versión, anterior se depreca';

CREATE INDEX IF NOT EXISTS idx_rules_feature ON public.condition_rules(feature_key);
CREATE INDEX IF NOT EXISTS idx_rules_asset_class ON public.condition_rules(asset_class);
CREATE INDEX IF NOT EXISTS idx_rules_validation ON public.condition_rules(validation_status);
```

### condition_event_sources (Migration 5)

```sql
CREATE TABLE IF NOT EXISTS public.condition_event_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.condition_events(id) ON DELETE CASCADE,
  feature_value_id UUID REFERENCES public.condition_feature_values(id),
  analysis_result_id UUID REFERENCES public.condition_analysis_results(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (feature_value_id IS NOT NULL OR analysis_result_id IS NOT NULL)
);

COMMENT ON TABLE public.condition_event_sources IS 'Vincula eventos con los feature_values y/o analysis_results que los dispararon';
COMMENT ON COLUMN public.condition_event_sources.feature_value_id IS 'Feature value que contribuyó al evento (si aplica)';
COMMENT ON COLUMN public.condition_event_sources.analysis_result_id IS 'Resultado de análisis que contribuyó al evento (si aplica)';

CREATE INDEX IF NOT EXISTS idx_es_event ON public.condition_event_sources(event_id);
CREATE INDEX IF NOT EXISTS idx_es_feature ON public.condition_event_sources(feature_value_id);
```

### work_orders extension (Migration 5)

```sql
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS condition_event_id UUID REFERENCES public.condition_events(id);
COMMENT ON COLUMN work_orders.condition_event_id IS 'Evento de condición que disparó esta OT (CBM avanzado)';
```

---

## RLS Policies

Following existing RBAC model (`get_user_role()` → ADMIN, PLANNER, TECHNICIAN, STOREKEEPER).

### Catalog tables (feature_definitions, analysis_methods, threshold_catalog)
- **SELECT**: authenticated (all roles)
- **INSERT/UPDATE/DELETE**: PLANNER, ADMIN

### source_capabilities
- **SELECT**: authenticated (all roles)
- **INSERT/UPDATE/DELETE**: PLANNER, ADMIN

### Ingest tables (windows, feature_values)
- **SELECT**: authenticated (all roles)
- **INSERT**: authenticated (Edge Functions use service_role, bypass RLS)
- **UPDATE/DELETE**: ADMIN only

### events, event_sources
- **SELECT**: authenticated (all roles)
- **INSERT**: authenticated (PLANNER, ADMIN for manual events)
- **UPDATE/DELETE**: ADMIN only

### analysis_results (system-computed)
- **SELECT**: authenticated (all roles)
- **INSERT/UPDATE/DELETE**: ADMIN only

### rules
- **SELECT**: authenticated (all roles)
- **INSERT/UPDATE/DELETE**: PLANNER, ADMIN

Policy template follows existing pattern:
```sql
ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY;
CREATE POLICY {table}_select ON public.{table} FOR SELECT TO authenticated USING (true);
CREATE POLICY {table}_insert ON public.{table} FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));
-- ... per role
```

---

## Edge Functions

### 1. ingest-condition (Migration 4)

**Input Contract** — FeatureSet v0.2 Enriched:

```typescript
interface FeatureSetV2 {
  external_window_id: string;    // REQUIRED, unique
  asset_id: string;              // REQUIRED
  source_id: string;             // REQUIRED
  source_type: string;           // REQUIRED
  window_start: string;          // REQUIRED, ISO 8601
  window_end: string;            // REQUIRED, ISO 8601
  pipeline_version?: string;
  config_version?: string;
  operational_context?: {
    regime?: string;
    rpm?: number;
    load_pct?: number;
  };
  features: FeatureV2[];
}

interface FeatureV2 {
  measurement_point_id?: string;
  feature_key: string;           // REQUIRED
  value: number;                 // REQUIRED
  unit: string;                  // REQUIRED
  quality_flag: string;          // REQUIRED, 'G0'|'G1'|'G2'|'G3'
  method_key: string;            // REQUIRED
  method_version: string;        // REQUIRED
  parameters?: Record<string, unknown>;
  uncertainty?: number;
  confidence?: number;
  sample_count?: number;
}
```

**Validation flow** (11 mandatory fields):
1. Validate HTTP method = POST, Bearer auth
2. Parse JSON body, validate structure
3. For each feature in `features[]`: check `feature_key`, `value`, `unit`, `quality_flag`, `method_key`, `method_version` are present + correct types
4. Validate `quality_flag ∈ {G0,G1,G2,G3}`; `confidence ∈ [0,1]`
5. Soft-validate `method_key` exists in `condition_analysis_methods` (if not → force quality_flag=G2)
6. Validate `feature_key` exists in `condition_feature_definitions` (hard FK — reject if missing)
7. Validate source capability (if capability exists but validation_status ∉ {active, field_trial} → force G2; if NO capability at all → REJECT 400)

**Transaction flow** (single Supabase transaction):
```
1. UPSERT condition_window (ON CONFLICT external_window_id DO NOTHING)
   → if duplicate, return 409 Conflict
2. For each feature in payload:
   a. Resolve feature_definition_id from feature_key
   b. INSERT INTO condition_feature_values (window_id, feature_definition_id, value, unit,
        quality_flag, method_key, method_version, parameters, uncertainty, confidence,
        measurement_point_id, sample_count)
3. UPDATE condition_windows SET status='processed'
4. Return 200 { window_id, features_ingested: N }
```

**Error handling**: 400 for validation, 401 for auth, 409 for duplicate, 500 for DB errors. All errors return `{ error: string, details?: string[] }`.

**Response**: `{ window_id: UUID, external_window_id: string, features_ingested: number, status: "processed" }`

### 2. ingest-events (Migration 4)

**Input Contract**:
```typescript
interface EventIngestPayload {
  asset_id: string;          // REQUIRED
  event_type: string;        // REQUIRED
  severity: string;          // REQUIRED
  message: string;           // REQUIRED
  hi_value?: number;
  dhi_dt_value?: number;
}
```

**Validation**: Bearer auth, validate required fields, validate `event_type ∈ {threshold_exceeded, trend_detected, quality_degraded, manual}`, validate `severity ∈ {info, warning, critical}`.

**Transaction**: INSERT INTO `condition_events`. Return `{ event_id, status: "open" }`.

### 3. compute-hi (Migration 5)

**Invocation**: Scheduled (pg_cron) or manual POST.

**Flow**:
1. Receive `{ asset_id?: string, window_end?: string }` — if no asset_id, compute for all active assets
2. For each asset:
   a. Call `compute_health_index(asset_id, window_end)`
   b. Call `compute_degradation_velocity(asset_id, 168)`
   c. Store results in `condition_analysis_results`
   d. Call `evaluate_condition_rules(asset_id, latest_window_id)`
3. Return summary: `{ assets_processed: N, hi_computed: N, events_generated: N }`

---

## Functions & Triggers

### compute_health_index(asset_id TEXT, window_end TIMESTAMPTZ)

```sql
CREATE OR REPLACE FUNCTION compute_health_index(
  p_asset_id TEXT,
  p_window_end TIMESTAMPTZ DEFAULT NOW()
) RETURNS TABLE(
  health_index NUMERIC,
  confidence NUMERIC,
  features_used INT,
  features_total INT,
  details JSONB
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- Pseudocódigo de la implementación:
-- 1. Obtener asset_class del activo
-- 2. Obtener operational_context de la última ventana (régimen actual)
-- 3. Obtener últimos feature_values del activo (último valor por feature_definition_id)
-- 4. Para cada feature_value:
--    a. Buscar threshold en condition_threshold_catalog que coincida:
--       feature_definition_id + method_key + asset_class + regime
--       (con fallback: NULL regime → FULL_LOAD; NULL asset_class → genérico)
--    b. Si no hay threshold: feature se excluye (registrar warning)
--    c. Mapear value a zona ISO:
--       ≤ zone_a_max → zone_score = 1.0
--       (zone_a_max, zone_b_max] → interpolación lineal 1.0→0.7
--       (zone_b_max, zone_c_max] → interpolación lineal 0.7→0.2
--       > zone_c_max → interpolación lineal 0.2→0
--    NOTA: Implementación usa piecewise linear continuo (no discreto).
--    Esto es más preciso que las zonas discretas del diseño original.
--    d. Aplicar quality_modifier: G0=1.0, G1=0.8, G2=0.5, G3=0.0
--    e. Contribución = zone_score × quality_mod × weight
-- 5. HI = SUM(contribuciones) / SUM(weights)
--    Si SUM(weights) = 0 → HI=NULL, confidence=0
-- 6. Confidence = AVG(confidence de cada feature_value × quality_mod)
-- 7. Retornar HI, confidence, features_used, features_total, details JSONB
$$;
```

**Quality modifiers**: G0=1.0, G1=0.8, G2=0.5, G3=0.0
**Zone mapping**: A=1.0, B=0.7, C=0.2, D=0.0
**Threshold lookup priority**: feature_definition_id + method_key + asset_class + regime exact match → partial matches with fallback → NULL (feature excluded)

### compute_degradation_velocity(asset_id TEXT, window_hours INT DEFAULT 168)

```sql
CREATE OR REPLACE FUNCTION compute_degradation_velocity(
  p_asset_id TEXT,
  p_window_hours INT DEFAULT 168
) RETURNS TABLE(
  slope NUMERIC,
  r_squared NUMERIC,
  point_count INT,
  regime_used TEXT
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- Pseudocódigo:
-- 1. Leer analysis_results WHERE asset_id = p_asset_id
--    AND analysis_type = 'health_index'
--    AND window_end > NOW() - (p_window_hours || ' hours')::INTERVAL
-- 2. Agrupar por operational_context.regime de las ventanas fuente
-- 3. Para el régimen con más puntos:
--    a. Si point_count < 5 → retornar slope=NULL, r_squared=NULL, point_count
--    b. Calcular regresión lineal (HI vs tiempo)
--    c. Si R² < 0.5 → retornar slope=NULL (no accionable)
--    d. Retornar slope (dHI/dt), r_squared, point_count, regime_used
$$;
```

**Regression method**: Simple linear regression via PostgreSQL aggregates (`regr_slope`, `regr_r2`).
**Requirements**: ≥5 consecutive readings in same regime, R² ≥ 0.5 for actionable slope.

### evaluate_condition_rules(asset_id TEXT, window_id UUID)

```sql
CREATE OR REPLACE FUNCTION evaluate_condition_rules(
  p_asset_id TEXT,
  p_window_id UUID
) RETURNS TABLE(
  rule_id UUID,
  rule_name TEXT,
  event_id UUID,
  severity TEXT
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- Pseudocódigo:
-- 1. Obtener feature_values para esta window_id
-- 2. Obtener asset_class del activo
-- 3. Obtener operational_context.regime de la ventana
-- 4. Cargar reglas activas: validation_status IN ('active', 'field_trial')
-- 5. Para cada regla que coincide en asset_class (o NULL) Y regime (o NULL):
--    a. Si rule.feature_key != NULL: filtrar features por feature_key
--    b. Si rule.method_key != NULL: filtrar features por method_key
--    c. Verificar calidad: quality_flag >= min_quality_flag
--    d. Evaluar según evaluation_type:
--       - threshold: value > rule_config.threshold × duration_windows
--       - trend: consultar analysis_results para trend_slope con R² >= rule_config.min_r_squared
--       - compound: evaluar rule_config.conditions (AND/OR anidados)
--       - residual: comparar resultado de análisis residual contra límites
--    e. Si la regla dispara:
--       - Crear condition_event con severity apropiado
--       - Si method_key está en draft/candidate → limitar severity a 'warning'
--       - Insertar en condition_event_sources los feature_values/analysis_results
--       - Retornar en resultado
-- 6. Retornar lista de (rule_id, rule_name, event_id, severity)
$$;
```

**Severity gate**: Si el method_key referenciado tiene validation_status `draft` o `candidate`, el severity máximo para eventos de esa regla es `warning`.

### trg_condition_event_to_wo (Migration 5)

```sql
CREATE OR REPLACE FUNCTION trg_condition_event_to_wo_func()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_equip_id VARCHAR;
  v_wo_id UUID;
BEGIN
  -- Solo eventos critical + open disparan WO
  IF NEW.severity != 'critical' OR NEW.status != 'open' THEN
    RETURN NEW;
  END IF;

  -- Resolver equipment_id
  SELECT equipment_id INTO v_equip_id FROM assets WHERE id = NEW.asset_id;

  -- Insertar work_order CBM
  INSERT INTO work_orders (
    asset_id, equipment_id, wo_type, lifecycle_phase, condition_event_id,
    reported_at, criticality, symptom_note
  ) VALUES (
    NEW.asset_id, v_equip_id, 'CBM', 'WAPPR', NEW.id,
    NOW(), 'A',
    format('Evento CBM [%s]: %s (HI: %s, dHI/dt: %s)',
      NEW.severity, NEW.message,
      COALESCE(NEW.hi_value::TEXT, 'N/D'),
      COALESCE(NEW.dhi_dt_value::TEXT, 'N/D')
    )
  ) RETURNING id INTO v_wo_id;

  -- Vincular evento a WO
  UPDATE condition_events SET status = 'linked_to_wo' WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_condition_event_to_wo ON condition_events;
CREATE TRIGGER trg_condition_event_to_wo
  AFTER INSERT ON condition_events
  FOR EACH ROW
  EXECUTE FUNCTION trg_condition_event_to_wo_func();
```

### trg_enforce_validation_lifecycle (Migration 5)

```sql
CREATE OR REPLACE FUNCTION is_valid_validation_transition(
  old_status TEXT,
  new_status TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF old_status = new_status THEN RETURN true; END IF;
  -- rejected y deprecated son estados terminales
  IF old_status IN ('rejected', 'deprecated') THEN RETURN false; END IF;
  -- transiciones forward
  IF old_status = 'draft' AND new_status IN ('candidate', 'rejected') THEN RETURN true; END IF;
  IF old_status = 'candidate' AND new_status IN ('bench_validated', 'rejected') THEN RETURN true; END IF;
  IF old_status = 'bench_validated' AND new_status IN ('field_trial', 'rejected') THEN RETURN true; END IF;
  IF old_status = 'field_trial' AND new_status IN ('active', 'rejected') THEN RETURN true; END IF;
  IF old_status = 'active' AND new_status = 'deprecated' THEN RETURN true; END IF;
  RETURN false;
END;
$$;

-- Trigger genérico que se adjunta a cada tabla con validation_status
CREATE OR REPLACE FUNCTION trg_enforce_validation_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_valid_validation_transition(OLD.validation_status, NEW.validation_status) THEN
    RAISE EXCEPTION 'Transición de validación inválida: % → %', OLD.validation_status, NEW.validation_status;
  END IF;
  RETURN NEW;
END;
$$;

-- Adjuntar a cada tabla (ejemplo para condition_analysis_methods):
DROP TRIGGER IF EXISTS trg_validation_methods ON condition_analysis_methods;
CREATE TRIGGER trg_validation_methods
  BEFORE UPDATE OF validation_status ON condition_analysis_methods
  FOR EACH ROW
  WHEN (OLD.validation_status IS DISTINCT FROM NEW.validation_status)
  EXECUTE FUNCTION trg_enforce_validation_lifecycle();

-- Repetir para: condition_threshold_catalog, condition_source_capabilities,
--               condition_rules, condition_analysis_results
```

---

## Seed Data

### condition_feature_definitions (12 features)

```sql
INSERT INTO public.condition_feature_definitions (feature_key, unit, category, description, default_weight) VALUES
('vibration.rms',             'mm/s',  'vibration',    'Velocidad RMS de vibración (10-1000 Hz)', 1.0),
('vibration.peak',            'mm/s',  'vibration',    'Velocidad pico de vibración',              0.8),
('vibration.acceleration_rms','m/s²',  'vibration',    'Aceleración RMS de vibración',             0.7),
('temperature.bearing',       '°C',    'temperature',  'Temperatura de rodamiento',                0.9),
('temperature.winding',       '°C',    'temperature',  'Temperatura de devanado del motor',        0.8),
('pressure.suction',          'bar',   'pressure',     'Presión de succión',                       0.6),
('pressure.discharge',        'bar',   'pressure',     'Presión de descarga',                      0.6),
('flow.rate',                 'm³/h',  'flow',         'Caudal de proceso',                        0.5),
('current.motor',             'A',     'electrical',   'Corriente del motor',                      0.7),
('speed.rpm',                 'rpm',   'speed',        'Velocidad de rotación',                    0.5),
('manual.noise_score',        'score', 'manual',       'Puntaje de ruido (inspección manual)',     0.4),
('manual.visual_score',       'score', 'manual',       'Puntaje visual (inspección manual)',       0.4);
```

### condition_analysis_methods (11 methods)

```sql
INSERT INTO public.condition_analysis_methods (method_key, category, input_features, output_features, default_parameters, description, validation_status) VALUES
('rms_velocity_window',     'time_domain',      ARRAY['vibration.raw'],          ARRAY['vibration.rms'],              '{"window_s":1.0,"filter":"10-1000Hz"}', 'RMS de velocidad en ventana temporal', 'active'),
('rms_acceleration_window', 'time_domain',      ARRAY['vibration.raw'],          ARRAY['vibration.acceleration_rms'],  '{"window_s":1.0,"filter":"10-5000Hz"}', 'RMS de aceleración en ventana temporal', 'active'),
('fft_band_energy',         'frequency_domain', ARRAY['vibration.raw'],          ARRAY['vibration.band_energy'],       '{"bands":[{"low":10,"high":1000}],"window":"hanning"}', 'Energía por banda espectral FFT', 'bench_validated'),
('hilbert_envelope',        'frequency_domain', ARRAY['vibration.raw'],          ARRAY['vibration.envelope'],          '{"filter_band":[500,5000]}', 'Envolvente de Hilbert para detección de fallas en rodamientos', 'bench_validated'),
('linear_regression',       'statistical',      ARRAY['vibration.rms'],          ARRAY['trend.slope','trend.r2'],     '{"window_hours":168,"min_points":5}', 'Regresión lineal sobre serie temporal', 'active'),
('kalman_filter',           'model_based',      ARRAY['vibration.rms'],          ARRAY['state.estimate'],              '{"Q":0.01,"R":0.1}', 'Filtro de Kalman para estimación de estado (placeholder Phase 2)', 'draft'),
('model_residual',          'model_based',      ARRAY['state.estimate','vibration.rms'], ARRAY['residual.value'],       '{"threshold":2.0}', 'Residual entre modelo y medición', 'draft'),
('window_average',          'statistical',      ARRAY['temperature.bearing'],    ARRAY['temperature.bearing'],         '{"window_s":60}', 'Promedio móvil en ventana temporal', 'active'),
('peak',                    'time_domain',      ARRAY['vibration.raw'],          ARRAY['vibration.peak'],              '{"window_s":1.0}', 'Detección de valor pico en ventana', 'active'),
('crest_factor',            'statistical',      ARRAY['vibration.raw'],          ARRAY['vibration.crest_factor'],     '{"window_s":1.0}', 'Factor de cresta (peak/RMS)', 'bench_validated'),
('manual_observation',      'hybrid',           ARRAY['manual.noise_score','manual.visual_score'], ARRAY['manual.composite'], '{}', 'Observación manual del operador', 'active'),
('weighted_health_index',   'hybrid',           ARRAY['vibration.rms','temperature.bearing','pressure.suction','pressure.discharge'], ARRAY['health_index'], '{"zone_weights":{"A":1.0,"B":0.7,"C":0.2,"D":0.0},"quality_modifiers":{"G0":1.0,"G1":0.8,"G2":0.5,"G3":0.0}}', 'Índice de salud ponderado multi-feature', 'active');
```

### condition_threshold_catalog (ISO 10816/20816 — ≥4 asset classes, vibration.rms × rms_velocity_window)

```sql
-- centrifugal_pump, rigid mounting (ISO 10816-7, >15kW)
INSERT INTO public.condition_threshold_catalog (feature_definition_id, method_key, asset_class, mounting_type, regime, zone_a_max, zone_b_max, zone_c_max, unit, iso_standard, standard_reference, validation_status)
SELECT fd.id, 'rms_velocity_window', 'centrifugal_pump', 'rigid', 'FULL_LOAD', 2.3, 4.5, 7.1, 'mm/s', 'ISO 10816-7', 'Table A.1 — Category II, rigid', 'bench_validated'
FROM public.condition_feature_definitions fd WHERE fd.feature_key = 'vibration.rms';

-- centrifugal_pump, flexible mounting (ISO 10816-7, >15kW)
INSERT INTO public.condition_threshold_catalog (feature_definition_id, method_key, asset_class, mounting_type, regime, zone_a_max, zone_b_max, zone_c_max, unit, iso_standard, standard_reference, validation_status)
SELECT fd.id, 'rms_velocity_window', 'centrifugal_pump', 'flexible', 'FULL_LOAD', 3.5, 7.1, 11.0, 'mm/s', 'ISO 10816-7', 'Table A.1 — Category II, flexible', 'bench_validated'
FROM public.condition_feature_definitions fd WHERE fd.feature_key = 'vibration.rms';

-- electric_motor, rigid mounting (ISO 10816-3, Group 2, 15-300kW)
INSERT INTO public.condition_threshold_catalog (feature_definition_id, method_key, asset_class, mounting_type, regime, zone_a_max, zone_b_max, zone_c_max, unit, iso_standard, standard_reference, validation_status)
SELECT fd.id, 'rms_velocity_window', 'electric_motor', 'rigid', 'FULL_LOAD', 1.4, 2.8, 4.5, 'mm/s', 'ISO 10816-3', 'Table 3 — Group 2, rigid', 'bench_validated'
FROM public.condition_feature_definitions fd WHERE fd.feature_key = 'vibration.rms';

-- electric_motor, flexible mounting
INSERT INTO public.condition_threshold_catalog (feature_definition_id, method_key, asset_class, mounting_type, regime, zone_a_max, zone_b_max, zone_c_max, unit, iso_standard, standard_reference, validation_status)
SELECT fd.id, 'rms_velocity_window', 'electric_motor', 'flexible', 'FULL_LOAD', 2.3, 4.5, 7.1, 'mm/s', 'ISO 10816-3', 'Table 4 — Group 2, flexible', 'bench_validated'
FROM public.condition_feature_definitions fd WHERE fd.feature_key = 'vibration.rms';

-- centrifugal_fan, rigid (ISO 10816-3, Group 1, >300kW)
INSERT INTO public.condition_threshold_catalog (feature_definition_id, method_key, asset_class, mounting_type, regime, zone_a_max, zone_b_max, zone_c_max, unit, iso_standard, standard_reference, validation_status)
SELECT fd.id, 'rms_velocity_window', 'centrifugal_fan', 'rigid', 'FULL_LOAD', 2.3, 4.5, 7.1, 'mm/s', 'ISO 10816-3', 'Table 1 — Group 1, rigid', 'bench_validated'
FROM public.condition_feature_definitions fd WHERE fd.feature_key = 'vibration.rms';

-- centrifugal_fan, flexible
INSERT INTO public.condition_threshold_catalog (feature_definition_id, method_key, asset_class, mounting_type, regime, zone_a_max, zone_b_max, zone_c_max, unit, iso_standard, standard_reference, validation_status)
SELECT fd.id, 'rms_velocity_window', 'centrifugal_fan', 'flexible', 'FULL_LOAD', 3.5, 7.1, 11.0, 'mm/s', 'ISO 10816-3', 'Table 2 — Group 1, flexible', 'bench_validated'
FROM public.condition_feature_definitions fd WHERE fd.feature_key = 'vibration.rms';

-- centrifugal_compressor, rigid (ISO 20816-3)
INSERT INTO public.condition_threshold_catalog (feature_definition_id, method_key, asset_class, mounting_type, regime, zone_a_max, zone_b_max, zone_c_max, unit, iso_standard, standard_reference, validation_status)
SELECT fd.id, 'rms_velocity_window', 'centrifugal_compressor', 'rigid', 'FULL_LOAD', 2.3, 4.5, 7.1, 'mm/s', 'ISO 20816-3', 'Industrial compressors, rigid', 'bench_validated'
FROM public.condition_feature_definitions fd WHERE fd.feature_key = 'vibration.rms';

-- centrifugal_compressor, flexible
INSERT INTO public.condition_threshold_catalog (feature_definition_id, method_key, asset_class, mounting_type, regime, zone_a_max, zone_b_max, zone_c_max, unit, iso_standard, standard_reference, validation_status)
SELECT fd.id, 'rms_velocity_window', 'centrifugal_compressor', 'flexible', 'FULL_LOAD', 3.5, 7.1, 11.0, 'mm/s', 'ISO 20816-3', 'Industrial compressors, flexible', 'bench_validated'
FROM public.condition_feature_definitions fd WHERE fd.feature_key = 'vibration.rms';

-- Generic fallback (ISO 10816-1) — asset_class=NULL para consultas sin clase específica
INSERT INTO public.condition_threshold_catalog (feature_definition_id, method_key, asset_class, mounting_type, regime, zone_a_max, zone_b_max, zone_c_max, unit, iso_standard, standard_reference, validity_notes, validation_status)
SELECT fd.id, 'rms_velocity_window', NULL, 'rigid', 'FULL_LOAD', 1.8, 4.5, 7.1, 'mm/s', 'ISO 10816-1', 'General evaluation criteria', 'Umbral genérico conservador. Usar como fallback cuando no hay datos específicos de la clase de activo.', 'bench_validated'
FROM public.condition_feature_definitions fd WHERE fd.feature_key = 'vibration.rms';
```

---

## Validation Lifecycle Design

### State Machine

```
draft ──→ candidate ──→ bench_validated ──→ field_trial ──→ active ──→ deprecated
  │          │               │                   │              │
  └──────────┴───────────────┴───────────────────┴──→ rejected  ←┘
```

### Valid Transitions (enforced by `trg_enforce_validation_lifecycle`)

| From | To | Allow? |
|---|---|---|
| `draft` | `candidate` | ✓ |
| `draft` | `rejected` | ✓ |
| `candidate` | `bench_validated` | ✓ |
| `candidate` | `rejected` | ✓ |
| `bench_validated` | `field_trial` | ✓ |
| `bench_validated` | `rejected` | ✓ |
| `field_trial` | `active` | ✓ |
| `field_trial` | `rejected` | ✓ |
| `active` | `deprecated` | ✓ |
| `rejected` | *any* | ✗ (terminal) |
| `deprecated` | *any* | ✗ (terminal) |
| *any* | `draft` | ✗ (no backward) |
| `draft` | `active` | ✗ (skip validation) |

### Behavioral Gates by State

| validation_status | ¿Ingesta aceptada? | ¿Regla evalúa? | ¿Eventos generados? | ¿OT creada? |
|---|---|---|---|---|
| `draft` | No (rechazada si capability en draft) | No (omitida) | No | No |
| `candidate` | Parcial (G2 forzado si capability) | No (omitida) | No | No |
| `bench_validated` | Sí (G0/G1/G2 respetados) | Sí | Sí, severity ≤ warning | No |
| `field_trial` | Sí | Sí | Sí | Solo warning (no critical automático) |
| `active` | Sí | Sí | Sí | Sí (incluyendo critical → WO) |
| `deprecated` | No (fuente rechazada) | No (omitida) | No | No |
| `rejected` | No (rechazada) | No (omitida) | No | No |

**Key enforcement rules**:
1. `ingest-condition` EF: rechaza si source_capability.validation_status ∉ {bench_validated, field_trial, active}
2. `evaluate_condition_rules()`: solo evalúa reglas con validation_status IN ('active', 'field_trial')
3. `trg_condition_event_to_wo`: si method_key.validation_status ∉ {field_trial, active}, severity máximo = 'warning'
4. `condition_analysis_results`: validation_status se propaga de los métodos usados en el cómputo

---

## Data Flow

### Flow 1: FeatureSet Ingest → Storage

```
IIoT Edge / Fuente
      │
      │  POST /ingest-condition  { FeatureSet v0.2 enriched }
      ▼
┌─────────────────────────────────────────────────────────┐
│ ingest-condition Edge Function (TypeScript)              │
│  1. Validate Bearer auth                                 │
│  2. Validate 11 mandatory fields per feature             │
│  3. Soft-validate method_key ∈ condition_analysis_methods│
│  4. Hard-validate feature_key ∈ condition_feature_definitions│
│  5. Validate source capability (rechazar si no registrada)│
│  6. Degradar quality_flag si capability ∉ active/field_trial│
│  7. UPSERT condition_windows (ON CONFLICT → 409)         │
│  8. INSERT condition_feature_values (one per feature)     │
│  9. UPDATE condition_windows SET status='processed'      │
│ 10. Return 200 { window_id, features_ingested }          │
└─────────────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────┐    ┌──────────────────────────┐
│ condition_windows    │◄───│ condition_feature_values  │
│  external_window_id  │    │  window_id FK             │
│  asset_id            │    │  feature_definition_id FK │
│  operational_context │    │  value, unit              │
│  status=processed    │    │  quality_flag             │
└──────────────────────┘    │  method_key, method_version│
                             │  parameters, uncertainty   │
                             └──────────────────────────┘
```

### Flow 2: Health Index Computation

```
┌──────────────────────┐
│ compute_health_index │  (asset_id, window_end)
└──────────┬───────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────┐
│ 1. SELECT asset_class FROM assets WHERE id = asset_id     │
│ 2. SELECT operational_context FROM latest condition_window│
│ 3. SELECT DISTINCT ON (feature_definition_id)             │
│      value, quality_flag, method_key, confidence          │
│    FROM condition_feature_values                          │
│    JOIN condition_windows ON window_id                    │
│    WHERE asset_id = p_asset_id                            │
│    ORDER BY feature_definition_id, window_end DESC        │
│ 4. FOR each feature_value:                                │
│    a. SELECT zone boundaries FROM condition_thresholds    │
│       WHERE feature_definition_id = fv.fd_id              │
│         AND method_key = fv.method_key                    │
│         AND (asset_class = v_asset_class OR NULL)         │
│         AND (regime = v_regime OR 'FULL_LOAD')            │
│    b. Map value → zone → zone_score (1.0/0.7/0.2/0.0)    │
│    c. Apply quality_modifier (1.0/0.8/0.5/0.0)            │
│    d. contribution = zone_score × quality_mod × weight    │
│ 5. HI = SUM(contributions) / SUM(weights)                 │
│ 6. RETURN health_index, confidence, features_used         │
└──────────────────────────────────────────────────────────┘
           │
           ▼
┌────────────────────────────────────────┐
│ INSERT INTO condition_analysis_results │
│   analysis_type='health_index'         │
│   result_value = HI score              │
│   input_window_ids = [window UUIDs]    │
└────────────────────────────────────────┘
```

### Flow 3: Degradation Velocity

```
compute_degradation_velocity(asset_id, 168h)
           │
           ▼
┌──────────────────────────────────────────────────────────┐
│ 1. SELECT result_value, window_end, regime                │
│    FROM condition_analysis_results                        │
│    WHERE asset_id = p_asset_id                            │
│      AND analysis_type = 'health_index'                   │
│      AND window_end > NOW() - INTERVAL '168 hours'        │
│ 2. GROUP BY regime → pick regime with most points         │
│ 3. IF count < 5 → RETURN slope=NULL, r2=NULL              │
│ 4. SELECT regr_slope(result_value, EXTRACT(EPOCH FROM     │
│      window_end)) as slope,                               │
│      regr_r2(result_value, EXTRACT(EPOCH FROM             │
│      window_end)) as r_squared                            │
│ 5. IF r_squared < 0.5 → RETURN slope=NULL                  │
│ 6. RETURN slope (dHI/day), r_squared, point_count          │
└──────────────────────────────────────────────────────────┘
           │
           ▼
┌────────────────────────────────────────┐
│ INSERT INTO condition_analysis_results │
│   analysis_type='trend_slope'          │
│   result_value = slope                 │
│   result_unit = 'HI/day'               │
│   r_squared = computed R²              │
└────────────────────────────────────────┘
```

### Flow 4: Rule Evaluation → Event → Work Order

```
evaluate_condition_rules(asset_id, window_id)
           │
           ▼
┌──────────────────────────────────────────────────────────┐
│ 1. Load feature_values for window_id                      │
│ 2. Load active/field_trial rules matching asset_class     │
│    and regime                                             │
│ 3. FOR each matching rule:                                │
│    a. Filter features by feature_key, method_key          │
│    b. Check quality_flag ≥ min_quality_flag               │
│    c. Evaluate by type:                                   │
│       - threshold: value > rule_config.threshold          │
│         AND sustained for duration_windows                │
│       - trend: dHI/dt from analysis_results               │
│         with R² ≥ min_r_squared                           │
│       - compound: all/any conditions in rule_config       │
│    d. IF fires:                                           │
│       - Gate severity by method validation_status         │
│       - INSERT condition_event (severity, message)        │
│         ──┬── AFTER INSERT trigger fires                  │
│           │                                               │
└───────────┼───────────────────────────────────────────────┘
            ▼
┌──────────────────────────────────────────────────────────┐
│ trg_condition_event_to_wo (AFTER INSERT)                   │
│   IF severity = 'critical':                               │
│     INSERT INTO work_orders (                              │
│       asset_id, equipment_id, wo_type='CBM',              │
│       lifecycle_phase='WAPPR', condition_event_id,        │
│       symptom_note = event.message                        │
│     )                                                     │
│     UPDATE condition_events SET status='linked_to_wo'     │
│                                                            │
│   INSERT INTO condition_event_sources (                    │
│     event_id, feature_value_id, analysis_result_id        │
│   )                                                       │
└──────────────────────────────────────────────────────────┘
```

### Flow 5: Validation Lifecycle (on every entity update)

```
UPDATE condition_analysis_methods SET validation_status = 'active'
WHERE method_key = 'fft_band_energy'   -- current: 'bench_validated'
           │
           ▼
┌──────────────────────────────────────────────────────────┐
│ trg_enforce_validation_lifecycle (BEFORE UPDATE)          │
│   is_valid_validation_transition(                         │
│     'bench_validated', 'active'                           │
│   ) → FALSE → RAISE EXCEPTION                             │
│   'Transición de validación inválida:                     │
│    bench_validated → active'                              │
│                                                            │
│   Valid path: bench_validated → field_trial → active      │
└──────────────────────────────────────────────────────────┘
```

---

## Continuous Improvement Views (Migration 5)

```sql
-- Vista: Calidad de datos por fuente
CREATE OR REPLACE VIEW data_quality_metrics AS
SELECT
  w.source_id,
  DATE_TRUNC('day', w.window_start) AS dia,
  COUNT(*) AS total_features,
  COUNT(*) FILTER (WHERE fv.quality_flag = 'G0') AS g0_count,
  COUNT(*) FILTER (WHERE fv.quality_flag = 'G1') AS g1_count,
  COUNT(*) FILTER (WHERE fv.quality_flag = 'G2') AS g2_count,
  COUNT(*) FILTER (WHERE fv.quality_flag = 'G3') AS g3_count,
  ROUND(100.0 * COUNT(*) FILTER (WHERE fv.quality_flag = 'G0') / NULLIF(COUNT(*), 0), 1) AS pct_g0
FROM condition_feature_values fv
JOIN condition_windows w ON w.id = fv.window_id
GROUP BY w.source_id, DATE_TRUNC('day', w.window_start);

-- Vista: Desempeño de reglas
CREATE OR REPLACE VIEW rule_performance_metrics AS
SELECT
  r.id AS rule_id,
  r.rule_name,
  r.version,
  COUNT(e.id) AS eventos_generados,
  COUNT(e.id) FILTER (WHERE e.status = 'dismissed') AS falsos_positivos,
  COUNT(e.id) FILTER (WHERE e.status = 'closed') AS confirmados
FROM condition_rules r
LEFT JOIN condition_events e ON e.rule_id = r.id
GROUP BY r.id, r.rule_name, r.version;

-- Vista: Resultados de mantenimiento
CREATE OR REPLACE VIEW maintenance_outcome_metrics AS
SELECT
  DATE_TRUNC('month', wo.reported_at) AS mes,
  COUNT(wo.id) AS ots_creadas_cbm,
  COUNT(wo.id) FILTER (WHERE wo.lifecycle_phase = 'CLOSED') AS ots_cerradas,
  COUNT(wo.id) FILTER (WHERE wo.lifecycle_phase = 'COMP' AND wo.condition_event_id IS NOT NULL) AS ots_con_hallazgo
FROM work_orders wo
WHERE wo.wo_type = 'CBM'
GROUP BY DATE_TRUNC('month', wo.reported_at);
```

---

## Testing Strategy

| Layer | What | Tool | Count |
|---|---|---|---|
| Schema | Table existence, column types, constraints | pgTAP | ~20 assertions |
| FK/Constraints | Foreign keys, CHECKs, UNIQUEs | pgTAP | ~15 assertions |
| RLS | Policies for each table×role | pgTAP | ~10 assertions |
| Functions | compute_health_index (all zones), degradation_velocity (edge cases) | pgTAP | ~20 assertions |
| Triggers | event→WO, validation lifecycle transitions | pgTAP | ~15 assertions |
| Seed Data | Verify ≥11 methods, ≥4 asset classes, ≥8 thresholds | pgTAP | ~10 assertions |
| Edge Functions | Payload validation, round-trip, error cases | deno test | ~15 assertions |
| Integration | Full pipeline: ingest → HI → dHI/dt → rules → event → WO | pgTAP | ~10 assertions |
| **Total** | | | **~115 assertions** |

---

## Open Questions

- [ ] Confirmar que `assets.id` es TEXT (observado en migraciones existentes) — usar type consistente
- [ ] Confirmar versión exacta de Supabase CLI y pgTAP en el proyecto para compatibilidad
- [ ] ¿Los umbrales genéricos (asset_class=NULL) necesitan régimen específico o `FULL_LOAD` como default?
- [ ] ¿Se requiere particionamiento en `condition_feature_values` por asset_id para escalar?

---

## Technical Debt — Pre-existing Schema Constraints

The following constraints are inherited from the pre-existing CMMS schema and are **not** introduced by this SDD. They are documented here for traceability and should be addressed in a future Database Architecture Normalization SDD.

### TD-1: `assets.id` is INTEGER, not UUID/TEXT
- **Impact**: `condition_events.asset_id`, `condition_windows.asset_id` use TEXT. Triggers cast `assets.id::TEXT` as a bridge.
- **Risk**: Type mismatch in JOINs; potential collation issues.
- **Workaround**: All condition tables use TEXT for asset_id; triggers and functions perform explicit casts.

### TD-2: `assets` has no direct `asset_class` column
- **Impact**: `compute_health_index()` and `evaluate_condition_rules()` accept `p_asset_class TEXT DEFAULT NULL` as optional parameter because `asset_class` must be resolved from `assets.asset_type_id` (INTEGER FK).
- **Risk**: Threshold lookup cannot be fully automated without external asset_class resolution.
- **Workaround**: Caller must provide asset_class or accept NULL (uses generic fallback thresholds).

### TD-3: `work_orders.id` has no DEFAULT value
- **Impact**: `trg_condition_event_to_wo` generates UUID explicitly via `gen_random_uuid()` because the column lacks a DEFAULT.
- **Risk**: Any other code path inserting into work_orders without explicit UUID will fail.
- **Workaround**: Condition event trigger always provides explicit UUID.

### TD-4: Pre-existing `condition_feature_definitions` rows (outside migration system)
- **Impact**: 15 rows existed before this SDD with a different schema version. Migration used `ALTER TABLE ADD COLUMN IF NOT EXISTS` + `ON CONFLICT DO NOTHING` for seed data.
- **Risk**: 2 features preserved legacy values (`vibration.crest_factor` unit="", `vibration.band_1x` default_weight=1.0). Fixed via manual UPDATE in verify phase.
- **Resolution**: Fixed. Both rows corrected to match design values.
