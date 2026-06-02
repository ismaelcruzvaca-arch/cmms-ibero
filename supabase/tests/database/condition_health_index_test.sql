-- =============================================================================
-- Condition Health Index & Degradation Velocity — Test Suite (pgTAP)
-- PR 2c: compute_health_index() + compute_degradation_velocity()
--
-- Assertions: zone mapping (A/B/C/D), quality modifiers (G0/G1/G2/G3),
--   G3-only edge case (NULL HI), analysis_results storage,
--   degradation velocity (<5pts NULL, ≥5pts valid, low R² no storage) (~18)
--
-- Threshold usado: genérico (asset_class=NULL):
--   zone_a_max=1.8, zone_b_max=4.5, zone_c_max=7.1
--
-- Ejecutar (con pgTAP instalado):
--   supabase db test --file supabase/tests/database/condition_health_index_test.sql
-- =============================================================================

BEGIN;

SELECT plan(18);

-- =============================================================================
-- 1. FUNCTION EXISTENCE
-- =============================================================================
SELECT has_function('public', 'compute_health_index',
  ARRAY['text', 'timestamptz', 'text'],
  'compute_health_index(TEXT, TIMESTAMPTZ, TEXT) existe');

SELECT has_function('public', 'compute_degradation_velocity',
  ARRAY['text', 'integer'],
  'compute_degradation_velocity(TEXT, INT) existe');

-- =============================================================================
-- 2. ZONE MAPPING: Zone A — value ≤ zone_a_max → h = 1.0
--    Valor=1.0 ≤ 1.8, G0 → HI esperado = 1.0
-- =============================================================================
INSERT INTO public.condition_windows
  (external_window_id, asset_id, source_id, source_type, window_start, window_end,
   operational_context)
VALUES ('tst-hi-zone-a', 'TST-ZA', 'tst-src', 'edge',
  NOW() - INTERVAL '1 hour', NOW(), '{"regime":"FULL_LOAD"}');

INSERT INTO public.condition_feature_values
  (window_id, feature_definition_id, value, unit, quality_flag,
   method_key, method_version, confidence)
SELECT cw.id, fd.id, 1.0, 'mm/s', 'G0',
       'rms_velocity_window', '0.1.0', 1.0
FROM public.condition_windows cw
CROSS JOIN public.condition_feature_definitions fd
WHERE cw.external_window_id = 'tst-hi-zone-a'
  AND fd.feature_key = 'vibration.rms';

SELECT is(
  (SELECT round(health_index::numeric, 4) FROM public.compute_health_index('TST-ZA', NOW(), NULL)),
  1.0000::numeric,
  'Zone A: vibration.rms=1.0 ≤ 1.8 → HI = 1.0'
);

-- =============================================================================
-- 3. ZONE MAPPING: Zone B — midpoint entre 1.8 y 4.5
--    Valor=3.15, G0 → h = 1.0 - 0.3*(3.15-1.8)/(4.5-1.8) = 0.85
-- =============================================================================
INSERT INTO public.condition_windows
  (external_window_id, asset_id, source_id, source_type, window_start, window_end,
   operational_context)
VALUES ('tst-hi-zone-b', 'TST-ZB', 'tst-src', 'edge',
  NOW() - INTERVAL '1 hour', NOW(), '{"regime":"FULL_LOAD"}');

INSERT INTO public.condition_feature_values
  (window_id, feature_definition_id, value, unit, quality_flag,
   method_key, method_version, confidence)
SELECT cw.id, fd.id, 3.15, 'mm/s', 'G0',
       'rms_velocity_window', '0.1.0', 1.0
FROM public.condition_windows cw
CROSS JOIN public.condition_feature_definitions fd
WHERE cw.external_window_id = 'tst-hi-zone-b'
  AND fd.feature_key = 'vibration.rms';

SELECT is(
  (SELECT round(health_index::numeric, 4) FROM public.compute_health_index('TST-ZB', NOW(), NULL)),
  0.8500::numeric,
  'Zone B: vibration.rms=3.15 → HI ≈ 0.85'
);

