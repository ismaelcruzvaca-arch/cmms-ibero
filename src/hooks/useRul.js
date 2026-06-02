/**
 * useRul — Hook para estimación de Vida Útil Remanente (RUL)
 *
 * Obtiene la última estimación RUL desde condition_analysis_results
 * con analysis_type='rul_estimate' para un activo. Formatea el intervalo
 * de incertidumbre y la confianza.
 *
 * Responsabilidades:
 *  - Fetch latest condition_analysis_results WHERE analysis_type = 'rul_estimate'
 *  - Extraer intervalo (rul_low, rul_high) desde parámetros
 *  - Retorno memoizado con useMemo
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

/**
 * @param {Object} options
 * @param {string} options.assetId — ID del activo (obligatorio)
 * @returns {Object} { rulData, isLoading, error, refresh }
 *
 * rulData shape:
 *  - rulDays {number} — RUL estimado en días
 *  - confidence {number} — Confianza de la estimación (0-1)
 *  - rulLow {number} — Límite inferior del intervalo
 *  - rulHigh {number} — Límite superior del intervalo
 *  - failureModeKey {string|null} — Modo de falla asociado
 *  - assumptions {string[]} — Supuestos del modelo
 *  - unit {string} — Unidad de medida
 *  - windowEnd {string} — Timestamp de la ventana
 */
export function useRul({ assetId }) {
  const [rulData, setRulData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    if (!assetId) {
      setRulData(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { data, error: dbError } = await supabase
        .from('condition_analysis_results')
        .select('*')
        .eq('asset_id', assetId)
        .eq('analysis_type', 'rul_estimate')
        .order('window_end', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (dbError) throw new Error(dbError.message);

      if (data) {
        const params = data.parameters || {};
        const rulDays = data.result_value;
        const rulLow = params.rul_low_estimate ?? rulDays * 0.8;
        const rulHigh = params.rul_high_estimate ?? rulDays * 1.2;

        setRulData({
          rulDays,
          confidence: data.confidence,
          rulLow,
          rulHigh,
          failureModeKey: params.failure_mode_key || null,
          assumptions: params.assumptions || [],
          unit: data.result_unit || 'days',
          windowEnd: data.window_end,
        });
      } else {
        setRulData(null);
      }
    } catch (err) {
      setError(err.message);
      console.warn('[useRul] Error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [assetId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const result = useMemo(
    () => ({
      rulData,
      isLoading,
      error,
      refresh: fetchData,
    }),
    [rulData, isLoading, error, fetchData]
  );

  return result;
}

export default useRul;
