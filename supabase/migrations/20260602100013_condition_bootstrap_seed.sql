-- ============================================================
-- MIGRATION: condition_bootstrap_seed — Datos Semilla SDD 3
-- Change: condition-monitoring-detection-estimation (PR 1a)
-- ============================================================
-- Carga datos semilla de condition_windows y condition_feature_values
-- para 2 activos (BANDA-TR-01, TOS-MOT-01) con patrones de
-- operación normal, degradación gradual, cambio escalón,
-- calidad G2/G3 y calidad mixta.
--
-- También inserta 3 baselines en estado draft como punto de
-- partida para el aprendizaje de líneas base.
--
-- Idempotente: usa ON CONFLICT (external_window_id) DO NOTHING
-- para evitar duplicados en re-ejecución.
--
-- Dependencias:
--   condition_baselines (migración 20260602100012)
--   condition_feature_definitions (SDD 1 — vibration.rms, temperature.bearing)
--   condition_analysis_methods (SDD 1 — rms_velocity_window, window_average)
--   condition_windows (SDD 1)
--   condition_feature_values (SDD 1)
-- ============================================================

-- -----------------------------------------------------------
-- 1. BANDA-TR-01: 27 condition_windows + feature_values
-- -----------------------------------------------------------
DO $$
DECLARE
  v_vib_rms_id UUID;
  v_temp_bearing_id UUID;
  v_window_id UUID;
  v_ts TIMESTAMPTZ;
  v_i INT;
  v_vib NUMERIC;
  v_temp NUMERIC;
  v_quality TEXT;
  v_ingested_col_exists BOOLEAN;
