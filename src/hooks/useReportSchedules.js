/**
 * useReportSchedules.js
 * Hook React para administrar report_schedules vía Supabase REST directo.
 *
 * Expone: fetchSchedules, createSchedule, updateSchedule, deleteSchedule, toggleActive
 * Calcula next_run_at desde cron_expression via cron-parser en INSERT.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { CronExpressionParser } from 'cron-parser';
import { supabase } from '../lib/supabaseClient';

// ─────────────────────────────────────────────────────────────
// Helper: parsear error de Supabase a string
// ─────────────────────────────────────────────────────────────
function parseError(err) {
  if (!err) return null;
  if (typeof err === 'string') return err;
  if (err?.message) return err.message;
  if (err?.error_description) return err.error_description;
  return 'Error desconocido en la operación';
}

/**
 * Calcula el próximo next_run_at desde una expresión cron.
 * @param {string} cronExpression — expresión cron de 5 campos
 * @returns {string} ISO string de la próxima ejecución
 */
function computeNextRun(cronExpression) {
  try {
    const interval = CronExpressionParser.parse(cronExpression);
    return interval.next().toISOString();
  } catch {
    // Fallback: 1 hora desde ahora si la expresión es inválida
    return new Date(Date.now() + 60 * 60 * 1000).toISOString();
  }
}

/**
 * @typedef {Object} ScheduleRow
 * @property {string} id
 * @property {string} name
 * @property {string} template_code
 * @property {string} cron_expression
 * @property {string[]} recipients
 * @property {string} subject
 * @property {Object} params
 * @property {boolean} is_active
 * @property {string|null} last_run_at
 * @property {string} next_run_at
 * @property {string} created_at
 * @property {string|null} updated_at
 */

/**
 * Hook CRUD para report_schedules.
 *
 * @returns {{
 *   schedules: ScheduleRow[],
 *   loading: boolean,
 *   error: string|null,
 *   fetchSchedules: () => Promise<void>,
 *   createSchedule: (data: Object) => Promise<void>,
 *   updateSchedule: (id: string, data: Object) => Promise<void>,
 *   deleteSchedule: (id: string) => Promise<void>,
 *   toggleActive: (id: string, isActive: boolean) => Promise<void>,
 * }}
 */
export function useReportSchedules() {
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const safeSetState = useCallback((setter, val) => {
    if (mountedRef.current) setter(val);
  }, []);

  /**
   * Fetch all schedules, ordenados por created_at DESC.
   */
  const fetchSchedules = useCallback(async () => {
    safeSetState(setLoading, true);
    safeSetState(setError, null);
    try {
      const { data, error: dbError } = await supabase
        .from('report_schedules')
        .select('*')
        .order('created_at', { ascending: false });

      if (dbError) {
        safeSetState(setError, parseError(dbError));
        safeSetState(setSchedules, []);
      } else {
        safeSetState(setSchedules, data || []);
      }
    } catch (err) {
      safeSetState(setError, parseError(err));
      safeSetState(setSchedules, []);
    } finally {
      safeSetState(setLoading, false);
    }
  }, [safeSetState]);

  /**
   * Crear un nuevo schedule. Calcula next_run_at desde cron_expression.
   */
  const createSchedule = useCallback(async (data) => {
    safeSetState(setLoading, true);
    safeSetState(setError, null);
    try {
      const nextRun = computeNextRun(data.cron_expression);

      const { error: dbError } = await supabase
        .from('report_schedules')
        .insert({
          name: data.name,
          template_code: data.template_code,
          cron_expression: data.cron_expression,
          recipients: data.recipients,
          subject: data.subject,
          params: data.params || {},
          is_active: data.is_active !== undefined ? data.is_active : true,
          next_run_at: nextRun,
        });

      if (dbError) {
        safeSetState(setError, parseError(dbError));
      } else {
        // Refrescar la lista
        await fetchSchedules();
      }
    } catch (err) {
      safeSetState(setError, parseError(err));
    } finally {
      safeSetState(setLoading, false);
    }
  }, [safeSetState, fetchSchedules]);

  /**
   * Actualizar un schedule existente.
   */
  const updateSchedule = useCallback(async (id, data) => {
    safeSetState(setLoading, true);
    safeSetState(setError, null);
    try {
      const updateData = { ...data };
      // Si cambia cron_expression, recalcular next_run_at
      if (data.cron_expression) {
        updateData.next_run_at = computeNextRun(data.cron_expression);
      }

      const { error: dbError } = await supabase
        .from('report_schedules')
        .update(updateData)
        .eq('id', id);

      if (dbError) {
        safeSetState(setError, parseError(dbError));
      } else {
        await fetchSchedules();
      }
    } catch (err) {
      safeSetState(setError, parseError(err));
    } finally {
      safeSetState(setLoading, false);
    }
  }, [safeSetState, fetchSchedules]);

  /**
   * Eliminar un schedule por id.
   */
  const deleteSchedule = useCallback(async (id) => {
    safeSetState(setLoading, true);
    safeSetState(setError, null);
    try {
      const { error: dbError } = await supabase
        .from('report_schedules')
        .delete()
        .eq('id', id);

      if (dbError) {
        safeSetState(setError, parseError(dbError));
      } else {
        await fetchSchedules();
      }
    } catch (err) {
      safeSetState(setError, parseError(err));
    } finally {
      safeSetState(setLoading, false);
    }
  }, [safeSetState, fetchSchedules]);

  /**
   * Toggle is_active en un schedule.
   */
  const toggleActive = useCallback(async (id, isActive) => {
    safeSetState(setLoading, true);
    safeSetState(setError, null);
    try {
      const { error: dbError } = await supabase
        .from('report_schedules')
        .update({ is_active: isActive })
        .eq('id', id);

      if (dbError) {
        safeSetState(setError, parseError(dbError));
      } else {
        await fetchSchedules();
      }
    } catch (err) {
      safeSetState(setError, parseError(err));
    } finally {
      safeSetState(setLoading, false);
    }
  }, [safeSetState, fetchSchedules]);

  return {
    schedules,
    loading,
    error,
    fetchSchedules,
    createSchedule,
    updateSchedule,
    deleteSchedule,
    toggleActive,
  };
}

export default useReportSchedules;
