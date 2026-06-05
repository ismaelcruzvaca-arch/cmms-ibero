/**
 * useDashboardMetrics — Hook para métricas del dashboard de condición
 *
 * Obtiene todas las métricas del dashboard en paralelo desde Supabase REST.
 * Separa problemas de activo (diagnósticos, RUL, recs) de problemas de
 * fuente/dato (calidad, fuentes caídas, dead letters).
 *
 * Responsabilidades:
 *  - Fetch de activos críticos (diagnóstico activo + confianza >= 0.7)
 *  - Fetch de diagnósticos abiertos agrupados por modo de falla
 *  - Fetch de top 5 RUL más bajo
 *  - Fetch de recomendaciones pendientes por prioridad
 *  - Fetch de calidad de datos por fuente vía RPC compute_source_quality_stats()
 *  - Fetch de fuentes caídas (sin datos > 24h)
 *  - Fetch de dead letters, feedback pendiente, OTs CBM abiertas
 *  - Retorno memoizado con useMemo
 *
 * Props:
 *  - assetId (opcional): filtra métricas a un activo específico
 *
 * Retorna:
 *  { metrics, loading, error, refetch }
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

// ─── Constantes ────────────────────────────────────────────────
const DIAGNOSIS_OPEN_STATUSES = ['candidate', 'field_trial', 'active'];
const REC_PENDING_STATUSES = ['suggested', 'review_required'];
const STALE_HOURS = 24;

/**
 * @param {Object} [options]
 * @param {string} [options.assetId] — Opcional, scopes métricas a un activo
 * @returns {Object} { metrics, loading, error, refetch }
 */
