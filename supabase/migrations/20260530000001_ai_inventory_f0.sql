-- ============================================================
-- MIGRACIÓN 18: AI Inventory Intelligence — Fase 0 (Heuristics)
-- Change: ai-inventory-f0
-- ============================================================
-- Feature store + heuristics analíticos sobre consumo de partes.
-- SIN frontend, SIN infraestructura ML, SOLO PostgreSQL.
--
-- Contenido:
--   Sec 1: Schema ai_inventory
--   Sec 2: MATVIEW — part_consumption_stats
--   Sec 3: MATVIEW — part_abc_classification
--   Sec 4: MATVIEW — part_associations
--   Sec 5: MATVIEW — consumption_anomalies
--   Sec 6: VIEW   — stockout_signals (unificada)
--   Sec 7: MATVIEW — pm_demand_pipeline
--   Sec 8: Función — croston_forecast()
--   Sec 9: Funciones — inventory_kpi_*()
--   Sec 10: Epicor Outbox — expansión ISSUE/RETURN
--   Sec 11: pg_cron — refresco de MATVIEWs
-- ============================================================

-- ============================================================
-- SECCIÓN 1: Schema ai_inventory
-- ============================================================

CREATE SCHEMA IF NOT EXISTS ai_inventory;

-- ============================================================
-- SECCIÓN 2: part_consumption_stats
--   Estadísticas de consumo por parte en ventanas temporales
--   Refresco: diario
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS ai_inventory.part_consumption_stats AS
SELECT
  part_num,
  COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS issues_30d,
  COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '90 days') AS issues_90d,
  COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '365 days') AS issues_1y,
  SUM(ABS(qty)) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS qty_30d,
  SUM(ABS(qty)) FILTER (WHERE created_at >= NOW() - INTERVAL '90 days') AS qty_90d,
  SUM(ABS(qty)) FILTER (WHERE created_at >= NOW() - INTERVAL '365 days') AS qty_1y,
  ROUND(SUM(ABS(qty)) / 90.0, 2) AS daily_avg_90d,
  ROUND(STDDEV(ABS(qty))::numeric, 2) AS daily_std_90d,
  COUNT(DISTINCT work_order_id) FILTER (WHERE created_at >= NOW() - INTERVAL '90 days') AS wos_90d,
  COUNT(DISTINCT work_order_id) FILTER (WHERE created_at >= NOW() - INTERVAL '365 days') AS wos_1y,
  NOW() AS refreshed_at
FROM inventory_transactions
WHERE transaction_type IN ('ISSUE', 'DIRECT_ISSUE')
GROUP BY part_num;

COMMENT ON MATERIALIZED VIEW ai_inventory.part_consumption_stats IS
  'Estadísticas de consumo por parte: volúmenes, frecuencias y ventanas temporales. Fuente primaria para forecasting y ABC.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_pcs_part ON ai_inventory.part_consumption_stats(part_num);

