/**
 * useMaterialsConsumed.js
 * Fetches materials consumption from the report_materials_consumed view.
 *
 * Returns: { records, loading, error, refetch }
 *
 * States: loading, error, empty, success
 * Filters: assetId (via work_orders sub-query), partNum, date range
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';

/**
 * @param {Object} params
 * @param {string|null} params.assetId
 * @param {string} params.startDate - ISO 8601
 * @param {string} params.endDate - ISO 8601
 * @param {string|null} params.partNum
 * @returns {{ records: Array, loading: boolean, error: string|null, refetch: () => void }}
 */
export function useMaterialsConsumed({ startDate, endDate, assetId, partNum }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const loadingRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (loadingRef.current) return;
    setLoading(true);
    setError(null);
    loadingRef.current = true;

    try {
      // If filtering by asset, resolve work order IDs for that asset first
      let assetWoIds = null;
      if (assetId) {
        const { data: wos, error: woError } = await supabase
          .from('work_orders')
          .select('id')
          .eq('asset_id', assetId);

        if (woError) throw new Error(woError.message);
        assetWoIds = (wos || []).map((wo) => wo.id);

        // No work orders for this asset → empty result
        if (assetWoIds.length === 0) {
          setRecords([]);
          setLoading(false);
          loadingRef.current = false;
          return;
        }
      }

      let query = supabase
        .from('report_materials_consumed')
        .select()
        .order('last_transaction_at', { ascending: false });

      if (assetId && assetWoIds.length > 0) {
        query = query.in('work_order_id', assetWoIds);
      }
      if (partNum) {
        query = query.eq('part_num', partNum);
      }
      if (startDate) {
        query = query.gte('last_transaction_at', startDate);
      }
      if (endDate) {
        query = query.lte('last_transaction_at', endDate);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw new Error(fetchError.message);

      setRecords(data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      // Guard: only reset loading if we didn't early-return from empty asset WOs
      if (loadingRef.current) {
        setLoading(false);
        loadingRef.current = false;
      }
    }
  }, [assetId, partNum, startDate, endDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { records, loading, error, refetch: fetchData };
}

export default useMaterialsConsumed;
