/**
 * useLaborHoursReport.js
 * Fetches labor_records + user_profiles, aggregates client-side by technician × activity_code.
 *
 * Returns: { records, grandTotal, loading, error, refetch }
 *
 * records: [{ technicianId, technicianName, activityBreakdown: { code → hours }, totalHours }]
 * grandTotal: number (sum of all hours)
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';

/**
 * @param {Object} params
 * @param {string|null} params.techId
 * @param {string} params.startDate - ISO 8601
 * @param {string} params.endDate - ISO 8601
 * @returns {{ records: Array, grandTotal: number, loading: boolean, error: string|null, refetch: () => void }}
 */
export function useLaborHoursReport({ techId, startDate, endDate }) {
  const [records, setRecords] = useState([]);
  const [grandTotal, setGrandTotal] = useState(0);
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
        .from('labor_records')
        .select('*, user_profiles(full_name)')
        .order('start_time', { ascending: true });

      if (techId) {
        query = query.eq('technician_id', techId);
      }
      if (startDate) {
        query = query.gte('start_time', startDate);
      }
      if (endDate) {
        query = query.lte('start_time', endDate);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw new Error(fetchError.message);

      const items = data || [];

      // Aggregate by technician_id → activity_code
      const techMap = {};
      items.forEach((lr) => {
        const techIdKey = lr.technician_id;
        const actCode = lr.activity_code || 'SIN CÓDIGO';
        const hours = Number(lr.total_hours) || 0;

        if (!techMap[techIdKey]) {
          techMap[techIdKey] = {
            technicianId: techIdKey,
            technicianName:
              lr.user_profiles?.full_name || `Técnico ${techIdKey}`,
            activityBreakdown: {},
            totalHours: 0,
          };
        }

        techMap[techIdKey].activityBreakdown[actCode] =
          (techMap[techIdKey].activityBreakdown[actCode] || 0) + hours;
        techMap[techIdKey].totalHours += hours;
      });

      const techRecords = Object.values(techMap);
      const total = techRecords.reduce((sum, r) => sum + r.totalHours, 0);

      setRecords(techRecords);
      setGrandTotal(total);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [techId, startDate, endDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { records, grandTotal, loading, error, refetch: fetchData };
}

export default useLaborHoursReport;
