/**
 * RxDB - Offline-First Database
 * Configuración con Dexie.js como motor de almacenamiento
 * handlers manuales para Supabase REST API
 */
import { createRxDatabase, addRxPlugin } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { replicateRxCollection } from 'rxdb/plugins/replication';
import { RxDBMigrationSchemaPlugin } from 'rxdb/plugins/migration-schema';
import { supabase } from './supabaseClient';

addRxPlugin(RxDBMigrationSchemaPlugin);

// ============================================
// CONSTANTES DE CONFIGURACIÓN
// ============================================
const DB_NAME = 'cmms-db';
const BATCH_SIZE = 50;

// ============================================
// SCHEMA DE WORK ORDER (RxSchema)
// Estandarizado: updated_at, deleted
// El schema debe ser 100% serializable (JSON puro, sin funciones)
// ============================================
const workOrderSchema = {
  version: 1,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 50 },
    equipment_id: { type: 'string', maxLength: 50 },
    description: { type: 'string' },
    location: { type: 'string', maxLength: 100 },
    criticality: { type: 'string', enum: ['A', 'B', 'C'] },
    status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
    priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
    assigned_to: { type: 'string' },
    scheduled_date: { type: 'string' },
    completed_date: { type: 'string' },
    created_at: { type: 'string' },
    updated_at: { type: 'number' },
    deleted: { type: 'boolean' }
  },
  required: ['id', 'equipment_id', 'description', 'status']
};

// ============================================
// SINGLETON PATTERN (Promesa Compartida)
// Evita Error DB8 en React StrictMode
// ============================================
let dbInstance = null;
let initPromise = null;

async function _createDatabase() {
  const db = await createRxDatabase({
    name: DB_NAME,
    storage: getRxStorageDexie(),
    multiInstance: false
  });

  try {
    await db.addCollections({
      work_orders: { schema: workOrderSchema }
    });
  } catch (err) {
    const errorStr = String(err);
    if (errorStr.includes('DB6') || errorStr.includes('schema')) {
      console.warn('[RxDB] Conflicto de schema, eliminando DB y recreando...');
      await db.remove();
      const newDb = await createRxDatabase({
        name: DB_NAME,
        storage: getRxStorageDexie(),
        multiInstance: false
      });
      await newDb.addCollections({
        work_orders: { schema: workOrderSchema }
      });
      return newDb;
    }
    if (db.work_orders) {
      console.log('[RxDB] Colección work_orders ya existe');
    } else {
      console.error('[RxDB] Error al agregar colección:', err);
      throw new Error(`Colección no creada: ${err.message}`);
    }
  }

  if (!db.work_orders) {
    throw new Error('Colección work_orders no encontrada después de inicialización');
  }

  return db;
}

export async function initRxDB() {
  if (dbInstance) return dbInstance;
  if (initPromise) return initPromise;

  console.log('[RxDB] Inicializando base de datos...');

  initPromise = _createDatabase()
    .then(db => {
      dbInstance = db;
      console.log('[RxDB] Instancia creada exitosamente');
      return db;
    })
    .catch(err => {
      console.error('[RxDB] Error en inicialización:', err);
      initPromise = null;
      throw err;
    });

  return initPromise;
}

// ============================================
// PULL HANDLER (Descargar del servidor)
// ============================================
/**
 * Riesgo: Query out-of-bounds por reasignación
 */
const pullHandler = async (checkpoint, batchSize = BATCH_SIZE) => {
  const currentUserId = 'current-user-id'; // TODO: Obtener de auth context

  let query = supabase
    .from('work_orders')
    .select('*')
    .eq('assigned_to', currentUserId)
    .order('updated_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(batchSize);

  if (checkpoint?.lastModified && checkpoint?.lastId) {
    query = query.or(
      `updated_at.gt.${checkpoint.lastModified},and(updated_at.eq.${checkpoint.lastModified},id.gt.${checkpoint.lastId})`
    );
  }

  const { data, error } = await query;
  if (error) throw error;

  const lastDoc = data[data.length - 1];
  const newCheckpoint = lastDoc
    ? { lastModified: lastDoc.updated_at, lastId: lastDoc.id }
    : checkpoint;

  return {
    documents: data,
    checkpoint: newCheckpoint
  };
};

// ============================================
// PUSH HANDLER (Enviar al servidor)
// ============================================
/**
 * Estrategia: Sobreescritura ciega (last-write-wins)
 */
const pushHandler = async (docs) => {
  const upserts = docs.filter(d => !d.deleted);
  const deletes = docs.filter(d => d.deleted);

  if (upserts.length > 0) {
    const { error } = await supabase
      .from('work_orders')
      .upsert(upserts.map(d => ({
        id: d.id,
        equipment_id: d.equipment_id,
        description: d.description,
        location: d.location,
        criticality: d.criticality,
        status: d.status,
        priority: d.priority,
        assigned_to: d.assigned_to,
        scheduled_date: d.scheduled_date,
        completed_date: d.completed_date,
        created_at: d.created_at,
        deleted: d.deleted || false
      })), { onConflict: 'id' });

    if (error) console.warn('[RxDB] Push warning:', error);
  }

  if (deletes.length > 0) {
    await supabase
      .from('work_orders')
      .update({ deleted: true })
      .in('id', deletes.map(d => d.id));
  }

  return [];
};

// ============================================
// INICIAR REPLICACIÓN
// ============================================
export async function startReplication(db) {
  const replicationState = replicateRxCollection({
    collection: db.work_orders,
    replicationIdentifier: 'cmms-wo-sync',
    live: true,
    retryTime: 5000,
    pull: { handler: pullHandler },
    push: { handler: pushHandler }
  });

  replicationState.active$.subscribe(isActive => {
    console.log('[RxDB] Replicación activa:', isActive);
  });

  replicationState.error$.subscribe(error => {
    if (error) console.error('[RxDB] Error de replicación:', error);
  });

  return replicationState;
}

// ============================================
// HOOK DE REACT
// ============================================
import { useState, useEffect } from 'react';

export function useRxDB() {
  const [db, setDb] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [syncStatus, setSyncStatus] = useState('offline');

  useEffect(() => {
    let repState = null;

    async function init() {
      try {
        const database = await initRxDB();
        setDb(database);
        
        repState = await startReplication(database);
        
        repState.active$.subscribe(isActive => {
          setSyncStatus(isActive ? 'syncing' : 'online');
        });

        setLoading(false);
      } catch (err) {
        console.error('[useRxDB] Error:', err);
        setError(err);
        setLoading(false);
        setSyncStatus('offline');
      }
    }

    init();

    return () => {
      if (repState) repState.cancel();
    };
  }, []);

  return { db, loading, error, syncStatus };
}

export function useWorkOrders() {
  const { db, loading, error, syncStatus } = useRxDB();
  const [workOrders, setWorkOrders] = useState([]);

  useEffect(() => {
    if (!db) return;

    const collection = db.work_orders;
    const sub = collection.find().$.subscribe(docs => {
      const activeDocs = docs
        .map(doc => doc.toJSON())
        .filter(doc => !doc.deleted);
      setWorkOrders(activeDocs);
    });

    return () => sub.unsubscribe();
  }, [db]);

  return { workOrders, loading, error, syncStatus };
}

export { workOrderSchema };