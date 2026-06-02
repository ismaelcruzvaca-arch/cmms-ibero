# Design: Condition Monitoring Hybrid Source Integration & Ingest Governance

## Architecture Overview

```
MANUAL / CSV / EDGE / API / PORTABLE
       │
       │  Construir / parsear → FeatureSet v0.2 payload
       ▼
┌─────────────────────────────────────────────────────────────────┐
│ FRONTEND (Browser / Offline RxDB Queue)                         │
│                                                                 │
│ Manual: ConditionCapture.jsx → FeatureSet v0.2 client-side     │
│ CSV:    CsvImportForm.jsx → Papa Parse → column mapping →      │
│         validate rows → staging → confirm                      │
│                                                                 │
│ Offline: cola RxDB local → sync con measured_at preservado     │
└───────────────────────────┬─────────────────────────────────────┘
                            │ POST /ingest-condition (Bearer auth)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ ingest-condition EDGE FUNCTION (TypeScript, Deno)               │
│                                                                 │
│ 1. Auth + CORS                                                  │
│ 2. Parse FeatureSet v0.2 (11 campos obligatorios)               │
│ 3. Validate feature_key ∈ condition_feature_definitions (FK)    │
│ 4. Soft-validate method_key ∈ condition_analysis_methods (G2?)  │
│ 5. Validate source capability:                                  │
│    → is_source_capable(source_id, feature_key, method_key)      │
│    → Sin capability → 400                                       │
│    → Capability draft/rejected → quality_flag=G2 forzado        │
│ 6. Validate source_lifecycle gate:                              │
│    → Fuente disabled/deprecated → 400                           │
│    → Fuente candidate → flag late_data=true (G2 forzado, no HI) │
│ 7. LATE DATA GATE: ingested_at − measured_at > cutoff_hours?    │
│    → late_data_flag=true, skip_events=true, skip_hi=?           │
│ 8. IDEMPOTENCY CHECK: según source_type                         │
│    → Misma key → 409 Conflict                                   │
│ 9. TRANSACTION:                                                 │
│    a. UPSERT condition_windows                                  │
│    b. INSERT condition_feature_values (one per feature)          │
│    c. UPDATE condition_windows SET status='processed'           │
│    d. UPDATE condition_sources SET last_seen_at=NOW()           │
│ 10. ON DB FAILURE → INSERT condition_ingest_outbox               │
│ 11. ON SUCCESS → si source policy lo permite:                    │
│     a. RPC evaluate_condition_rules(asset_id)                   │
│     b. RPC compute_health_index(asset_id) si no late_data       │
│ 12. Return 200 { window_id, features_ingested, warnings,        │
│      late_data, quality_overrides }                             │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ POSTGRES + SQL FUNCTIONS                                        │
│                                                                 │
│ condition_windows (external_window_id UNIQUE)                   │
│ condition_feature_values (FK → window, FK → feature_defs)       │
│ condition_sources (source lifecycle, last_seen_at update)        │
│                                                                 │
│ condition_ingest_outbox (idempotency_key UNIQUE, payload JSONB) │
│ condition_ingest_failures (dead-letter, status enum)            │
│                                                                 │
│ pg_cron: retry_failed_ingests() cada 1 minuto                   │
│   → backoff: 1min → 5min → 15min → dead-letter                 │
│                                                                 │
│ Triggers existentes (NO modificados):                            │
│   trg_condition_event_to_wo → solo severity=critical → WO       │
│   evaluate_condition_rules() → rules engine                     │
│   compute_health_index() → HI ponderado                         │
└─────────────────────────────────────────────────────────────────┘
```

**Principio**: SDD 1 definió el contrato FeatureSet v0.2 y el carril único de ingesta. SDD 2 agrega gobierno de fuentes, múltiples carriles de entrada (manual, CSV), confiabilidad (idempotencia, outbox, dead-letter), política de datos tardíos, y trazabilidad de auditoría — todo manteniendo el mismo contrato FeatureSet v0.2 como interfaz unificada.

---

## Migration Plan

### PR 1 — Ingest Governance Foundation (3 migrations, ~700 LOC)

| # | Migration filename | Creates/Modifies |
|---|---|---|
| 1 | `YYYYMMDDHHMMSS_condition_sources.sql` | `condition_sources` (13 cols, 5 indexes, RLS + seeds ≥5 fuentes) |
| 2 | `YYYYMMDDHHMMSS_condition_ingest_outbox_failures.sql` | `condition_ingest_outbox` (idempotency_key UNIQUE, payload JSONB, retry metadata) + `condition_ingest_failures` (dead-letter, status enum, reprocess) |
| 3 | `YYYYMMDDHHMMSS_condition_ingest_governance.sql` | ALTERs on `condition_windows` (+`ingested_by`, +`source_id` FK, +`late_data_flag`), ALTERs on `condition_feature_values` (+`ingested_by`, +`measured_at`, +`entered_at`), `is_source_capable()` SQL function, `retry_failed_ingests()` SQL function, `purge_dead_letters()` SQL function, extend `ingest-condition` EF; RLS updates |

**Dependencies**: Migration 1 → 2 → 3 (sequential). All three must run together.

### PR 2 — Human/Batch Inputs (2 migrations + frontend, ~1200 LOC)

| # | Migration filename | Creates/Modifies |
|---|---|---|
| 4 | `YYYYMMDDHHMMSS_condition_import_staging.sql` | `condition_import_batches` (batch lifecycle) + `condition_import_rows` (raw_data JSONB, validation_errors TEXT[]) + RLS |
| 5 | `YYYYMMDDHHMMSS_condition_extended_capabilities.sql` | Seeds multi-feature para `condition_source_capabilities` (edge_001: +vibration.peak bajo `peak` + temperature.bearing bajo `window_average`; nuevas: csv_import, portable_01), seeds para `condition_sources` de los nuevos tipos |

**Dependencies**: PR 2 depends on all PR 1 migrations. Must run after PR 1 is merged.

---

## Schema Design

### `condition_sources` (Migration PR1-1)

