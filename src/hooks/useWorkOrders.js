/**
 * Hook personalizado para Work Orders con RxDB
 * Expone datos reactivos y estado de sincronización
 */
import { useState, useEffect, useCallback } from 'react';
import { initRxDB, startReplication } from '../lib/rxdb';

export function useWorkOrders() {
  const [workOrders, setWorkOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [syncStatus, setSyncStatus] = useState('offline');
  const [db, setDb] = useState(null);

  useEffect(() => {
    let subscription = null;
    let repState = null;

    async function init() {
      try {
        console.log('[useWorkOrders] Iniciando...');
        
        const database = await initRxDB();
        console.log('[useWorkOrders] DB inicializada:', !!database);
        
        setDb(database);

        // Verificar que la colección existe
        if (!database.work_orders) {
          console.error('[useWorkOrders] Colección no encontrada');
          setError(new Error('Colección work_orders no encontrada'));
          setLoading(false);
          return;
        }

        // Iniciar replicación
        repState = await startReplication(database);
        
        // Estado de sincronización
        repState.active$.subscribe(isActive => {
          setSyncStatus(isActive ? 'syncing' : 'online');
        });

        // Consulta inicial con manejo de errores
        const collection = database.work_orders;
        try {
          const initialDocs = await collection.find().exec();
          console.log('[useWorkOrders] Docs iniciales:', initialDocs.length);
          
          const activeDocs = initialDocs
            .map(doc => doc.toJSON())
            .filter(doc => !doc.deleted);
            
          setWorkOrders(activeDocs);
        } catch (queryErr) {
          console.warn('[useWorkOrders] Consulta inicial error:', queryErr);
        }

        // Suscribirse a cambios reactivos
        subscription = collection.find().$.subscribe({
          next: (docs) => {
            const activeDocs = docs
              .map(doc => doc.toJSON())
              .filter(doc => !doc.deleted);
            setWorkOrders(activeDocs);
          },
          error: (err) => {
            console.error('[useWorkOrders] Suscripción error:', err);
          }
        });

        setLoading(false);
        console.log('[useWorkOrders] Completado');

      } catch (err) {
        console.error('[useWorkOrders] Error:', err);
        setError(err);
        setLoading(false);
        setSyncStatus('offline');
      }
    }

    init();

    return () => {
      if (subscription) subscription.unsubscribe();
      if (repState) repState.cancel();
    };
  }, []);

  // Función para crear nuevo Work Order
  const createWorkOrder = useCallback(async (workOrder) => {
    if (!db) return { error: 'DB not initialized' };
    
    try {
      const collection = db.work_orders;
      await collection.insert({
        ...workOrder,
        id: workOrder.id || `WO-${Date.now()}`,
        created_at: new Date().toISOString(),
        updated_at: Date.now(),
        deleted: false
      });
      return { success: true };
    } catch (err) {
      console.error('[useWorkOrders] Insert error:', err);
      return { error: err.message };
    }
  }, [db]);

  // Función para actualizar Work Order
  const updateWorkOrder = useCallback(async (id, updates) => {
    if (!db) return { error: 'DB not initialized' };
    
    try {
      const collection = db.work_orders;
      const doc = await collection.findOne(id).exec();
      if (doc) {
        await doc.update({ $set: { ...updates, updated_at: Date.now() } });
        return { success: true };
      }
      return { error: 'Document not found' };
    } catch (err) {
      console.error('[useWorkOrders] Update error:', err);
      return { error: err.message };
    }
  }, [db]);

  // Función para eliminar (soft delete)
  const deleteWorkOrder = useCallback(async (id) => {
    if (!db) return { error: 'DB not initialized' };
    
    try {
      const collection = db.work_orders;
      const doc = await collection.findOne(id).exec();
      if (doc) {
        await doc.update({ $set: { deleted: true, updated_at: Date.now() } });
        return { success: true };
      }
      return { error: 'Document not found' };
    } catch (err) {
      console.error('[useWorkOrders] Delete error:', err);
      return { error: err.message };
    }
  }, [db]);

  return {
    workOrders,
    allWorkOrders: workOrders,
    loading,
    error,
    syncStatus,
    createWorkOrder,
    updateWorkOrder,
    deleteWorkOrder
  };
}

export default useWorkOrders;