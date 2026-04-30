/**
 * RxDB - Offline-First Database
 * Configuración con Dexie.js como motor de almacenamiento
 */
import { createRxDatabase } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { replicateRxCollection } from 'rxdb/plugins/replication';
import { supabase } from './supabaseClient';

// ============================================
// CONSTANTES DE CONFIGURACIÓN
// ============================================
const DB_NAME = 'cmms-db';
const BATCH_SIZE = 50;

// ============================================
// SCHEMA DE WORK ORDER (RxSchema)
// ============================================
const workOrderSchema = {
  version: 0,
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
    _deleted: { type: 'boolean' },
    _last_modified: { type: 'number' }
  },
  required: ['id', 'equipment_id', 'description', 'status']
};

// ============================================
// PULL HANDLER (Descargar del servidor)
// ============================================
/**
 * TODO (Arquitectura): Riesgo de pérdida de sincronización por reasignación (Query out-of-bounds).
 * Requiere rediseño de backend para eventos de cambio de scope.
 */
const pullHandler = async (checkpoint, batchSize = BATCH_SIZE) => {
  // Filtrar por usuario actual (escalabilidad)
  const currentUserId = 'current-user-id'; // TODO: Obtener de auth context

  let query = supabase
    .from('work_orders')
    .select('*')
    .eq('assigned_to', currentUserId)
    .order('_last_modified', { ascending: true })
    .order('id', { ascending: true })
    .limit(batchSize);

  // Paginación compuesta: timestamp mayor O (timestamp igual Y id mayor)
  if (checkpoint?.lastModified && checkpoint?.lastId) {
    query = query.or(
      `_last_modified.gt.${checkpoint.lastModified},and(_last_modified.eq.${checkpoint.lastModified},id.gt.${checkpoint.lastId})`
    );
  }

  const { data, error } = await query;
  if (error) throw error;

  // Calcular checkpoint desde el último documento
  const lastDoc = data[data.length - 1];
  const newCheckpoint = lastDoc
    ? { lastModified: lastDoc._last_modified, lastId: lastDoc.id }
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
 * NO hay validación de conflictos - PostgreSQL sobreescribe directamente
 */
const pushHandler = async (docs) => {
  const upserts = docs.filter(d => !d._deleted);
  const deletes = docs.filter(d => d._deleted);

  // Upserts: enviar data sin _last_modified (trigger PostgreSQL lo maneja)
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
        _deleted: d._deleted || false
      })), { onConflict: 'id' });

    // Ignorar errores - la siguiente sincronización corregirá
    if (error) console.warn('Push warning:', error);
  }

  // Deletes: marcar como eliminados en servidor
  if (deletes.length > 0) {
    await supabase
      .from('work_orders')
      .update({ _deleted: true })
      .in('id', deletes.map(d => d.id));
  }

  // No hay manejo de conflictos en MVP
  return [];
};

// ============================================
// INICIALIZACIÓN DE BASE DE DATOS
// ============================================
let dbInstance = null;

export async function initRxDB() {
  if (dbInstance) return dbInstance;

  console.log('[RxDB] Inicializando base de datos offline-first...');

  // Crear base de datos con Dexie
  const db = await createRxDatabase({
    name: DB_NAME,
    storage: getRxStorageDexie()
  });

  // Agregar colecciones
  await db.addCollections({
    work_orders: { schema: workOrderSchema }
  });

  console.log('[RxDB] Colecciones creadas:', db.collections);

  // Iniciar replicación
  const replicationState = replicateRxCollection({
    collection: db.work_orders,
    replicationIdentifier: 'cmms-wo-sync',
    live: true,
    retryTime: 5000,
    pull: { handler: pullHandler },
    push: { handler: pushHandler }
  });

  // Observar estado de replicación
  replicationState.active$.subscribe(isActive => {
    console.log('[RxDB] Replicación activa:', isActive);
  });

  replicationState.error$.subscribe(error => {
    if (error) console.error('[RxDB] Error de replicación:', error);
  });

  dbInstance = db;
  console.log('[RxDB] Inicialización completa');

  return db;
}

// ============================================
// HOOK DE REACT PARA USAR RxDB
// ============================================
import { useState, useEffect } from 'react';

export function useRxDB() {
  const [db, setDb] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    initRxDB()
      .then(database => {
        setDb(database);
        setLoading(false);
      })
      .catch(err => {
        setError(err);
        setLoading(false);
      });
  }, []);

  return { db, loading, error };
}

export { workOrderSchema };