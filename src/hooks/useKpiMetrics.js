/**
 * useKpiMetrics.js
 * Fetches 3 KPI views (kpi_mtbf, kpi_mttr, kpi_availability) merged by period_month.
 *
 * Returns: { current, monthly, loading, error, refetch }
 *
 * States: loading, error, empty/insufficient-data, success
 * current: { mtbfHours, mttrHours, availabilityPct, totalWos }
 * monthly: [{ periodMonth, mtbfHours, mttrHours, availabilityPct, woCount }]
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';

/**
 * @param {Object} params
 * @param {string|null} params.assetId
 * @param {string} params.startDate - ISO 8601
 * @param {string} params.endDate - ISO 8601
 * @returns {{ current: Object, monthly: Array, loading: boolean, error: string|null, refetch: () => void }}
 */
export function useKpiMetrics({ assetId, startDate, endDate }) {
  const [current, setCurrent] = useState({
    mtbfHours: null,
    mttrHours: null,
    availabilityPct: null,
    totalWos: 0,
  });
  const [monthly, setMonthly] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const loadingRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (loadingRef.current) return;
    setLoading(true);
    setError(null);
    loadingRef.current = true;

    try {
      // Build base query with filters on period_month
      function buildQuery(view) {
        let q = supabase.from(view).select('*').order('period_month', { ascending: true });
        if (assetId) q = q.eq('asset_id', assetId);
        if (startDate) q = q.gte('period_month', startDate.slice(0, 7) + '-01');
        if (endDate) q = q.lte('period_month', endDate.slice(0, 7) + '-01');
        return q;
      }

      const [mtbfRes, mttrRes, availRes] = await Promise.all([
        buildQuery('kpi_mtbf'),
        buildQuery('kpi_mttr'),
        buildQuery('kpi_availability'),
      ]);

      // Check for errors
      const firstError = [mtbfRes, mttrRes, availRes].find((r) => r.error);
      if (firstError) throw new Error(firstError.error.message);

      const mtbfData = mtbfRes.data || [];
      const mttrData = mttrRes.data || [];
      const availData = availRes.data || [];

      // Merge by period_month
      const monthSet = new Set();
      mtbfData.forEach((r) => monthSet.add(r.period_month));
      mttrData.forEach((r) => monthSet.add(r.period_month));
      availData.forEach((r) => monthSet.add(r.period_month));

      const merged = Array.from(monthSet)
        .sort()
        .map((periodMonth) => {
          const mtbfRow = mtbfData.find((r) => r.period_month === periodMonth);
          const mttrRow = mttrData.find((r) => r.period_month === periodMonth);
          const availRow = availData.find((r) => r.period_month === periodMonth);
          return {
            periodMonth,
            mtbfHours: mtbfRow?.mtbf_hours ?? null,
            mttrHours: mttrRow?.mttr_hours ?? null,
            availabilityPct: availRow?.availability_pct ?? null,
            woCount: mtbfRow?.wo_count ?? 0,
          };
        });

      setMonthly(merged);

      // Compute current (aggregate across all months)
      const validMtbf = mtbfData
        .map((r) => r.mtbf_hours)
        .filter((v) => v != null);
      const validMttr = mttrData
        .map((r) => r.mttr_hours)
        .filter((v) => v != null);
      const validAvail = availData
        .map((r) => r.availability_pct)
        .filter((v) => v != null);

      setCurrent({
        mtbfHours: validMtbf.length > 0
          ? validMtbf.reduce((a, b) => a + b, 0) / validMtbf.length
          : null,
        mttrHours: validMttr.length > 0
          ? validMttr.reduce((a, b) => a + b, 0) / validMttr.length
          : null,
        availabilityPct: validAvail.length > 0
          ? validAvail.reduce((a, b) => a + b, 0) / validAvail.length
          : null,
        totalWos: mtbfData.reduce((sum, r) => sum + (r.wo_count || 0), 0),
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [assetId, startDate, endDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { current, monthly, loading, error, refetch: fetchData };
}

export default useKpiMetrics;
