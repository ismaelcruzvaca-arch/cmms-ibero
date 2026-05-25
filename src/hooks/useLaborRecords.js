/**
 * Hook personalizado para Labor Records con RxDB
 * Expone records, activeSession, clockIn(), clockOut()
 * Sigue el mismo patrón que useWorkOrders.js
 */
import { useState, useEffect, useCallback } from 'react';
import { initRxDB } from '../lib/rxdb';
import { toViewModelList } from '../lib/adapters/laborAdapter';

/**
 * @param {Object} params
 * @param {string} params.workOrderId - ID de la orden de trabajo
 * @param {string} params.userId - UUID del técnico autenticado
 * @returns {{
 *   records: Array,
 *   activeSession: Object|null,
 *   clockIn: (activityCode: string, notes?: string) => Promise<{success: boolean, error?: string}>,
 *   clockOut: () => Promise<{success: boolean, error?: string}>,
 *   loading: boolean,
 *   error: string|null
 * }}
 */
export function useLaborRecords({ workOrderId, userId }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [db, setDb] = useState(null);

  useEffect(() => {
    let subscription = null;

    const init = async () => {
      try {
        console.log('[useLaborRecords] Iniciando...');

        const database = await initRxDB();
        console.log('[useLaborRecords] DB inicializada:', !!database);

        setDb(database);

        if (!database.labor_records) {
          console.error('[useLaborRecords] Colección labor_records no encontrada');
          setError(new Error('Colección labor_records no encontrada'));
          setLoading(false);
          return;
        }

        const collection = database.labor_records;

        // ── Consulta inicial ──
        try {
          const initialDocs = await collection
            .find({ selector: { work_order_id: workOrderId, _deleted: false } })
            .exec();
          console.log('[useLaborRecords] Docs iniciales:', initialDocs.length);
          setRecords(toViewModelList(initialDocs.map(d => d.toJSON())));
        } catch (queryErr) {
          console.warn('[useLaborRecords] Consulta inicial error:', queryErr);
        }

        // ── Suscripción a cambios reactivos ──
        subscription = collection
          .find({ selector: { work_order_id: workOrderId, _deleted: false } })
          .$.subscribe({
            next: (docs) => {
              try {
                const activeDocs = docs
                  .map(doc => doc.toJSON())
                  .filter(doc => !doc._deleted);
                setRecords(toViewModelList(activeDocs));
              } catch (e) {
                console.error('[useLaborRecords] Error procesando docs:', e);
              }
            },
            error: (err) => {
              console.error('[useLaborRecords] Suscripción error:', err);
            }
          });

        setLoading(false);
        console.log('[useLaborRecords] Completado');

      } catch (err) {
        console.error('[useLaborRecords] Error:', err);
        setError(err);
        setLoading(false);
      }
    }

    init();

    return () => {
      if (subscription) {
        try { subscription.unsubscribe(); } catch { /* ignorado */ }
      }
    };
  }, [workOrderId]);

  // ─── Sesión activa: el registro con end_time IS NULL ───
  const activeSession = records.find(r => r.endTime === null) || null;

  // ─── Clock In ───
  const clockIn = useCallback(async (activityCode, notes) => {
    if (!db) return { error: 'DB no inicializada' };
    if (!workOrderId) return { error: 'workOrderId no proporcionado' };
    if (!userId) return { error: 'userId no proporcionado' };

    try {
      const id = crypto.randomUUID
        ? crypto.randomUUID()
        : 'lr-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

      const now = new Date().toISOString();
      const timestamp = Date.now();

      // 1. INSERT labor_record con end_time = null (sesión activa)
      await db.labor_records.insert({
        id,
        work_order_id: workOrderId,
        technician_id: userId,
        start_time: now,
        activity_code: activityCode,
        notes: notes || null,
        device_timestamp: now,
        end_time: null,
        created_at: now,
        updated_at: timestamp,
        _deleted: false
      });

      // 2. Si el WO está APPROVED, transicionar a INPRG
      const woDoc = await db.work_orders.findOne(workOrderId).exec();
      if (woDoc && woDoc.lifecycle_phase === 'APPROVED') {
        await woDoc.update({
          $set: { lifecycle_phase: 'INPRG', updated_at: Date.now() }
        });
      }

      return { success: true };
    } catch (err) {
      console.error('[useLaborRecords] clockIn error:', err);
      return { error: err.message };
    }
  }, [db, workOrderId, userId]);

  // ─── Clock Out ───
  const clockOut = useCallback(async () => {
    if (!db) return { error: 'DB no inicializada' };
    if (!workOrderId) return { error: 'workOrderId no proporcionado' };
    if (!userId) return { error: 'userId no proporcionado' };

    try {
      const collection = db.labor_records;

      // Buscar sesión activa para este WO + técnico
      const docs = await collection
        .find({
          selector: {
            work_order_id: workOrderId,
            technician_id: userId,
            end_time: null,
            _deleted: false
          }
        })
        .exec();

      const activeDoc = docs[0];
      if (!activeDoc) {
        return { error: 'No hay sesión activa para cerrar' };
      }

      // 1. UPDATE: cerrar la sesión activa
      const now = new Date().toISOString();
      await activeDoc.update({
        $set: { end_time: now, updated_at: Date.now() }
      });

      // 2. Verificar si quedan sesiones activas para este WO
      const remainingActive = await collection
        .find({
          selector: {
            work_order_id: workOrderId,
            end_time: null,
            _deleted: false
          }
        })
        .exec();

      if (remainingActive.length === 0) {
        // Si no quedan sesiones activas, transicionar WO a COMP
        const woDoc = await db.work_orders.findOne(workOrderId).exec();
        if (woDoc && woDoc.lifecycle_phase === 'INPRG') {
          await woDoc.update({
            $set: { lifecycle_phase: 'COMP', updated_at: Date.now() }
          });
        }
      }

      return { success: true };
    } catch (err) {
      console.error('[useLaborRecords] clockOut error:', err);
      return { error: err.message };
    }
  }, [db, workOrderId, userId]);

  return {
    records,
    activeSession,
    clockIn,
    clockOut,
    loading,
    error
  };
}

export default useLaborRecords;