```sql
CREATE TABLE IF NOT EXISTS public.condition_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id TEXT UNIQUE NOT NULL,             -- PK lógico: edge_001, manual_route_001
  source_type TEXT NOT NULL CHECK (source_type IN (
    'edge', 'manual', 'portable', 'csv', 'modbus', 'mqtt', 'api', 'scada'
  )),
  name TEXT NOT NULL,                         -- nombre descriptivo legible
  status TEXT DEFAULT 'draft' CHECK (status IN (
    'draft', 'candidate', 'field_trial', 'active', 'disabled', 'deprecated'
  )),
  asset_id TEXT,                              -- activo asociado (nullable)
  owner TEXT,                                 -- responsable
  last_seen_at TIMESTAMPTZ,                   -- último ingesta exitosa
  validation_status TEXT DEFAULT 'draft' CHECK (validation_status IN (
    'draft', 'candidate', 'bench_validated', 'field_trial', 'active', 'deprecated', 'rejected'
  )),
  late_event_cutoff_hours INTEGER DEFAULT 24, -- cutoff configurable (0 = nunca eventos)
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.condition_sources IS 'Registro y gobierno de fuentes de datos de condición con lifecycle tracking';
COMMENT ON COLUMN public.condition_sources.status IS 'Estado operativo: draft → candidate → field_trial → active → disabled → deprecated';
COMMENT ON COLUMN public.condition_sources.validation_status IS 'Ciclo de validación según estándar del dominio';
COMMENT ON COLUMN public.condition_sources.late_event_cutoff_hours IS 'Horas máximas de retraso para generar eventos (0=nunca, default 24h)';
COMMENT ON COLUMN public.condition_sources.last_seen_at IS 'Timestamp de la última ingesta exitosa desde esta fuente';
COMMENT ON COLUMN public.condition_sources.created_by IS 'Usuario que registró la fuente en el sistema';

-- Índices
CREATE INDEX IF NOT EXISTS idx_sources_type ON public.condition_sources(source_type);
CREATE INDEX IF NOT EXISTS idx_sources_status ON public.condition_sources(status);
CREATE INDEX IF NOT EXISTS idx_sources_asset ON public.condition_sources(asset_id);
CREATE INDEX IF NOT EXISTS idx_sources_last_seen ON public.condition_sources(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_sources_validation ON public.condition_sources(validation_status);

-- RLS
ALTER TABLE public.condition_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS condition_sources_select ON public.condition_sources;
CREATE POLICY condition_sources_select ON public.condition_sources
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS condition_sources_insert ON public.condition_sources;
CREATE POLICY condition_sources_insert ON public.condition_sources
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

DROP POLICY IF EXISTS condition_sources_update ON public.condition_sources;
CREATE POLICY condition_sources_update ON public.condition_sources
  FOR UPDATE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

DROP POLICY IF EXISTS condition_sources_delete ON public.condition_sources;
CREATE POLICY condition_sources_delete ON public.condition_sources
  FOR DELETE TO authenticated USING (get_user_role() = 'ADMIN');
```

**Seeds (≥5 fuentes)**:
```sql
INSERT INTO public.condition_sources (source_id, source_type, name, status, asset_id, owner, late_event_cutoff_hours, created_by) VALUES
('edge_001',            'edge',     'Sensor Vibración Banda TR-01',        'active',      'BANDA-TR-01', 'ing-mantenimiento', 24, 'admin'),
('manual_route_001',   'manual',   'Ruta Inspección Operador Turno A',    'active',      NULL,          'sup-turno-a',        0, 'admin'),
('csv_import',          'csv',      'Importación CSV Histórico',           'candidate',   NULL,          'planner',            0, 'admin'),
('mock_source',         'api',      'Mock Source Desarrollo',              'field_trial', NULL,          'dev-team',          24, 'admin'),
('portable_01',         'portable', 'Analizador Portátil Vibraciones TI-1','field_trial', NULL,          'inspector',         24, 'admin')
ON CONFLICT (source_id) DO NOTHING;
```

---

### `condition_ingest_outbox` (Migration PR1-2a)

```sql
CREATE TABLE IF NOT EXISTS public.condition_ingest_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT UNIQUE NOT NULL,      -- clave de idempotencia compuesta (varía por source_type)
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  payload JSONB NOT NULL,                    -- FeatureSet v0.2 completo que falló
  payload_size_bytes INTEGER,                -- para monitoreo y alertas de tamaño excesivo
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'processing', 'failed', 'dead'
  )),
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  error_message TEXT,
  error_code TEXT,                           -- código de error SQL o HTTP
  error_details JSONB,                       -- detalles estructurados del error
  created_at TIMESTAMPTZ DEFAULT NOW(),
  next_retry_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '1 minute'),
  last_retry_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);

COMMENT ON TABLE public.condition_ingest_outbox IS 'Cola de ingesta fallida con reintentos automáticos vía pg_cron';
COMMENT ON COLUMN public.condition_ingest_outbox.idempotency_key IS 'Clave única de deduplicación. Varía por source_type: external_window_id (edge/api), source_id+asset_id+feature_key+method_key+measured_at (manual), batch_id+row_number (csv), source_id+asset_id+measured_at (portable)';
COMMENT ON COLUMN public.condition_ingest_outbox.payload IS 'Payload FeatureSet v0.2 completo en formato JSONB que se intentó ingerir';
COMMENT ON COLUMN public.condition_ingest_outbox.status IS 'Ciclo: pending → processing → failed → dead';
COMMENT ON COLUMN public.condition_ingest_outbox.next_retry_at IS 'Próximo intento con backoff: +1min, +5min, +15min';

CREATE INDEX IF NOT EXISTS idx_outbox_status ON public.condition_ingest_outbox(status);
CREATE INDEX IF NOT EXISTS idx_outbox_next_retry ON public.condition_ingest_outbox(next_retry_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_outbox_source ON public.condition_ingest_outbox(source_id);
CREATE INDEX IF NOT EXISTS idx_outbox_created ON public.condition_ingest_outbox(created_at DESC);

-- RLS: PLANNER/ADMIN pueden ver outbox; INSERT via service_role (EF); DELETE → ADMIN
ALTER TABLE public.condition_ingest_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS condition_ingest_outbox_select ON public.condition_ingest_outbox;
CREATE POLICY condition_ingest_outbox_select ON public.condition_ingest_outbox
  FOR SELECT TO authenticated
  USING (get_user_role() IN ('PLANNER', 'ADMIN'));

-- INSERT: via EF con service_role (bypass RLS). No se expone a usuarios.
DROP POLICY IF EXISTS condition_ingest_outbox_insert ON public.condition_ingest_outbox;
CREATE POLICY condition_ingest_outbox_insert ON public.condition_ingest_outbox
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

DROP POLICY IF EXISTS condition_ingest_outbox_delete ON public.condition_ingest_outbox;
CREATE POLICY condition_ingest_outbox_delete ON public.condition_ingest_outbox
  FOR DELETE TO authenticated
  USING (get_user_role() = 'ADMIN');
```

---

### `condition_ingest_failures` — Dead-Letter (Migration PR1-2b)

