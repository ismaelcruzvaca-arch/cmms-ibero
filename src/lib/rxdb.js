/**
 * RxDB - Offline-First Database
 * Configuración con Dexie.js como motor de almacenamiento
 * Replicación manual con Supabase REST API
 */
import { createRxDatabase, addRxPlugin } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { replicateRxCollection } from 'rxdb/plugins/replication';
import { RxDBMigrationSchemaPlugin } from 'rxdb/plugins/migration-schema';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { isValidTransition } from './fsm.js';

addRxPlugin(RxDBMigrationSchemaPlugin);

// ============================================
// CONSTANTES DE CONFIGURACIÓN
// ============================================
const DB_NAME = 'cmms-db';
const BATCH_SIZE = 50;

// ============================================
// SCHEMAS DE RXDB (JSON puro, sin funciones)
// ============================================
const workOrderSchema = {
  version: 2,
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
    asset_id: { type: 'string', maxLength: 100 },
    wo_type: { type: 'string', enum: ['preventive', 'corrective', 'predictive', 'emergency', 'inspection'] },
    planned_hours: { type: 'number', minimum: 0 },
    actual_hours: { type: 'number', minimum: 0 },
    cost_estimate: { type: 'number', minimum: 0 },
    actual_cost: { type: 'number', minimum: 0 },
    requested_by: { type: 'string' },
    approved_by: { type: 'string' },
    approval_date: { type: 'string' },
    start_date: { type: 'string' },
    end_date: { type: 'string' },
    hold_reason: { type: 'string' },
    close_reason: { type: 'string' },
    cancel_reason: { type: 'string' },
    work_center: { type: 'string' },
    planner_group: { type: 'string' },
    downtime_hours: { type: 'number', minimum: 0 },
    percentage_complete: { type: 'number', minimum: 0, maximum: 100 },
    _conflict: { type: 'boolean' },
    _deleted: { type: 'boolean' }
  },
  required: [
    'id', 'equipment_id', 'description', 'status',
    'asset_id', 'wo_type', 'planned_hours', 'actual_hours',
    'cost_estimate', 'actual_cost', 'percentage_complete', '_conflict', '_deleted'
  ]
};

const assetSchema = {
  version: 1,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 100 },
    equipment_id: { type: 'string', maxLength: 50 },
    description: { type: 'string' },
    asset_type_id: { type: 'string', maxLength: 50 },
    serial_number: { type: 'string' },
    status: { type: 'string' },
    location: { type: 'string', maxLength: 100 },
    site: { type: 'string' },
    resource_group: { type: 'string' },
    criticality: { type: 'string', enum: ['A', 'B', 'C'] },
    manufacturer: { type: 'string' },
    model_number: { type: 'string' },
    in_service_date: { type: 'string' },
    warranty_expiration: { type: 'string' },
    technical_specs: { type: 'object' },
    created_at: { type: 'string' },
    updated_at: { type: 'number' }
  },
  required: ['id', 'equipment_id']
};

const assetHierarchySchema = {
  version: 1,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 100 },
    parent_id: { type: 'string', maxLength: 100 },
    child_id: { type: 'string', maxLength: 100 },
    hierarchy_level: { type: 'number' },
    created_at: { type: 'string' },
    updated_at: { type: 'number' }
  },
  required: ['id', 'parent_id', 'child_id']
};

const workOrdersMigrationV2 = {
  2: async (oldDoc, database) => {
    let asset_id = '';
    try {
      const asset = await database.assets
        .findOne({ selector: { equipment_id: oldDoc.equipment_id } })
        .exec();
      if (asset) asset_id = asset.id;
    } catch (e) {
      console.warn('[Migration] asset resolution failed for', oldDoc.equipment_id);
    }

    return {
      ...oldDoc,
      asset_id,
      wo_type: 'corrective',
      planned_hours: 0,
      actual_hours: 0,
      cost_estimate: 0,
      actual_cost: 0,
      requested_by: '',
      approved_by: '',
      approval_date: '',
      start_date: '',
      end_date: '',
      hold_reason: '',
      close_reason: '',
      cancel_reason: '',
      work_center: '',
      planner_group: '',
      downtime_hours: 0,
      percentage_complete: 0,
      _conflict: false,
      _deleted: oldDoc._deleted ?? false
    };
  }
};

