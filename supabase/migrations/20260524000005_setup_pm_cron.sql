-- ============================================================
-- MIGRATION 8: PM Engine — Cron Automático
-- ============================================================
-- Programa generate_due_preventive_work_orders() para
-- ejecutarse diariamente a la 01:00 AM (fuera de turno).
--
-- Dependencia: pg_cron extension (disponible en Supabase)
-- ============================================================

-- 1. Activar extensión pg_cron (idempotente)
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- 2. Eliminar schedule previo si existe (idempotente)
SELECT cron.unschedule('pm_engine_daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pm_engine_daily');

-- 3. Programar ejecución diaria a la 01:00 AM
SELECT cron.schedule(
  'pm_engine_daily',
  '0 1 * * *',
  $$SELECT generate_due_preventive_work_orders();$$
);
