import { useState, useEffect, useCallback } from 'react';
import { initRxDB } from '../lib/rxdb.js';
import { supabase } from '../lib/supabaseClient.js';

// ── Constantes de negocio ──
const BLOCK_C_MIN_LEVEL = 3;
const SAMPLING_AUDIT_ONLY = 0;
const SAMPLING_ALWAYS = 1;

/**
 * Hash determinístico para sampling de checklists.
 * Misma WO + template → mismo resultado siempre.
 */
const deterministicHash = (str, mod) => {
  if (mod <= 1) return 0;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash) % mod;
};

/**
 * Hook de checklists de competencia.
 * Resuelve templates aplicables por WO, aplica sampling,
 * manage instancias y respuestas, y alimenta el Focus Mode.
 */
export function useChecklists() {
  const [db, setDb] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const database = await initRxDB();
        if (!cancelled) {
          setDb(database);
          setLoading(false);
        }
      } catch (err) {
        console.error('[useChecklists] Init error:', err);
        if (!cancelled) {
          setError(err);
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /**
   * Obtiene el nivel actual del técnico en un módulo
   */
  const getTechnicianLevel = useCallback(async (technicianId, moduleCode) => {
    try {
      // Obtener el UUID del módulo primero
      const { data: modData } = await supabase
        .from('technological_modules')
        .select('id')
        .eq('code', moduleCode)
        .single();

      if (!modData?.id) return 1;

      const { data, error } = await supabase
        .from('technician_skills')
        .select('current_level')
        .eq('technician_id', technicianId)
        .eq('module_id', modData.id);

      if (error) throw error;
      return data?.[0]?.current_level || 1;
    } catch (err) {
      console.warn('[useChecklists] Error getting tech level:', err);
      return 1;
    }
  }, []);



  /**
   * Resuelve qué templates aplicar para una WO.
   * Aplica: filtro por módulo, sampling hash, Block C gate.
   */
  const getTemplatesForWO = useCallback(async (workOrderId, technicianId) => {
    if (!db) return [];

    try {
      // Obtener WO para conocer asset y job_plan
      const woDoc = await db.work_orders.findOne(workOrderId).exec();
      if (!woDoc) return [];
      const wo = woDoc.toJSON();

      // Obtener asset para conocer módulo
      const assetDoc = await db.assets.findOne(wo.asset_id).exec();
      if (!assetDoc) return [];

      // Obtener módulo del asset (desde Supabase, no tenemos module_id en RxDB assets)
      const { data: assetData } = await supabase
        .from('assets')
        .select('module_id')
        .eq('id', wo.asset_id)
        .single();

      if (!assetData?.module_id) return [];

      // Obtener módulo code
      const { data: modData } = await supabase
        .from('technological_modules')
        .select('code')
        .eq('id', assetData.module_id)
        .single();

      if (!modData?.code) return [];

      const moduleCode = modData.code;

      // Buscar templates activos para este módulo
      const templateDocs = await db.checklist_templates.find()
        .where('is_active').eq(true)
        .where('module_id').eq(assetData.module_id)
        .exec();

      let templates = templateDocs.map(d => d.toJSON());

      // Filtrar por job_plan: templates con job_plan_id específico solo aplican a ese plan
      templates = templates.filter(t => 
        !t.job_plan_id || t.job_plan_id === (wo.job_plan_id || '')
      );

      // Aplicar sampling
      const sampledTemplates = [];
      const isAuditable = wo.is_auditable || false;

      for (const t of templates) {
        // Si sampling_rate = AUDIT_ONLY y no es auditable → skip
        if (t.sampling_rate === SAMPLING_AUDIT_ONLY && !isAuditable) continue;

        // Si sampling_rate > ALWAYS → hash determinístico
        if (t.sampling_rate > SAMPLING_ALWAYS) {
          const hash = deterministicHash(workOrderId + t.id, t.sampling_rate);
          if (hash !== 0) continue;
        }

        // Block C gate: solo visible si técnico tiene nivel mínimo
        if (t.block_type === 'C') {
          const techLevel = await getTechnicianLevel(technicianId, moduleCode);
          if (techLevel < BLOCK_C_MIN_LEVEL) continue;
        }

        sampledTemplates.push(t);
      }

      return sampledTemplates;
    } catch (err) {
      console.error('[useChecklists] Error resolving templates:', err);
      return [];
    }
  }, [db, getTechnicianLevel]);

  /**
   * Obtiene los ítems de un template
   */
  const getTemplateItems = useCallback(async (templateId) => {
    if (!db) return [];

    try {
      // Los templates items son pull-only, se consultan por Supabase directo
      // porque son pull-only (no se crean localmente)
      const { data, error } = await supabase
        .from('checklist_template_items')
        .select('*')
        .eq('checklist_template_id', templateId)
        .order('step_sequence', { ascending: true });

      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('[useChecklists] Error getting template items:', err);
      return [];
    }
  }, [db]);

  /**
   * Crea una instancia de checklist con sus respuestas.
   * Se llama al abrir el Focus Mode.
   */
  const createChecklistInstance = useCallback(async ({
    workOrderId,
    templateId,
    technicianId,
    assetId,
    evaluatorSource = 'SELF',
    evaluatedBy
  }) => {
    if (!db) throw new Error('DB not initialized');

    const instanceId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const instance = {
      id: instanceId,
      work_order_id: workOrderId,
      checklist_template_id: templateId,
      technician_id: technicianId,
      asset_id: assetId,
      evaluator_source: evaluatorSource,
      evaluated_by: evaluatedBy || technicianId,
      status: 'IN_PROGRESS',
      started_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      _deleted: false
    };

    await db.checklist_instances.insert(instance);

    // Crear responses en blanco para cada ítem del template
    const { data: items } = await supabase
      .from('checklist_template_items')
      .select('*')
      .eq('checklist_template_id', templateId)
      .order('step_sequence', { ascending: true });

    if (items) {
      for (const item of items) {
        const responseId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await db.checklist_item_responses.insert({
          id: responseId,
          checklist_instance_id: instanceId,
          template_item_id: item.id,
          status: 'SKIPPED',
          answered_at: new Date().toISOString(),
          _deleted: false
        });
      }
    }

    return instanceId;
  }, [db]);

  /**
   * Actualiza una respuesta individual.
   */
  const updateResponse = useCallback(async (responseId, updates) => {
    if (!db) return;

    try {
      const doc = await db.checklist_item_responses.findOne(responseId).exec();
      if (doc) {
        await doc.update({
          $set: {
            ...updates,
            answered_at: new Date().toISOString()
          }
        });
      }
    } catch (err) {
      console.error('[useChecklists] Error updating response:', err);
      throw err;
    }
  }, [db]);

  /**
   * Marca una instancia como COMPLETED.
   * Esto dispara el trigger trg_checklist_to_evidence en la DB.
   */
  const completeInstance = useCallback(async (instanceId) => {
    if (!db) return;

    try {
      const doc = await db.checklist_instances.findOne(instanceId).exec();
      if (doc) {
        await doc.update({
          $set: {
            status: 'COMPLETED',
            completed_at: new Date().toISOString()
          }
        });
      }
    } catch (err) {
      console.error('[useChecklists] Error completing instance:', err);
      throw err;
    }
  }, [db]);

  /**
   * Obtiene las respuestas de una instancia.
   */
  const getInstanceResponses = useCallback(async (instanceId) => {
    if (!db) return [];

    try {
      const docs = await db.checklist_item_responses.find()
        .where('checklist_instance_id').eq(instanceId)
        .exec();
      return docs.map(d => d.toJSON());
    } catch (err) {
      console.error('[useChecklists] Error getting responses:', err);
      return [];
    }
  }, [db]);

  /**
   * Obtiene todas las instancias para una WO.
   */
  const getInstancesForWO = useCallback(async (workOrderId) => {
    if (!db) return [];

    try {
      const docs = await db.checklist_instances.find()
        .where('work_order_id').eq(workOrderId)
        .exec();
      return docs.map(d => d.toJSON());
    } catch (err) {
      console.error('[useChecklists] Error getting instances:', err);
      return [];
    }
  }, [db]);

  /**
   * Verifica si Block A está completado y PASS para una WO.
   * Usado por el gate INPRG→COMP.
   */
  const isBlockAPassed = useCallback(async (workOrderId) => {
    try {
      const instances = await getInstancesForWO(workOrderId);
      const blockAInstances = [];

      for (const inst of instances) {
        const templateDoc = await db.checklist_templates.findOne(inst.checklist_template_id).exec();
        if (templateDoc && templateDoc.toJSON().block_type === 'A') {
          blockAInstances.push(inst);
        }
      }

      if (blockAInstances.length === 0) return false; // No hay Block A, no se puede pasar

      // Verificar que TODAS las instancias Block A estén COMPLETED
      const allCompleted = blockAInstances.every(i => i.status === 'COMPLETED');
      if (!allCompleted) return false;

      // Verificar que NO haya FAILs en las respuestas (sin NO_APLICA)
      for (const inst of blockAInstances) {
        const responses = await getInstanceResponses(inst.id);
        const hasFail = responses.some(r => r.status === 'FAIL');
        if (hasFail) return false;
      }

      return true;
    } catch (err) {
      console.error('[useChecklists] Error checking Block A:', err);
      return false;
    }
  }, [db, getInstancesForWO, getInstanceResponses]);

  /**
   * Obtiene bloques visibles según nivel del técnico.
   */
  const getVisibleBlocks = useCallback(async (technicianId, moduleCode) => {
    const level = await getTechnicianLevel(technicianId, moduleCode);
    const blocks = ['A', 'B'];
    if (level >= 3) blocks.push('C');
    return blocks;
  }, [getTechnicianLevel]);

  /**
   * Fuerza re-sync de colecciones de checklist.
   */
  const refreshChecklists = useCallback(async () => {
    const database = await initRxDB();
    const { forceResync } = await import('../lib/rxdb.js');
    await forceResync('checklist_instances');
    await forceResync('checklist_item_responses');
  }, []);

  return {
    loading,
    error,
    getTemplatesForWO,
    getTemplateItems,
    createChecklistInstance,
    updateResponse,
    completeInstance,
    getInstanceResponses,
    getInstancesForWO,
    isBlockAPassed,
    getVisibleBlocks,
    refreshChecklists
  };
}

export default useChecklists;