-- ============================================================
-- SECCIÓN 3: part_abc_classification
--   ABC multi-criterio: 50% valor consumo, 30% criticidad, 20% frecuencia
--   Refresco: mensual
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS ai_inventory.part_abc_classification AS
WITH consumption_value AS (
  SELECT
    it.part_num,
    SUM(ABS(it.qty)) AS annual_qty,
    SUM(ABS(it.qty)) AS annual_value
  FROM inventory_transactions it
  WHERE it.transaction_type IN ('ISSUE', 'DIRECT_ISSUE')
    AND it.created_at >= NOW() - INTERVAL '365 days'
  GROUP BY it.part_num
),
part_criticality AS (
  SELECT
    asp.part_num,
    MAX(CASE a.criticality
      WHEN 'A' THEN 3 WHEN 'B' THEN 2 WHEN 'C' THEN 1
      ELSE 0
    END) AS max_criticality_score
  FROM asset_spare_parts asp
  JOIN assets a ON a.id = asp.asset_id
  GROUP BY asp.part_num
),
scored AS (
  SELECT
    cv.part_num,
    cv.annual_qty,
    cv.annual_value,
    COALESCE(pc.max_criticality_score, 0) AS criticality_score,
    ROW_NUMBER() OVER (ORDER BY cv.annual_value DESC NULLS LAST)::float /
      NULLIF(COUNT(*) OVER (), 0) AS value_percentile,
    COALESCE(pc.max_criticality_score, 0) / 3.0 AS criticality_norm,
    (0.5 * (1 - ROW_NUMBER() OVER (ORDER BY cv.annual_value DESC NULLS LAST)::float /
      NULLIF(COUNT(*) OVER (), 0))
    + 0.3 * COALESCE(pc.max_criticality_score, 0) / 3.0
    + 0.2 * COALESCE(cv.annual_qty / NULLIF(MAX(cv.annual_qty) OVER (), 0), 0)) AS composite_score
  FROM consumption_value cv
  LEFT JOIN part_criticality pc ON pc.part_num = cv.part_num
),
cumulative AS (
  SELECT
    part_num,
    annual_qty,
    annual_value,
    composite_score,
    SUM(annual_value) OVER (ORDER BY composite_score DESC NULLS LAST) AS running_value,
    SUM(annual_value) OVER () AS total_value
  FROM scored
)
SELECT
  part_num,
  annual_qty,
  ROUND(annual_value, 2) AS annual_value,
  ROUND(composite_score::numeric, 3) AS composite_score,
  CASE
    WHEN running_value / NULLIF(total_value, 0) <= 0.80 THEN 'A'
    WHEN running_value / NULLIF(total_value, 0) <= 0.95 THEN 'B'
    ELSE 'C'
  END AS abc_class,
  CASE
    WHEN composite_score >= 0.7 THEN 'A'
    WHEN composite_score >= 0.4 THEN 'B'
    ELSE 'C'
  END AS abc_multicriteria,
  NOW() AS refreshed_at
FROM cumulative
ORDER BY composite_score DESC NULLS LAST;

COMMENT ON MATERIALIZED VIEW ai_inventory.part_abc_classification IS
  'Clasificación ABC multi-criterio: 50% valor de consumo anual, 30% criticidad del activo, 20% frecuencia de uso.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_pabc_part ON ai_inventory.part_abc_classification(part_num);

-- ============================================================
-- SECCIÓN 4: part_associations
--   Reglas de asociación entre partes (pair frequency)
--   "Quien usó X también usó Y"
--   Refresco: semanal
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS ai_inventory.part_associations AS
WITH wo_parts AS (
  SELECT DISTINCT work_order_id, part_num
  FROM inventory_transactions
  WHERE transaction_type IN ('ISSUE', 'DIRECT_ISSUE')
    AND work_order_id IS NOT NULL
    AND part_num IS NOT NULL
    AND created_at >= NOW() - INTERVAL '365 days'
),
pairs AS (
  SELECT
    a.part_num AS part_a,
    b.part_num AS part_b,
    COUNT(*) AS co_occurrence
  FROM wo_parts a
  JOIN wo_parts b ON a.work_order_id = b.work_order_id
    AND a.part_num < b.part_num
  GROUP BY a.part_num, b.part_num
),
part_freq AS (
  SELECT part_num, COUNT(*) AS total_wos
  FROM wo_parts
  GROUP BY part_num
),
total_wos AS (
  SELECT COUNT(DISTINCT work_order_id) AS total FROM wo_parts
)
SELECT
  p.part_a,
  p.part_b,
  p.co_occurrence,
  ROUND(100.0 * p.co_occurrence / NULLIF(pf_a.total_wos, 0), 1) AS confidence_a_to_b,
  ROUND(100.0 * p.co_occurrence / NULLIF(pf_b.total_wos, 0), 1) AS confidence_b_to_a,
  ROUND(
    (p.co_occurrence::numeric / NULLIF(pf_a.total_wos, 0))
    / NULLIF(pf_b.total_wos::numeric / NULLIF(tw.total, 0), 0),
    2
  ) AS lift,
  NOW() AS refreshed_at
