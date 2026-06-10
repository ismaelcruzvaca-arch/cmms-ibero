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
  version: 5,
  primaryKey: 'id',
  type: 'object',
  properties: {
    // ── Identidad ──
    id: { type: 'string', maxLength: 50 },
    legacy_id: { type: 'string' },
    equipment_id: { type: 'string', maxLength: 50 },
    description: { type: 'string' },
    asset_id: { type: 'string', maxLength: 100 },

    // ── ISO 14224: Ciclo de Vida ──
    wo_type: { type: 'string', enum: ['preventive', 'corrective', 'predictive', 'emergency', 'inspection', 'CBM', 'PM'] },
    lifecycle_phase: { type: 'string', enum: ['WAPPR', 'APPROVED', 'INPRG', 'COMP', 'CLOSED', 'CANCELLED', 'REJECTED'] },
    block_reason: { type: 'string', enum: ['NONE', 'PARTS', 'TOOLS', 'CREW', 'PERMIT', 'SHUTDOWN', 'WEATHER', 'OTHER'] },
    priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
    criticality: { type: 'string', enum: ['A', 'B', 'C'] },
    percentage_complete: { type: 'number', minimum: 0, maximum: 100 },

    // ── ISO 14224: Timestamps Operativos ──
    reported_at: { type: 'string' },
    approved_at: { type: 'string' },
    planned_start_at: { type: 'string' },
    actual_start_at: { type: 'string' },
    completed_at: { type: 'string' },
    closed_at: { type: 'string' },
    machine_down_at: { type: 'string' },
    machine_up_at: { type: 'string' },
    scheduled_date: { type: 'string' },
    completed_date: { type: 'string' },
    approval_date: { type: 'string' },
    start_date: { type: 'string' },
    end_date: { type: 'string' },
    created_at: { type: 'string' },

    // ── ISO 14224: Taxonomía de Fallas ──
    failure_class: { type: 'string' },
    problem_code: { type: 'string' },
    cause_code: { type: 'string' },
    remedy_code: { type: 'string' },
    asset_class: { type: 'string' },
    part_in_process: { type: 'string' },
    symptom_note: { type: 'string' },
    cause_note: { type: 'string' },
    action_note: { type: 'string' },
    resolution_note: { type: 'string' },

    // ── Asignación y Responsables ──
    assigned_to: { type: 'string' },
    requested_by: { type: 'string' },
    reported_by: { type: 'string' },
    approved_by: { type: 'string' },
    created_by: { type: 'string' },          // UUID como string

    // ── Referencias a Entidades ──
    job_plan_id: { type: 'string' },         // UUID del job_plan que originó la OT
    meter_id: { type: 'string' },            // UUID del medidor CBM

    // ── Planificación ──
    planned_hours: { type: 'number', minimum: 0 },
    actual_hours: { type: 'number', minimum: 0 },
    cost_estimate: { type: 'number', minimum: 0 },
    actual_cost: { type: 'number', minimum: 0 },
    downtime_hours: { type: 'number', minimum: 0 },
    work_center: { type: 'string' },
    planner_group: { type: 'string' },
    maintenance_reference: { type: 'string' },
    revision: { type: 'number' },

    // ── Campos de Control ──
    location: { type: 'string', maxLength: 100 },
    hold_reason: { type: 'string' },
    close_reason: { type: 'string' },
    cancel_reason: { type: 'string' },
    updated_at: { type: 'number' },

    // ── Auditoría / Sampling (checklist-evidence-system) ──
    is_auditable: { type: 'boolean' },
    audit_reason: { type: 'string' },

    // ── RxDB / Replicación ──
    _conflict: { type: 'boolean' },
    _deleted: { type: 'boolean' }
  },
  required: [
    'id', 'equipment_id', 'description', 'lifecycle_phase',
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

const workOrdersMigrationV3 = {
  3: async (oldDoc) => {
    const phaseMap = {
      'pending': 'WAPPR',
      'in_progress': 'INPRG',
      'completed': 'COMP',
      'cancelled': 'CLOSED'
    };
    return {
      ...oldDoc,
      lifecycle_phase: phaseMap[oldDoc.status] || 'WAPPR',
      block_reason: oldDoc.block_reason || 'NONE',
      failure_class: oldDoc.failure_class || '',
      problem_code: oldDoc.problem_code || '',
      cause_code: oldDoc.cause_code || '',
      remedy_code: oldDoc.remedy_code || '',
      symptom_note: oldDoc.symptom_note || '',
      cause_note: oldDoc.cause_note || '',
      action_note: oldDoc.action_note || '',
      status: undefined
    };
  }
};

const materialRequestSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 100 },
    work_order_id: { type: 'string', maxLength: 50 },
    part_num: { type: 'string' },
    line_desc: { type: 'string' },
    is_non_stock: { type: 'boolean' },
    requested_qty: { type: 'number', minimum: 0 },
    created_at: { type: 'string' }
  },
  required: ['id', 'work_order_id', 'line_desc', 'requested_qty']
};

const laborRecordSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 50 },
    work_order_id: { type: 'string', maxLength: 50 },
    technician_id: { type: 'string', maxLength: 50 },
    start_time: { type: 'string' },
    end_time: { type: 'string' },
    activity_code: { type: 'string', enum: ['DIRECT_WORK', 'WAIT_MATERIAL', 'WAIT_PERMIT', 'TRAVEL', 'BREAK'] },
    notes: { type: 'string' },
    device_timestamp: { type: 'string' },
    created_at: { type: 'string' },
    updated_at: { type: 'number' },
    _deleted: { type: 'boolean' }
  },
  required: ['id', 'work_order_id', 'technician_id', 'start_time', 'activity_code']
};

const workOrdersMigrationV4 = {
  4: async (oldDoc) => {
    const oldBlockReasonMap = {
      'MATERIAL': 'PARTS',
      'PLANT_CONDITION': 'SHUTDOWN',
      'SCHEDULE': 'CREW'
    };
    return {
      ...oldDoc,
      // Fix block_reason enum values (changed in ISO 14224 production migration)
      block_reason: oldBlockReasonMap[oldDoc.block_reason] || oldDoc.block_reason || 'NONE',
      // New ISO 14224 timestamp fields (default empty string)
      reported_at: oldDoc.reported_at || oldDoc.created_at || '',
      approved_at: oldDoc.approved_at || '',
      planned_start_at: oldDoc.planned_start_at || oldDoc.start_date || '',
      actual_start_at: oldDoc.actual_start_at || '',
      completed_at: oldDoc.completed_at || oldDoc.completed_date || '',
      closed_at: oldDoc.closed_at || '',
      machine_down_at: oldDoc.machine_down_at || '',
      machine_up_at: oldDoc.machine_up_at || '',
      // New taxonomía fields
      asset_class: oldDoc.asset_class || '',
      part_in_process: oldDoc.part_in_process || '',
      resolution_note: oldDoc.resolution_note || '',
      reported_by: oldDoc.reported_by || oldDoc.requested_by || '',
      created_by: oldDoc.created_by || '',
      maintenance_reference: oldDoc.maintenance_reference || '',
      revision: oldDoc.revision || 0,
      legacy_id: oldDoc.legacy_id || oldDoc.id || '',
      // Referencias
      job_plan_id: oldDoc.job_plan_id || '',
      meter_id: oldDoc.meter_id || '',
      // wo_type: ensure PM/CBM values pass validation
      wo_type: (['preventive', 'corrective', 'predictive', 'emergency', 'inspection', 'CBM', 'PM'].includes(oldDoc.wo_type))
        ? oldDoc.wo_type
        : (oldDoc.wo_type || 'corrective'),
    };
  }
};

// Migration v4→v5: add is_auditable + audit_reason
const workOrdersMigrationV5 = {
  5: async (oldDoc) => {
    return {
      ...oldDoc,
      is_auditable: oldDoc.is_auditable || false,
      audit_reason: oldDoc.audit_reason || '',
    };
  }
};

