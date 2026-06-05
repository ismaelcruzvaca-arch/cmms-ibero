-- ============================================================
-- MIGRATION: PDF Scheduled Reports — Tables, Functions & Cron
-- Change: pdf-scheduled-reports (PR 1 — Backend)
-- ============================================================
-- Crea los objetos necesarios para el sistema de reportes
-- programados por cron:
--   1. pg_net extension (idempotente)
--   2. report_schedule_config — configuración de un solo registro
--      (internal_secret compartido entre pg_cron y send-report EF)
--   3. report_schedules — tabla de schedules con cron_expression,
--      recipients, template_code y parámetros
--   4. RLS policies para ADMIN (CRUD) y PLANNER (read-only)
--   5. cron_next() — función simplificada de avance de cron
--   6. process_due_report_schedules() — función principal de
--      procesamiento con advisory lock y BEGIN/EXCEPTION por schedule
--   7. pg_cron job cada 15 minutos (idempotente)
--
-- Idempotente: CREATE OR REPLACE FUNCTION, IF NOT EXISTS,
--   DO block con EXCEPTION para cron.unschedule.
-- ============================================================

-- ============================================================
-- 1. pg_net Extension
--   Necesaria para net.http_post() desde PL/pgSQL.
--   Idempotente: IF NOT EXISTS.
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_net;

COMMENT ON EXTENSION pg_net IS
  'pg_net: HTTP cliente asíncrono desde PL/pgSQL vía net.http_post().';