BEGIN
  -- Resolver IDs de feature definitions
  SELECT id INTO v_vib_rms_id
  FROM public.condition_feature_definitions
  WHERE feature_key = 'vibration.rms';

  SELECT id INTO v_temp_bearing_id
  FROM public.condition_feature_definitions
  WHERE feature_key = 'temperature.bearing';

  IF v_vib_rms_id IS NULL OR v_temp_bearing_id IS NULL THEN
    RAISE EXCEPTION 'Feature definitions no encontradas: vibration.rms o temperature.bearing';
  END IF;

  -- Verificar si condition_windows tiene columna ingested_by
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'condition_windows'
      AND column_name = 'ingested_by'
  ) INTO v_ingested_col_exists;

  -- ========================================================
  -- BLOQUE 1: BANDA-TR-01 — Normal FULL_LOAD (10 ventanas)
  --   Operación nominal ISO zona A. vibration.rms ~2.3±0.3
  --   temperature.bearing ~61±3°C
  --   Calidad: G0
  -- ========================================================
  FOR v_i IN 1..10 LOOP
    v_ts := NOW() - (60 - v_i) * INTERVAL '30 minutes';
    v_vib := 2.3 + (random() - 0.5) * 0.6;   -- ~2.0-2.6
    v_temp := 61 + (random() - 0.5) * 6;      -- ~58-64
    v_quality := 'G0';

    INSERT INTO public.condition_windows (
      external_window_id, asset_id, source_id, source_type,
      window_start, window_end,
      operational_context, status
    ) VALUES (
      'bootstrap_sdd3:BANDA-TR-01:full_load:normal:' || v_i,
      'BANDA-TR-01', 'bootstrap_sdd3', 'seed',
      v_ts - INTERVAL '30 minutes', v_ts,
      jsonb_build_object(
        'regime', 'FULL_LOAD', 'rpm', 1450 + (random()*100 - 50)::INT,
        'load_pct', 85 + (random()*10 - 5)::INT
      ),
      'processed'
    )
    ON CONFLICT (external_window_id) DO NOTHING
    RETURNING id INTO v_window_id;

    IF v_window_id IS NOT NULL THEN
      INSERT INTO public.condition_feature_values
        (window_id, feature_definition_id, value, unit, quality_flag,
         method_key, method_version)
      VALUES
        (v_window_id, v_vib_rms_id, v_vib, 'mm/s', v_quality,
         'rms_velocity_window', '1.0.0');

      INSERT INTO public.condition_feature_values
        (window_id, feature_definition_id, value, unit, quality_flag,
         method_key, method_version)
      VALUES
        (v_window_id, v_temp_bearing_id, v_temp, '°C', v_quality,
         'window_average', '1.0.0');
    END IF;

    v_window_id := NULL;
  END LOOP;

  -- ========================================================
  -- BLOQUE 2: BANDA-TR-01 — Normal PARTIAL_LOAD (5 ventanas)
  --   vibration.rms ~1.8±0.2, temperature.bearing ~51±3°C
  --   Calidad: G0
  -- ========================================================
  FOR v_i IN 1..5 LOOP
    v_ts := NOW() - (50 - v_i) * INTERVAL '30 minutes';
    v_vib := 1.8 + (random() - 0.5) * 0.4;   -- ~1.6-2.0
    v_temp := 51 + (random() - 0.5) * 6;      -- ~48-54
    v_quality := 'G0';

    INSERT INTO public.condition_windows (
      external_window_id, asset_id, source_id, source_type,
      window_start, window_end,
      operational_context, status
    ) VALUES (
      'bootstrap_sdd3:BANDA-TR-01:partial_load:normal:' || v_i,
      'BANDA-TR-01', 'bootstrap_sdd3', 'seed',
      v_ts - INTERVAL '30 minutes', v_ts,
      jsonb_build_object(
        'regime', 'PARTIAL_LOAD', 'rpm', 800 + (random()*100 - 50)::INT,
        'load_pct', 42 + (random()*10 - 5)::INT
      ),
      'processed'
    )
    ON CONFLICT (external_window_id) DO NOTHING
    RETURNING id INTO v_window_id;

    IF v_window_id IS NOT NULL THEN
      INSERT INTO public.condition_feature_values
        (window_id, feature_definition_id, value, unit, quality_flag,
         method_key, method_version)
      VALUES
        (v_window_id, v_vib_rms_id, v_vib, 'mm/s', v_quality,
         'rms_velocity_window', '1.0.0');

      INSERT INTO public.condition_feature_values
        (window_id, feature_definition_id, value, unit, quality_flag,
         method_key, method_version)
      VALUES
        (v_window_id, v_temp_bearing_id, v_temp, '°C', v_quality,
         'window_average', '1.0.0');
    END IF;

    v_window_id := NULL;
  END LOOP;

  -- ========================================================
  -- BLOQUE 3: BANDA-TR-01 — Degradación gradual FULL_LOAD (5 ventanas)
  --   vibration.rms 2.4→2.9 (lineal), temp 60→68
  --   Calidad: G0 (el aprendizaje no debe incorporar degradación)
  -- ========================================================
  FOR v_i IN 1..5 LOOP
    v_ts := NOW() - (45 - v_i) * INTERVAL '30 minutes';
    v_vib := 2.4 + (v_i - 1) * 0.12 + (random() - 0.5) * 0.1;  -- 2.4→2.9
    v_temp := 60 + (v_i - 1) * 2.0 + (random() - 0.5) * 2;     -- 60→68
    v_quality := 'G0';

    INSERT INTO public.condition_windows (
      external_window_id, asset_id, source_id, source_type,
      window_start, window_end,
      operational_context, status
    ) VALUES (
      'bootstrap_sdd3:BANDA-TR-01:full_load:degradation:' || v_i,
      'BANDA-TR-01', 'bootstrap_sdd3', 'seed',
      v_ts - INTERVAL '30 minutes', v_ts,
      jsonb_build_object(
        'regime', 'FULL_LOAD', 'rpm', 1460, 'load_pct', 86
      ),
      'processed'
    )
    ON CONFLICT (external_window_id) DO NOTHING
    RETURNING id INTO v_window_id;

    IF v_window_id IS NOT NULL THEN
      INSERT INTO public.condition_feature_values
        (window_id, feature_definition_id, value, unit, quality_flag,
         method_key, method_version)
      VALUES
        (v_window_id, v_vib_rms_id, v_vib, 'mm/s', v_quality,
         'rms_velocity_window', '1.0.0');

      INSERT INTO public.condition_feature_values
        (window_id, feature_definition_id, value, unit, quality_flag,
         method_key, method_version)
      VALUES
        (v_window_id, v_temp_bearing_id, v_temp, '°C', v_quality,
         'window_average', '1.0.0');
    END IF;

    v_window_id := NULL;
  END LOOP;

  -- ========================================================
  -- BLOQUE 4: BANDA-TR-01 — Cambio escalón FULL_LOAD (2 ventanas)
  --   vibration.rms salta de 2.5→4.0 y se mantiene alto
  --   Calidad: G0 (para probar detección de cambio escalón)
  -- ========================================================
  FOR v_i IN 1..2 LOOP
    v_ts := NOW() - (40 - v_i) * INTERVAL '30 minutes';
    v_vib := CASE v_i WHEN 1 THEN 2.5 + (random() - 0.5) * 0.3
                      ELSE 4.0 + (random() - 0.5) * 0.4 END;
    v_temp := 62 + (random() - 0.5) * 4;
    v_quality := 'G0';

    INSERT INTO public.condition_windows (
      external_window_id, asset_id, source_id, source_type,
      window_start, window_end,
      operational_context, status
    ) VALUES (
      'bootstrap_sdd3:BANDA-TR-01:full_load:step:' || v_i,
      'BANDA-TR-01', 'bootstrap_sdd3', 'seed',
      v_ts - INTERVAL '30 minutes', v_ts,
      jsonb_build_object(
        'regime', 'FULL_LOAD', 'rpm', 1440, 'load_pct', 84
      ),
      'processed'
    )
    ON CONFLICT (external_window_id) DO NOTHING
    RETURNING id INTO v_window_id;

    IF v_window_id IS NOT NULL THEN
      INSERT INTO public.condition_feature_values
        (window_id, feature_definition_id, value, unit, quality_flag,
         method_key, method_version)
      VALUES
        (v_window_id, v_vib_rms_id, v_vib, 'mm/s', v_quality,
         'rms_velocity_window', '1.0.0');

      INSERT INTO public.condition_feature_values
        (window_id, feature_definition_id, value, unit, quality_flag,
         method_key, method_version)
      VALUES
        (v_window_id, v_temp_bearing_id, v_temp, '°C', v_quality,
         'window_average', '1.0.0');
    END IF;

    v_window_id := NULL;
  END LOOP;

  -- ========================================================
  -- BLOQUE 5: BANDA-TR-01 — Calidad G2/G3 FULL_LOAD (5 ventanas)
  --   vibration.rms valores anómalos con calidad degradada
  --   (para probar la política de aprendizaje: G2/G3 excluidos)
  -- ========================================================
  FOR v_i IN 1..5 LOOP
    v_ts := NOW() - (38 - v_i) * INTERVAL '30 minutes';
    v_vib := 3.0 + (random() - 0.5) * 1.5;   -- ~2.25-3.75
    v_temp := 65 + (random() - 0.5) * 8;
    v_quality := CASE WHEN v_i <= 3 THEN 'G2' ELSE 'G3' END;

    INSERT INTO public.condition_windows (
      external_window_id, asset_id, source_id, source_type,
      window_start, window_end,
      operational_context, status
    ) VALUES (
      'bootstrap_sdd3:BANDA-TR-01:full_load:g2g3:' || v_i,
      'BANDA-TR-01', 'bootstrap_sdd3', 'seed',
      v_ts - INTERVAL '30 minutes', v_ts,
      jsonb_build_object(
        'regime', 'FULL_LOAD', 'rpm', 1430, 'load_pct', 82
      ),
      'processed'
    )
    ON CONFLICT (external_window_id) DO NOTHING
    RETURNING id INTO v_window_id;

    IF v_window_id IS NOT NULL THEN
      INSERT INTO public.condition_feature_values
        (window_id, feature_definition_id, value, unit, quality_flag,
         method_key, method_version)
      VALUES
        (v_window_id, v_vib_rms_id, v_vib, 'mm/s', v_quality,
         'rms_velocity_window', '1.0.0');

      INSERT INTO public.condition_feature_values
        (window_id, feature_definition_id, value, unit, quality_flag,
         method_key, method_version)
      VALUES
        (v_window_id, v_temp_bearing_id, v_temp, '°C', v_quality,
         'window_average', '1.0.0');
    END IF;

    v_window_id := NULL;
  END LOOP;

  -- ========================================================
  -- BLOQUE 6: BANDA-TR-01 — Calidad mixta G0/G1 FULL_LOAD (2 ventanas)
  --   Una ventana G0, una G1 (para probar política de quality_filter)
  -- ========================================================
  FOR v_i IN 1..2 LOOP
    v_ts := NOW() - (33 - v_i) * INTERVAL '30 minutes';
    v_vib := 2.4 + (random() - 0.5) * 0.4;
    v_temp := 62 + (random() - 0.5) * 4;
    v_quality := CASE WHEN v_i = 1 THEN 'G0' ELSE 'G1' END;

    INSERT INTO public.condition_windows (
      external_window_id, asset_id, source_id, source_type,
      window_start, window_end,
      operational_context, status
    ) VALUES (
      'bootstrap_sdd3:BANDA-TR-01:full_load:mixed:' || v_i,
      'BANDA-TR-01', 'bootstrap_sdd3', 'seed',
      v_ts - INTERVAL '30 minutes', v_ts,
      jsonb_build_object(
        'regime', 'FULL_LOAD', 'rpm', 1460, 'load_pct', 85
      ),
      'processed'
    )
    ON CONFLICT (external_window_id) DO NOTHING
    RETURNING id INTO v_window_id;

    IF v_window_id IS NOT NULL THEN
      INSERT INTO public.condition_feature_values
        (window_id, feature_definition_id, value, unit, quality_flag,
         method_key, method_version)
      VALUES
        (v_window_id, v_vib_rms_id, v_vib, 'mm/s', v_quality,
         'rms_velocity_window', '1.0.0');

      INSERT INTO public.condition_feature_values
        (window_id, feature_definition_id, value, unit, quality_flag,
         method_key, method_version)
      VALUES
        (v_window_id, v_temp_bearing_id, v_temp, '°C', v_quality,
         'window_average', '1.0.0');
    END IF;

    v_window_id := NULL;
  END LOOP;

  -- ========================================================
  -- BLOQUE 7: TOS-MOT-01 — Normal FULL_LOAD (5 ventanas)
  --   Motor de tostador, electric_motor class
  --   vibration.rms ~1.4±0.2, temperature.bearing ~56±3°C
  --   Calidad: G0
  -- ========================================================
  FOR v_i IN 1..5 LOOP
    v_ts := NOW() - (28 - v_i) * INTERVAL '30 minutes';
    v_vib := 1.4 + (random() - 0.5) * 0.4;   -- ~1.2-1.6
    v_temp := 56 + (random() - 0.5) * 6;      -- ~53-59
    v_quality := 'G0';

    INSERT INTO public.condition_windows (
      external_window_id, asset_id, source_id, source_type,
      window_start, window_end,
      operational_context, status
    ) VALUES (
      'bootstrap_sdd3:TOS-MOT-01:full_load:normal:' || v_i,
      'TOS-MOT-01', 'bootstrap_sdd3', 'seed',
      v_ts - INTERVAL '30 minutes', v_ts,
      jsonb_build_object(
        'regime', 'FULL_LOAD', 'rpm', 1750 + (random()*100 - 50)::INT,
        'load_pct', 88 + (random()*10 - 5)::INT
      ),
      'processed'
    )
    ON CONFLICT (external_window_id) DO NOTHING
    RETURNING id INTO v_window_id;

    IF v_window_id IS NOT NULL THEN
      INSERT INTO public.condition_feature_values
        (window_id, feature_definition_id, value, unit, quality_flag,
         method_key, method_version)
      VALUES
        (v_window_id, v_vib_rms_id, v_vib, 'mm/s', v_quality,
         'rms_velocity_window', '1.0.0');

      INSERT INTO public.condition_feature_values
        (window_id, feature_definition_id, value, unit, quality_flag,
         method_key, method_version)
      VALUES
        (v_window_id, v_temp_bearing_id, v_temp, '°C', v_quality,
         'window_average', '1.0.0');
    END IF;

    v_window_id := NULL;
  END LOOP;

  -- ========================================================
  -- BLOQUE 8: TOS-MOT-01 — Normal PARTIAL_LOAD (3 ventanas)
  --   vibration.rms ~1.0±0.1, temperature.bearing ~46±3°C
  --   Calidad: G0
  -- ========================================================
  FOR v_i IN 1..3 LOOP
    v_ts := NOW() - (23 - v_i) * INTERVAL '30 minutes';
    v_vib := 1.0 + (random() - 0.5) * 0.2;   -- ~0.9-1.1
    v_temp := 46 + (random() - 0.5) * 6;      -- ~43-49
    v_quality := 'G0';

    INSERT INTO public.condition_windows (
      external_window_id, asset_id, source_id, source_type,
      window_start, window_end,
      operational_context, status
    ) VALUES (
      'bootstrap_sdd3:TOS-MOT-01:partial_load:normal:' || v_i,
      'TOS-MOT-01', 'bootstrap_sdd3', 'seed',
      v_ts - INTERVAL '30 minutes', v_ts,
      jsonb_build_object(
        'regime', 'PARTIAL_LOAD', 'rpm', 900 + (random()*100 - 50)::INT,
        'load_pct', 45 + (random()*10 - 5)::INT
      ),
      'processed'
    )
    ON CONFLICT (external_window_id) DO NOTHING
    RETURNING id INTO v_window_id;

    IF v_window_id IS NOT NULL THEN
      INSERT INTO public.condition_feature_values
        (window_id, feature_definition_id, value, unit, quality_flag,
         method_key, method_version)
      VALUES
        (v_window_id, v_vib_rms_id, v_vib, 'mm/s', v_quality,
         'rms_velocity_window', '1.0.0');

      INSERT INTO public.condition_feature_values
        (window_id, feature_definition_id, value, unit, quality_flag,
         method_key, method_version)
      VALUES
        (v_window_id, v_temp_bearing_id, v_temp, '°C', v_quality,
         'window_average', '1.0.0');
    END IF;

    v_window_id := NULL;
  END LOOP;

  -- ========================================================
  -- BLOQUE 9: TOS-MOT-01 — Degradación gradual FULL_LOAD (3 ventanas)
  --   vibration.rms 1.3→1.8 (lineal), temp 55→68
  --   Calidad: G0
  -- ========================================================
  FOR v_i IN 1..3 LOOP
    v_ts := NOW() - (20 - v_i) * INTERVAL '30 minutes';
    v_vib := 1.3 + (v_i - 1) * 0.25 + (random() - 0.5) * 0.1;  -- 1.3→1.8
    v_temp := 55 + (v_i - 1) * 6.5 + (random() - 0.5) * 2;     -- 55→68
    v_quality := 'G0';

    INSERT INTO public.condition_windows (
      external_window_id, asset_id, source_id, source_type,
      window_start, window_end,
      operational_context, status
    ) VALUES (
      'bootstrap_sdd3:TOS-MOT-01:full_load:degradation:' || v_i,
      'TOS-MOT-01', 'bootstrap_sdd3', 'seed',
      v_ts - INTERVAL '30 minutes', v_ts,
      jsonb_build_object(
        'regime', 'FULL_LOAD', 'rpm', 1760, 'load_pct', 90
      ),
      'processed'
    )
    ON CONFLICT (external_window_id) DO NOTHING
    RETURNING id INTO v_window_id;

    IF v_window_id IS NOT NULL THEN
      INSERT INTO public.condition_feature_values
        (window_id, feature_definition_id, value, unit, quality_flag,
         method_key, method_version)
      VALUES
        (v_window_id, v_vib_rms_id, v_vib, 'mm/s', v_quality,
         'rms_velocity_window', '1.0.0');

      INSERT INTO public.condition_feature_values
        (window_id, feature_definition_id, value, unit, quality_flag,
         method_key, method_version)
      VALUES
        (v_window_id, v_temp_bearing_id, v_temp, '°C', v_quality,
         'window_average', '1.0.0');
    END IF;

    v_window_id := NULL;
  END LOOP;

  -- ========================================================
  -- BLOQUE 10: TOS-MOT-01 — Cambio escalón FULL_LOAD (2 ventanas)
  --   vibration.rms 1.5→3.2 (salto), temp normal
  --   Calidad: G0
  -- ========================================================
  FOR v_i IN 1..2 LOOP
    v_ts := NOW() - (17 - v_i) * INTERVAL '30 minutes';
    v_vib := CASE v_i WHEN 1 THEN 1.5 + (random() - 0.5) * 0.3
                      ELSE 3.2 + (random() - 0.5) * 0.4 END;
    v_temp := 57 + (random() - 0.5) * 4;
    v_quality := 'G0';

    INSERT INTO public.condition_windows (
      external_window_id, asset_id, source_id, source_type,
      window_start, window_end,
      operational_context, status
    ) VALUES (
      'bootstrap_sdd3:TOS-MOT-01:full_load:step:' || v_i,
      'TOS-MOT-01', 'bootstrap_sdd3', 'seed',
      v_ts - INTERVAL '30 minutes', v_ts,
      jsonb_build_object(
        'regime', 'FULL_LOAD', 'rpm', 1770, 'load_pct', 89
      ),
      'processed'
    )
    ON CONFLICT (external_window_id) DO NOTHING
    RETURNING id INTO v_window_id;

    IF v_window_id IS NOT NULL THEN
      INSERT INTO public.condition_feature_values
        (window_id, feature_definition_id, value, unit, quality_flag,
         method_key, method_version)
      VALUES
        (v_window_id, v_vib_rms_id, v_vib, 'mm/s', v_quality,
         'rms_velocity_window', '1.0.0');

      INSERT INTO public.condition_feature_values
        (window_id, feature_definition_id, value, unit, quality_flag,
         method_key, method_version)
      VALUES
        (v_window_id, v_temp_bearing_id, v_temp, '°C', v_quality,
         'window_average', '1.0.0');
    END IF;

    v_window_id := NULL;
  END LOOP;

  -- ========================================================
  -- BLOQUE 11: TOS-MOT-01 — Calidad G2/G3 FULL_LOAD (3 ventanas)
  --   (Para probar política de aprendizaje: G2/G3 excluidos)
  -- ========================================================
  FOR v_i IN 1..3 LOOP
    v_ts := NOW() - (15 - v_i) * INTERVAL '30 minutes';
    v_vib := 2.0 + (random() - 0.5) * 1.0;   -- ~1.5-2.5
    v_temp := 60 + (random() - 0.5) * 8;
    v_quality := CASE WHEN v_i <= 2 THEN 'G2' ELSE 'G3' END;

    INSERT INTO public.condition_windows (
      external_window_id, asset_id, source_id, source_type,
      window_start, window_end,
      operational_context, status
    ) VALUES (
      'bootstrap_sdd3:TOS-MOT-01:full_load:g2g3:' || v_i,
      'TOS-MOT-01', 'bootstrap_sdd3', 'seed',
      v_ts - INTERVAL '30 minutes', v_ts,
      jsonb_build_object(
        'regime', 'FULL_LOAD', 'rpm', 1740, 'load_pct', 87
      ),
      'processed'
    )
    ON CONFLICT (external_window_id) DO NOTHING
    RETURNING id INTO v_window_id;

    IF v_window_id IS NOT NULL THEN
      INSERT INTO public.condition_feature_values
        (window_id, feature_definition_id, value, unit, quality_flag,
         method_key, method_version)
      VALUES
        (v_window_id, v_vib_rms_id, v_vib, 'mm/s', v_quality,
         'rms_velocity_window', '1.0.0');

      INSERT INTO public.condition_feature_values
        (window_id, feature_definition_id, value, unit, quality_flag,
         method_key, method_version)
      VALUES
        (v_window_id, v_temp_bearing_id, v_temp, '°C', v_quality,
         'window_average', '1.0.0');
    END IF;

    v_window_id := NULL;
  END LOOP;

  -- ========================================================
  -- BLOQUE 12: TOS-MOT-01 — Calidad mixta G0/G1 FULL_LOAD (2 ventanas)
  -- ========================================================
  FOR v_i IN 1..2 LOOP
    v_ts := NOW() - (12 - v_i) * INTERVAL '30 minutes';
    v_vib := 1.5 + (random() - 0.5) * 0.4;
    v_temp := 57 + (random() - 0.5) * 4;
    v_quality := CASE WHEN v_i = 1 THEN 'G0' ELSE 'G1' END;

    INSERT INTO public.condition_windows (
      external_window_id, asset_id, source_id, source_type,
      window_start, window_end,
      operational_context, status
    ) VALUES (
      'bootstrap_sdd3:TOS-MOT-01:full_load:mixed:' || v_i,
      'TOS-MOT-01', 'bootstrap_sdd3', 'seed',
      v_ts - INTERVAL '30 minutes', v_ts,
      jsonb_build_object(
        'regime', 'FULL_LOAD', 'rpm', 1750, 'load_pct', 88
      ),
      'processed'
    )
    ON CONFLICT (external_window_id) DO NOTHING
    RETURNING id INTO v_window_id;

    IF v_window_id IS NOT NULL THEN
      INSERT INTO public.condition_feature_values
        (window_id, feature_definition_id, value, unit, quality_flag,
         method_key, method_version)
      VALUES
        (v_window_id, v_vib_rms_id, v_vib, 'mm/s', v_quality,
         'rms_velocity_window', '1.0.0');

      INSERT INTO public.condition_feature_values
        (window_id, feature_definition_id, value, unit, quality_flag,
         method_key, method_version)
      VALUES
        (v_window_id, v_temp_bearing_id, v_temp, '°C', v_quality,
         'window_average', '1.0.0');
    END IF;

    v_window_id := NULL;
  END LOOP;

