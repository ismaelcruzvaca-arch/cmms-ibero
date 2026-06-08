/**
 * useChecklistEvidence.js
 * Fetches COMPLETED checklist instances with item responses and photo
 * evidence. Computes aggregated PASS/FAIL/NA counts and photo count.
 *
 * Filters: date range (completed_at), technician_id (optional),
 *          template_id (optional).
 *
 * Returns: { instances, summary, loading, error, refetch }
 *   - instances: array of checklist_instances with embedded
 *                user_profiles(full_name) and checklist_item_responses
 *   - summary: { totalInstances, passCount, failCount, naCount, withPhotoCount }
 *
 * States: loading, error, empty, success
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';

/**
 * Compute aggregated summary counts from an array of checklist instances.
 *
 * @param {Array} instances — checklist instances with checklist_item_responses
 * @returns {{ totalInstances: number, passCount: number, failCount: number, naCount: number, withPhotoCount: number }}
 */
function computeSummary(instances) {
  let passCount = 0;
  let failCount = 0;
  let naCount = 0;
  let withPhotoCount = 0;

  for (const instance of instances) {
    const responses = instance.checklist_item_responses;
    if (!responses) continue;

    for (const response of responses) {
      switch (response.status) {
        case 'PASS':
          passCount++;
          break;
        case 'FAIL':
          failCount++;
          break;
        case 'NA':
          naCount++;
          break;
        // SKIPPED status is not counted
      }
      if (response.photo_url) {
        withPhotoCount++;
      }
    }
  }

  return {
    totalInstances: instances.length,
    passCount,
    failCount,
    naCount,
    withPhotoCount,
  };
}

/**
 * @param {Object} params
 * @param {string} params.startDate - ISO 8601
 * @param {string} params.endDate - ISO 8601
 * @param {string|null} [params.techId]
 * @param {string|null} [params.templateId]
 * @returns {{
 *   instances: Array,
 *   summary: { totalInstances: number, passCount: number, failCount: number, naCount: number, withPhotoCount: number },
 *   loading: boolean,
 *   error: string|null,
 *   refetch: () => void
 * }}
 */
export function useChecklistEvidence({ startDate, endDate, techId, templateId } = {}) {
  const [instances, setInstances] = useState([]);
  const [summary, setSummary] = useState({
    totalInstances: 0,
    passCount: 0,
    failCount: 0,
    naCount: 0,
    withPhotoCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const loadingRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (loadingRef.current) return;
    setLoading(true);
    setError(null);
    loadingRef.current = true;

    try {
      let q = supabase
        .from('checklist_instances')
        .select(
          '*, user_profiles!checklist_instances_technician_id_fkey(full_name), checklist_item_responses(*)'
        )
        .eq('status', 'COMPLETED');

      if (startDate) q = q.gte('completed_at', startDate);
      if (endDate) q = q.lte('completed_at', endDate);
      if (techId) q = q.eq('technician_id', techId);
      if (templateId) q = q.eq('checklist_template_id', templateId);

      q = q.order('completed_at', { ascending: false });

      const { data, error: queryError } = await q;
      if (queryError) throw new Error(queryError.message);

      const result = data || [];
      setInstances(result);
      setSummary(computeSummary(result));
    } catch (err) {
      setError(err.message || 'Error al cargar evidencia de checklists');
      setInstances([]);
      setSummary({
        totalInstances: 0,
        passCount: 0,
        failCount: 0,
        naCount: 0,
        withPhotoCount: 0,
      });
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [startDate, endDate, techId, templateId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    instances,
    summary,
    loading,
    error,
    refetch: fetchData,
  };
}

export default useChecklistEvidence;
