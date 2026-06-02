-- ============================================================
-- MIGRATION: condition_ingest_outbox + condition_ingest_failures
-- Change: condition-monitoring-hybrid-sources (PR 1)
-- ============================================================
-- Crea la outbox de ingesta para payloads fallidos con reintentos
-- automáticos vía pg_cron y la tabla de dead-letter para payloads
-- que agotaron todos los reintentos.
--
-- Tablas:
--   condition_ingest_outbox  — cola de ingesta con idempotency_key
--     UNIQUE, payload JSONB, backoff exponencial
--   condition_ingest_failures — dead-letter con status, resolved_by
--
-- Índices: status, next_retry_at, source_id, created_at (outbox);
--   status, source_id, created_at (failures).
--
-- RLS: PLANNER/ADMIN para SELECT, INSERT; DELETE → ADMIN
--   (condition_ingest_failures: UPDATE → PLANNER/ADMIN).
--
-- Dependencias: get_user_role() (migración de RBAC).
-- ============================================================

-- ============================================================
-- 1. TABLA: condition_ingest_outbox
--    Cola de ingesta fallida con reintentos automáticos vía pg_cron.
--    idempotency_key es único — garantiza idempotencia.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.condition_ingest_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT UNIQUE NOT NULL,
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  payload_size_bytes INTEGER,
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'processing', 'failed', 'dead'
  )),
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  error_message TEXT,
  error_code TEXT,
  error_details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  next_retry_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '1 minute'),
  last_retry_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);

COMMENT ON TABLE public.condition_ingest_outbox
  IS 'Cola de ingesta fallida con reintentos automáticos vía pg_cron';

COMMENT ON COLUMN public.condition_ingest_outbox.idempotency_key
  IS 'Clave única de deduplicación. Varía por source_type: external_window_id (edge/api), source_id+asset_id+feature_key+method_key+measured_at (manual), batch_id+row_number (csv), source_id+asset_id+measured_at (portable)';

COMMENT ON COLUMN public.condition_ingest_outbox.source_id
  IS 'Identificador de la fuente que originó el payload';

COMMENT ON COLUMN public.condition_ingest_outbox.source_type
  IS 'Tipo de fuente de datos';

COMMENT ON COLUMN public.condition_ingest_outbox.payload
  IS 'Payload FeatureSet v0.2 completo en formato JSONB que se intentó ingerir';

COMMENT ON COLUMN public.condition_ingest_outbox.payload_size_bytes
  IS 'Tamaño del payload en bytes para monitoreo y alertas';

COMMENT ON COLUMN public.condition_ingest_outbox.status
  IS 'Ciclo: pending → processing → failed → dead';

COMMENT ON COLUMN public.condition_ingest_outbox.retry_count
  IS 'Cantidad de reintentos realizados';

COMMENT ON COLUMN public.condition_ingest_outbox.max_retries
  IS 'Máximo de reintentos antes de mover a dead-letter (default 3)';

COMMENT ON COLUMN public.condition_ingest_outbox.error_message
  IS 'Mensaje de error del último intento fallido';

COMMENT ON COLUMN public.condition_ingest_outbox.error_code
  IS 'Código de error SQL (ej: 23514 = CHECK violation, 23503 = FK violation)';

COMMENT ON COLUMN public.condition_ingest_outbox.error_details
  IS 'Detalles estructurados del error (JSONB)';

COMMENT ON COLUMN public.condition_ingest_outbox.created_at
  IS 'Fecha de creación del registro en el outbox';

COMMENT ON COLUMN public.condition_ingest_outbox.next_retry_at
  IS 'Próximo intento con backoff: +1min, +5min, +15min';

COMMENT ON COLUMN public.condition_ingest_outbox.last_retry_at
  IS 'Timestamp del último intento de reintento';

COMMENT ON COLUMN public.condition_ingest_outbox.resolved_at
  IS 'Timestamp de resolución (procesado exitosamente o movido a dead-letter)';

-- -----------------------------------------------------------
-- 2. ÍNDICES: condition_ingest_outbox
-- -----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_outbox_status
  ON public.condition_ingest_outbox(status);

