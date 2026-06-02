-- ============================================================
-- MIGRATION: condition_ingest_governance — Gobierno de Ingesta
-- Change: condition-monitoring-hybrid-sources (PR 1)
-- ============================================================
-- Extiende el schema de ingesta SDD 1 con trazabilidad de fuentes,
-- política de datos tardíos, y funciones de gobierno:
--
-- ALTERs:
--   condition_windows           +ingested_by, +late_data_flag,
--                               +late_data_hours, +quality_gate_passed,
--                               FK→condition_sources(source_id), 2 índices
--   condition_feature_values    +ingested_by, +measured_by, +entered_by,
--                               +measured_at, +entered_at, +instrument_ref,
--                               +notes, 2 índices
--   condition_source_capabilities +late_event_cutoff_hours
--
-- SQL Functions:
--   is_source_capable(source_id, feature_key, method_key) → BOOLEAN
--   is_within_late_cutoff(source_id, measured_at) → BOOLEAN
--   retry_failed_ingests() → INT (pg_cron job)
--   purge_dead_letters(days) → INT (cleanup)
--
-- Dependencias:
--   condition_sources          (migración 20260602100007)
--   condition_ingest_outbox    (migración 20260602100008)
--   condition_ingest_failures  (migración 20260602100008)
--   condition_source_capabilities (SDD 1: 20260602100002)
-- ============================================================

-- ============================================================
-- 1. ALTER: condition_windows — columnas de trazabilidad
-- ============================================================
ALTER TABLE public.condition_windows ADD COLUMN IF NOT EXISTS ingested_by TEXT;

COMMENT ON COLUMN public.condition_windows.ingested_by
  IS 'Usuario o EF que realizó la ingesta (ej: tech-02, ingest-condition/edge_001)';

ALTER TABLE public.condition_windows ADD COLUMN IF NOT EXISTS late_data_flag BOOLEAN DEFAULT false;

COMMENT ON COLUMN public.condition_windows.late_data_flag
  IS 'TRUE si ingested_at − measured_at > late_event_cutoff_hours de la fuente';

ALTER TABLE public.condition_windows ADD COLUMN IF NOT EXISTS late_data_hours NUMERIC;

COMMENT ON COLUMN public.condition_windows.late_data_hours
  IS 'Cantidad de horas de retraso (ingested_at − measured_at)';

ALTER TABLE public.condition_windows ADD COLUMN IF NOT EXISTS quality_gate_passed BOOLEAN DEFAULT true;

COMMENT ON COLUMN public.condition_windows.quality_gate_passed
  IS 'FALSE si la ingesta fue forzada ignorando alguna validación de calidad';

