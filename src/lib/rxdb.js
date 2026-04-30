/**
 * RxDB - Offline-First Database
 * Configuración con Dexie.js como motor de almacenamiento
 * Replicación manual con Supabase REST API
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
// SCHEMAS DE RXDB (JSON puro, sin funciones)
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
    updated_at: { type: 'number' },
    deleted: { type: 'boolean' }
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
    updated_at: { type: 'number' },
    deleted: { type: 'boolean' }
  },
  required: ['id', 'parent_id', 'child_id']
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
      work_orders: { schema: workOrderSchema },
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
        work_orders: { schema: workOrderSchema },
        assets: { schema: assetSchema },
        asset_hierarchy: { schema: assetHierarchySchema }
      });
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

    const { data, error } = await query;
    if (error) throw error;

    const lastDoc = data[data.length - 1];
    const newCheckpoint = lastDoc
      ? { lastModified: lastDoc[orderField], lastId: lastDoc.id }
      : checkpoint;

    return { documents: data, checkpoint: newCheckpoint };
  };
}

function createPushHandler(tableName, fields) {
  return async (docs) => {
    const upserts = docs.filter(d => !d.deleted);
    const deletes = docs.filter(d => d.deleted);

    if (upserts.length > 0) {
      const { error } = await supabase
        .from(tableName)
        .upsert(upserts.map(d => {
          const obj = {};
          fields.forEach(f => { obj[f] = d[f]; });
          obj.deleted = d.deleted || false;
          return obj;
        }), { onConflict: 'id' });

      if (error) console.warn(`[RxDB] Push ${tableName} warning:`, error);
    }

    if (deletes.length > 0) {
      await supabase
        .from(tableName)
        .update({ deleted: true })
        .in('id', deletes.map(d => d.id));
    }

    return [];
  };
}

// ============================================
// REPLICACIONES
// ============================================
export async function startAllReplications(db) {
  // Work Orders
  const woPull = createPullHandler('work_orders', 'updated_at');
  const woPush = createPushHandler('work_orders', [
    'id', 'equipment_id', 'description', 'location', 'criticality',
    'status', 'priority', 'assigned_to', 'scheduled_date',
    'completed_date', 'created_at', 'deleted'
  ]);

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
    'technical_specs', 'created_at', 'deleted'
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
    'id', 'parent_id', 'child_id', 'hierarchy_level', 'created_at', 'deleted'
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
        pull: { handler: createPullHandler(collectionName) },
        push: { handler: createPushHandler(collectionName, []) }
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
import { useState, useEffect, useMemo, useCallback } from 'react';

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
        
        // Estado combinado de todas las replicaciones
        const updateStatus = () => {
          const anyActive = Object.values(repStates).some(s => s.active$.value);
          setSyncStatus(anyActive ? 'syncing' : 'online');
        };
        
        Object.values(repStates).forEach(state => {
          state.active$.subscribe(updateStatus);
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
      if (repStates) {
        Object.values(repStates).forEach(state => state.cancel());
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
        .filter(doc => !doc.deleted);
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
        .filter(doc => !doc.deleted);
      setAssets(activeDocs);
    });

    const hierarchySub = db.asset_hierarchy.find().$.subscribe(docs => {
      const activeDocs = docs
        .map(doc => doc.toJSON())
        .filter(doc => !doc.deleted);
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
      if (!rel.deleted) {
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