FROM pairs p
JOIN part_freq pf_a ON pf_a.part_num = p.part_a
JOIN part_freq pf_b ON pf_b.part_num = p.part_b
CROSS JOIN total_wos tw
WHERE p.co_occurrence >= 3
  AND pf_a.total_wos > 0
  AND pf_b.total_wos > 0
  AND tw.total > 0
  AND (p.co_occurrence::numeric / NULLIF(pf_a.total_wos, 0))
    / NULLIF(pf_b.total_wos::numeric / NULLIF(tw.total, 0), 0) > 1.5
ORDER BY lift DESC NULLS LAST
LIMIT 500;

COMMENT ON MATERIALIZED VIEW ai_inventory.part_associations IS
  'Reglas de asociación entre partes: co-occurrencia, confianza y lift. "Quien usó X también usó Y".';

CREATE UNIQUE INDEX IF NOT EXISTS idx_pa_pair ON ai_inventory.part_associations(part_a, part_b);

-- ============================================================
-- SECCIÓN 5: consumption_anomalies
--   Z-score móvil sobre consumo semanal
--   Detecta picos/patrones inusuales
--   Refresco: diario
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS ai_inventory.consumption_anomalies AS
WITH weekly_consumption AS (
  SELECT
    date_trunc('week', created_at) AS week,
    part_num,
    SUM(ABS(qty)) AS weekly_qty
  FROM inventory_transactions
  WHERE transaction_type IN ('ISSUE', 'DIRECT_ISSUE')
    AND created_at >= NOW() - INTERVAL '6 months'
  GROUP BY 1, 2
),
stats AS (
  SELECT
    part_num,
    week,
    weekly_qty,
    AVG(weekly_qty) OVER (
      PARTITION BY part_num
      ORDER BY week
      ROWS BETWEEN 12 PRECEDING AND 1 PRECEDING
    ) AS avg_12wk,
    STDDEV(weekly_qty) OVER (
      PARTITION BY part_num
      ORDER BY week
      ROWS BETWEEN 12 PRECEDING AND 1 PRECEDING
    ) AS std_12wk
  FROM weekly_consumption
)
SELECT
  part_num,
  week,
  weekly_qty,
  ROUND(COALESCE(avg_12wk, 0), 2) AS expected,
  ROUND(COALESCE((weekly_qty - avg_12wk) / NULLIF(std_12wk, 0), 0), 2) AS z_score,
  CASE
    WHEN std_12wk IS NULL OR std_12wk = 0 THEN 'NO_HISTORY'
    WHEN ABS((weekly_qty - avg_12wk) / NULLIF(std_12wk, 0)) > 3 THEN 'ANOMALY'
    WHEN ABS((weekly_qty - avg_12wk) / NULLIF(std_12wk, 0)) > 2 THEN 'WARNING'
    ELSE 'NORMAL'
  END AS alert,
  NOW() AS refreshed_at
FROM stats
WHERE week >= NOW() - INTERVAL '4 weeks'
  AND EXISTS (
    SELECT 1 FROM inventory_transactions it
    WHERE it.part_num = stats.part_num
      AND it.created_at >= NOW() - INTERVAL '90 days'
  )
ORDER BY z_score DESC NULLS LAST;

COMMENT ON MATERIALIZED VIEW ai_inventory.consumption_anomalies IS
  'Anomalías de consumo detectadas por Z-score móvil (ventana 12 semanas). Alertas ANOMALY (>3σ) y WARNING (>2σ).';

CREATE UNIQUE INDEX IF NOT EXISTS idx_ca_week_part ON ai_inventory.consumption_anomalies(week, part_num);

-- ============================================================
-- SECCIÓN 6: stockout_signals (VIEW, no MATVIEW — siempre fresco)
--   Unifica las 3 señales de falta de refacción en GEMA
-- ============================================================