-- ============================================================
-- 2. report_schedule_config
--   Tabla de configuración de un solo registro.
--   CHECK (id = 1) impone el constraint single-row.
--   internal_secret: secreto compartido para auth interna entre
--     pg_cron→EF. Debe coincidir con INTERNAL_SECRET env var.
--   ef_url: URL base del Edge Function send-report (opcional).
--     Si es NULL, se construye desde current_setting('supabase_url').
-- ============================================================
CREATE TABLE IF NOT EXISTS report_schedule_config (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  internal_secret TEXT NOT NULL,
  ef_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE report_schedule_config IS
  'Configuración global para el sistema de reportes programados. Single-row (CHECK id=1).';
COMMENT ON COLUMN report_schedule_config.internal_secret IS
  'Secreto compartido para autenticación interna pg_cron→send-report EF. Debe coincidir con INTERNAL_SECRET env var.';
COMMENT ON COLUMN report_schedule_config.ef_url IS
  'URL base del Edge Function send-report (opcional). Si es NULL se construye desde supabase_url.';

-- Seed default: inserta registro con un placeholder de secret.
-- El equipo de operaciones debe rotar este secreto post-deploy.
INSERT INTO report_schedule_config (id, internal_secret)
VALUES (1, 'change-me-in-production')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 3. report_schedules
--   Tabla principal de schedules de reportes programados.
--   Cada fila representa un schedule con su propia expresión
--   cron, lista de destinatarios y parámetros del template.
--   template_code es una referencia lógica a report_templates(code)
--   (sin FK constraint porque code no es UNIQUE solo).
-- ============================================================
CREATE TABLE IF NOT EXISTS report_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  template_code VARCHAR(100) NOT NULL,
  cron_expression VARCHAR(100) NOT NULL,
  recipients TEXT[] NOT NULL,
  subject VARCHAR(500) NOT NULL,
  params JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE report_schedules IS
  'Reportes programados — cada fila define un schedule con cron_expression y template_code.';
COMMENT ON COLUMN report_schedules.template_code IS
  'Código del template de reporte (referencia lógica a report_templates.code).';
COMMENT ON COLUMN report_schedules.cron_expression IS
  'Expresión cron estándar de 5 campos: minuto hora día-del-mes mes día-de-la-semana.';
COMMENT ON COLUMN report_schedules.recipients IS
  'Array de direcciones de email destinatarias del reporte.';
COMMENT ON COLUMN report_schedules.params IS
  'Parámetros JSONB específicos del schedule, pasados como data al template.';
COMMENT ON COLUMN report_schedules.is_active IS
  'Si el schedule está activo (true) o pausado (false).';
COMMENT ON COLUMN report_schedules.last_run_at IS
  'Última ejecución exitosa del schedule (actualizado por process_due_report_schedules).';
COMMENT ON COLUMN report_schedules.next_run_at IS
  'Próxima ejecución programada. Se calcula desde cron_expression vía cron_next().';

-- Índices para consultas eficientes de schedules pendientes
CREATE INDEX IF NOT EXISTS idx_report_schedules_due
  ON report_schedules (is_active, next_run_at)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_report_schedules_template_code
  ON report_schedules (template_code);

COMMENT ON INDEX idx_report_schedules_due IS
  'Índice parcial para la consulta de schedules pendientes en process_due_report_schedules().';
COMMENT ON INDEX idx_report_schedules_template_code IS
  'Índice para búsquedas por template_code.';

-- ============================================================
-- 3a. updated_at trigger para report_schedules
-- ============================================================
CREATE OR REPLACE FUNCTION set_report_schedules_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION set_report_schedules_updated_at()
  IS 'Trigger function: actualiza updated_at automáticamente en report_schedules.';

DROP TRIGGER IF EXISTS trg_report_schedules_updated_at ON report_schedules;

CREATE TRIGGER trg_report_schedules_updated_at
  BEFORE UPDATE ON report_schedules
  FOR EACH ROW
  EXECUTE FUNCTION set_report_schedules_updated_at();

COMMENT ON TRIGGER trg_report_schedules_updated_at ON report_schedules
  IS 'BEFORE UPDATE: actualiza updated_at automáticamente al modificar el schedule.';

-- ============================================================
-- 4. RLS: report_schedules
--   ADMIN: full CRUD (INSERT/SELECT/UPDATE/DELETE)
--   PLANNER: SELECT only (solo lectura)
--   TECHNICIAN: sin acceso (las políticas niegan por defecto)
--   Patrón consistente con report_templates (ver migración pdf_report_engine).
-- ============================================================
ALTER TABLE report_schedules ENABLE ROW LEVEL SECURITY;

-- ADMIN: full CRUD
CREATE POLICY report_schedules_admin_all ON report_schedules
  FOR ALL
  USING (get_user_role() = 'ADMIN')
  WITH CHECK (get_user_role() = 'ADMIN');

COMMENT ON POLICY report_schedules_admin_all ON report_schedules
  IS 'ADMIN: CRUD completo sobre report_schedules.';

-- PLANNER: SELECT only
CREATE POLICY report_schedules_planner_select ON report_schedules
  FOR SELECT
  USING (get_user_role() = 'PLANNER');

COMMENT ON POLICY report_schedules_planner_select ON report_schedules
  IS 'PLANNER: solo lectura de report_schedules.';

-- TECHNICIAN: sin acceso (la política por defecto denega)

-- ============================================================
-- 5. cron_next(cron_expr, from_time)
--   Función simplificada que avanza from_time al próximo
--   período según el patrón cron de 5 campos.
--
--   Heurísticas (basadas en primeros 3 campos):
--     - day-of-month específico → +1 mes
--     - day-of-week específico (5º campo) → +7 días
--     - minute con */N → +N minutos
--     - hour = * → +1 hora
--     - minute y hour específicos → +1 día
--     - fallback → +1 día
--
--   Para un cálculo exacto se recomienda cron-parser en frontend
--   (ver diseño: Next Run Calculation Option B).
--   STABLE: mismo resultado para mismos inputs dentro de la misma transacción.
-- ============================================================
CREATE OR REPLACE FUNCTION cron_next(
  cron_expr TEXT,
  from_time TIMESTAMPTZ
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  parts TEXT[];
  minute_part TEXT;
  hour_part TEXT;
  dom_part TEXT;
  dow_part TEXT;
BEGIN
  parts := regexp_split_to_array(TRIM(cron_expr), '\s+');

  -- Solo procesamos expresiones de 5 campos
  IF array_length(parts, 1) >= 5 THEN
    minute_part := parts[1];
    hour_part   := parts[2];
    dom_part    := parts[3];
    dow_part    := parts[5];

    -- Monthly: day-of-month es un número específico (no *)
    IF dom_part ~ '^\d{1,2}$' THEN
      RETURN from_time + INTERVAL '1 month';
    END IF;

    -- Weekly: day-of-week es un número específico
    IF dow_part ~ '^\d{1,2}$' THEN
      RETURN from_time + INTERVAL '7 days';
    END IF;

    -- Sub-daily: minute con step */N
    IF minute_part LIKE '*/%' THEN
      RETURN from_time + (substring(minute_part FROM 3)::INT || ' minutes')::INTERVAL;
    END IF;

    -- Hourly: minute específico, hour = *
    IF hour_part = '*' THEN
      RETURN from_time + INTERVAL '1 hour';
    END IF;

    -- Daily: minute y hour específicos
    IF minute_part ~ '^\d{1,2}$' AND hour_part ~ '^\d{1,2}$' THEN
      RETURN from_time + INTERVAL '1 day';
    END IF;
  END IF;

  -- Fallback: avanzar 1 día para patrones no reconocidos
  RETURN from_time + INTERVAL '1 day';
END;
$$;

COMMENT ON FUNCTION cron_next(TEXT, TIMESTAMPTZ) IS
  'Avanza from_time al próximo período según expresión cron de 5 campos. STABLE.';

-- ============================================================
-- 6. process_due_report_schedules()
--   Función principal que processa todos los schedules
--   cuyo next_run_at <= NOW().
--
--   Flujo:
--     1. Advisory lock (pg_try_advisory_xact_lock) para evitar
--        ejecuciones concurrentes.
--     2. Lee internal_secret y ef_url desde report_schedule_config.
--     3. Itera sobre schedules pendientes (is_active AND
--        next_run_at <= NOW()) con FOR UPDATE SKIP LOCKED.
--     4. Por cada schedule:
--        a. BEGIN → net.http_post() al EF con headers de auth interna
--        b. UPDATE last_run_at = NOW(), next_run_at = cron_next()
--        c. EXCEPTION → RAISE WARNING + continúa al siguiente
--
--   SECURITY DEFINER: necesita acceso a net.http_post() y a las
--   tablas. SET search_path = public por seguridad.
-- ============================================================
CREATE OR REPLACE FUNCTION process_due_report_schedules()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  sched RECORD;
  secret TEXT;
  ef_url TEXT;
BEGIN
  -- 6a. Advisory lock: prevenir ejecuciones concurrentes
  IF NOT pg_try_advisory_xact_lock(hashtext('process_due_report_schedules')) THEN
    RAISE WARNING 'process_due_report_schedules: ejecución concurrente detectada, saltando.';
    RETURN;
  END IF;

  -- 6b. Leer configuración
  SELECT internal_secret,
         COALESCE(
           ef_url,
           current_setting('supabase_url', true) || '/functions/v1/send-report'
         )
  INTO secret, ef_url
  FROM report_schedule_config
  WHERE id = 1;

  IF secret IS NULL THEN
    RAISE WARNING 'process_due_report_schedules: report_schedule_config no encontrada o internal_secret es NULL.';
    RETURN;
  END IF;

  -- 6c. Iterar sobre schedules pendientes
  FOR sched IN
    SELECT *
    FROM report_schedules
    WHERE is_active AND next_run_at <= NOW()
    ORDER BY next_run_at ASC
    FOR UPDATE SKIP LOCKED
  LOOP
    -- 6d. Cada schedule en su propio BEGIN/EXCEPTION
    BEGIN
      PERFORM net.http_post(
        url := ef_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'X-Internal-Secret', secret
        ),
        body := jsonb_build_object(
          'to', sched.recipients,
          'subject', sched.subject,
          'template_code', sched.template_code,
          'data', sched.params
        ),
        timeout_milliseconds := 30000
      );

      -- Actualizar last_run_at y calcular próximo next_run_at
      UPDATE report_schedules
      SET last_run_at = NOW(),
          next_run_at = cron_next(sched.cron_expression, NOW())
      WHERE id = sched.id;

      RAISE DEBUG 'process_due_report_schedules: schedule % procesado exitosamente', sched.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'process_due_report_schedules: schedule % falló: %', sched.id, SQLERRM;
    END;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION process_due_report_schedules() IS
  'Procesa schedules pendientes: llama a send-report EF vía net.http_post() con auth interna y avanza last_run_at/next_run_at. SECURITY DEFINER.';

-- ============================================================
-- 7. pg_cron: Schedule cada 15 minutos
--   Idempotente: DO block con EXCEPTION para cron.unschedule.
--   Guard: verifica que pg_cron esté instalado.
--
--   NOTA: El schedule se llama 'process-report-schedules' para
--   consistencia con la convención de nombres de schedules en
--   Supabase (kebab-case). La expresión cron */15 * * * *
--   ejecuta la función cada 15 minutos.
-- ============================================================
DO $cron_block$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Eliminar schedule previo si existe (idempotente)
    BEGIN
      PERFORM cron.unschedule('process-report-schedules');
    EXCEPTION WHEN OTHERS THEN
      -- El job no existía, continuar
    END;

    -- Crear nuevo schedule cada 15 minutos
    PERFORM cron.schedule(
      'process-report-schedules',
      '*/15 * * * *',
      $cron_job$SELECT process_due_report_schedules();$cron_job$
    );
  END IF;
END;
$cron_block$;

-- ============================================================
-- FIN MIGRATION: pdf_scheduled_reports
-- ============================================================
