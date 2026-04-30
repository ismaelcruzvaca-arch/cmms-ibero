/**
 * Hook personalizado para Work Orders con RxDB
 * Expone datos reactivos y estado de sincronización
 */
import { useState, useEffect, useCallback } from 'react';
import { initRxDB } from '../lib/rxdb';

export function useWorkOrders() {
  const [workOrders, setWorkOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [syncStatus, setSyncStatus] = useState('offline'); // offline | syncing | online
  const [db, setDb] = useState(null);

  useEffect(() => {
    let subscription = null;

    async function init() {
      try {
        const database = await initRxDB();
        setDb(database);

        // Suscribirse a cambios reactivos en la colección
        const collection = database.work_orders;
        
        // Observable de replicación para estado
        const repState = database.collections.work_orders?.__rxdb?.replicationState;
        
        if (repState?.active$) {
          repState.active$.subscribe(isActive => {
            setSyncStatus(isActive ? 'syncing' : 'online');
          });
        }

        // Consulta inicial
        const initialDocs = await collection.find().exec();
        setWorkOrders(initialDocs.map(doc => doc.toJSON()));
        setLoading(false);

        // Suscribir a cambios reactivos
        subscription = collection.find().$.subscribe(docs => {
          setWorkOrders(docs.map(doc => doc.toJSON()));
        });

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
    };
  }, []);

  // Función para crear nuevo Work Order (escribe local, replica al servidor)
  const createWorkOrder = useCallback(async (workOrder) => {
    if (!db) return { error: 'DB not initialized' };
    
    try {
      const collection = db.work_orders;
      await collection.insert({
        ...workOrder,
        id: workOrder.id || `WO-${Date.now()}`,
        created_at: new Date().toISOString(),
        _last_modified: Date.now()
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
        await doc.update({ $set: { ...updates, _last_modified: Date.now() } });
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
        await doc.update({ $set: { _deleted: true, _last_modified: Date.now() } });
        return { success: true };
      }
      return { error: 'Document not found' };
    } catch (err) {
      console.error('[useWorkOrders] Delete error:', err);
      return { error: err.message };
    }
  }, [db]);

  // Work Orders activas (sin soft deletes)
  const activeWorkOrders = workOrders.filter(wo => !wo._deleted);

  return {
    workOrders: activeWorkOrders,
    allWorkOrders: workOrders, // incluye borrados lógicos
    loading,
    error,
    syncStatus,
    createWorkOrder,
    updateWorkOrder,
    deleteWorkOrder
  };
}

export default useWorkOrders;