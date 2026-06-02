/**
 * useFeatureTrends — Hook para datos de tendencias de condición
 *
 * Obtiene datos históricos de condición desde Supabase REST para el
 * componente TrendChart: health_index, feature_values con ventanas,
 * baselines activos y eventos de anomalía.
 *
 * Responsabilidades:
 *  - Fetch condition_analysis_results (health_index) para un activo
 *  - Fetch condition_feature_values JOIN condition_windows para timestamps
 *  - Fetch condition_baselines activo para el activo+feature
 *  - Fetch condition_events para marcadores en timeline
 *  - Filtro por rango de fechas y feature key
 *  - Retorno memoizado con useMemo
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

// ─── Constantes ────────────────────────────────────────────────
const DEFAULT_DAYS = 30;
const MAX_RESULTS = 90;

/**
 * Hook principal de tendencias de condición.
 *
 * @param {Object} options
 * @param {string} options.assetId — ID del activo (obligatorio)
 * @param {string} [options.featureKey] — Feature key a filtrar (opcional, null = HI)
 * @param {number} [options.days=30] — Ventana de días hacia atrás
 * @returns {Object} { hiData, featureData, baseline, events, isLoading, error }
 */
export function useFeatureTrends({ assetId, featureKey, days = DEFAULT_DAYS }) {
  const [hiData, setHiData] = useState([]);
  const [featureData, setFeatureData] = useState([]);
  const [baseline, setBaseline] = useState(null);
  const [events, setEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    if (!assetId) {
      setHiData([]);
      setFeatureData([]);
      setBaseline(null);
      setEvents([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      // 1. Health Index desde condition_analysis_results
      let hiQuery = supabase
        .from('condition_analysis_results')
        .select('*')
        .eq('asset_id', assetId)
        .eq('analysis_type', 'health_index')
        .gte('window_end', since)
        .order('window_end', { ascending: true });

      // 2. Feature values JOIN windows para timestamps
      let fvQuery = supabase
        .from('condition_feature_values')
        .select(`
          *,
          window:condition_windows!inner(window_end, operational_context)
        `)
        .eq('window.asset_id', assetId)
        .gte('window.window_end', since)
        .order('window.window_end', { ascending: true })
        .limit(MAX_RESULTS);

      // Si featureKey está presente, filtrar por feature_definition_id
      if (featureKey) {
        // Obtenemos el feature_definition_id
        const { data: fdData, error: fdErr } = await supabase
          .from('condition_feature_definitions')
          .select('id')
          .eq('feature_key', featureKey)
          .single();

        if (fdErr) throw new Error(`Error al obtener definición de feature: ${fdErr.message}`);
        if (fdData) {
          fvQuery = fvQuery.eq('feature_definition_id', fdData.id);
          hiQuery = hiQuery.eq('feature_definition_id', fdData.id);
        }
      }

      // 3. Baseline activo
      let blQuery = supabase
        .from('condition_baselines')
        .select('*')
        .eq('asset_id', assetId)
        .eq('baseline_status', 'active');

      // 4. Eventos
      let evQuery = supabase
        .from('condition_events')
        .select('*')
        .eq('asset_id', assetId)
        .gte('created_at', since)
        .order('created_at', { ascending: true });

      // Ejecutar consultas en paralelo
      const [hiRes, fvRes, blRes, evRes] = await Promise.all([
        hiQuery,
        fvQuery,
        blQuery,
        evQuery,
      ]);

      if (hiRes.error) throw new Error(`Error HI: ${hiRes.error.message}`);
      if (fvRes.error) throw new Error(`Error feature values: ${fvRes.error.message}`);
      if (blRes.error) throw new Error(`Error baselines: ${blRes.error.message}`);
      if (evRes.error) throw new Error(`Error events: ${evRes.error.message}`);

      setHiData(hiRes.data || []);

      // Procesar feature data para incluir timestamp y regime desde la window
      const processed = (fvRes.data || []).map((fv) => ({
        ...fv,
        timestamp: fv.window?.window_end || null,
        regime: fv.window?.operational_context?.regime || null,
      }));
      setFeatureData(processed);

      setBaseline(blRes.data?.[0] || null);
      setEvents(evRes.data || []);
    } catch (err) {
      setError(err.message);
      console.warn('[useFeatureTrends] Error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [assetId, featureKey, days]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Retorno memoizado
  const result = useMemo(() => ({
    hiData,
    featureData,
    baseline,
    events,
    isLoading,
    error,
    refresh: fetchData,
  }), [hiData, featureData, baseline, events, isLoading, error, fetchData]);

  return result;
}

export default useFeatureTrends;