// ============================================
// SINGLETON PATTERN
// Evita Error DB8 en React StrictMode
// ============================================
let dbInstance = null;
let initPromise = null;
let replicationStates = {};

async function _createDatabase() {
  const db = await createRxDatabase({
    name: DB_NAME,
    storage: getRxStorageDexie(),
    multiInstance: false
  });

  try {
    await db.addCollections({
      work_orders: { schema: workOrderSchema, migrationStrategies: workOrdersMigrationV2 },
      assets: { schema: assetSchema },
      asset_hierarchy: { schema: assetHierarchySchema }
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
        work_orders: { schema: workOrderSchema, migrationStrategies: workOrdersMigrationV2 },
        assets: { schema: assetSchema },
        asset_hierarchy: { schema: assetHierarchySchema }
      });
      newDb.work_orders.preSave((plainData, doc) => {
        const oldStatus = doc.status;
        const newStatus = plainData.status ?? oldStatus;
        if (oldStatus !== newStatus && !isValidTransition(oldStatus, newStatus)) {
          throw new Error(`FSM violation: ${oldStatus} → ${newStatus}`);
        }
      }, false);
      return newDb;
    }
    if (db.work_orders && db.assets && db.asset_hierarchy) {
      console.log('[RxDB] Colecciones ya existentes');
    } else {
      console.error('[RxDB] Error al agregar colecciones:', err);
      throw new Error(`Colecciones no creadas: ${err.message}`);
    }
  }

  if (!db.work_orders || !db.assets || !db.asset_hierarchy) {
    throw new Error('Colecciones no encontradas después de inicialización');
  }

  db.work_orders.preSave((plainData, doc) => {
    const oldStatus = doc.status;
    const newStatus = plainData.status ?? oldStatus;
    if (oldStatus !== newStatus && !isValidTransition(oldStatus, newStatus)) {
      throw new Error(`FSM violation: ${oldStatus} → ${newStatus}`);
    }
  }, false);

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
// PULL/PUSH HANDLERS GENÉRICOS
// ============================================
function createPullHandler(tableName, orderField = 'updated_at') {
  return async (checkpoint, batchSize = BATCH_SIZE) => {
    console.log(`[RxDB Sync] Iniciando pull de ${tableName}. Checkpoint actual:`, checkpoint);
    let query = supabase
      .from(tableName)
      .select('*')
      .order(orderField, { ascending: true })
      .order('id', { ascending: true })
      .limit(batchSize);

    if (checkpoint?.lastModified && checkpoint?.lastId) {
      query = query.or(
        `${orderField}.gt.${checkpoint.lastModified},and(${orderField}.eq.${checkpoint.lastModified},id.gt.${checkpoint.lastId})`
      );
    }

    try {
      const { data, error } = await query;
      if (error) {
        console.error(`[RxDB Sync] Error en consulta pull de ${tableName}:`, error);
        throw error;
      }

      console.log(`[RxDB Sync] Consulta pull de ${tableName} exitosa. Registros devueltos: ${data ? data.length : 0}`);

      // Mapear campos de Supabase a los nombres y tipos esperados por RxDB
      const mappedDocs = data.map(doc => {
        const mapped = { ...doc };

        // 1. Mapeo de _deleted / is_deleted -> _deleted (RxDB v15 soft-delete nativo)
        if ('_deleted' in doc) {
          mapped._deleted = !!doc._deleted;
        } else if ('is_deleted' in doc) {
          mapped._deleted = !!doc.is_deleted;
          delete mapped.is_deleted;
        } else if ('deleted' in doc) {
          mapped._deleted = !!doc.deleted;
          delete mapped.deleted;
        } else {
          mapped._deleted = false;
        }

        // 2. Mapeo de updated_at (debe ser number para cumplir con el esquema RxDB)
        if (typeof doc.updated_at === 'string') {
          // Si es assets o asset_hierarchy usamos el campo updated_at_ms (si existe) o convertimos la fecha string a timestamp
          mapped.updated_at = doc.updated_at_ms || new Date(doc.updated_at).getTime() || Date.now();
        } else if (!doc.updated_at) {
          mapped.updated_at = Date.now();
        }

        return mapped;
      });

      const lastDoc = data[data.length - 1];
      const newCheckpoint = lastDoc
        ? { lastModified: lastDoc[orderField], lastId: lastDoc.id }
        : checkpoint;

      console.log(`[RxDB Sync] Pull de ${tableName} completado. Checkpoint nuevo:`, newCheckpoint);
      return { documents: mappedDocs, checkpoint: newCheckpoint };
    } catch (err) {
      console.error(`[RxDB Sync] Excepción en pull de ${tableName}:`, err);
      throw err;
    }
  };
}