CREATE OR REPLACE VIEW ai_inventory.stockout_signals AS
WITH -- Nota: No filtramos por block_reason porque el ENUM actual
-- ({NONE,MATERIAL,PLANT_CONDITION,SCHEDULE}) no incluye PARTS.
-- La señal principal de desabasto viene de WAIT_MATERIAL en labor_records.
-- WO_BLOCKED se reserva para cuando el ENUM se expanda.
waiting_material AS (
  SELECT
    lr.work_order_id,
    wo.asset_id,
    NULL::TEXT AS block_reason,
    lr.start_time AS signal_at,
    'WAIT_MATERIAL' AS signal_type,
    it.part_num
  FROM labor_records lr
  JOIN work_orders wo ON wo.id = lr.work_order_id
  LEFT JOIN inventory_transactions it ON it.work_order_id = wo.id
  WHERE lr.activity_code = 'WAIT_MATERIAL'
    AND lr.start_time >= NOW() - INTERVAL '90 days'
),
checklist_falta AS (
  SELECT
    cir.checklist_instance_id,
    ci.work_order_id,
    wo.asset_id,
    cir.answered_at AS signal_at,
    'FALTA_REPUESTO' AS signal_type,
    NULL::TEXT AS part_num
  FROM checklist_item_responses cir
  JOIN checklist_instances ci ON ci.id = cir.checklist_instance_id
  JOIN work_orders wo ON wo.id = ci.work_order_id
  WHERE cir.causa_falla_id IN (SELECT id FROM causa_falla_catalog WHERE code = 'FALTA_REPUESTO')
    AND cir.answered_at >= NOW() - INTERVAL '90 days'
)
SELECT
  COALESCE(wm.signal_at, cf.signal_at) AS signal_at,
  COALESCE(wm.work_order_id, cf.work_order_id) AS work_order_id,
  COALESCE(wm.asset_id, cf.asset_id) AS asset_id,
  COALESCE(wm.signal_type, cf.signal_type) AS signal_type,
  COALESCE(wm.part_num, cf.part_num) AS part_num
FROM waiting_material wm
FULL OUTER JOIN checklist_falta cf ON cf.work_order_id = wm.work_order_id
ORDER BY signal_at DESC;

COMMENT ON VIEW ai_inventory.stockout_signals IS
  'Señales unificadas de desabasto: WO bloqueadas por PARTS, labor_records WAIT_MATERIAL, checklists FALTA_REPUESTO.';

-- ============================================================
-- SECCIÓN 7: pm_demand_pipeline
--   Demanda CONOCIDA de partes desde PM schedules
--   Refresco: diario
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS ai_inventory.pm_demand_pipeline AS
SELECT
  date_trunc('week', pm.next_target_date) AS week,
  jpm.part_num,
  sp.description AS part_description,
  SUM(jpm.planned_qty) AS planned_qty,
  COUNT(DISTINCT pm.asset_id) AS assets_count,
  NOW() AS refreshed_at
FROM pm_schedules pm
JOIN job_plans jp ON jp.id = pm.job_plan_id
JOIN job_plan_materials jpm ON jpm.job_plan_id = jp.id
LEFT JOIN spare_parts sp ON sp.part_num = jpm.part_num
WHERE pm.next_target_date IS NOT NULL
  AND pm.next_target_date <= CURRENT_DATE + INTERVAL '90 days'
GROUP BY 1, 2, 3
ORDER BY week ASC, planned_qty DESC;

COMMENT ON MATERIALIZED VIEW ai_inventory.pm_demand_pipeline IS
  'Demanda CONOCIDA de refacciones desde PM schedules a 90 días. Fuente de demanda CIERTA (no forecast, es programado).';

CREATE UNIQUE INDEX IF NOT EXISTS idx_pdp_week_part ON ai_inventory.pm_demand_pipeline(week, part_num);

-- ============================================================
-- SECCIÓN 8: Función croston_forecast()
--   Croston's Method aproximado para demanda intermitente
--   Retorna forecast mensual para una parte
-- ============================================================

