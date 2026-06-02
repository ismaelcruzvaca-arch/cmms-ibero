/**
 * useDiagnoses — Hook para diagnósticos de condición
 *
 * Obtiene diagnósticos activos para un activo desde condition_diagnoses,
 * con JOIN al catálogo de modos de falla, conteo de eventos vinculados,
 * y desglose de confianza desde compute_diagnosis_confidence RPC.
 *
 * Responsabilidades:
 *  - Fetch condition_diagnoses JOIN condition_failure_mode_catalog
 *  - Fetch linked event counts (condition_events WHERE diagnosis_id IS NOT NULL)
 *  - Fetch confidence breakdown via compute_diagnosis_confidence RPC
 *  - Retorno memoizado con useMemo
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

/**
 * @param {Object} options
 * @param {string} options.assetId — ID del activo (obligatorio)
 * @returns {Object} { diagnoses, isLoading, error, refresh }
 */
export function useDiagnoses({ assetId }) {
  const [diagnoses, setDiagnoses] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    if (!assetId) {
      setDiagnoses([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // 1. Fetch diagnoses with failure mode catalog JOIN
      const { data: diagnosesData, error: dError } = await supabase
        .from('condition_diagnoses')
        .select(`
          *,
          failure_mode:condition_failure_mode_catalog!inner(
            name, severity_default, detectability, failure_mode_key
          )
        `)
        .eq('asset_id', assetId)
        .in('diagnosis_status', ['candidate', 'field_trial', 'active'])
        .order('confidence', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });

      if (dError) throw new Error(dError.message);

      const rows = diagnosesData || [];

      // 2. Fetch linked event counts in one batch
      const diagnosisIds = rows.map((d) => d.id);
      let eventCountByDiagnosis = {};

      if (diagnosisIds.length > 0) {
        const { data: events } = await supabase
          .from('condition_events')
          .select('diagnosis_id')
          .in('diagnosis_id', diagnosisIds);

        (events || []).forEach((ev) => {
          eventCountByDiagnosis[ev.diagnosis_id] =
            (eventCountByDiagnosis[ev.diagnosis_id] || 0) + 1;
        });
      }

      // 3. Fetch confidence breakdown per unique failure_mode_key
      const fmKeys = [
        ...new Set(
          rows
            .map((d) => d.failure_mode?.failure_mode_key)
            .filter(Boolean)
        ),
      ];

      const breakdownByKey = {};
      if (fmKeys.length > 0) {
        const breakdownResults = await Promise.all(
          fmKeys.map(async (key) => {
            const { data, error: rpcError } = await supabase
              .rpc('compute_diagnosis_confidence', {
                p_asset_id: assetId,
                p_failure_mode_key: key,
              });
            if (rpcError) {
              console.warn('[useDiagnoses] RPC error for', key, rpcError);
              return { key, breakdown: null };
            }
            return { key, breakdown: data?.[0] || null };
          })
        );
        breakdownResults.forEach((r) => {
          breakdownByKey[r.key] = r.breakdown;
        });
      }

      // 4. Enrich diagnoses with event count and breakdown
      const enriched = rows.map((d) => ({
        ...d,
        linked_event_count: eventCountByDiagnosis[d.id] || 0,
        confidence_breakdown:
          breakdownByKey[d.failure_mode?.failure_mode_key] || null,
      }));

      setDiagnoses(enriched);
    } catch (err) {
      setError(err.message);
      console.warn('[useDiagnoses] Error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [assetId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const result = useMemo(
    () => ({
      diagnoses,
      isLoading,
      error,
      refresh: fetchData,
    }),
    [diagnoses, isLoading, error, fetchData]
  );

  return result;
}

export default useDiagnoses;
