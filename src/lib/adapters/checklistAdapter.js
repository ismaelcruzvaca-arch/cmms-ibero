/**
 * Checklist Adapter — RxDB document → ViewModel mapper
 * Sigue el mismo patrón que laborAdapter.js y workOrderAdapter.js
 */

/**
 * Adapta una instancia de checklist desde RxDB (snake_case) a ViewModel (camelCase)
 */
export function adaptChecklistInstance(doc) {
  if (!doc) return null;

  return {
    id: doc.id,
    workOrderId: doc.work_order_id,
    checklistTemplateId: doc.checklist_template_id,
    technicianId: doc.technician_id,
    assetId: doc.asset_id,
    evaluatorSource: doc.evaluator_source,
    evaluatedBy: doc.evaluated_by,
    verifiedBy: doc.verified_by,
    verifiedAt: doc.verified_at,
    status: doc.status,
    startedAt: doc.started_at,
    completedAt: doc.completed_at,
    notes: doc.notes,
    createdAt: doc.created_at
  };
}

/**
 * Adapta una respuesta de ítem desde RxDB a ViewModel
 */
export function adaptChecklistResponse(doc) {
  if (!doc) return null;

  return {
    id: doc.id,
    checklistInstanceId: doc.checklist_instance_id,
    templateItemId: doc.template_item_id,
    status: doc.status,
    causaFallaId: doc.causa_falla_id,
    comment: doc.comment,
    photoUrl: doc.photo_url,
    measurementValue: doc.measurement_value,
    answeredAt: doc.answered_at
  };
}

/**
 * Adapta un template desde Supabase (snake_case) a ViewModel
 */
export function adaptChecklistTemplate(row) {
  if (!row) return null;

  return {
    id: row.id,
    code: row.code,
    description: row.description,
    moduleId: row.module_id,
    jobPlanId: row.job_plan_id,
    blockType: row.block_type,
    samplingRate: row.sampling_rate,
    isAuditable: row.is_auditable,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * Adapta un ítem de template desde Supabase a ViewModel
 */
export function adaptTemplateItem(row) {
  if (!row) return null;

  return {
    id: row.id,
    checklistTemplateId: row.checklist_template_id,
    stepSequence: row.step_sequence,
    itemText: row.item_text,
    itemType: row.item_type,
    requiresPhoto: row.requires_photo,
    requiresComment: row.requires_comment,
    optional: row.optional
  };
}

/**
 * Adapta una causa de falla desde RxDB a ViewModel
 */
export function adaptCausaFalla(doc) {
  if (!doc) return null;

  return {
    id: doc.id,
    code: doc.code,
    name: doc.name,
    description: doc.description
  };
}

/**
 * Prepara una instancia de checklist para inserción en RxDB (camelCase → snake_case)
 */
export function prepareChecklistInstance(viewModel) {
  return {
    id: viewModel.id,
    work_order_id: viewModel.workOrderId,
    checklist_template_id: viewModel.checklistTemplateId,
    technician_id: viewModel.technicianId,
    asset_id: viewModel.assetId,
    evaluator_source: viewModel.evaluatorSource || 'SELF',
    evaluated_by: viewModel.evaluatedBy,
    status: viewModel.status || 'IN_PROGRESS',
    started_at: viewModel.startedAt || new Date().toISOString(),
    created_at: viewModel.createdAt || new Date().toISOString(),
    _deleted: false
  };
}

/**
 * Prepara una respuesta para inserción en RxDB
 */
export function prepareChecklistResponse(viewModel) {
  return {
    id: viewModel.id,
    checklist_instance_id: viewModel.checklistInstanceId,
    template_item_id: viewModel.templateItemId,
    status: viewModel.status || 'SKIPPED',
    causa_falla_id: viewModel.causaFallaId || null,
    comment: viewModel.comment || '',
    photo_url: viewModel.photoUrl || '',
    measurement_value: viewModel.measurementValue || null,
    answered_at: viewModel.answeredAt || new Date().toISOString(),
    _deleted: false
  };
}