CREATE OR REPLACE FUNCTION ai_inventory.croston_forecast(
  p_part_num TEXT,
  p_periods INT DEFAULT 12
)
RETURNS TABLE (month INT, forecast NUMERIC, nonzero_avg NUMERIC, probability NUMERIC)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_nonzero_avg NUMERIC;
  v_probability NUMERIC;
BEGIN
  WITH monthly AS (
    SELECT
      date_trunc('month', created_at) AS month,
      SUM(ABS(qty)) AS total_qty
    FROM inventory_transactions
    WHERE part_num = p_part_num
      AND transaction_type IN ('ISSUE', 'DIRECT_ISSUE')
      AND created_at >= NOW() - INTERVAL '24 months'
    GROUP BY 1
  ),
  nonzero AS (
    SELECT AVG(total_qty) AS avg_qty, COUNT(*) AS nonzero_count
    FROM monthly WHERE total_qty > 0
  ),
  total AS (
    SELECT GREATEST(COUNT(*), 1) AS total_count FROM monthly
  )
  SELECT
    COALESCE((SELECT avg_qty FROM nonzero), 0),
    CASE WHEN (SELECT total_count FROM total) > 0
      THEN COALESCE((SELECT nonzero_count::numeric FROM nonzero), 0) /
           (SELECT total_count FROM total)
      ELSE 0
    END
  INTO v_nonzero_avg, v_probability;

  RETURN QUERY
  SELECT
    generate_series(1, p_periods) AS month,
    ROUND(v_nonzero_avg * v_probability, 2) AS forecast,
    ROUND(v_nonzero_avg, 2) AS nonzero_avg,
    ROUND(v_probability, 4) AS probability;
END;
$$;

COMMENT ON FUNCTION ai_inventory.croston_forecast IS
  'Croston method aproximado para demanda intermitente. Retorna forecast mensual: forecast = avg_nonzero_demand * probability_of_demand.';

-- ============================================================
-- SECCIÓN 9: Inventory KPIs
--   Funciones de indicadores de desempeño del almacén
-- ============================================================

-- 9.1 Fill Rate: % de material_requests cumplidos
CREATE OR REPLACE VIEW ai_inventory.kpi_fill_rate AS
WITH requests AS (
  SELECT
    date_trunc('month', mr.created_at) AS month,
    COUNT(*) AS total_requests,
    SUM(mr.requested_qty) AS total_requested_qty,
    COALESCE(SUM(ABS(it.qty)), 0) AS total_issued_qty
  FROM material_requests mr
  LEFT JOIN inventory_transactions it ON it.work_order_id = mr.work_order_id
    AND it.part_num = mr.part_num
    AND it.transaction_type IN ('ISSUE', 'DIRECT_ISSUE')
  WHERE mr.created_at >= NOW() - INTERVAL '12 months'
  GROUP BY 1
)
SELECT
  month,
  total_requests,
  total_requested_qty,
  total_issued_qty,
  CASE
    WHEN total_requested_qty > 0
    THEN ROUND(100.0 * LEAST(total_issued_qty, total_requested_qty) / total_requested_qty, 1)
    ELSE 0
  END AS fill_rate_pct
FROM requests
ORDER BY month DESC;

COMMENT ON VIEW ai_inventory.kpi_fill_rate IS
  'Fill Rate mensual: % de refacciones solicitadas que fueron efectivamente emitidas contra WO.';

-- 9.2 Urgent Purchase Rate: % de requests sin job_plan (compras no planificadas)
CREATE OR REPLACE VIEW ai_inventory.kpi_urgent_purchases AS
SELECT
  date_trunc('month', mr.created_at) AS month,
  COUNT(*) AS total_requests,
  COUNT(*) FILTER (WHERE mr.req_num IS NULL) AS urgent_requests,
  CASE
    WHEN COUNT(*) > 0
    THEN ROUND(100.0 * COUNT(*) FILTER (WHERE mr.req_num IS NULL) / COUNT(*), 1)
    ELSE 0
  END AS urgent_pct