```sql
CREATE TABLE IF NOT EXISTS public.condition_ingest_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id UUID REFERENCES public.condition_ingest_outbox(id) ON DELETE SET NULL,
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  error_code TEXT,
  error_message TEXT,
  retry_count INTEGER DEFAULT 3,            -- intentos agotados
  status TEXT DEFAULT 'dead_letter' CHECK (status IN (
    'pending_retry', 'dead_letter', 'resolved', 'ignored', 'reprocessed'
  )),
  resolved_by TEXT,                          -- usuario que resolvió
  resolved_at TIMESTAMPTZ,
  notes TEXT,                                -- notas de resolución
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.condition_ingest_failures IS 'Dead-letter: payloads que agotaron reintentos. Revisión y reprocesamiento manual.';
COMMENT ON COLUMN public.condition_ingest_failures.status IS 'Estado: pending_retry → dead_letter → resolved | ignored | reprocessed';
COMMENT ON COLUMN public.condition_ingest_failures.resolved_by IS 'Usuario PLANNER/ADMIN que resolvió el dead-letter';
COMMENT ON COLUMN public.condition_ingest_failures.error_code IS 'Código de error (ej: 23514 = CHECK violation, 23503 = FK violation, P0001 = raise_exception)';

CREATE INDEX IF NOT EXISTS idx_failures_status ON public.condition_ingest_failures(status);
CREATE INDEX IF NOT EXISTS idx_failures_source ON public.condition_ingest_failures(source_id);
CREATE INDEX IF NOT EXISTS idx_failures_created ON public.condition_ingest_failures(created_at DESC);

-- RLS: PLANNER/ADMIN para ver y resolver; INSERT via service_role
ALTER TABLE public.condition_ingest_failures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS condition_ingest_failures_select ON public.condition_ingest_failures;
CREATE POLICY condition_ingest_failures_select ON public.condition_ingest_failures
  FOR SELECT TO authenticated
  USING (get_user_role() IN ('PLANNER', 'ADMIN'));

DROP POLICY IF EXISTS condition_ingest_failures_update ON public.condition_ingest_failures;
CREATE POLICY condition_ingest_failures_update ON public.condition_ingest_failures
  FOR UPDATE TO authenticated
  USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

DROP POLICY IF EXISTS condition_ingest_failures_delete ON public.condition_ingest_failures;
CREATE POLICY condition_ingest_failures_delete ON public.condition_ingest_failures
  FOR DELETE TO authenticated
  USING (get_user_role() = 'ADMIN');
```

---

### Modifications to Existing Tables (Migration PR1-3)

#### ALTER `condition_windows`

```sql
-- Nuevas columnas de trazabilidad y gobernanza
ALTER TABLE public.condition_windows ADD COLUMN IF NOT EXISTS ingested_by TEXT;
ALTER TABLE public.condition_windows ADD COLUMN IF NOT EXISTS late_data_flag BOOLEAN DEFAULT false;
ALTER TABLE public.condition_windows ADD COLUMN IF NOT EXISTS late_data_hours NUMERIC;
ALTER TABLE public.condition_windows ADD COLUMN IF NOT EXISTS quality_gate_passed BOOLEAN DEFAULT true;

COMMENT ON COLUMN public.condition_windows.ingested_by IS 'Usuario o EF que realizó la ingesta (ej: tech-02, ingest-condition/edge_001)';
COMMENT ON COLUMN public.condition_windows.late_data_flag IS 'TRUE si ingested_at − measured_at > late_event_cutoff_hours de la fuente';
COMMENT ON COLUMN public.condition_windows.late_data_hours IS 'Cantidad de horas de retraso (ingested_at − measured_at)';
COMMENT ON COLUMN public.condition_windows.quality_gate_passed IS 'FALSE si la ingesta fue forzada ignorando alguna validación de calidad';

-- FK a condition_sources (soft: no ON DELETE CASCADE)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_windows_source') THEN
    ALTER TABLE public.condition_windows ADD CONSTRAINT fk_windows_source
      FOREIGN KEY (source_id) REFERENCES public.condition_sources(source_id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Nuevo índice para trazabilidad
CREATE INDEX IF NOT EXISTS idx_windows_ingested_by ON public.condition_windows(ingested_by);
CREATE INDEX IF NOT EXISTS idx_windows_late_data ON public.condition_windows(late_data_flag) WHERE late_data_flag = true;
```

#### ALTER `condition_feature_values`

```sql
ALTER TABLE public.condition_feature_values ADD COLUMN IF NOT EXISTS ingested_by TEXT;
ALTER TABLE public.condition_feature_values ADD COLUMN IF NOT EXISTS measured_by TEXT;
ALTER TABLE public.condition_feature_values ADD COLUMN IF NOT EXISTS entered_by TEXT;
ALTER TABLE public.condition_feature_values ADD COLUMN IF NOT EXISTS measured_at TIMESTAMPTZ;
ALTER TABLE public.condition_feature_values ADD COLUMN IF NOT EXISTS entered_at TIMESTAMPTZ;
ALTER TABLE public.condition_feature_values ADD COLUMN IF NOT EXISTS instrument_ref TEXT;
ALTER TABLE public.condition_feature_values ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN public.condition_feature_values.ingested_by IS 'Usuario o EF que realizó la ingesta';
COMMENT ON COLUMN public.condition_feature_values.measured_by IS 'Usuario que midió en campo (puede ser distinto de entered_by)';
COMMENT ON COLUMN public.condition_feature_values.entered_by IS 'Usuario que ingresó el dato en el sistema';
COMMENT ON COLUMN public.condition_feature_values.measured_at IS 'Timestamp en que se realizó la medición física';
COMMENT ON COLUMN public.condition_feature_values.entered_at IS 'Timestamp en que se ingresó al sistema';
COMMENT ON COLUMN public.condition_feature_values.instrument_ref IS 'Referencia al instrumento usado (ej: vib-01, termo-IR-03)';
COMMENT ON COLUMN public.condition_feature_values.notes IS 'Notas libres del operador sobre la medición';

CREATE INDEX IF NOT EXISTS idx_fv_ingested_by ON public.condition_feature_values(ingested_by);
CREATE INDEX IF NOT EXISTS idx_fv_measured_at ON public.condition_feature_values(measured_at);
```

#### ALTER `condition_source_capabilities`

```sql
-- Agregar columna late_event_cutoff_hours a nivel capability (opcional, override a nivel fuente)
ALTER TABLE public.condition_source_capabilities ADD COLUMN IF NOT EXISTS late_event_cutoff_hours INTEGER;

COMMENT ON COLUMN public.condition_source_capabilities.late_event_cutoff_hours IS 'Override de cutoff a nivel capability (NULL = hereda de condition_sources)';
```

---

### `condition_import_batches` (Migration PR2-4a)