function createPushHandler(tableName, fields) {
  return async (docs) => {
    console.log(`[RxDB Sync] Iniciando push de ${tableName}. Documentos:`, docs);
    const upserts = docs.filter(d => !d._deleted);
    const deletes = docs.filter(d => d._deleted);

    try {
      if (upserts.length > 0) {
        const mappedUpserts = upserts.map(d => {
          const obj = { is_deleted: false };
          fields.forEach(f => {
            if (f === 'updated_at') {
              obj.updated_at = new Date(d.updated_at).toISOString();
              obj.updated_at_ms = d.updated_at;
            } else {
              obj[f] = d[f];
            }
          });
          return obj;
        });

        const { error } = await supabase
          .from(tableName)
          .upsert(mappedUpserts, { onConflict: 'id' });

        if (error) {
          console.error(`[RxDB Sync] Error en push upsert de ${tableName}:`, error);
          throw error;
        }
      }

      if (deletes.length > 0) {
        const { error } = await supabase
          .from(tableName)
          .update({ is_deleted: true })
          .in('id', deletes.map(d => d.id));

        if (error) {
          console.error(`[RxDB Sync] Error en push delete de ${tableName}:`, error);
          throw error;
        }
      }

      console.log(`[RxDB Sync] Push de ${tableName} completado exitosamente`);
      return [];
    } catch (err) {
      console.error(`[RxDB Sync] Excepción en push de ${tableName}:`, err);
      throw err;
    }
  };
}

const WORK_ORDER_PUSH_FIELDS = [
  'id', 'equipment_id', 'description', 'location', 'criticality',
  'status', 'priority', 'assigned_to', 'scheduled_date',
  'completed_date', 'created_at', 'updated_at', 'asset_id', 'wo_type',
  'planned_hours', 'actual_hours', 'cost_estimate', 'actual_cost',
  'requested_by', 'approved_by', 'approval_date', 'start_date',
  'end_date', 'hold_reason', 'close_reason', 'cancel_reason',
  'work_center', 'planner_group', 'downtime_hours', 'percentage_complete',
  '_conflict'
];

function createWorkOrderPushHandler(tableName) {
  return async (docs) => {
    console.log(`[RxDB Sync] Iniciando push de ${tableName}. Documentos:`, docs);
    const upserts = docs.filter(d => !d._deleted);
    const deletes = docs.filter(d => d._deleted);

    try {
      if (upserts.length > 0) {
        const mappedUpserts = upserts.map(d => {
          const obj = { _deleted: false };
          WORK_ORDER_PUSH_FIELDS.forEach(f => {
            if (f === 'updated_at') {
              // updated_at is BIGINT in Supabase; send as number, no conversion
              obj.updated_at = d.updated_at;
            } else {
              obj[f] = d[f];
            }
          });
          return obj;
        });

        const { error } = await supabase
          .from(tableName)
          .upsert(mappedUpserts, { onConflict: 'id' });

        if (error) {
          const isPermanent = error.code === '23514' || error.code === 'P0001' || error.code === '23503' || error.message?.includes('Invalid status transition');
          if (isPermanent) {
            console.error(`[RxDB Sync] Permanent error en push de ${tableName}:`, error);
            if (dbInstance) {
              for (const doc of upserts) {
                try {
                  // Fetch server state to revert invalid status when possible
                  const { data: serverDoc, error: serverErr } = await supabase
                    .from(tableName)
                    .select('status')
                    .eq('id', doc.id)
                    .single();
                  const revertStatus = (!serverErr && serverDoc) ? serverDoc.status : doc.status;
                  const localDoc = await dbInstance.work_orders.findOne(doc.id).exec();
                  if (localDoc) {
                    await localDoc.update({
                      $set: { _conflict: true, status: revertStatus }
                    });
                  }
                } catch (patchErr) {
                  console.error(`[RxDB Sync] Error marcando conflicto local para ${doc.id}:`, patchErr);
                }
              }
            }
            return [];
          }
          throw error;
        }
      }

      if (deletes.length > 0) {
        const { error } = await supabase
          .from(tableName)
          .update({ _deleted: true })
          .in('id', deletes.map(d => d.id));

        if (error) {
          console.error(`[RxDB Sync] Error en push delete de ${tableName}:`, error);
          throw error;
        }
      }

      console.log(`[RxDB Sync] Push de ${tableName} completado exitosamente`);
      return [];
    } catch (err) {
      console.error(`[RxDB Sync] Excepción en push de ${tableName}:`, err);
      throw err;
    }
  };
}