-- =============================================================================
-- 4. ZONE MAPPING: Zone C — midpoint entre 4.5 y 7.1
--    Valor=5.8, G0 → h = 0.7 - 0.5*(5.8-4.5)/(7.1-4.5) = 0.45
-- =============================================================================
INSERT INTO public.condition_windows
  (external_window_id, asset_id, source_id, source_type, window_start, window_end,
   operational_context)
VALUES ('tst-hi-zone-c', 'TST-ZC', 'tst-src', 'edge',
  NOW() - INTERVAL '1 hour', NOW(), '{"regime":"FULL_LOAD"}');

INSERT INTO public.condition_feature_values
  (window_id, feature_definition_id, value, unit, quality_flag,
   method_key, method_version, confidence)
SELECT cw.id, fd.id, 5.8, 'mm/s', 'G0',
       'rms_velocity_window', '0.1.0', 1.0
FROM public.condition_windows cw
CROSS JOIN public.condition_feature_definitions fd
WHERE cw.external_window_id = 'tst-hi-zone-c'
  AND fd.feature_key = 'vibration.rms';

SELECT is(
  (SELECT round(health_index::numeric, 4) FROM public.compute_health_index('TST-ZC', NOW(), NULL)),
  0.4500::numeric,
  'Zone C: vibration.rms=5.8 → HI ≈ 0.45'
);

-- =============================================================================
-- 5. ZONE MAPPING: Zone D — value > zone_c_max
--    Valor=9.0, G0 → h = max(0, 0.2 - 0.2*(9.0-7.1)/(7.1*0.5)) ≈ 0.0930
-- =============================================================================
INSERT INTO public.condition_windows
  (external_window_id, asset_id, source_id, source_type, window_start, window_end,
   operational_context)
VALUES ('tst-hi-zone-d', 'TST-ZD', 'tst-src', 'edge',
  NOW() - INTERVAL '1 hour', NOW(), '{"regime":"FULL_LOAD"}');

INSERT INTO public.condition_feature_values
  (window_id, feature_definition_id, value, unit, quality_flag,
   method_key, method_version, confidence)
SELECT cw.id, fd.id, 9.0, 'mm/s', 'G0',
       'rms_velocity_window', '0.1.0', 1.0
FROM public.condition_windows cw
CROSS JOIN public.condition_feature_definitions fd
WHERE cw.external_window_id = 'tst-hi-zone-d'
  AND fd.feature_key = 'vibration.rms';

SELECT is(
  (SELECT round(health_index::numeric, 4) FROM public.compute_health_index('TST-ZD', NOW(), NULL)),
  0.0930::numeric,
  'Zone D: vibration.rms=9.0 → HI ≈ 0.093'
);

-- =============================================================================
-- 6. QUALITY MODIFIER: G1 (q=0.8) — feature contribuye normalmente
--    Valor=1.0 (Zone A), G1 → q cancela para single feature, HI=1.0
-- =============================================================================
INSERT INTO public.condition_windows
  (external_window_id, asset_id, source_id, source_type, window_start, window_end,
   operational_context)
VALUES ('tst-hi-g1', 'TST-G1', 'tst-src', 'edge',
  NOW() - INTERVAL '1 hour', NOW(), '{"regime":"FULL_LOAD"}');

INSERT INTO public.condition_feature_values
  (window_id, feature_definition_id, value, unit, quality_flag,
   method_key, method_version, confidence)
SELECT cw.id, fd.id, 1.0, 'mm/s', 'G1',
       'rms_velocity_window', '0.1.0', 1.0
FROM public.condition_windows cw
CROSS JOIN public.condition_feature_definitions fd
WHERE cw.external_window_id = 'tst-hi-g1'
  AND fd.feature_key = 'vibration.rms';

SELECT is(
  (SELECT round(health_index::numeric, 4) FROM public.compute_health_index('TST-G1', NOW(), NULL)),
  1.0000::numeric,
  'Quality G1 (q=0.8): feature en Zone A → HI no nulo, q cancela para un solo feature'
);