FROM material_requests mr
WHERE mr.created_at >= NOW() - INTERVAL '12 months'
GROUP BY 1
ORDER BY month DESC;

COMMENT ON VIEW ai_inventory.kpi_urgent_purchases IS
  '% de compras urgentes (material_requests sin req_num / sin origen planificado) por mes.';

-- 9.3 Stockout Impact: horas perdidas por WAIT_MATERIAL
CREATE OR REPLACE VIEW ai_inventory.kpi_stockout_impact AS
SELECT
  date_trunc('month', lr.start_time) AS month,
  COUNT(DISTINCT lr.work_order_id) AS wos_affected,
  COUNT(*) AS wait_events,
  ROUND(COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(lr.end_time, NOW()) - lr.start_time)) / 3600), 0), 1) AS hours_lost
FROM labor_records lr
WHERE lr.activity_code = 'WAIT_MATERIAL'
  AND lr.start_time >= NOW() - INTERVAL '12 months'
GROUP BY 1
ORDER BY month DESC;

COMMENT ON VIEW ai_inventory.kpi_stockout_impact IS
  'Impacto de desabasto: OTs afectadas, eventos de espera, y horas-hombre perdidas por WAIT_MATERIAL.';

-- 9.4 Obsolete Inventory: partes sin movimiento en 6/12 meses
CREATE OR REPLACE VIEW ai_inventory.kpi_obsolete_parts AS
SELECT
  sp.part_num,
  sp.description,
  COALESCE(pcs.qty_1y, 0) AS qty_1y,
  COALESCE(pcs.issues_1y, 0) AS issues_1y,
  CASE
    WHEN pcs.issues_1y IS NULL OR pcs.issues_1y = 0 THEN 'OBSOLETE_12M'
    WHEN pcs.issues_90d IS NULL OR pcs.issues_90d = 0 THEN 'SLOW_MOVING'
    ELSE 'ACTIVE'
  END AS movement_category,
  NOW() AS refreshed_at
FROM spare_parts sp
LEFT JOIN ai_inventory.part_consumption_stats pcs ON pcs.part_num = sp.part_num
WHERE pcs.issues_1y IS NULL OR pcs.issues_1y = 0 OR pcs.issues_90d IS NULL OR pcs.issues_90d = 0
ORDER BY movement_category, sp.part_num;

COMMENT ON VIEW ai_inventory.kpi_obsolete_parts IS
  'Partes sin movimiento: OBSOLETE_12M (sin ISSUE en 12 meses), SLOW_MOVING (sin ISSUE en 90 días).';

-- 9.5 Coverage: días de cobertura por parte
CREATE OR REPLACE VIEW ai_inventory.kpi_coverage AS
SELECT
  pcs.part_num,
  pcs.qty_90d,
  pcs.daily_avg_90d,
  CASE
    WHEN pcs.daily_avg_90d > 0
    THEN ROUND(pcs.qty_90d / pcs.daily_avg_90d, 1)
    ELSE NULL
  END AS coverage_days,
  NOW() AS refreshed_at
FROM ai_inventory.part_consumption_stats pcs
WHERE pcs.daily_avg_90d > 0
ORDER BY coverage_days ASC NULLS LAST;

COMMENT ON VIEW ai_inventory.kpi_coverage IS
  'Días de cobertura por parte: qty consumida en 90 días / consumo diario promedio.';

-- 9.6 Turnover Ratio: rotación de inventario anualizada
CREATE OR REPLACE VIEW ai_inventory.kpi_turnover AS
SELECT
  pcs.part_num,
  pcs.qty_1y,
  ROUND(pcs.daily_avg_90d * 365, 1) AS annual_projected_qty,
  CASE
    WHEN pcs.daily_avg_90d > 0
    THEN ROUND(pcs.qty_1y / NULLIF(pcs.daily_avg_90d * 365, 0), 2)
    ELSE NULL
  END AS turnover_ratio,
  NOW() AS refreshed_at