// ============================================
// REPLICACIONES
// ============================================
export async function startAllReplications(db) {
  // Work Orders
  const woPull = createPullHandler('work_orders', 'updated_at');
  const woPush = createWorkOrderPushHandler('work_orders');

  replicationStates.work_orders = replicateRxCollection({
    collection: db.work_orders,
    replicationIdentifier: 'cmms-wo-sync',
    live: true,
    retryTime: 5000,
    pull: { handler: woPull },
    push: { handler: woPush }
  });

  // Assets
  const assetsPull = createPullHandler('assets', 'updated_at_ms');
  const assetsPush = createPushHandler('assets', [
    'id', 'equipment_id', 'description', 'asset_type_id', 'serial_number',
    'status', 'location', 'site', 'resource_group', 'criticality',
    'manufacturer', 'model_number', 'in_service_date', 'warranty_expiration',
    'technical_specs', 'created_at'
  ]);

  replicationStates.assets = replicateRxCollection({
    collection: db.assets,
    replicationIdentifier: 'cmms-assets-sync',
    live: true,
    retryTime: 5000,
    pull: { handler: assetsPull },
    push: { handler: assetsPush }
  });

  // Asset Hierarchy
  const hierarchyPull = createPullHandler('asset_hierarchy', 'id');
  const hierarchyPush = createPushHandler('asset_hierarchy', [
    'id', 'parent_id', 'child_id', 'hierarchy_level', 'created_at'
  ]);

  replicationStates.asset_hierarchy = replicateRxCollection({
    collection: db.asset_hierarchy,
    replicationIdentifier: 'cmms-hierarchy-sync',
    live: true,
    retryTime: 5000,
    pull: { handler: hierarchyPull },
    push: { handler: hierarchyPush }
  });

  // Suscripciones a estados
  Object.entries(replicationStates).forEach(([key, state]) => {
    state.active$.subscribe(isActive => {
      console.log(`[RxDB] ${key} activa:`, isActive);
    });
    state.error$.subscribe(error => {
      if (error) console.error(`[RxDB] Error ${key}:`, error);
    });
  });

  return replicationStates;
}

// Re-sync manual
function getPullOrderField(collectionName) {
  if (collectionName === 'assets') return 'updated_at_ms';
  if (collectionName === 'asset_hierarchy') return 'id';
  return 'updated_at';
}

function getPushHandler(collectionName) {
  if (collectionName === 'work_orders') return createWorkOrderPushHandler(collectionName);
  if (collectionName === 'assets') {
    return createPushHandler(collectionName, [
      'id', 'equipment_id', 'description', 'asset_type_id', 'serial_number',
      'status', 'location', 'site', 'resource_group', 'criticality',
      'manufacturer', 'model_number', 'in_service_date', 'warranty_expiration',
      'technical_specs', 'created_at'
    ]);
  }
  if (collectionName === 'asset_hierarchy') {
    return createPushHandler(collectionName, [
      'id', 'parent_id', 'child_id', 'hierarchy_level', 'created_at'
    ]);
  }
  return createPushHandler(collectionName, []);
}

export async function forceResync(collectionName) {
  const state = replicationStates[collectionName];
  if (state) {
    console.log(`[RxDB] Force resync: ${collectionName}`);
    state.cancel();
    const db = dbInstance;
    if (db && db[collectionName]) {
      replicationStates[collectionName] = replicateRxCollection({
        collection: db[collectionName],
        replicationIdentifier: `cmms-${collectionName}-resync-${Date.now()}`,
        live: true,
        retryTime: 5000,
        pull: { handler: createPullHandler(collectionName, getPullOrderField(collectionName)) },
        push: { handler: getPushHandler(collectionName) }
      });
    }
  }
}