```sql
CREATE TABLE IF NOT EXISTS public.condition_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id TEXT UNIQUE NOT NULL,              -- csv_import:{timestamp}:{hash_8}
  file_name TEXT NOT NULL,                    -- nombre original del archivo
  file_hash TEXT NOT NULL,                    -- SHA-256 del contenido
  row_count INTEGER NOT NULL DEFAULT 0,       -- total de filas en el CSV
  valid_rows INTEGER DEFAULT 0,               -- filas que pasaron validación
  invalid_rows INTEGER DEFAULT 0,             -- filas con errores
  source_id TEXT NOT NULL,                    -- FK a condition_sources (csv_import)
  status TEXT DEFAULT 'uploaded' CHECK (status IN (
    'uploaded', 'validating', 'validated', 'ready_to_import', 'importing', 'imported', 'failed', 'cancelled'
  )),
  column_mapping JSONB DEFAULT '{}',          -- {"file_header": "feature_key", ...}
  error_summary JSONB,                        -- resumen de errores agrupados por tipo
  created_by TEXT NOT NULL,                   -- usuario que subió el archivo
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.condition_import_batches IS 'Lotes de importación CSV con pipeline de staging y validación';
COMMENT ON COLUMN public.condition_import_batches.column_mapping IS 'Mapeo de columnas del archivo → campos FeatureSet v0.2';
COMMENT ON COLUMN public.condition_import_batches.file_hash IS 'SHA-256 para detectar re-uploads del mismo archivo';

CREATE INDEX IF NOT EXISTS idx_batches_status ON public.condition_import_batches(status);
CREATE INDEX IF NOT EXISTS idx_batches_created_at ON public.condition_import_batches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_batches_created_by ON public.condition_import_batches(created_by);

-- RLS
ALTER TABLE public.condition_import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS condition_import_batches_select ON public.condition_import_batches;
CREATE POLICY condition_import_batches_select ON public.condition_import_batches
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS condition_import_batches_insert ON public.condition_import_batches;
CREATE POLICY condition_import_batches_insert ON public.condition_import_batches
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

DROP POLICY IF EXISTS condition_import_batches_update ON public.condition_import_batches;
CREATE POLICY condition_import_batches_update ON public.condition_import_batches
  FOR UPDATE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));
```

---

### `condition_import_rows` (Migration PR2-4b)

```sql
CREATE TABLE IF NOT EXISTS public.condition_import_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.condition_import_batches(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,               -- número de fila en el CSV (1-indexed)
  raw_data JSONB NOT NULL,                    -- datos crudos parseados de la fila
  mapped_data JSONB,                          -- datos mapeados según column_mapping
  validation_errors TEXT[] DEFAULT '{}',      -- lista de errores de validación
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'valid', 'invalid', 'imported', 'error'
  )),
  feature_value_id UUID,                      -- FK al feature_value creado (si fue importado)
  window_id UUID,                             -- FK a la ventana creada (si fue importado)
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(batch_id, row_number)
);

COMMENT ON TABLE public.condition_import_rows IS 'Filas individuales de importación CSV con datos crudos y validación';
COMMENT ON COLUMN public.condition_import_rows.raw_data IS 'Datos crudos de la fila CSV como JSONB (headers → valores)';
COMMENT ON COLUMN public.condition_import_rows.mapped_data IS 'Datos mapeados a campos FeatureSet v0.2 según column_mapping del batch';
COMMENT ON COLUMN public.condition_import_rows.validation_errors IS 'Array de mensajes de error: feature desconocido, asset inexistente, valor no numérico, etc.';

CREATE INDEX IF NOT EXISTS idx_import_rows_batch ON public.condition_import_rows(batch_id);
CREATE INDEX IF NOT EXISTS idx_import_rows_status ON public.condition_import_rows(status);

-- RLS: SELECT → authenticated; INSERT/UPDATE → PLANNER/ADMIN
ALTER TABLE public.condition_import_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS condition_import_rows_select ON public.condition_import_rows;
CREATE POLICY condition_import_rows_select ON public.condition_import_rows
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS condition_import_rows_insert ON public.condition_import_rows;
CREATE POLICY condition_import_rows_insert ON public.condition_import_rows
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

DROP POLICY IF EXISTS condition_import_rows_update ON public.condition_import_rows;
CREATE POLICY condition_import_rows_update ON public.condition_import_rows
  FOR UPDATE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));
```

---

## Ingest Pipeline (Detailed Flow)

### Where Each Step Executes

| Step | Where | Role | Notes |
|------|-------|------|-------|
| Construir FeatureSet v0.2 (manual) | Frontend: `useConditionCapture.js` | Browser | Client-side TS interfaces matching EF payload types |
| Parsear CSV (Papa Parse) | Frontend: `useCsvImport.js` | Browser | Client-side parsing, large file splits into chunks |
| Column mapping (CSV) | Frontend: `CsvImportForm.jsx` | Browser | Auto-detect + user review UI |
| Validate feature_key exists | EF: `ingest-condition` | Deno | Hard FK: query `condition_feature_definitions` |
| Validate method_key in catalog | EF: `ingest-condition` | Deno | Soft validation: not found → G2 forced |
| Validate source capability | EF: `ingest-condition` | Deno | Calls `is_source_capable()` SQL function or runs equivalent query |
| Validate source lifecycle gate | EF: `ingest-condition` | Deno | Reads `condition_sources.status` → reject disabled/deprecated, force G2 for candidate |
| Late data gate | EF: `ingest-condition` | Deno | Reads `condition_sources.late_event_cutoff_hours`, computes diff |
| Idempotency check | EF: `ingest-condition` | Deno | Constructs idempotency key per source_type, checks `condition_windows.external_window_id` or outbox `idempotency_key` |
| Insert window + feature_values | EF: `ingest-condition` | Deno + PostgreSQL | Single Supabase client.insert() transaction |
| Update last_seen_at | EF: `ingest-condition` | Deno | `condition_sources.last_seen_at = NOW()` |
| On DB failure → outbox | EF: `ingest-condition` | Deno | Catches DB exception, writes to `condition_ingest_outbox` |
| Retry from outbox | SQL: `retry_failed_ingests()` | PostgreSQL (pg_cron) | Reads outbox, replays via `supabase.rpc()` or re-invokes EF |
| Dead-letter after max retries | SQL: `retry_failed_ingests()` | PostgreSQL | Moves outbox entry → `condition_ingest_failures` |
| Evaluate rules | EF: `ingest-condition` | Deno → PostgreSQL | Calls RPC `evaluate_condition_rules(asset_id)` if source policy allows events |
| Generate OT (trigger) | PostgreSQL trigger | PostgreSQL | `trg_condition_event_to_wo` fires on `condition_events` INSERT if severity=critical |

---

## Policy Enforcement

### Where Each Gate Is Checked

| Estado | Guardar | HI | Evento | OT | Gate Location |
|--------|---------|-----|--------|-----|---------------|
| `draft` | ❌ | ❌ | ❌ | ❌ | EF: validateSourceLifecycle() → 400 |
| `candidate` | ✅ G2 | ❌ | ❌ | ❌ | EF: force G2 + skip_events=true; no RPC calls |
| `field_trial` | ✅ | ✅ | info | ❌ | EF: permit ingest; RPC evaluate_condition_rules() → severity capped; trigger gate: no WO for info/warning |
| `active` | ✅ | ✅ | ✅ | ✅ | EF: permit everything; full pipeline |
| `disabled` | ❌ | ❌ | ❌ | ❌ | EF: validateSourceLifecycle() → 400 |
| `deprecated` | ❌ hist | ❌ | ❌ | ❌ | EF: reject new data, solo lecturas históricas permitidas (SELECT) |

**Enforcement location details**:

1. **Source lifecycle gate** (`ingest-condition` EF): Reads `condition_sources.status`. If `draft|disabled|deprecated` → 400. If `candidate` → sets `force_g2=true`, `skip_events=true`, `skip_hi=true`. If `field_trial` → sets `skip_ot=true`.

2. **Source capability enforcement** (`ingest-condition` EF): Calls `is_source_capable(source_id, feature_key, method_key)`. No capability → 400. Capability in `draft|rejected` → `force_g2=true`.

3. **HI recalculation** (`ingest-condition` EF): Only calls `compute_health_index()` RPC if `skip_hi=false` AND `late_data_flag=false`. On success, stores `condition_analysis_results`.

4. **Rule evaluation** (`ingest-condition` EF): Only calls `evaluate_condition_rules()` RPC if `skip_events=false` AND `late_data_flag=false`. The function internally respects validation status of methods and rules (per SDD 1 design).

5. **OT generation** (`trg_condition_event_to_wo` PostgreSQL trigger): Existing trigger unchanged. It only fires for `severity='critical'` AND `status='open'`. Since `field_trial` sources cap severity to `info` or `warning` via `evaluate_condition_rules()`, no OT is generated. This is enforced at the SQL level, not the EF.

### Late Data Policy Config & Gate

**Configuration**: `condition_sources.late_event_cutoff_hours` (default 24h). Override at capability level via `condition_source_capabilities.late_event_cutoff_hours`.

**Gate logic** (executed in `ingest-condition` EF):

```
ingested_at = NOW()
measured_at = payload.window_start (o feature.measured_at si existe)
diff_hours = (ingested_at - measured_at) / 3600
cutoff = MIN(
  source.late_event_cutoff_hours,
  COALESCE(capability.late_event_cutoff_hours, 999999)
)

IF diff_hours > cutoff:
  late_data_flag = true
  IF diff_hours > 168 (7 days): skip_hi = true
  skip_events = true
  
  → guarda feature_values con late_data_flag=true
  → NO RPC calls (no HI, no rules, no events)
```

---

## CSV Staging Pipeline

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. UPLOAD                                                        │
│    User selects CSV file → CsvImportForm.jsx                     │
│    → Validate file (size < 10MB, .csv extension)                 │
│    → Compute SHA-256 hash                                        │
│    → Papa Parse: detect delimiter, extract headers, preview rows │
│    → Create batch: INSERT condition_import_batches               │
│      status = 'uploaded'                                         │
│    → Insert rows: INSERT condition_import_rows                   │
│      raw_data = JSONB de la fila parseada                        │
│      status = 'pending'                                          │
└───────────────────────┬──────────────────────────────────────────┘
                        ▼
┌──────────────────────────────────────────────────────────────────┐
│ 2. COLUMN MAPPING                                                │
│    Auto-detect: headers fuzzy-match → feature_key, value,         │
│      measured_at, unit, asset_id                                 │
│    User UI: dropdown por columna para mapear ↔ campos FeatureSet  │
│    → Store column_mapping in batch (JSONB)                       │
│    → UPDATE batch.status = 'validating'                          │
└───────────────────────┬──────────────────────────────────────────┘
                        ▼
┌──────────────────────────────────────────────────────────────────┐
│ 3. VALIDATE                                                      │
│    For each row:                                                 │
│    a. Apply column_mapping → construir mapped_data (JSONB)       │
│    b. Validate feature_key ∈ condition_feature_definitions       │
│       (query Supabase catalog, cache in memory)                  │
│    c. Validate value is numeric                                  │
│    d. Validate measured_at is parseable date                     │
│    e. Validate asset_id exists in assets table (optional)         │
│    f. Set row status = 'valid' or 'invalid' + validation_errors  │
│    → UPDATE each row in condition_import_rows                    │
│    → UPDATE batch.valid_rows, batch.invalid_rows                 │
│    → UPDATE batch.status = 'validated'                           │
└───────────────────────┬──────────────────────────────────────────┘
                        ▼
┌──────────────────────────────────────────────────────────────────┐
│ 4. PREVIEW                                                       │
│    Display table: valid rows in green, invalid in red            │
│    Tooltip/hover shows validation_errors                         │
│    User can: fix mapping → re-validate, edit individual rows,    │
│    or proceed with only valid rows                               │
│    → UPDATE batch.status = 'ready_to_import' (user clicks confirm)│
└───────────────────────┬──────────────────────────────────────────┘
                        ▼
┌──────────────────────────────────────────────────────────────────┐
│ 5. CONFIRM & INGEST                                              │
│    For each row with status = 'valid':                           │
│    a. Construct FeatureSet v0.2 payload from mapped_data         │
│       (source_id='csv_import', source_type='csv')                │
│       (idempotency_key = batch_id + row_number)                  │
│    b. POST to ingest-condition EF                                │
│    c. On success: UPDATE row status = 'imported', set            │
│       window_id, feature_value_id                                │
│    d. On failure: UPDATE row status = 'error', log error         │
│    → UPDATE batch.status = 'imported' (all processed)            │
│    → Show summary: X imported, Y errors, Z skipped               │
└──────────────────────────────────────────────────────────────────┘
```

**Key design**: Invalid rows stay in staging. They never reach `condition_windows` or `condition_feature_values`. No contamination.

**Architectural decision**: CSV parsing and validation is client-side (Papa Parse). Why: faster UX feedback, works offline for staging, avoids deploying a new EF. Large files (>500 rows) are chunked: validate in batches of 50, using MUI CircularProgress for UX.

---

## Dead-Letter System

### State Machine

```
outbox.pending ──retry──→ outbox.processing ──success──→ outbox.dead (limpieza por purge)
       │                         │
       │                         │fail (retry_count+1 < max_retries)
       │                         ▼
       │                    outbox.pending (next_retry_at recalculado)
       │
       └──fail retry_count ≥ max_retries──→
           1. INSERT condition_ingest_failures
              (status='dead_letter', payload←outbox.payload)
           2. UPDATE outbox.status='dead'
           3. DeadLetterPanel muestra el payload fallido
```

### Retry Logic (`retry_failed_ingests()`)

```sql
CREATE OR REPLACE FUNCTION public.retry_failed_ingests()
RETURNS TABLE(retried_count INT, dead_lettered_count INT) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rec RECORD;
  v_retries INT := 0;
  v_dead INT := 0;
