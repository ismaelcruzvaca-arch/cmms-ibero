/**
 * useMaintenanceHistory.js
 * Fetches work_orders + assets by assetId + dateRange.
 *
 * Returns: { wos, timeline, assetName, loading, error, refetch }
 *
 * States: loading, error, empty, success
 * Timeline aggregates WOs per month for the bar chart.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';

/**
 * @param {Object} params
 * @param {string|null} params.assetId
 * @param {string} params.startDate - ISO 8601
 * @param {string} params.endDate - ISO 8601
 * @returns {{ wos: Array, timeline: Array, assetName: string|null, loading: boolean, error: string|null, refetch: () => void }}
 */
export function useMaintenanceHistory({ assetId, startDate, endDate }) {
  const [wos, setWos] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [assetName, setAssetName] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const loadingRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (loadingRef.current) return;
    setLoading(true);
    setError(null);
    loadingRef.current = true;

    try {
      let query = supabase
        .from('work_orders')
        .select('*, assets(description)')
        .order('created_at', { ascending: true });

      if (assetId) {
        query = query.eq('asset_id', assetId);
      }
      if (startDate) {
        query = query.gte('created_at', startDate);
      }
      if (endDate) {
        query = query.lte('created_at', endDate);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw new Error(fetchError.message);

      const items = data || [];

      // Extract asset name from the first WO's joined asset
      const name =
        items.length > 0 && items[0].assets?.description
          ? items[0].assets.description
          : null;
      setAssetName(name);

      // Build monthly timeline
      const monthMap = {};
      items.forEach((wo) => {
        const d = new Date(wo.created_at);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthMap[key] = (monthMap[key] || 0) + 1;
      });
      const tl = Object.entries(monthMap).map(([month, count]) => ({
        month,
        count,
      }));
      setTimeline(tl);

      setWos(items);
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

  return { wos, timeline, assetName, loading, error, refetch: fetchData };
}

export default useMaintenanceHistory;