END;
$$;

-- -----------------------------------------------------------
-- 2. BASELINES SEMILLA (3 draft baselines)
--    Insertados después de las ventanas para que existan datos
--    de referencia. Estos baselines son el punto de partida
--    para el aprendizaje de líneas base.
-- -----------------------------------------------------------
DO $$
DECLARE
  v_vib_rms_id UUID;
BEGIN
  SELECT id INTO v_vib_rms_id
  FROM public.condition_feature_definitions
  WHERE feature_key = 'vibration.rms';

  -- 2a. BANDA-TR-01, vibration.rms, rms_velocity_window, FULL_LOAD
  --     mean=2.3, stddev=0.4, sample_count=10 (basado en las 10 ventanas G0)
  INSERT INTO public.condition_baselines
    (asset_id, feature_definition_id, method_key, measurement_point_id,
     regime, rpm_band, load_band,
     mean, stddev, median, mad, p95, p99, sample_count,
     baseline_status, baseline_version, quality_filter, created_by)
  VALUES
    ('BANDA-TR-01', v_vib_rms_id, 'rms_velocity_window', NULL,
     'FULL_LOAD', '1000-1500', '75-100%',
     2.3, 0.4, 2.25, 0.35, 3.0, 3.4, 10,
     'draft', 1, 'G0', 'bootstrap_sdd3')
  ON CONFLICT (asset_id, feature_definition_id, method_key, measurement_point_id,
               regime, rpm_band, load_band, baseline_version)
  DO NOTHING;

  -- 2b. BANDA-TR-01, vibration.rms, rms_velocity_window, PARTIAL_LOAD
  --     mean=1.8, stddev=0.3, sample_count=5
  INSERT INTO public.condition_baselines
    (asset_id, feature_definition_id, method_key, measurement_point_id,
     regime, rpm_band, load_band,
     mean, stddev, median, mad, p95, p99, sample_count,
     baseline_status, baseline_version, quality_filter, created_by)
  VALUES
    ('BANDA-TR-01', v_vib_rms_id, 'rms_velocity_window', NULL,
     'PARTIAL_LOAD', '500-1000', '25-50%',
     1.8, 0.3, 1.75, 0.25, 2.3, 2.5, 5,
     'draft', 1, 'G0', 'bootstrap_sdd3')
  ON CONFLICT (asset_id, feature_definition_id, method_key, measurement_point_id,
               regime, rpm_band, load_band, baseline_version)
  DO NOTHING;

  -- 2c. TOS-MOT-01, vibration.rms, rms_velocity_window, FULL_LOAD
  --     mean=1.4, stddev=0.3, sample_count=5
  INSERT INTO public.condition_baselines
    (asset_id, feature_definition_id, method_key, measurement_point_id,
     regime, rpm_band, load_band,
     mean, stddev, median, mad, p95, p99, sample_count,
     baseline_status, baseline_version, quality_filter, created_by)
  VALUES
    ('TOS-MOT-01', v_vib_rms_id, 'rms_velocity_window', NULL,
     'FULL_LOAD', '1500-2000', '75-100%',
     1.4, 0.3, 1.35, 0.25, 1.9, 2.1, 5,
     'draft', 1, 'G0', 'bootstrap_sdd3')
  ON CONFLICT (asset_id, feature_definition_id, method_key, measurement_point_id,
               regime, rpm_band, load_band, baseline_version)
  DO NOTHING;

END;
$$;

-- ============================================================
-- FIN MIGRATION: condition_bootstrap_seed
-- ============================================================