BEGIN
  FOR v_rec IN
    SELECT * FROM public.condition_ingest_outbox
    WHERE status = 'pending'
      AND next_retry_at <= NOW()
    ORDER BY created_at
    LIMIT 10  -- procesar de a 10 por ciclo para no sobrecargar
  LOOP
    -- Marcar como processing
    UPDATE public.condition_ingest_outbox
    SET status = 'processing', last_retry_at = NOW()
    WHERE id = v_rec.id;

    -- Intentar ingesta (llama a ingest-condition EF via pg_net o http extension)
    -- En esta implementación, el EF 'ingest-condition' recibe payload del outbox
    -- La función solo actualiza metadata de retry. El reintento real ocurre en el EF.

    IF v_rec.retry_count + 1 >= v_rec.max_retries THEN
      -- Mover a dead-letter
      INSERT INTO public.condition_ingest_failures
        (outbox_id, source_id, source_type, idempotency_key, payload,
         error_code, error_message, retry_count, status, created_at)
      VALUES
        (v_rec.id, v_rec.source_id, v_rec.source_type, v_rec.idempotency_key,
         v_rec.payload, v_rec.error_code, v_rec.error_message,
         v_rec.retry_count, 'dead_letter', NOW());

      UPDATE public.condition_ingest_outbox
      SET status = 'dead'
      WHERE id = v_rec.id;

      v_dead := v_dead + 1;
    ELSE
      -- Recalcular next_retry_at con backoff
      UPDATE public.condition_ingest_outbox SET
        status = 'pending',
        retry_count = retry_count + 1,
        next_retry_at = NOW() + (CASE retry_count
          WHEN 0 THEN INTERVAL '1 minute'
          WHEN 1 THEN INTERVAL '5 minutes'
          WHEN 2 THEN INTERVAL '15 minutes'
          ELSE INTERVAL '30 minutes'
        END)
      WHERE id = v_rec.id;

      v_retries := v_retries + 1;
    END IF;
  END LOOP;

  retried_count := v_retries;
  dead_lettered_count := v_dead;
  RETURN NEXT;
END;
$$;
```

### Purge Function

```sql
CREATE OR REPLACE FUNCTION public.purge_dead_letters(days INT DEFAULT 90)
RETURNS TABLE(purged_count INT) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  WITH deleted AS (
    DELETE FROM public.condition_ingest_failures
    WHERE status IN ('resolved', 'ignored')
      AND created_at < NOW() - (days || ' days')::INTERVAL
    RETURNING id
  )
  SELECT COUNT(*)::INT INTO purged_count FROM deleted;
  RETURN NEXT;
END;
$$;
```

### Dead-Letter Minimal UI (`DeadLetterPanel.jsx`)

- **Visible to**: PLANNER, ADMIN (RBAC)
- **Component**: MUI Table con columnas: source_id, error_code, error_message, created_at, status, acciones
- **Acciones por fila**: `Reintentar` (PATCH status → `pending_retry`, triggers re-ingest via EF), `Descartar` (PATCH status → `ignored`), `Ver payload` (Dialog con JSON formateado)
- **Filtros**: por source_id, status, fecha
- **Sin paginación**: máximo 100 registros cargados (los dead-letters no deberían acumularse)

---

## Edge Function Modifications

### `ingest-condition` — Cambios en `index.ts`

**Nuevos parámetros en el payload FeatureSet v0.2** (opcionales):

```typescript
interface FeatureSetV2Extended extends FeatureSetV2 {
  // Campos existentes (external_window_id, asset_id, source_id, ...)
  
  // NUEVOS para SDD 2:
  idempotency_key?: string;       // clave de deduplicación (si no se provee, se construye)
  ingested_by?: string;           // usuario o EF que origina la ingesta
  batch_id?: string;              // CSV: batch_id del lote de importación
  row_number?: number;            // CSV: número de fila dentro del batch
  skip_validation?: boolean;      // solo para reprocess de dead-letter
}

interface FeatureV2Extended extends FeatureV2 {
  measured_by?: string;           // usuario que midió en campo
  entered_by?: string;            // usuario que ingresó en sistema
  measured_at?: string;           // ISO 8601 timestamp de medición física
  entered_at?: string;            // ISO 8601 timestamp de ingreso al sistema
  instrument_ref?: string;        // referencia al instrumento
  notes?: string;                 // notas del operador
}
```

**Nuevas funciones exportadas**:
- `validateSourceLifecycle(sourceId)` → lee `condition_sources`, retorna `{ ok, force_g2, skip_events, skip_hi, skip_ot }`
- `computeLateDataPolicy(sourceId, measuredAt)` → retorna `{ late_data_flag, late_data_hours, skip_events, skip_hi }`
- `buildIdempotencyKey(payload)` → construye según source_type
- `writeOutbox(payload, idempotencyKey, error)` → INSERT en `condition_ingest_outbox`

**Flujo modificado en `handleRequest()`**:

```typescript
// ... auth, payload validation (existing) ...

// NEW STEP 5: Validate source lifecycle (gates)
const lifecycleResult = await validateSourceLifecycle(ctx, payload.source_id);
if (!lifecycleResult.ok) return 400; // disabled/deprecated/draft
// Apply gates from lifecycleResult to flags

// NEW STEP 6: Late data policy
const lateDataResult = await computeLateDataPolicy(ctx, payload.source_id, payload.window_start);

// NEW STEP 7: Build idempotency key (if not provided)
const idempotencyKey = payload.idempotency_key ?? buildIdempotencyKey(payload);

// NEW STEP 8: Idempotency check against outbox + windows
const dupCheck = await checkIdempotency(ctx, idempotencyKey);
if (dupCheck.exists) return 409;

// ... catalog validation (existing, enhanced with lifecycle flags) ...

// ... source capability validation (existing, enhanced) ...

// MODIFIED STEP 9: Transaction with outbox fallback
try {
  const ingestResult = await ingestFeatures(payload, validatedFeatures, featureIdMap, {
    ingested_by: payload.ingested_by ?? `ingest-condition/${payload.source_id}`,
    late_data_flag: lateDataResult.late_data_flag,
    late_data_hours: lateDataResult.late_data_hours,
    quality_gate_passed: !lifecycleResult.force_g2,
  });
  
  if (!ingestResult.ok) throw new Error(ingestResult.error);

  // Update last_seen_at
  await ctx.supabase
    .from('condition_sources')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('source_id', payload.source_id);
  
  // NEW: Conditional rule evaluation + HI compute (respect policy gates)
  if (!lateDataResult.skip_events && !lifecycleResult.skip_events) {
    // Fire-and-forget: no bloquea la respuesta
    fetch(`${supabaseUrl}/rest/v1/rpc/evaluate_condition_rules`, {
      method: 'POST',
      headers: { 'apikey': serviceRoleKey, 'Authorization': `Bearer ${serviceRoleKey}` },
      body: JSON.stringify({ p_asset_id: payload.asset_id }),
    }).catch(e => console.error('evaluate_condition_rules async error:', e));
  }

  // Return 200 as before...
  
} catch (dbError) {
  // NEW: Outbox fallback
  await writeOutbox(ctx, payload, idempotencyKey, dbError);
  return 500; // or 202 Accepted if outbox write succeeds
}
```

---

## Frontend Design

### Component Tree

```
App.jsx
└── Tabs (nuevo Tab 3: "Monitoreo de Condición")
    ├── Sub-Tab: "Captura Manual"     (visible: TECHNICIAN+)
    │   └── ConditionCapture.jsx
    │       ├── AssetSelector (reusa AssetSearchBar pattern)
    │       ├── FeatureSelector (cascada: feature_key → method_key auto)
    │       ├── ValueInput (numérico con unit display)
    │       ├── QualityFlagSelector (G0/G1/G2 — manual defaults to G2)
    │       ├── OperationalContextFields (regime, rpm, load_pct)
    │       ├── InstrumentRef + Notes
    │       ├── FieldTraceability (measured_by, measured_at)
    │       └── SubmitButton → useConditionCapture.js
    │
    ├── Sub-Tab: "Importación CSV"    (visible: PLANNER/ADMIN)
    │   └── CsvImportForm.jsx
    │       ├── FileUpload (MUI Dropzone/Button, validación tipo/tamaño)
    │       ├── ColumnMappingUI (dropdowns por columna CSV)
    │       ├── ValidationProgress (CircularProgress)
    │       ├── PreviewTable (MUI DataGrid con filas verdes/rojas)
    │       └── ConfirmButton → useCsvImport.js
    │
    ├── Sub-Tab: "Fuentes"            (visible: authenticated)
    │   └── SourceManagementPanel.jsx
    │       ├── SourceList (MUI Table)
    │       ├── SourceHealthBadge.jsx (active/offline/error/field_trial)
    │       └── LastSeenIndicator
    │
    └── Sub-Tab: "Dead-Letter"        (visible: PLANNER/ADMIN)
        └── DeadLetterPanel.jsx
            ├── FilterBar (source_id, status, date range)
            ├── FailureTable (MUI Table)
            ├── PayloadDialog (JSON formateado, MUI Dialog)
            └── ActionButtons (Reintentar, Descartar)