-- FK a condition_sources(source_id) — ON DELETE SET NULL (soft)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_windows_source') THEN
    ALTER TABLE public.condition_windows
      ADD CONSTRAINT fk_windows_source
      FOREIGN KEY (source_id) REFERENCES public.condition_sources(source_id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Índices de trazabilidad
CREATE INDEX IF NOT EXISTS idx_windows_ingested_by
  ON public.condition_windows(ingested_by);

CREATE INDEX IF NOT EXISTS idx_windows_late_data
  ON public.condition_windows(late_data_flag)
  WHERE late_data_flag = true;

-- ============================================================
-- 2. ALTER: condition_feature_values — columnas de trazabilidad
-- ============================================================
ALTER TABLE public.condition_feature_values ADD COLUMN IF NOT EXISTS ingested_by TEXT;

COMMENT ON COLUMN public.condition_feature_values.ingested_by
  IS 'Usuario o EF que realizó la ingesta';

ALTER TABLE public.condition_feature_values ADD COLUMN IF NOT EXISTS measured_by TEXT;

COMMENT ON COLUMN public.condition_feature_values.measured_by
  IS 'Usuario que midió en campo (puede ser distinto de entered_by)';

ALTER TABLE public.condition_feature_values ADD COLUMN IF NOT EXISTS entered_by TEXT;

COMMENT ON COLUMN public.condition_feature_values.entered_by
  IS 'Usuario que ingresó el dato en el sistema';

ALTER TABLE public.condition_feature_values ADD COLUMN IF NOT EXISTS measured_at TIMESTAMPTZ;

COMMENT ON COLUMN public.condition_feature_values.measured_at
  IS 'Timestamp en que se realizó la medición física';

ALTER TABLE public.condition_feature_values ADD COLUMN IF NOT EXISTS entered_at TIMESTAMPTZ;

COMMENT ON COLUMN public.condition_feature_values.entered_at
  IS 'Timestamp en que se ingresó al sistema';

ALTER TABLE public.condition_feature_values ADD COLUMN IF NOT EXISTS instrument_ref TEXT;

COMMENT ON COLUMN public.condition_feature_values.instrument_ref
  IS 'Referencia al instrumento usado (ej: vib-01, termo-IR-03)';

ALTER TABLE public.condition_feature_values ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN public.condition_feature_values.notes
  IS 'Notas libres del operador sobre la medición';

-- Índices de trazabilidad
CREATE INDEX IF NOT EXISTS idx_fv_ingested_by
  ON public.condition_feature_values(ingested_by);

CREATE INDEX IF NOT EXISTS idx_fv_measured_at
  ON public.condition_feature_values(measured_at);

-- ============================================================
-- 3. ALTER: condition_source_capabilities — cutoff a nivel capability
-- ============================================================
ALTER TABLE public.condition_source_capabilities ADD COLUMN IF NOT EXISTS late_event_cutoff_hours INTEGER;

COMMENT ON COLUMN public.condition_source_capabilities.late_event_cutoff_hours
  IS 'Override de cutoff a nivel capability (NULL = hereda de condition_sources)';

-- ============================================================
-- 4. FUNCIÓN: is_source_capable(source_id, feature_key, method_key) → BOOLEAN
--    Verifica si una fuente tiene capacidad registrada y validada
--    para producir un feature específico con un método específico.
--
--    Retorna TRUE si existe capability con validation_status IN
--    ('active', 'field_trial', 'bench_validated').
--    Retorna FALSE si no existe capability o si validation_status
--    está en draft/rejected/deprecated.
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_source_capable(
  p_source_id TEXT,
  p_feature_key TEXT,
  p_method_key TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.condition_source_capabilities
  WHERE source_id = p_source_id
    AND can_produce = p_feature_key
    AND method_key = p_method_key
    AND validation_status IN ('active', 'field_trial', 'bench_validated');

  RETURN v_count > 0;
END;
$$;

COMMENT ON FUNCTION public.is_source_capable(TEXT, TEXT, TEXT)
  IS 'Verifica si source_id tiene capability activa (active/field_trial/bench_validated) para feature_key + method_key. Retorna BOOLEAN.';

-- ============================================================
-- 5. FUNCIÓN: is_within_late_cutoff(source_id, measured_at) → BOOLEAN
--    Evalúa si una medición está dentro del cutoff de datos tardíos
--    configurado para la fuente.
--
--    Usa el mínimo entre:
--    - condition_sources.late_event_cutoff_hours
--    - COALESCE(condition_source_capabilities.late_event_cutoff_hours, ∞)
--
--    Si cutoff = 0 → siempre es late (csv histórico, etc.).
--    Si cutoff = NULL o no existe la fuente → FALSE (rechazar por seguridad).
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_within_late_cutoff(
  p_source_id TEXT,
  p_measured_at TIMESTAMPTZ
) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_source_cutoff INTEGER;
  v_capability_cutoff INTEGER;
  v_effective_cutoff NUMERIC;
  v_diff_hours NUMERIC;
BEGIN
  -- Obtener cutoff de la fuente
  SELECT late_event_cutoff_hours INTO v_source_cutoff
  FROM public.condition_sources
  WHERE source_id = p_source_id;

  -- Si la fuente no existe o no tiene cutoff → rechazar por seguridad
  IF v_source_cutoff IS NULL THEN
    RETURN false;
  END IF;

  -- cutoff = 0 → siempre late (CSV histórico, etc.)
  IF v_source_cutoff = 0 THEN
    RETURN false;
  END IF;

  -- Obtener override de capability (mínimo entre los capabilities)
  SELECT MIN(late_event_cutoff_hours) INTO v_capability_cutoff
  FROM public.condition_source_capabilities
  WHERE source_id = p_source_id
    AND late_event_cutoff_hours IS NOT NULL;

  -- Cutoff efectivo: mínimo entre fuente y capability
  v_effective_cutoff := LEAST(
    v_source_cutoff::NUMERIC,
    COALESCE(v_capability_cutoff::NUMERIC, 999999)
  );

  -- Calcular diferencia en horas
  v_diff_hours := EXTRACT(EPOCH FROM (NOW() - p_measured_at)) / 3600.0;

  RETURN v_diff_hours <= v_effective_cutoff;
END;
$$;

COMMENT ON FUNCTION public.is_within_late_cutoff(TEXT, TIMESTAMPTZ)
  IS 'Evalúa si una medición está dentro del cutoff de datos tardíos usando el mínimo entre source y capability cutoff. Retorna FALSE si es late, TRUE si está a tiempo.';

-- ============================================================
-- 6. FUNCIÓN: retry_failed_ingests() → INT
--    pg_cron job: procesa hasta 10 entradas pending del outbox
--    cuyo next_retry_at ya venció.
--
--    Backoff: 1min → 5min → 15min (según retry_count actual).
--    Después de max_retries (default 3) → mover a dead-letter.
--
--    Retorna: cantidad de payloads procesados (retried + dead_lettered).
-- ============================================================
CREATE OR REPLACE FUNCTION public.retry_failed_ingests()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
  v_processed INT := 0;
  v_new_next_retry TIMESTAMPTZ;
BEGIN
  -- Procesar hasta 10 entradas por ciclo para no sobrecargar
  FOR v_rec IN
    SELECT *
    FROM public.condition_ingest_outbox
    WHERE status = 'pending'
      AND next_retry_at <= NOW()
    ORDER BY created_at
    LIMIT 10
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Si ya alcanzó max_retries → mover a dead-letter
    IF v_rec.retry_count >= v_rec.max_retries THEN
      -- Insertar en dead-letter
      INSERT INTO public.condition_ingest_failures (
        outbox_id, source_id, source_type, idempotency_key,
        payload, error_code, error_message, retry_count,
        status, created_at
      ) VALUES (
        v_rec.id, v_rec.source_id, v_rec.source_type,
        v_rec.idempotency_key, v_rec.payload,
        v_rec.error_code, v_rec.error_message,
        v_rec.retry_count, 'dead_letter', NOW()
      );

      -- Marcar outbox como dead
      UPDATE public.condition_ingest_outbox
      SET status = 'dead', resolved_at = NOW()
      WHERE id = v_rec.id;

      v_processed := v_processed + 1;
      CONTINUE;
    END IF;

    -- Calcular backoff para el próximo reintento
    v_new_next_retry := CASE v_rec.retry_count
      WHEN 0 THEN NOW() + INTERVAL '1 minute'
      WHEN 1 THEN NOW() + INTERVAL '5 minutes'
      WHEN 2 THEN NOW() + INTERVAL '15 minutes'
      ELSE NOW() + INTERVAL '30 minutes'
    END;

    -- Incrementar retry_count y programar próximo intento
    UPDATE public.condition_ingest_outbox SET
      status = 'pending',
      retry_count = retry_count + 1,
      next_retry_at = v_new_next_retry,
      last_retry_at = NOW()
    WHERE id = v_rec.id;

    v_processed := v_processed + 1;
  END LOOP;

  RETURN v_processed;
END;
$$;

COMMENT ON FUNCTION public.retry_failed_ingests()
  IS 'pg_cron job: reintenta hasta 10 payloads pending del outbox con backoff 1/5/15min. Después de max_retries → dead-letter. Retorna cantidad procesada.';

-- ============================================================
-- 7. FUNCIÓN: purge_dead_letters(days) → INT
--    Limpia dead-letters resueltos/ignorados con antigüedad
--    mayor a N días (default 90).
--
--    Retorna: cantidad de registros eliminados.
-- ============================================================
CREATE OR REPLACE FUNCTION public.purge_dead_letters(
  days INT DEFAULT 90
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_purged INT;
BEGIN
  WITH deleted AS (
    DELETE FROM public.condition_ingest_failures
    WHERE status IN ('resolved', 'ignored')
      AND created_at < NOW() - (days || ' days')::INTERVAL
    RETURNING id
  )
  SELECT COUNT(*) INTO v_purged FROM deleted;

  RETURN v_purged;
END;
$$;

COMMENT ON FUNCTION public.purge_dead_letters(INT)
  IS 'Limpia dead-letters con status resolved/ignored más antiguos que N días (default 90). Retorna cantidad eliminada.';