// ============================================================
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
      work_orders: {
      schema: workOrderSchema,
          migrationStrategies: { ...workOrdersMigrationV2, ...workOrdersMigrationV3, ...workOrdersMigrationV4, ...workOrdersMigrationV5 }
        },
        assets: { schema: assetSchema },
      asset_hierarchy: { schema: assetHierarchySchema },
      material_requests: { schema: materialRequestSchema },
      labor_records: { schema: laborRecordSchema },
      // ── Checklist Collections ──
      causa_falla_catalog: { schema: causaFallaSchema },
      checklist_templates: { schema: checklistTemplateSchema },
      checklist_instances: { schema: checklistInstanceSchema },
      checklist_item_responses: { schema: checklistItemResponseSchema },
      checklist_sampling_config: { schema: checklistSamplingConfigSchema },
      // ── FMEA / RCM Collections ──
      component_types: { schema: componentTypeSchema },
      asset_components: { schema: assetComponentSchema },
      failure_mode_catalog: { schema: failureModeCatalogSchema },
      fmea_rcm_analysis: { schema: fmeaAnalysisSchema },
      // ── Condition Monitoring (SDD 2) ──
      condition_feature_definitions: { schema: conditionFeatureDefSchema },
      condition_sources: { schema: conditionSourcesSchema },
      condition_source_capabilities: { schema: conditionSourceCapsSchema },
      condition_capture_queue: { schema: captureQueueSchema },
      // ── PDF Report Engine Collections ──
      report_templates: { schema: reportTemplateSchema },
      report_history: { schema: reportHistorySchema }
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
        work_orders: {
          schema: workOrderSchema,
        migrationStrategies: { ...workOrdersMigrationV2, ...workOrdersMigrationV3, ...workOrdersMigrationV4, ...workOrdersMigrationV5 }
        },
        assets: { schema: assetSchema },
        asset_hierarchy: { schema: assetHierarchySchema },
        material_requests: { schema: materialRequestSchema },
        labor_records: { schema: laborRecordSchema },
        causa_falla_catalog: { schema: causaFallaSchema },
        checklist_templates: { schema: checklistTemplateSchema },
        checklist_instances: { schema: checklistInstanceSchema },
        checklist_item_responses: { schema: checklistItemResponseSchema },

        checklist_sampling_config: { schema: checklistSamplingConfigSchema },
        component_types: { schema: componentTypeSchema },
        asset_components: { schema: assetComponentSchema },
        failure_mode_catalog: { schema: failureModeCatalogSchema },
        fmea_rcm_analysis: { schema: fmeaAnalysisSchema },
        condition_feature_definitions: { schema: conditionFeatureDefSchema },
        condition_sources: { schema: conditionSourcesSchema },
        condition_source_capabilities: { schema: conditionSourceCapsSchema },
        condition_capture_queue: { schema: captureQueueSchema },
        // ── PDF Report Engine Collections ──
        report_templates: { schema: reportTemplateSchema },
        report_history: { schema: reportHistorySchema }
      });
      newDb.work_orders.preSave((plainData, doc) => {
        const oldPhase = doc.lifecycle_phase;
        const newPhase = plainData.lifecycle_phase ?? oldPhase;
        if (oldPhase && newPhase && oldPhase !== newPhase && !isValidTransition(oldPhase, newPhase)) {
          throw new Error(`FSM violation: ${oldPhase} → ${newPhase}`);
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
    const oldPhase = doc.lifecycle_phase;
    const newPhase = plainData.lifecycle_phase ?? oldPhase;
    if (oldPhase && newPhase && oldPhase !== newPhase && !isValidTransition(oldPhase, newPhase)) {
      throw new Error(`FSM violation: ${oldPhase} → ${newPhase}`);
    }
  }, false);

  return db;
}

export async function initRxDB() {
  if (dbInstance) return dbInstance;
  if (initPromise) return initPromise;

  console.log('[RxDB] Inicializando base de datos...');

  try {
    const db = await _createDatabase();
    dbInstance = db;
    console.log('[RxDB] Instancia creada exitosamente');
    initPromise = db;
  } catch (err) {
    console.error('[RxDB] Error en inicialización:', err);
    initPromise = null;
    throw err;
  }

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
        // Si la tabla no existe en Supabase, retornar vacío en lugar de fallar
        if (error.code === 'PGRST205' || error.message?.includes('Could not find the table')) {
          console.warn(`[RxDB Sync] ⚠ Tabla ${tableName} no existe en Supabase. Pull desactivado.`);
          return { documents: [], checkpoint: null };
        }
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
  'lifecycle_phase', 'block_reason', 'priority', 'assigned_to', 'scheduled_date',
  'completed_date', 'created_at', 'updated_at', 'asset_id', 'wo_type',
  'planned_hours', 'actual_hours', 'cost_estimate', 'actual_cost',
  'requested_by', 'approved_by', 'approval_date', 'start_date',
  'end_date', 'hold_reason', 'close_reason', 'cancel_reason',
  'work_center', 'planner_group', 'downtime_hours', 'percentage_complete',
  'reported_at', 'approved_at', 'planned_start_at', 'actual_start_at',
  'completed_at', 'closed_at', 'machine_down_at', 'machine_up_at',
  'failure_class', 'problem_code', 'cause_code', 'remedy_code',
  'asset_class', 'part_in_process', 'symptom_note', 'cause_note',
  'action_note', 'resolution_note', 'reported_by', 'created_by',
  'maintenance_reference', 'revision', 'legacy_id', 'job_plan_id', 'meter_id',
  'is_auditable', 'audit_reason',
  '_conflict'
];

