/**
 * useComplianceReport.js
 * Fetches 3 compliance sections in parallel: work permits (expiring/active),
 * active LOTO records, and technician certifications with module info.
 *
 * Returns: { permits, lotoRecords, certs, loading, error, sectionErrors, refetch }
 *
 * States: loading, error (only when ALL 3 fail), empty, success
 * Partial errors: sectionErrors.{permits,loto,certs} set individually.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';

/**
 * @param {Object} params
 * @param {string|null} params.assetId
 * @param {string} params.startDate - ISO 8601
 * @param {string} params.endDate - ISO 8601
 * @param {string|null} params.techId
 * @returns {{
 *   permits: Array,
 *   lotoRecords: Array,
 *   certs: Array,
 *   loading: boolean,
 *   error: string|null,
 *   sectionErrors: { permits: string|null, loto: string|null, certs: string|null },
 *   refetch: () => void
 * }}
 */
export function useComplianceReport({ assetId, startDate, endDate, techId } = {}) {
  const [permits, setPermits] = useState([]);
  const [lotoRecords, setLotoRecords] = useState([]);
  const [certs, setCerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sectionErrors, setSectionErrors] = useState({
    permits: null,
    loto: null,
    certs: null,
  });
  const loadingRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (loadingRef.current) return;
    setLoading(true);
    setError(null);
    setSectionErrors({ permits: null, loto: null, certs: null });
    loadingRef.current = true;

    // Build ISO dates without fractional seconds (avoids dots in filter strings)
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const thirtyDays = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z');

    try {
      // ── 3 parallel queries with individual error isolation ──
      const results = await Promise.allSettled([
        // 1. Work permits: expiring within 30 days OR currently active
        (async () => {
          let q = supabase
            .from('work_permits')
            .select('*, permit_types(code, name)')
            .or(
              `and(expires_at.gte.${now},expires_at.lte.${thirtyDays}),permit_status.eq.ACTIVE`
            )
            .order('expires_at', { ascending: true, nullsFirst: false });

          if (assetId) q = q.eq('asset_id', assetId);

          const { data, error: queryError } = await q;
          if (queryError) throw new Error(queryError.message);
          return data || [];
        })(),

        // 2. Active LOTO records: LOCKED or VERIFIED
        (async () => {
          let q = supabase
            .from('lockout_tagout')
            .select('*')
            .in('loto_status', ['LOCKED', 'VERIFIED'])
            .order('locked_at', { ascending: false });

          if (assetId) q = q.eq('asset_id', assetId);
          if (startDate) q = q.gte('locked_at', startDate);
          if (endDate) q = q.lte('locked_at', endDate);

          const { data, error: queryError } = await q;
          if (queryError) throw new Error(queryError.message);
          return data || [];
        })(),

        // 3. Technician certifications with module info and technician name
        (async () => {
          let q = supabase
            .from('technician_skills')
            .select(
              '*, technological_modules(code, name), user_profiles(full_name)'
            )
            .order('current_level', { ascending: false });

          if (techId) q = q.eq('technician_id', techId);

          const { data, error: queryError } = await q;
          if (queryError) throw new Error(queryError.message);
          return data || [];
        })(),
      ]);

      // ── Process results with partial-error tolerance ──
      const newSectionErrors = { permits: null, loto: null, certs: null };
      const sections = ['permits', 'loto', 'certs'];
      const setData = [setPermits, setLotoRecords, setCerts];

      results.forEach((result, idx) => {
        if (result.status === 'fulfilled') {
          setData[idx](result.value);
        } else {
          const errMsg = result.reason?.message || 'Error desconocido';
          newSectionErrors[sections[idx]] = errMsg;
          setData[idx]([]);
        }
      });

      setSectionErrors(newSectionErrors);

      // Overall error only when ALL 3 failed
      const failedCount = Object.values(newSectionErrors).filter(Boolean).length;
      if (failedCount === 3) {
        setError(
          'No se pudieron cargar los datos de cumplimiento. Verifique su conexión e intente nuevamente.'
        );
      }
    } catch (err) {
      // Catches unexpected errors in the orchestration itself
      setError(err.message || 'Error inesperado al cargar datos de cumplimiento');
      setSectionErrors({ permits: err.message, loto: err.message, certs: err.message });
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, startDate, endDate, techId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    permits,
    lotoRecords,
    certs,
    loading,
    error,
    sectionErrors,
    refetch: fetchData,
  };
}

export default useComplianceReport;