export async function startReplication(db) {
  return startAllReplications(db);
}

// ============================================
// HOOKS DE REACT
// ============================================

export function useRxDB() {
  const [db, setDb] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [syncStatus, setSyncStatus] = useState('offline');

  useEffect(() => {
    let repStates = null;

    async function init() {
      try {
        const database = await initRxDB();
        setDb(database);
        
        repStates = await startAllReplications(database);
        
        // Estado combinado de todas las replicaciones con validaciones
        const updateStatus = () => {
          if (!repStates) return;
          try {
            const anyActive = Object.values(repStates).some(s => s?.active$?.value);
            setSyncStatus(anyActive ? 'syncing' : 'online');
          } catch (e) {
            setSyncStatus('online');
          }
        };
        
        if (repStates) {
          Object.values(repStates).forEach(state => {
            if (state?.active$) {
              state.active$.subscribe(updateStatus);
            }
          });
        }

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
      if (repStates) {
        Object.values(repStates).forEach(state => {
          if (state?.cancel) state.cancel();
        });
      }
    };
  }, []);

  return { db, loading, error, syncStatus };
}

// Hook para Work Orders
export function useWorkOrders() {
  const { db, loading, error, syncStatus } = useRxDB();
  const [workOrders, setWorkOrders] = useState([]);

  useEffect(() => {
    if (!db) return;

    const sub = db.work_orders.find().$.subscribe(docs => {
      const activeDocs = docs
        .map(doc => doc.toJSON())
        .filter(doc => !doc._deleted);
      setWorkOrders(activeDocs);
    });

    return () => sub.unsubscribe();
  }, [db]);

  return { workOrders, loading, error, syncStatus };
}

// Hook para Assets con construcción de árbol
export function useAssets() {
  const { db, loading, error, syncStatus } = useRxDB();
  const [assets, setAssets] = useState([]);
  const [hierarchy, setHierarchy] = useState([]);

  useEffect(() => {
    if (!db) return;

    const assetsSub = db.assets.find().$.subscribe(docs => {
      const activeDocs = docs
        .map(doc => doc.toJSON())
        .filter(doc => !doc._deleted);
      setAssets(activeDocs);
    });

    const hierarchySub = db.asset_hierarchy.find().$.subscribe(docs => {
      const activeDocs = docs
        .map(doc => doc.toJSON())
        .filter(doc => !doc._deleted);
      setHierarchy(activeDocs);
    });

    return () => {
      assetsSub.unsubscribe();
      hierarchySub.unsubscribe();
    };
  }, [db]);

  // Construcción del árbol con useMemo para evitar re-renders innecesarios
  const assetTree = useMemo(() => {
    if (!assets.length) return [];

    // Crear mapa de hijos por padre
    const childrenMap = new Map();
    const assetMap = new Map();

    // Indexar assets por ID
    assets.forEach(asset => {
      assetMap.set(asset.id, { ...asset, children: [] });
    });

    // Construir jerarquía
    hierarchy.forEach(rel => {
      if (!rel._deleted) {
        const parent = assetMap.get(rel.parent_id);
        const child = assetMap.get(rel.child_id);
        if (parent && child) {
          if (!parent.children) parent.children = [];
          parent.children.push(child);
        }
      }
    });

    // Filtrar nodos raíz (sin padre)
    const rootAssets = [];
    const hasParent = new Set(hierarchy.map(h => h.child_id));
    
    assetMap.forEach(asset => {
      if (!hasParent.has(asset.id)) {
        rootAssets.push(asset);
      }
    });

    return rootAssets;
  }, [assets, hierarchy]);

  // Función para forzar re-sync
  const refreshAssets = useCallback(async () => {
    if (db) {
      await forceResync('assets');
      await forceResync('asset_hierarchy');
    }
  }, [db]);

  return { assets, hierarchy, assetTree, loading, error, syncStatus, refreshAssets };
}

export { workOrderSchema, assetSchema, assetHierarchySchema };