CREATE INDEX IF NOT EXISTS idx_outbox_next_retry
  ON public.condition_ingest_outbox(next_retry_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_outbox_source
  ON public.condition_ingest_outbox(source_id);

CREATE INDEX IF NOT EXISTS idx_outbox_created
  ON public.condition_ingest_outbox(created_at DESC);

-- ============================================================
-- 3. TABLA: condition_ingest_failures
--    Dead-letter: payloads que agotaron reintentos.
--    Revisión y reprocesamiento manual por PLANNER/ADMIN.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.condition_ingest_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id UUID REFERENCES public.condition_ingest_outbox(id) ON DELETE SET NULL,
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  error_code TEXT,
  error_message TEXT,
  retry_count INTEGER DEFAULT 3,
  status TEXT DEFAULT 'dead_letter' CHECK (status IN (
    'pending_retry', 'dead_letter', 'resolved', 'ignored', 'reprocessed'
  )),
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.condition_ingest_failures
  IS 'Dead-letter: payloads que agotaron reintentos. Revisión y reprocesamiento manual.';

COMMENT ON COLUMN public.condition_ingest_failures.outbox_id
  IS 'FK a condition_ingest_outbox — entrada de outbox que originó este dead-letter';

COMMENT ON COLUMN public.condition_ingest_failures.source_id
  IS 'Identificador de la fuente que originó el payload';

COMMENT ON COLUMN public.condition_ingest_failures.source_type
  IS 'Tipo de fuente de datos';

COMMENT ON COLUMN public.condition_ingest_failures.idempotency_key
  IS 'Clave de idempotencia del payload fallido';

COMMENT ON COLUMN public.condition_ingest_failures.payload
  IS 'Payload FeatureSet v0.2 completo que falló';

COMMENT ON COLUMN public.condition_ingest_failures.error_code
  IS 'Código de error (ej: 23514 = CHECK violation, 23503 = FK violation, P0001 = raise_exception)';

COMMENT ON COLUMN public.condition_ingest_failures.error_message
  IS 'Mensaje de error del último fallo';

COMMENT ON COLUMN public.condition_ingest_failures.retry_count
  IS 'Cantidad de reintentos agotados';

COMMENT ON COLUMN public.condition_ingest_failures.status
  IS 'Estado: pending_retry → dead_letter → resolved | ignored | reprocessed';

COMMENT ON COLUMN public.condition_ingest_failures.resolved_by
  IS 'Usuario PLANNER/ADMIN que resolvió el dead-letter';

COMMENT ON COLUMN public.condition_ingest_failures.resolved_at
  IS 'Timestamp de resolución';

COMMENT ON COLUMN public.condition_ingest_failures.notes
  IS 'Notas de resolución (diagnóstico, causa raíz, acción tomada)';

COMMENT ON COLUMN public.condition_ingest_failures.created_at
  IS 'Fecha de creación del dead-letter';

-- -----------------------------------------------------------
-- 4. ÍNDICES: condition_ingest_failures
-- -----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_failures_status
  ON public.condition_ingest_failures(status);

CREATE INDEX IF NOT EXISTS idx_failures_source
  ON public.condition_ingest_failures(source_id);

CREATE INDEX IF NOT EXISTS idx_failures_created
  ON public.condition_ingest_failures(created_at DESC);

-- ============================================================
-- 5. ROW-LEVEL SECURITY: condition_ingest_outbox
-- ============================================================
ALTER TABLE public.condition_ingest_outbox ENABLE ROW LEVEL SECURITY;

-- SELECT: PLANNER/ADMIN pueden ver outbox
DROP POLICY IF EXISTS condition_ingest_outbox_select ON public.condition_ingest_outbox;
CREATE POLICY condition_ingest_outbox_select ON public.condition_ingest_outbox
  FOR SELECT TO authenticated
  USING (get_user_role() IN ('PLANNER', 'ADMIN'));

-- INSERT: PLANNER/ADMIN pueden insertar (EF usa service_role → bypass RLS)
DROP POLICY IF EXISTS condition_ingest_outbox_insert ON public.condition_ingest_outbox;
CREATE POLICY condition_ingest_outbox_insert ON public.condition_ingest_outbox
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

-- DELETE: solo ADMIN puede limpiar outbox
DROP POLICY IF EXISTS condition_ingest_outbox_delete ON public.condition_ingest_outbox;
CREATE POLICY condition_ingest_outbox_delete ON public.condition_ingest_outbox
  FOR DELETE TO authenticated
  USING (get_user_role() = 'ADMIN');

-- ============================================================
-- 6. ROW-LEVEL SECURITY: condition_ingest_failures
-- ============================================================
ALTER TABLE public.condition_ingest_failures ENABLE ROW LEVEL SECURITY;

-- SELECT: PLANNER/ADMIN pueden ver dead-letters
DROP POLICY IF EXISTS condition_ingest_failures_select ON public.condition_ingest_failures;
CREATE POLICY condition_ingest_failures_select ON public.condition_ingest_failures
  FOR SELECT TO authenticated
  USING (get_user_role() IN ('PLANNER', 'ADMIN'));

-- UPDATE: PLANNER/ADMIN pueden resolver dead-letters
DROP POLICY IF EXISTS condition_ingest_failures_update ON public.condition_ingest_failures;
CREATE POLICY condition_ingest_failures_update ON public.condition_ingest_failures
  FOR UPDATE TO authenticated
  USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

-- DELETE: solo ADMIN puede eliminar dead-letters
DROP POLICY IF EXISTS condition_ingest_failures_delete ON public.condition_ingest_failures;
CREATE POLICY condition_ingest_failures_delete ON public.condition_ingest_failures
  FOR DELETE TO authenticated
  USING (get_user_role() = 'ADMIN');
