/**
 * useDiagnosisFeedback — Hook para feedback de diagnósticos
 *
 * Permite enviar y consultar feedback técnico sobre diagnósticos
 * de condición desde la tabla condition_diagnosis_feedback.
 *
 * Responsabilidades:
 *  - Fetch feedback existente por diagnosis_id
 *  - submitFeedback: INSERT en condition_diagnosis_feedback
 *  - Retorno memoizado con useMemo
 *
 * submitFeedback data shape:
 *   { diagnosis_id, work_order_id?, feedback_status,
 *     actual_failure_mode?, actual_component?, actual_cause?,
 *     technician_observation?, recommendation_usefulness? }
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

// ─── Helpers ────────────────────────────────────────────────────

async function getCurrentUserEmail() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user?.email || session?.user?.id || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * @param {Object} [options]
 * @param {string} [options.diagnosisId] — ID del diagnóstico a consultar
 * @returns {Object} { feedback, submitFeedback, loading, error, refresh }
 */
export function useDiagnosisFeedback({ diagnosisId } = {}) {
  const [feedback, setFeedback] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchFeedback = useCallback(async (diagId) => {
    if (!diagId) {
      setFeedback([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: dbError } = await supabase
        .from('condition_diagnosis_feedback')
        .select('*')
        .eq('diagnosis_id', diagId)
        .order('created_at', { ascending: false });

      if (dbError) throw new Error(dbError.message);
      setFeedback(data || []);
    } catch (err) {
      setError(err.message);
      console.warn('[useDiagnosisFeedback] Error fetching:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch automático si se proporciona diagnosisId
  useEffect(() => {
    if (diagnosisId) {
      fetchFeedback(diagnosisId);
    }
  }, [diagnosisId, fetchFeedback]);

  // ─── submitFeedback ───────────────────────────────────────────
  const submitFeedback = useCallback(async (data) => {
    setError(null);

    if (!data.diagnosis_id) {
      throw new Error('diagnosis_id es requerido');
    }
    if (!data.feedback_status) {
      throw new Error('feedback_status es requerido');
    }

    const email = await getCurrentUserEmail();

    const payload = {
      diagnosis_id: data.diagnosis_id,
      work_order_id: data.work_order_id || null,
      feedback_status: data.feedback_status,
      actual_failure_mode: data.actual_failure_mode || null,
      actual_component: data.actual_component || null,
      actual_cause: data.actual_cause || null,
      technician_observation: data.technician_observation || null,
      was_recommendation_useful: null,
      recommendation_usefulness: data.recommendation_usefulness || null,
      reviewed_by: email,
      reviewed_at: new Date().toISOString(),
    };

    const { data: inserted, error: dbError } = await supabase
      .from('condition_diagnosis_feedback')
      .insert(payload)
      .select()
      .single();

    if (dbError) throw new Error(dbError.message);

    // Refresh local list
    if (data.diagnosis_id) {
      await fetchFeedback(data.diagnosis_id);
    }

    return inserted;
  }, [fetchFeedback]);

  // ─── Resultado memoizado ──────────────────────────────────────
  const result = useMemo(
    () => ({
      feedback,
      submitFeedback,
      loading,
      error,
      refresh: () => diagnosisId && fetchFeedback(diagnosisId),
    }),
    [feedback, submitFeedback, loading, error, diagnosisId, fetchFeedback]
  );

  return result;
}

export default useDiagnosisFeedback;