const LABOR_RECORD_PUSH_FIELDS = [
  'id', 'work_order_id', 'technician_id', 'start_time', 'end_time',
  'activity_code', 'notes', 'device_timestamp', 'created_at', 'updated_at'
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
                  // Fetch server state to revert invalid lifecycle phase when possible
                  const { data: serverDoc, error: serverErr } = await supabase
                    .from(tableName)
                    .select('lifecycle_phase')
                    .eq('id', doc.id)
                    .single();
                  const revertPhase = (!serverErr && serverDoc) ? serverDoc.lifecycle_phase : doc.lifecycle_phase;
                  const localDoc = await dbInstance.work_orders.findOne(doc.id).exec();
                  if (localDoc) {
                    await localDoc.update({
                      $set: { _conflict: true, lifecycle_phase: revertPhase }
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

// ── Labor Records Pull (custom: filtered by technician_id) ──
function createLaborPullHandler(tableName, orderField = 'updated_at') {
  return async (checkpoint, batchSize = BATCH_SIZE) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) {
      console.error('[RxDB Sync] No authenticated session for labor pull');
      throw new Error('No authenticated user for labor_records sync');
    }
    const userId = session.user.id;

    console.log(`[RxDB Sync] Iniciando pull de ${tableName} para technician ${userId}. Checkpoint:`, checkpoint);

    let query = supabase
      .from(tableName)
      .select('*')
      .eq('technician_id', userId)
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
        // Si la tabla no existe en Supabase, retornar vacío en lugar de fallar
        if (error.code === 'PGRST205' || error.message?.includes('Could not find the table')) {
          console.warn(`[RxDB Sync] ⚠ Tabla ${tableName} no existe en Supabase. Pull desactivado.`);
          return { documents: [], checkpoint: null };
        }
        console.error(`[RxDB Sync] Error en consulta pull de ${tableName}:`, error);
        throw error;
      }

      console.log(`[RxDB Sync] Consulta pull de ${tableName} exitosa. Registros devueltos: ${data ? data.length : 0}`);

      const mappedDocs = data.map(doc => {
        const mapped = { ...doc };

        if ('_deleted' in doc) {
          mapped._deleted = !!doc._deleted;
        } else if ('is_deleted' in doc) {
          mapped._deleted = !!doc.is_deleted;
          delete mapped.is_deleted;
        } else {
          mapped._deleted = false;
        }

        if (typeof doc.updated_at === 'string') {
          mapped.updated_at = new Date(doc.updated_at).getTime() || Date.now();
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

// ── Report Templates Push (no-op) ──
// Los writes van directo a Supabase vía useTemplates hook.
// RxDB pull replica automáticamente los cambios.
// Registramos el handler para que RxDB sepa que la colección acepta push,
// pero no realiza ninguna operación — evita duplicar writes.
export function createReportTemplatePushHandler() {
  return async (docs) => {
    console.log('[RxDB Sync] Push report_templates: no-op (writes bypass RxDB)');
    return [];
  };
}

// ── Labor Records Push ──
function createLaborPushHandler(tableName) {
  return async (docs) => {
    console.log(`[RxDB Sync] Iniciando push de ${tableName}. Documentos:`, docs);
    const upserts = docs.filter(d => !d._deleted);
    const deletes = docs.filter(d => d._deleted);

    try {
      if (upserts.length > 0) {
        const mappedUpserts = upserts.map(d => {
          const obj = { _deleted: false };
          LABOR_RECORD_PUSH_FIELDS.forEach(f => {
            if (f === 'updated_at') {
              obj.updated_at = new Date(d.updated_at).toISOString();
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

/**
 * Wrapper seguro para replicateRxCollection que captura errores
 * sincrónicos y asíncronos (tablas faltantes, schemas desincronizados)
 * y los loggea sin romper la app. Retorna null si falla.
 *
 * RxDB v17 llama internamente a replicationState.start() sin .catch(),
 * por lo que un error en el pull handler (tabla no existe) genera un
 * unhandled promise rejection que rompe la app. Este wrapper:
 * 1. Desactiva autoStart para que replicateRxCollection no llame a start()
 * 2. Llama a start() manualmente con .catch() para manejar el error
 */
function safeReplicate(options) {
  try {
    const state = replicateRxCollection({
      ...options,
      autoStart: false
    });
    if (state) {
      // Iniciar replicación manualmente con manejo de errores
      state.start().catch(err => {
        console.warn(`[RxDB Sync] ⚠ Replication start error for ${options.replicationIdentifier}:`, err?.message || err);
      });
      // Suscribirse al error$ para errores posteriores
      if (state.error$) {
        state.error$.subscribe(err => {
          console.warn(`[RxDB Sync] ⚠ Replication runtime error for ${options.replicationIdentifier}:`, err?.message || err);
        });
      }
    }
    return state;
  } catch (err) {
    console.warn(`[RxDB Sync] ⚠ Replication SKIPPED for ${options.replicationIdentifier}: ${err.message}`);
    return null;
  }
}

/**
 * Versión segura de createPullHandler que retorna vacío en lugar de
 * lanzar error cuando la tabla no existe en Supabase.
 */
function safePullHandler(tableName, orderField = 'updated_at') {
  return async (checkpoint, batchSize = BATCH_SIZE) => {
    try {
      const handler = createPullHandler(tableName, orderField);
      return await handler(checkpoint, batchSize);
    } catch (err) {
      if (err?.code === 'PGRST205' || err?.message?.includes('Could not find the table')) {
        console.warn(`[RxDB Sync] ⚠ Tabla ${tableName} no existe en Supabase. Replicación desactivada.`);
        return { documents: [], checkpoint: null };
      }
      throw err;
    }
  };
}

export async function startAllReplications(db) {
  // Work Orders
  const woPull = createPullHandler('work_orders', 'updated_at');
  const woPush = createWorkOrderPushHandler('work_orders');

  replicationStates.work_orders = safeReplicate({
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

  replicationStates.assets = safeReplicate({
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

  replicationStates.asset_hierarchy = safeReplicate({
    collection: db.asset_hierarchy,
    replicationIdentifier: 'cmms-hierarchy-sync',
    live: true,
    retryTime: 5000,
    pull: { handler: hierarchyPull },
    push: { handler: hierarchyPush }
  });

  // Material Requests
  const mrPull = createPullHandler('material_requests', 'created_at');
  const mrPush = createPushHandler('material_requests', [
    'id', 'work_order_id', 'part_num', 'line_desc', 'is_non_stock',
    'requested_qty', 'created_at'
  ]);

  replicationStates.material_requests = safeReplicate({
    collection: db.material_requests,
    replicationIdentifier: 'cmms-mr-sync',
    live: true,
    retryTime: 5000,
    pull: { handler: mrPull },
    push: { handler: mrPush }
  });

  // Labor Records (custom pull: technician_id filter)
  const laborPull = createLaborPullHandler('labor_records', 'updated_at');
  const laborPush = createLaborPushHandler('labor_records');

  replicationStates.labor_records = safeReplicate({
    collection: db.labor_records,
    replicationIdentifier: 'cmms-lr-sync',
    live: true,
    retryTime: 5000,
    pull: { handler: laborPull },
    push: { handler: laborPush }
  });

  // ── Checklist Replications ──
  // causa_falla_catalog (pull-only — catálogo fijo)
  replicationStates.causa_falla_catalog = safeReplicate({
    collection: db.causa_falla_catalog,
    replicationIdentifier: 'cmms-cfc-sync',
    live: true,
    retryTime: 5000,
    pull: { handler: createPullHandler('causa_falla_catalog', 'id') },
    push: { handler: createPushHandler('causa_falla_catalog', ['id', 'code', 'name', 'description']) }
  });

  // checklist_templates (pull-only — leídos del servidor)
  replicationStates.checklist_templates = safeReplicate({
    collection: db.checklist_templates,
    replicationIdentifier: 'cmms-ct-sync',
    live: true,
    retryTime: 5000,
    pull: { handler: createPullHandler('checklist_templates', 'updated_at') },
    push: { handler: createPushHandler('checklist_templates', [
      'id', 'code', 'description', 'module_id', 'job_plan_id', 'block_type',
      'sampling_rate', 'is_auditable', 'is_active', 'created_at', 'updated_at'
    ]) }
  });

  // checklist_instances (pull + push — creadas localmente, sincronizadas)
  replicationStates.checklist_instances = safeReplicate({
    collection: db.checklist_instances,
    replicationIdentifier: 'cmms-ci-sync',
    live: true,
    retryTime: 5000,
    pull: { handler: createPullHandler('checklist_instances', 'created_at') },
    push: { handler: createPushHandler('checklist_instances', [
      'id', 'work_order_id', 'checklist_template_id', 'technician_id', 'asset_id',
      'evaluator_source', 'evaluated_by', 'verified_by', 'verified_at',
      'status', 'started_at', 'completed_at', 'notes', 'created_at'
    ]) }
  });

  // checklist_item_responses (pull + push)
  replicationStates.checklist_item_responses = safeReplicate({
    collection: db.checklist_item_responses,
    replicationIdentifier: 'cmms-cir-sync',
    live: true,
    retryTime: 5000,
    pull: { handler: createPullHandler('checklist_item_responses', 'answered_at') },
    push: { handler: createPushHandler('checklist_item_responses', [
      'id', 'checklist_instance_id', 'template_item_id', 'status',
      'causa_falla_id', 'comment', 'photo_url', 'measurement_value', 'answered_at'
    ]) }
  });

  // checklist_sampling_config (pull-only — leídos del servidor)
  replicationStates.checklist_sampling_config = safeReplicate({
    collection: db.checklist_sampling_config,
    replicationIdentifier: 'cmms-csc-sync',
    live: true,
    retryTime: 5000,
    pull: { handler: createPullHandler('checklist_sampling_config', 'id') },
    push: { handler: createPushHandler('checklist_sampling_config', [
      'id', 'module_id', 'job_plan_id', 'block_type',
      'default_sampling_rate', 'is_auditable_only', 'is_active'
    ]) }
  });

  // ── FMEA / RCM Replications ──
  // component_types (pull-only — catálogo fijo)
  replicationStates.component_types = safeReplicate({
    collection: db.component_types,
    replicationIdentifier: 'cmms-ctypes-sync',
    live: true,
    retryTime: 5000,
    pull: { handler: createPullHandler('component_types', 'id') }
  });

  // asset_components (pull-only — catálogo filtrado por asset_id)
  replicationStates.asset_components = safeReplicate({
    collection: db.asset_components,
    replicationIdentifier: 'cmms-acomp-sync',
    live: true,
    retryTime: 5000,
    pull: { handler: createPullHandler('asset_components', 'id') }
  });

  // failure_mode_catalog (pull-only — catálogo filtrado por component_type_id)
  replicationStates.failure_mode_catalog = safeReplicate({
    collection: db.failure_mode_catalog,
    replicationIdentifier: 'cmms-fmc-sync',
    live: true,
    retryTime: 5000,
    pull: { handler: createPullHandler('failure_mode_catalog', 'id') }
  });

  // fmea_rcm_analysis (pull + push — datos de usuario)
  const fmeaPull = createPullHandler('fmea_rcm_analysis', 'updated_at');
  const fmeaPush = createPushHandler('fmea_rcm_analysis', [
    'id', 'asset_id', 'component_id', 'failure_mode_id',
    'severity', 'occurrence', 'detection',
    'q1', 'q2', 'q3', 'q4', 'q5',
    'recommended_strategy', 'failure_cause', 'mitigation_actions', 'recommended_frequency',
    'analyzed_by', 'notes', 'created_at', 'updated_at'
  ]);

  replicationStates.fmea_rcm_analysis = safeReplicate({
    collection: db.fmea_rcm_analysis,
    replicationIdentifier: 'cmms-fmea-sync',
    live: true,
    retryTime: 5000,
    pull: { handler: fmeaPull },
    push: { handler: fmeaPush }
  });

  // ── Condition Monitoring Replications (SDD 2) ──
  // condition_feature_definitions (pull + push — catálogo de features)
  replicationStates.condition_feature_definitions = safeReplicate({
    collection: db.condition_feature_definitions,
    replicationIdentifier: 'cmms-cfd-sync',
    live: true,
    retryTime: 5000,
    pull: { handler: createPullHandler('condition_feature_definitions', 'id') },
    push: { handler: createPushHandler('condition_feature_definitions', [
      'id', 'code', 'name', 'description', 'data_type', 'unit', 'is_active'
    ]) }
  });

  // condition_sources (pull + push — fuentes de datos)
  replicationStates.condition_sources = safeReplicate({
    collection: db.condition_sources,
    replicationIdentifier: 'cmms-cs-sync',
    live: true,
    retryTime: 5000,
    pull: { handler: createPullHandler('condition_sources', 'id') },
    push: { handler: createPushHandler('condition_sources', [
      'id', 'name', 'source_type', 'config', 'is_active'
    ]) }
  });

  // condition_source_capabilities (pull + push — capacidades declaradas)
  replicationStates.condition_source_capabilities = safeReplicate({
    collection: db.condition_source_capabilities,
    replicationIdentifier: 'cmms-cscap-sync',
    live: true,
    retryTime: 5000,
    pull: { handler: createPullHandler('condition_source_capabilities', 'id') },
    push: { handler: createPushHandler('condition_source_capabilities', [
      'id', 'source_id', 'feature_id', 'is_capable'
    ]) }
  });

  // condition_capture_queue (push-only — cola de captura local)
  replicationStates.condition_capture_queue = safeReplicate({
    collection: db.condition_capture_queue,
    replicationIdentifier: 'cmms-ccq-sync',
    live: true,
    retryTime: 5000,
    pull: { handler: createPullHandler('condition_capture_queue', 'requested_at') },
    push: { handler: createPushHandler('condition_capture_queue', [
      'id', 'source_id', 'feature_id', 'status',
      'requested_at', 'captured_at', 'value', 'error'
    ]) }
  });

    // ── PDF Report Engine Replications ──
  // report_templates (push no-op — writes bypass RxDB vía useTemplates hook)
  replicationStates.report_templates = safeReplicate({
    collection: db.report_templates,
    replicationIdentifier: 'cmms-rt-sync',
    live: true,
    retryTime: 5000,
    pull: { handler: createPullHandler('report_templates', 'updated_at') },
    push: { handler: createReportTemplatePushHandler() }
  });

  // report_history (pull + push — audit trail)
  const REPORT_HISTORY_PUSH_FIELDS = [
    'id', 'template_id', 'template_code', 'template_version',
    'report_data', 'generated_by', 'generated_at'
  ];

  replicationStates.report_history = safeReplicate({
    collection: db.report_history,
    replicationIdentifier: 'cmms-rh-sync',
    live: true,
    retryTime: 5000,
    pull: { handler: createPullHandler('report_history', 'generated_at') },
    push: { handler: createPushHandler('report_history', REPORT_HISTORY_PUSH_FIELDS) }
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
  if (collectionName === 'labor_records') return 'updated_at';

  if (collectionName === 'component_types') return 'id';
  if (collectionName === 'asset_components') return 'id';
  if (collectionName === 'failure_mode_catalog') return 'id';
  if (collectionName === 'fmea_rcm_analysis') return 'updated_at';
  if (collectionName === 'report_templates') return 'updated_at';
  if (collectionName === 'report_history') return 'generated_at';

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
  if (collectionName === 'labor_records') return createLaborPushHandler(collectionName);

  if (collectionName === 'fmea_rcm_analysis') {
    return createPushHandler(collectionName, [
      'id', 'asset_id', 'component_id', 'failure_mode_id',
      'severity', 'occurrence', 'detection',
      'q1', 'q2', 'q3', 'q4', 'q5',
      'recommended_strategy', 'failure_cause', 'mitigation_actions', 'recommended_frequency',
      'analyzed_by', 'notes', 'created_at', 'updated_at'
    ]);
  }

  if (collectionName === 'report_templates') {
    return createReportTemplatePushHandler();
  }

  if (collectionName === 'report_history') {
    return createPushHandler(collectionName, [
      'id', 'template_id', 'template_code', 'template_version',
      'report_data', 'generated_by', 'generated_at'
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
      replicationStates[collectionName] = safeReplicate({
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

// ============================================
// CHECKLIST SCHEMAS
// ============================================

const causaFallaSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 50 },
    code: { type: 'string', maxLength: 30 },
    name: { type: 'string' },
    description: { type: 'string' }
  },
  required: ['id', 'code', 'name']
};

const checklistTemplateSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 50 },
    code: { type: 'string', maxLength: 50 },
    description: { type: 'string' },
    module_id: { type: 'string', maxLength: 50 },
    job_plan_id: { type: 'string', maxLength: 50 },
    block_type: { type: 'string', enum: ['A', 'B', 'C'] },
    sampling_rate: { type: 'number' },
    is_auditable: { type: 'boolean' },
    is_active: { type: 'boolean' },
    created_at: { type: 'string' },
    updated_at: { type: 'number' }
  },
  required: ['id', 'code', 'description', 'module_id', 'block_type']
};

const checklistInstanceSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 50 },
    work_order_id: { type: 'string', maxLength: 50 },
    checklist_template_id: { type: 'string', maxLength: 50 },
    technician_id: { type: 'string', maxLength: 50 },
    asset_id: { type: 'string', maxLength: 100 },
    evaluator_source: { type: 'string', enum: ['SELF', 'SUPERVISOR', 'PEER'] },
    evaluated_by: { type: 'string', maxLength: 50 },
    verified_by: { type: 'string', maxLength: 50 },
    verified_at: { type: 'string' },
    status: { type: 'string', enum: ['IN_PROGRESS', 'COMPLETED', 'VOID'] },
    started_at: { type: 'string' },
    completed_at: { type: 'string' },
    notes: { type: 'string' },
    created_at: { type: 'string' },
    _deleted: { type: 'boolean' }
  },
  required: ['id', 'work_order_id', 'checklist_template_id', 'technician_id', 'asset_id', 'status']
};

const checklistItemResponseSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 50 },
    checklist_instance_id: { type: 'string', maxLength: 50 },
    template_item_id: { type: 'string', maxLength: 50 },
    status: { type: 'string', enum: ['PASS', 'FAIL', 'NA', 'SKIPPED'] },
    causa_falla_id: { type: 'string', maxLength: 50 },
    comment: { type: 'string' },
    photo_url: { type: 'string' },
    measurement_value: { type: 'number' },
    answered_at: { type: 'string' },
    _deleted: { type: 'boolean' }
  },
  required: ['id', 'checklist_instance_id', 'template_item_id', 'status']
};

const checklistSamplingConfigSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 50 },
    module_id: { type: 'string', maxLength: 50 },
    job_plan_id: { type: 'string', maxLength: 50 },
    block_type: { type: 'string', enum: ['A', 'B', 'C'] },
    default_sampling_rate: { type: 'number' },
    is_auditable_only: { type: 'boolean' },
    is_active: { type: 'boolean' }
  },
  required: ['id', 'block_type']
};

// ── FMEA / RCM Schemas ──

const componentTypeSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 50 },
    name: { type: 'string' },
    description: { type: 'string' },
    category: { type: 'string' },
    default_uom: { type: 'string' },
    _deleted: { type: 'boolean' }
  },
  required: ['id', 'name']
};

const assetComponentSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 50 },
    asset_id: { type: 'string', maxLength: 50 },
    component_type_id: { type: 'string', maxLength: 50 },
    serial_number: { type: 'string' },
    position: { type: 'string' },
    install_date: { type: 'string' },
    _deleted: { type: 'boolean' }
  },
  required: ['id', 'asset_id', 'component_type_id']
};

const failureModeCatalogSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 50 },
    code: { type: 'string', maxLength: 50 },
    name: { type: 'string' },
    description: { type: 'string' },
    component_type_id: { type: 'string', maxLength: 50 },
    severity: { type: 'string' },
    _deleted: { type: 'boolean' }
  },
  required: ['id', 'code', 'name']
};

const fmeaAnalysisSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 50 },
    asset_component_id: { type: 'string', maxLength: 50 },
    failure_mode_id: { type: 'string', maxLength: 50 },
    cause: { type: 'string' },
    effect: { type: 'string' },
    severity: { type: 'number' },
    occurrence: { type: 'number' },
    detection: { type: 'number' },
    rpn: { type: 'number' },
    recommended_action: { type: 'string' },
    status: { type: 'string' },
    _deleted: { type: 'boolean' }
  },
  required: ['id', 'asset_component_id', 'failure_mode_id']
};