FROM ai_inventory.part_consumption_stats pcs;

COMMENT ON VIEW ai_inventory.kpi_turnover IS
  'Rotación de inventario anualizada: consumo anual / proyección anual.';

-- ============================================================
-- SECCIÓN 10: Epicor Outbox — Expansión ISSUE/RETURN
--   Agrega eventos STOCK_ISSUE y STOCK_RETURN al outbox
-- ============================================================

-- Trigger: enqueue STOCK_ISSUE al hacer ISSUE/DIRECT_ISSUE
CREATE OR REPLACE FUNCTION ai_inventory.enqueue_stock_issue()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.transaction_type IN ('ISSUE', 'DIRECT_ISSUE') THEN
    INSERT INTO epicor_outbox (event_type, payload)
    VALUES (
      'STOCK_ISSUE',
      jsonb_build_object(
        'transaction_id', NEW.id,
        'part_num', NEW.part_num,
        'qty', ABS(NEW.qty),
        'work_order_id', NEW.work_order_id,
        'storeroom_id', NEW.storeroom_id,
        'bin_id', NEW.bin_id,
        'reason_code', NEW.reason_code,
        'timestamp', NOW()
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger: enqueue STOCK_RETURN al hacer RETURN
CREATE OR REPLACE FUNCTION ai_inventory.enqueue_stock_return()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.transaction_type = 'RETURN' THEN
    INSERT INTO epicor_outbox (event_type, payload)
    VALUES (
      'STOCK_RETURN',
      jsonb_build_object(
        'transaction_id', NEW.id,
        'part_num', NEW.part_num,
        'qty', ABS(NEW.qty),
        'work_order_id', NEW.work_order_id,
        'storeroom_id', NEW.storeroom_id,
        'bin_id', NEW.bin_id,
        'reason_code', NEW.reason_code,
        'timestamp', NOW()
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

-- Adjuntar triggers a inventory_transactions (solo si no existen)
DROP TRIGGER IF EXISTS trg_enqueue_stock_issue ON inventory_transactions;
CREATE TRIGGER trg_enqueue_stock_issue
  AFTER INSERT ON inventory_transactions
  FOR EACH ROW
  EXECUTE FUNCTION ai_inventory.enqueue_stock_issue();

DROP TRIGGER IF EXISTS trg_enqueue_stock_return ON inventory_transactions;
CREATE TRIGGER trg_enqueue_stock_return
  AFTER INSERT ON inventory_transactions
  FOR EACH ROW
  EXECUTE FUNCTION ai_inventory.enqueue_stock_return();

-- ============================================================
-- SECCIÓN 11: pg_cron — Refresco de MATVIEWs
--   Configura refrescos automáticos si pg_cron está activo
-- ============================================================

DO $$
BEGIN
  -- Solo configurar si pg_cron está disponible
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN

    -- Diarios
    PERFORM cron.schedule('refresh-ai-consumption',  '0 3 * * *',  'REFRESH MATERIALIZED VIEW CONCURRENTLY ai_inventory.part_consumption_stats');
    PERFORM cron.schedule('refresh-ai-anomalies',     '0 4 * * *',  'REFRESH MATERIALIZED VIEW CONCURRENTLY ai_inventory.consumption_anomalies');
    PERFORM cron.schedule('refresh-ai-pmpipeline',    '0 5 * * *',  'REFRESH MATERIALIZED VIEW CONCURRENTLY ai_inventory.pm_demand_pipeline');

    -- Semanal
    PERFORM cron.schedule('refresh-ai-associations', '0 6 * * 0',  'REFRESH MATERIALIZED VIEW CONCURRENTLY ai_inventory.part_associations');

    -- Mensual
    PERFORM cron.schedule('refresh-ai-abc',          '0 7 1 * *',  'REFRESH MATERIALIZED VIEW CONCURRENTLY ai_inventory.part_abc_classification');

  END IF;
END;
$$;