-- =============================================================================
-- 7. QUALITY MODIFIER: G2 (q=0.5) — feature contribuye pero con peso reducido
--    Valor=1.0 (Zone A), G2 → q cancela para single feature, HI=1.0
-- =============================================================================
INSERT INTO public.condition_windows
  (external_window_id, asset_id, source_id, source_type, window_start, window_end,
   operational_context)
VALUES ('tst-hi-g2', 'TST-G2', 'tst-src', 'edge',
  NOW() - INTERVAL '1 hour', NOW(), '{"regime":"FULL_LOAD"}');

INSERT INTO public.condition_feature_values
  (window_id, feature_definition_id, value, unit, quality_flag,
   method_key, method_version, confidence)
SELECT cw.id, fd.id, 1.0, 'mm/s', 'G2',
       'rms_velocity_window', '0.1.0', 1.0
FROM public.condition_windows cw
CROSS JOIN public.condition_feature_definitions fd
WHERE cw.external_window_id = 'tst-hi-g2'
  AND fd.feature_key = 'vibration.rms';

SELECT is(
  (SELECT round(health_index::numeric, 4) FROM public.compute_health_index('TST-G2', NOW(), NULL)),
  1.0000::numeric,
  'Quality G2 (q=0.5): feature en Zone A → HI no nulo, q cancela para un solo feature'
);

-- =============================================================================
-- 8. QUALITY MODIFIER: G3 (q=0.0) — feature excluido
--    Todos los features G3 → HI=NULL, confidence=0.0
-- =============================================================================
INSERT INTO public.condition_windows
  (external_window_id, asset_id, source_id, source_type, window_start, window_end,
   operational_context)
VALUES ('tst-hi-g3', 'TST-G3', 'tst-src', 'edge',
  NOW() - INTERVAL '1 hour', NOW(), '{"regime":"FULL_LOAD"}');

INSERT INTO public.condition_feature_values
  (window_id, feature_definition_id, value, unit, quality_flag,
   method_key, method_version, confidence)
SELECT cw.id, fd.id, 1.0, 'mm/s', 'G3',
       'rms_velocity_window', '0.1.0', 0.0
FROM public.condition_windows cw
CROSS JOIN public.condition_feature_definitions fd
WHERE cw.external_window_id = 'tst-hi-g3'
  AND fd.feature_key = 'vibration.rms';

SELECT is(
  (SELECT health_index FROM public.compute_health_index('TST-G3', NOW(), NULL)),
  NULL,
  'G3-only: HI IS NULL (sin features válidas)'
);

SELECT is(
  (SELECT confidence FROM public.compute_health_index('TST-G3', NOW(), NULL)),
  0.0::numeric,
  'G3-only: confidence = 0.0'
);

-- =============================================================================
-- 9. STORAGE: HI se almacena en condition_analysis_results
--    Verificar que la función persiste correctamente el resultado
-- =============================================================================
-- Usamos TST-ZA que ya insertó datos. La función ya corrió en el assert #2.
-- El INSERT dentro de la función ocurrió con SECURITY DEFINER.
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.condition_analysis_results
    WHERE asset_id = 'TST-ZA'
      AND analysis_type = 'health_index'
      AND method_key = 'weighted_health_index'
      AND method_version = '1.0.0'
  ),
  'HI almacenado en condition_analysis_results (analysis_type=health_index)'
);

SELECT is(
  (SELECT result_unit FROM public.condition_analysis_results
   WHERE asset_id = 'TST-ZA' AND analysis_type = 'health_index'
   ORDER BY created_at DESC LIMIT 1),
  'HI',
  'HI almacenado con result_unit = HI'
);

-- =============================================================================
-- 10. DEGRADATION VELOCITY: < 5 puntos → slope=NULL, r_squared=NULL
--     Insertar solo 3 HI results
-- =============================================================================
INSERT INTO public.condition_analysis_results
  (asset_id, analysis_type, method_key, method_version,
   result_value, result_unit, confidence, window_end)
VALUES
  ('TST-DV-FEW', 'health_index', 'weighted_health_index', '1.0.0',
   0.95, 'HI', 1.0, NOW() - INTERVAL '2 days'),
  ('TST-DV-FEW', 'health_index', 'weighted_health_index', '1.0.0',
   0.94, 'HI', 1.0, NOW() - INTERVAL '1 day'),
  ('TST-DV-FEW', 'health_index', 'weighted_health_index', '1.0.0',
   0.93, 'HI', 1.0, NOW());

