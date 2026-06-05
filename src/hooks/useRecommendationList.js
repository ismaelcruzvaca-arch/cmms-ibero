/**
 * useRecommendationList — Hook para lista de recomendaciones
 *
 * Obtiene recomendaciones de mantenimiento desde maintenance_recommendations
 * con JOIN a condition_diagnoses y condition_failure_mode_catalog.
 * Provee acciones de negocio: approve, dismiss, supersede, convertToWO.
 *
 * Responsabilidades:
 *  - Fetch filtrado por status, priority, assetId
 *  - Flatten nested JOIN result into flat recommendation objects
 *  - approveRec: UPDATE status → 'approved'
 *  - dismissRec: UPDATE status → 'dismissed' + reason
 *  - supersedeRec: UPDATE status → 'superseded' + superseded_by
 *  - convertToWO: RPC convert_recommendation_to_wo()
 *  - Retorno memoizado con useMemo
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
 * Flatten joined recommendation rows into flat objects.
 */
function flattenRecommendations(rows) {
  return (rows || []).map((r) => {
    const diag = r.diagnosis || {};
    const fm = diag.failure_mode || {};
    return {
      id: r.id,
      asset_id: diag.asset_id || null,
      diagnosis_id: r.diagnosis_id,
      recommended_action: r.recommended_action,
      priority: r.priority,
      due_window_days: r.due_window_days,
      work_order_type: r.work_order_type,
      requires_confirmation: r.requires_confirmation,
      status: r.status,
      created_at: r.created_at,
      reviewed_by: r.reviewed_by,
      reviewed_at: r.reviewed_at,
      dismissed_reason: r.dismissed_reason,
      superseded_by: r.superseded_by,
      work_order_id: r.work_order_id,
      failure_mode_key: fm.failure_mode_key || null,
      failure_mode_name: fm.name || null,
      diagnosis_confidence: diag.confidence || null,
      diagnosis_status: diag.diagnosis_status || null,
    };
  });
}

// ─── Constantes ─────────────────────────────────────────────────
const DEFAULT_FILTER = {
  status: ['suggested', 'review_required'],
  priority: null,
  assetId: null,
};

/**
 * @param {Object} [options]
 * @param {string} [options.assetId] — Filtrar por activo
 * @returns {Object} { recommendations, loading, error, filter, setFilter, approveRec, dismissRec, supersedeRec, convertToWO, refresh }
 */
export function useRecommendationList({ assetId } = {}) {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilterState] = useState({
    ...DEFAULT_FILTER,
    assetId: assetId || null,
  });

  // Sincronizar assetId externo
  useEffect(() => {
    setFilterState((prev) => {
      if (prev.assetId !== (assetId || null)) {
        return { ...prev, assetId: assetId || null };
      }
      return prev;
    });
  }, [assetId]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from('maintenance_recommendations')
        .select(`
          *,
          diagnosis:condition_diagnoses!inner(
            asset_id,
            diagnosis_status,
            confidence,
            failure_mode:condition_failure_mode_catalog!inner(
              failure_mode_key,
              name
            )
          )
        `)
        .order('created_at', { ascending: false });

      // Filtrar por status (array o single)
      if (filter.status && Array.isArray(filter.status) && filter.status.length > 0) {
        query = query.in('status', filter.status);
      } else if (filter.status && typeof filter.status === 'string') {
        query = query.eq('status', filter.status);
      }

      // Filtrar por prioridad
      if (filter.priority) {
        query = query.eq('priority', filter.priority);
      }

      // Filtrar por activo
      if (filter.assetId) {
        query = query.eq('diagnosis.asset_id', filter.assetId);
      }

      const { data, error: dbError } = await query;

      if (dbError) throw new Error(dbError.message);

      setRecommendations(flattenRecommendations(data));
    } catch (err) {
      setError(err.message);
      console.warn('[useRecommendationList] Error:', err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ─── setFilter — merge partial filter ─────────────────────────
  const setFilter = useCallback((partial) => {
    setFilterState((prev) => ({ ...prev, ...partial }));
  }, []);

  // ─── approveRec ───────────────────────────────────────────────
  const approveRec = useCallback(async (id) => {
    const email = await getCurrentUserEmail();
    const { error: dbError } = await supabase
      .from('maintenance_recommendations')
      .update({
        status: 'approved',
        reviewed_by: email,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (dbError) throw new Error(dbError.message);
    await fetchData();
  }, [fetchData]);

  // ─── dismissRec ───────────────────────────────────────────────
  const dismissRec = useCallback(async (id, reason) => {
    if (!reason || !reason.trim()) {
      throw new Error('El motivo de descarte es obligatorio');
    }
    const email = await getCurrentUserEmail();
    const { error: dbError } = await supabase
      .from('maintenance_recommendations')
      .update({
        status: 'dismissed',
        reviewed_by: email,
        reviewed_at: new Date().toISOString(),
        dismissed_reason: reason.trim(),
      })
      .eq('id', id);

    if (dbError) throw new Error(dbError.message);
    await fetchData();
  }, [fetchData]);

  // ─── supersedeRec ─────────────────────────────────────────────
  const supersedeRec = useCallback(async (id, newRecId) => {
    const { error: dbError } = await supabase
      .from('maintenance_recommendations')
      .update({
        status: 'superseded',
        superseded_by: newRecId,
      })
      .eq('id', id);

    if (dbError) throw new Error(dbError.message);
    await fetchData();
  }, [fetchData]);

  // ─── convertToWO ──────────────────────────────────────────────
  const convertToWO = useCallback(async (id) => {
    const { data, error: dbError } = await supabase
      .rpc('convert_recommendation_to_wo', {
        p_recommendation_id: id,
      });

    if (dbError) throw new Error(dbError.message);
    await fetchData();
    return data; // work_order_id
  }, [fetchData]);

  // ─── Resultado memoizado ──────────────────────────────────────
  const result = useMemo(
    () => ({
      recommendations,
      loading,
      error,
      filter,
      setFilter,
      approveRec,
      dismissRec,
      supersedeRec,
      convertToWO,
      refresh: fetchData,
    }),
    [
      recommendations,
      loading,
      error,
      filter,
      setFilter,
      approveRec,
      dismissRec,
      supersedeRec,
      convertToWO,
      fetchData,
    ]
  );

  return result;
}

export default useRecommendationList;