export function useDashboardMetrics({ assetId } = {}) {
  const [metrics, setMetrics] = useState({
    criticalAssets: 0,
    openDiagnoses: 0,
    openDiagnosesByFM: [],
    topLowestRul: [],
    pendingRecs: 0,
    pendingRecsByPriority: [],
    sourcesQuality: [],
    staleSources: [],
    deadLetterCount: 0,
    feedbackPending: 0,
    cbmWoOpen: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Helper: filtra por assetId si está presente
      const scope = (query, column = 'asset_id') =>
        assetId ? query.eq(column, assetId) : query;

      // ── Ejecutar todas las queries en paralelo ──
      const [
        criticalRes,
        openDiagRes,
        openDiagByFMRes,
        topRulRes,
        pendingRecsRes,
        recsByPriorityRes,
        qualityRes,
        staleRes,
        deadLetterRes,
        feedbackRes,
        cbmWoRes,
      ] = await Promise.all([

        // 1. Activos críticos: diagnosis activa + confianza >= 0.7
        scope(
          supabase
            .from('condition_diagnoses')
            .select('asset_id', { count: 'exact', head: true })
            .eq('diagnosis_status', 'active')
            .gte('confidence', 0.7)
        ),

        // 2. Diagnósticos abiertos: candidate, field_trial, active
        scope(
          supabase
            .from('condition_diagnoses')
            .select('id', { count: 'exact', head: true })
            .in('diagnosis_status', DIAGNOSIS_OPEN_STATUSES)
        ),

        // 3. Diagnósticos abiertos agrupados por failure_mode_key
        (() => {
          let q = supabase
            .from('condition_diagnoses')
            .select(`
              failure_mode:condition_failure_mode_catalog!inner(failure_mode_key)
            `)
            .in('diagnosis_status', DIAGNOSIS_OPEN_STATUSES);
          if (assetId) q = q.eq('asset_id', assetId);
          return q;
        })(),

        // 4. Top 5 RUL más bajo
        scope(
          supabase
            .from('condition_analysis_results')
            .select('asset_id, result_value')
            .eq('analysis_type', 'rul_estimate')
            .order('result_value', { ascending: true })
            .limit(5)
        ),

        // 5. Recomendaciones pendientes
        supabase
          .from('maintenance_recommendations')
          .select('id', { count: 'exact', head: true })
          .in('status', REC_PENDING_STATUSES),

        // 6. Recomendaciones pendientes por prioridad
        supabase
          .from('maintenance_recommendations')
          .select('priority')
          .in('status', REC_PENDING_STATUSES),

        // 7. Calidad de datos por fuente (RPC reutilizable)
        supabase.rpc('compute_source_quality_stats'),

        // 8. Fuentes caídas: sin datos > 24h
        supabase
          .from('condition_sources')
          .select('source_id, name, last_seen_at')
          .lt('last_seen_at', new Date(Date.now() - STALE_HOURS * 3600000).toISOString())
          .order('last_seen_at', { ascending: true }),

        // 9. Dead letters total
        supabase
          .from('condition_ingest_failures')
          .select('id', { count: 'exact', head: true }),

        // 10. Feedback pendiente
        supabase
          .from('condition_diagnosis_feedback')
          .select('id', { count: 'exact', head: true })
          .eq('feedback_status', 'pending'),

        // 11. OTs CBM abiertas (lifecycle_phase NOT IN COMP, CLOSED)
        supabase
          .from('work_orders')
          .select('id', { count: 'exact', head: true })
          .eq('wo_type', 'CBM')
          .not('lifecycle_phase', 'in', '(COMP,CLOSED)'),
      ]);

      // ── Validar errores ──
      if (criticalRes.error)   throw new Error(`Activos críticos: ${criticalRes.error.message}`);
      if (openDiagRes.error)   throw new Error(`Diagnósticos abiertos: ${openDiagRes.error.message}`);
      if (openDiagByFMRes.error) throw new Error(`Diagnósticos por FM: ${openDiagByFMRes.error.message}`);
      if (topRulRes.error)     throw new Error(`RUL: ${topRulRes.error.message}`);
      if (pendingRecsRes.error) throw new Error(`Recs pendientes: ${pendingRecsRes.error.message}`);
      if (recsByPriorityRes.error) throw new Error(`Recs por prioridad: ${recsByPriorityRes.error.message}`);
      if (qualityRes.error)    throw new Error(`Calidad fuentes: ${qualityRes.error.message}`);
      if (staleRes.error)      throw new Error(`Fuentes caídas: ${staleRes.error.message}`);
      if (deadLetterRes.error) throw new Error(`Dead letters: ${deadLetterRes.error.message}`);
      if (feedbackRes.error)   throw new Error(`Feedback: ${feedbackRes.error.message}`);
      if (cbmWoRes.error)      throw new Error(`OTs CBM: ${cbmWoRes.error.message}`);

      // ── Procesar diagnósticos por modo de falla ──
      const fmCount = {};
      for (const d of openDiagByFMRes.data || []) {
        const key = d.failure_mode?.failure_mode_key || 'unknown';
        fmCount[key] = (fmCount[key] || 0) + 1;
      }
      const openDiagnosesByFM = Object.entries(fmCount)
        .map(([failure_mode_key, count]) => ({ failure_mode_key, count }))
        .sort((a, b) => b.count - a.count);

      // ── Procesar recomendaciones por prioridad ──
      const priorityCount = {};
      for (const r of recsByPriorityRes.data || []) {
        const p = r.priority || 'unknown';
        priorityCount[p] = (priorityCount[p] || 0) + 1;
      }
      const pendingRecsByPriority = Object.entries(priorityCount)
        .map(([priority, count]) => ({ priority, count }))
        .sort((a, b) => b.count - a.count);

      // ── Procesar fuentes caídas con horas desde último dato ──
      const now = Date.now();
      const staleSources = (staleRes.data || []).map((s) => ({
        source_id: s.source_id,
        name: s.name,
        hours_since_last_data: s.last_seen_at
          ? Math.round((now - new Date(s.last_seen_at).getTime()) / 3600000)
          : null,
      }));

      setMetrics({
        criticalAssets: criticalRes.count || 0,
        openDiagnoses: openDiagRes.count || 0,
        openDiagnosesByFM,
        topLowestRul: topRulRes.data || [],
        pendingRecs: pendingRecsRes.count || 0,
        pendingRecsByPriority,
        sourcesQuality: qualityRes.data || [],
        staleSources,
        deadLetterCount: deadLetterRes.count || 0,
        feedbackPending: feedbackRes.count || 0,
        cbmWoOpen: cbmWoRes.count || 0,
      });
    } catch (err) {
      setError(err.message);
      console.warn('[useDashboardMetrics] Error:', err);
    } finally {
      setLoading(false);
    }
  }, [assetId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const result = useMemo(
    () => ({ metrics, loading, error, refetch: fetchData }),
    [metrics, loading, error, fetchData]
  );

  return result;
}

export default useDashboardMetrics;