SELECT is(
  (SELECT slope FROM public.compute_degradation_velocity('TST-DV-FEW', 168)),
  NULL,
  '< 5 puntos: slope IS NULL'
);

SELECT is(
  (SELECT point_count FROM public.compute_degradation_velocity('TST-DV-FEW', 168)),
  3,
  '< 5 puntos: point_count = 3'
);

-- =============================================================================
-- 11. DEGRADATION VELOCITY: ≥ 5 puntos con tendencia perfecta
--     HI = 1.0 - 0.01*days → slope = -0.01 HI/day, R² = 1.0
-- =============================================================================
INSERT INTO public.condition_analysis_results
  (asset_id, analysis_type, method_key, method_version,
   result_value, result_unit, confidence, window_end)
VALUES
  ('TST-DV-OK', 'health_index', 'weighted_health_index', '1.0.0',
   1.00, 'HI', 1.0, NOW() - INTERVAL '4 days'),
  ('TST-DV-OK', 'health_index', 'weighted_health_index', '1.0.0',
   0.99, 'HI', 1.0, NOW() - INTERVAL '3 days'),
  ('TST-DV-OK', 'health_index', 'weighted_health_index', '1.0.0',
   0.98, 'HI', 1.0, NOW() - INTERVAL '2 days'),
  ('TST-DV-OK', 'health_index', 'weighted_health_index', '1.0.0',
   0.97, 'HI', 1.0, NOW() - INTERVAL '1 day'),
  ('TST-DV-OK', 'health_index', 'weighted_health_index', '1.0.0',
   0.96, 'HI', 1.0, NOW());

SELECT is(
  (SELECT round(slope::numeric, 4) FROM public.compute_degradation_velocity('TST-DV-OK', 168)),
  -0.0100::numeric,
  '≥ 5 puntos: slope = -0.01 HI/day (regresión perfecta)'
);

SELECT ok(
  (SELECT r_squared::numeric >= 0.99 FROM public.compute_degradation_velocity('TST-DV-OK', 168)),
  '≥ 5 puntos: R² ≥ 0.99 (tendencia casi perfecta)'
);

-- =============================================================================
-- 12. DEGRADATION VELOCITY: R² < 0.5 → resultado retornado pero NO almacenado
--     Datos ruidosos que producen R² bajo
-- =============================================================================
INSERT INTO public.condition_analysis_results
  (asset_id, analysis_type, method_key, method_version,
   result_value, result_unit, confidence, window_end)
VALUES
  ('TST-DV-LOWR2', 'health_index', 'weighted_health_index', '1.0.0',
   0.95, 'HI', 1.0, NOW() - INTERVAL '4 days'),
  ('TST-DV-LOWR2', 'health_index', 'weighted_health_index', '1.0.0',
   0.93, 'HI', 1.0, NOW() - INTERVAL '3 days'),
  ('TST-DV-LOWR2', 'health_index', 'weighted_health_index', '1.0.0',
   0.97, 'HI', 1.0, NOW() - INTERVAL '2 days'),
  ('TST-DV-LOWR2', 'health_index', 'weighted_health_index', '1.0.0',
   0.94, 'HI', 1.0, NOW() - INTERVAL '1 day'),
  ('TST-DV-LOWR2', 'health_index', 'weighted_health_index', '1.0.0',
   0.96, 'HI', 1.0, NOW());

-- Forzar que el SELECT de la función evalúe el guard R² < 0.5
PERFORM public.compute_degradation_velocity('TST-DV-LOWR2', 168);

SELECT is(
  (SELECT COUNT(*)::int FROM public.condition_analysis_results
   WHERE asset_id = 'TST-DV-LOWR2' AND analysis_type = 'trend_slope'),
  0,
  'R² < 0.5: resultado NO almacenado en analysis_results'
);

-- =============================================================================
-- Finalizar suite pgTAP
-- =============================================================================
SELECT * FROM finish();

ROLLBACK;