```

### Routes / Navigation

No react-router. Tab-based navigation in `App.jsx`:

```jsx
{/* Nuevo Tab 3: Monitoreo de Condición */}
{(userRole === 'TECHNICIAN' || userRole === 'PLANNER' || userRole === 'ADMIN') && (
  <Tab label="Monitoreo" />
)}
```

Within Tab 3, sub-tabs via local `useState`:
```jsx
const [conditionSubTab, setConditionSubTab] = useState(0);
// subTab 0: Captura Manual, 1: CSV, 2: Fuentes, 3: Dead-Letter

{activeTab === 3 && (
  <Box>
    <Tabs value={conditionSubTab} onChange={(e,v) => setConditionSubTab(v)}>
      <Tab label="Captura" />
      {(userRole === 'PLANNER' || userRole === 'ADMIN') && <Tab label="CSV" />}
      <Tab label="Fuentes" />
      {(userRole === 'PLANNER' || userRole === 'ADMIN') && <Tab label="Dead-Letter" />}
    </Tabs>
    {conditionSubTab === 0 && <ConditionCapture />}
    {conditionSubTab === 1 && <CsvImportForm />}
    {conditionSubTab === 2 && <SourceManagementPanel />}
    {conditionSubTab === 3 && <DeadLetterPanel />}
  </Box>
)}
```

### RxDB Schemas (Pull-Only)

Two new pull-only collections for catalog tables:

```javascript
// condition_feature_definitions — catálogo de features (pull-only)
const conditionFeatureDefSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string' },
    feature_key: { type: 'string' },
    unit: { type: 'string' },
    category: { type: 'string' },
    description: { type: 'string' },
    default_weight: { type: 'number' },
    created_at: { type: 'string' }
  },
  required: ['id', 'feature_key', 'unit', 'category']
};

// condition_sources — registro de fuentes (pull-only)
const conditionSourcesSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string' },
    source_id: { type: 'string' },
    source_type: { type: 'string' },
    name: { type: 'string' },
    status: { type: 'string' },
    asset_id: { type: 'string' },
    owner: { type: 'string' },
    last_seen_at: { type: 'string' },
    validation_status: { type: 'string' },
    late_event_cutoff_hours: { type: 'number' },
    created_by: { type: 'string' },
    created_at: { type: 'string' }
  },
  required: ['id', 'source_id', 'source_type', 'name', 'status']
};

// condition_source_capabilities — capacidades (pull-only)
const conditionSourceCapsSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string' },
    source_id: { type: 'string' },
    source_type: { type: 'string' },
    can_produce: { type: 'string' },
    method_key: { type: 'string' },
    quality_expected: { type: 'string' },
    validation_status: { type: 'string' }
  },
  required: ['id', 'source_id', 'can_produce', 'method_key']
};
```

**Replications**: Pull-only using `createPullHandler()`. No push handler. Writes go direct to Supabase.

**Offline queue** (manual capture only): Local RxDB collection `condition_capture_queue` with schema:
```javascript
const captureQueueSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string' },
    payload: { type: 'object' },        // FeatureSet v0.2 completo
    measured_at: { type: 'string' },     // preservado durante sync
    status: { type: 'string', enum: ['pending', 'syncing', 'synced', 'failed'] },
    created_at: { type: 'string' },
    synced_at: { type: 'string' },
    error_message: { type: 'string' }
  },
  required: ['id', 'payload', 'measured_at', 'status']
};
```

### Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useConditionSources` | `src/hooks/useConditionSources.js` | RxDB reactive subscription to `condition_sources` + `condition_source_capabilities`. Returns `{ sources, capabilities, sourceCapabilityMap }` |
| `useConditionCapture` | `src/hooks/useConditionCapture.js` | FeatureSet v0.2 construction, client-side validation, offline queue management, POST to ingest-condition |
| `useCsvImport` | `src/hooks/useCsvImport.js` | Papa Parse file read, column auto-detect, row validation, batch creation + confirm, progress tracking |

---

## RBAC Design

### Permission Matrix

| Operación | TECHNICIAN | PLANNER | ADMIN | Service Role |
|-----------|------------|---------|-------|--------------|
| Capturar manual (POST ingest-condition) | ✅ | ✅ | ✅ | ✅ |
| Ver catálogo de features | ✅ | ✅ | ✅ | ✅ |
| Subir CSV (crear batch) | ❌ | ✅ | ✅ | ✅ |
| Confirmar batch (ingestar CSV) | ❌ | ✅ | ✅ | ✅ |
| Ver fuentes registradas | ✅ | ✅ | ✅ | ✅ |
| Activar/desactivar fuente (UPDATE condition_sources.status) | ❌ | ✅ | ✅ | ✅ |
| Registrar nueva fuente (INSERT condition_sources) | ❌ | ✅ | ✅ | ✅ |
| Ver dead-letter | ❌ | ✅ | ✅ | ✅ |
| Reprocesar dead-letter | ❌ | ✅ | ✅ | ✅ |
| Descartar dead-letter | ❌ | ❌ | ✅ | ✅ |
| Insertar feature_values (RLS) | ✅ | ✅ | ✅ | ✅ |
| Modificar feature_values (RLS) | ❌ | ❌ | ✅ | ✅ |