// ── Condition Monitoring Schemas (SDD 2) ──

const conditionFeatureDefSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 50 },
    code: { type: 'string', maxLength: 100 },
    name: { type: 'string' },
    description: { type: 'string' },
    data_type: { type: 'string' },
    unit: { type: 'string' },
    is_active: { type: 'boolean' },
    _deleted: { type: 'boolean' }
  },
  required: ['id', 'code', 'name']
};

const conditionSourcesSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 50 },
    name: { type: 'string' },
    source_type: { type: 'string' },
    config: { type: 'object' },
    is_active: { type: 'boolean' },
    _deleted: { type: 'boolean' }
  },
  required: ['id', 'name', 'source_type']
};

const conditionSourceCapsSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 50 },
    source_id: { type: 'string', maxLength: 50 },
    feature_id: { type: 'string', maxLength: 50 },
    is_capable: { type: 'boolean' },
    _deleted: { type: 'boolean' }
  },
  required: ['id', 'source_id', 'feature_id']
};

const captureQueueSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 50 },
    source_id: { type: 'string', maxLength: 50 },
    feature_id: { type: 'string', maxLength: 50 },
    status: { type: 'string' },
    requested_at: { type: 'string' },
    captured_at: { type: 'string' },
    value: { type: 'object' },
    error: { type: 'string' },
    _deleted: { type: 'boolean' }
  },
  required: ['id', 'source_id', 'feature_id']
};

// ── PDF Report Engine Schemas ──

const reportTemplateSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 50 },
    code: { type: 'string', maxLength: 100 },
    version: { type: 'number' },
    name: { type: 'string' },
    description: { type: 'string' },
    template: { type: 'object' },
    is_active: { type: 'boolean' },
    created_by: { type: 'string' },
    created_at: { type: 'string' },
    updated_at: { type: 'string' }
  },
  required: ['id', 'code', 'version']
};

const reportHistorySchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 50 },
    template_id: { type: 'string' },
    template_code: { type: 'string' },
    template_version: { type: 'number' },
    report_data: { type: 'object' },
    generated_by: { type: 'string' },
    generated_at: { type: 'string' },
    _deleted: { type: 'boolean' }
  },
  required: ['id']
};

// 