### RLS Policy Summary

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| `condition_sources` | authenticated | PLANNER, ADMIN | PLANNER, ADMIN | ADMIN |
| `condition_ingest_outbox` | PLANNER, ADMIN | PLANNER, ADMIN | — | ADMIN |
| `condition_ingest_failures` | PLANNER, ADMIN | — | PLANNER, ADMIN | ADMIN |
| `condition_import_batches` | authenticated | PLANNER, ADMIN | PLANNER, ADMIN | ADMIN |
| `condition_import_rows` | authenticated | PLANNER, ADMIN | PLANNER, ADMIN | ADMIN |
| `condition_windows` | authenticated | authenticated | ADMIN | ADMIN |
| `condition_feature_values` | authenticated | authenticated | ADMIN | ADMIN |
| `condition_source_capabilities` | authenticated | PLANNER, ADMIN | PLANNER, ADMIN | PLANNER, ADMIN |

Edge Functions use `service_role` service key — bypass all RLS. Frontend RBAC gates are enforced both at the UI level (conditional rendering) and at the database level (RLS policies). The `ingest-condition` EF additionally enforces source lifecycle and capability gates in application code before touching the database.

---

## SQL Functions

| Function | Signature | Purpose | Migration |
|----------|-----------|---------|-----------|
| `is_source_capable` | `(source_id TEXT, feature_key TEXT, method_key TEXT) → BOOLEAN` | Check if source has registered capability for feature+method | PR1-3 |
| `retry_failed_ingests` | `() → TABLE(retried_count INT, dead_lettered_count INT)` | pg_cron job: retries pending outbox entries with exponential backoff | PR1-3 |
| `purge_dead_letters` | `(days INT DEFAULT 90) → TABLE(purged_count INT)` | Cleanup resolved/ignored dead-letters older than N days | PR1-3 |

**Note**: `is_source_capable()` is already partially implemented in the EF as `validateSourceCapability()`. The SQL function provides a canonical check usable from triggers and RPC, but the EF still does its own check to return structured 400 responses.

---

## Testing Strategy

### PR 1 — pgTAP (~50 assertions)

| Test file | Assertions | Covers |
|-----------|-----------|--------|
| `supabase/tests/database/condition_sources_test.sql` | ~15 | Schema (13 cols, CHECK constraints), RLS (SELECT/INSERT/UPDATE/DELETE per role), lifecycle transitions, seeds |
| `supabase/tests/database/condition_outbox_test.sql` | ~15 | Outbox schema, UNIQUE on idempotency_key, status transitions, RLS, retry function logic |
| `supabase/tests/database/condition_governance_test.sql` | ~20 | ALTER columns exist on windows/feature_values, late_data_flag, FK integrity, is_source_capable() function, purge_dead_letters() |

**pgTAP pattern**: Follow SDD 1 conventions — `BEGIN; SELECT plan(N); ... SELECT * FROM finish(); ROLLBACK;`

### PR 2 — Playwright + Vitest

| Test | Type | Covers |
|------|------|--------|
| `tests/condition-manual-capture.spec.js` | Playwright | Full flow: login → Tab Monitoreo → Captura → select asset → feature → value → submit → verify 200 |
| `tests/condition-csv-import.spec.js` | Playwright | Full flow: upload CSV → column mapping → validate → preview → confirm → verify windows created |
| `tests/condition-source-panel.spec.js` | Playwright | Tab Fuentes: list sources with badges, verify last_seen for known source |
| `tests/condition-dead-letter.spec.js` | Playwright | Tab Dead-Letter: list failures, reprocess one, discard one, verify status changes |
| `src/hooks/__tests__/useConditionCapture.test.js` | Vitest | FeatureSet construction, client-side validation, offline queue enqueue/dequeue |
| `src/hooks/__tests__/useCsvImport.test.js` | Vitest | Papa Parse parsing, column auto-detect, row validation logic |
| `supabase/tests/database/condition_import_test.sql` | pgTAP (extra) | Import batch schema, row FK, status transitions, RLS |

**No regresión**: All 326 pgTAP assertions from SDD 1 must continue passing.

---

## File Changes Summary

| File | Action | PR |
|------|--------|-----|
| `supabase/migrations/YYYYMMDDHHMMSS_condition_sources.sql` | Create | PR 1 |
| `supabase/migrations/YYYYMMDDHHMMSS_condition_ingest_outbox_failures.sql` | Create | PR 1 |
| `supabase/migrations/YYYYMMDDHHMMSS_condition_ingest_governance.sql` | Create | PR 1 |
| `supabase/migrations/YYYYMMDDHHMMSS_condition_import_staging.sql` | Create | PR 2 |
| `supabase/migrations/YYYYMMDDHHMMSS_condition_extended_capabilities.sql` | Create | PR 2 |
| `supabase/functions/ingest-condition/index.ts` | Modify | PR 1 |
| `src/App.jsx` | Modify | PR 2 |
| `src/pages/ConditionCapture.jsx` | Create | PR 2 |
| `src/components/condition/CsvImportForm.jsx` | Create | PR 2 |
| `src/components/condition/SourceManagementPanel.jsx` | Create | PR 2 |
| `src/components/condition/SourceHealthBadge.jsx` | Create | PR 2 |
| `src/components/condition/DeadLetterPanel.jsx` | Create | PR 2 |
| `src/hooks/useConditionSources.js` | Create | PR 2 |
| `src/hooks/useConditionCapture.js` | Create | PR 2 |
| `src/hooks/useCsvImport.js` | Create | PR 2 |
| `src/lib/rxdb.js` | Modify | PR 2 |
| `supabase/tests/database/condition_sources_test.sql` | Create | PR 1 |
| `supabase/tests/database/condition_outbox_test.sql` | Create | PR 1 |
| `supabase/tests/database/condition_governance_test.sql` | Create | PR 1 |
| `supabase/tests/database/condition_import_test.sql` | Create | PR 2 |
| `tests/condition-manual-capture.spec.js` | Create | PR 2 |
| `tests/condition-csv-import.spec.js` | Create | PR 2 |
| `tests/condition-source-panel.spec.js` | Create | PR 2 |
| `tests/condition-dead-letter.spec.js` | Create | PR 2 |

---

## Open Questions

- [ ] ¿pg_cron está disponible y configurado en el proyecto Supabase? El diseño asume que sí (extensión estándar). Verificar con `supabase_list_extensions`.
- [ ] ¿El EF `ingest-condition` debe llamar RPCs de HI y reglas sincrónicamente (bloqueando la respuesta) o fire-and-forget? El diseño asume fire-and-forget para no bloquear el 200.
- [ ] La columna `measured_at` en `condition_feature_values` — ¿debe ser el `window_start` del payload (como está en condition_windows) o un campo nuevo a nivel feature individual? El diseño asume que puede diferir (el operador mide a las 8am pero la ventana del edge usa otros timestamps).
- [ ] Confirmar que `source_type` en `condition_sources` no tiene FK a otra tabla; es un CHECK puro (mismo patrón que `condition_source_capabilities`).
