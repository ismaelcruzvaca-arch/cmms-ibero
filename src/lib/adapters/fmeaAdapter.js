/**
 * FMEA / RCM Adapter — RxDB document → ViewModel mapper
 * Sigue el mismo patrón que checklistAdapter.js y laborAdapter.js
 */

// ─── Component Types ───

export function toComponentTypeViewModel(doc) {
  if (!doc) return null;

  return {
    id: doc.id,
    name: doc.name,
    description: doc.description || '',
    isActive: doc.is_active ?? true,
    createdAt: doc.created_at || ''
  };
}

export function toComponentTypeViewModelList(docs) {
  if (!Array.isArray(docs)) return [];
  return docs.map(toComponentTypeViewModel);
}

// ─── Asset Components ───

export function toAssetComponentViewModel(doc) {
  if (!doc) return null;

  return {
    id: doc.id,
    assetId: doc.asset_id,
    componentTypeId: doc.component_type_id,
    serialNumber: doc.serial_number || '',
    positionReference: doc.position_reference || '',
    createdAt: doc.created_at || ''
  };
}

export function toAssetComponentViewModelList(docs) {
  if (!Array.isArray(docs)) return [];
  return docs.map(toAssetComponentViewModel);
}

// ─── Failure Mode Catalog ───

export function toFailureModeViewModel(doc) {
  if (!doc) return null;

  return {
    id: doc.id,
    componentTypeId: doc.component_type_id,
    modeCode: doc.mode_code,
    modeName: doc.mode_name,
    description: doc.description || '',
    defaultSeverity: doc.default_severity || null,
    defaultOccurrence: doc.default_occurrence || null,
    defaultDetection: doc.default_detection || null,
    isActive: doc.is_active ?? true,
    createdAt: doc.created_at || ''
  };
}

export function toFailureModeViewModelList(docs) {
  if (!Array.isArray(docs)) return [];
  return docs.map(toFailureModeViewModel);
}

// ─── FMEA / RCM Analysis ───

export function toFmeaAnalysisViewModel(doc) {
  if (!doc) return null;

  const severity = doc.severity || 5;
  const occurrence = doc.occurrence || 3;
  const detection = doc.detection || 4;
  const rpn = severity * occurrence * detection;

  return {
    id: doc.id,
    assetId: doc.asset_id,
    componentId: doc.component_id,
    failureModeId: doc.failure_mode_id,
    severity,
    occurrence,
    detection,
    rpn: doc.rpn || rpn,
    q1: doc.q1 ?? null,
    q2: doc.q2 ?? null,
    q3: doc.q3 ?? null,
    q4: doc.q4 ?? null,
    q5: doc.q5 ?? null,
    recommendedStrategy: doc.recommended_strategy || null,
    failureCause: doc.failure_cause || '',
    mitigations: doc.mitigations || '',
    frequency: doc.frequency || '',
    analyzedBy: doc.analyzed_by || '',
    notes: doc.notes || '',
    createdAt: doc.created_at || '',
    updatedAt: doc.updated_at || null,
    isDeleted: Boolean(doc._deleted)
  };
}

export function toFmeaAnalysisViewModelList(docs) {
  if (!Array.isArray(docs)) return [];
  return docs.map(toFmeaAnalysisViewModel);
}

// ─── Prepare for RxDB Insert (ViewModel → RxDB document) ───

export function prepareAnalysisForInsert(viewModel) {
  return {
    id: viewModel.id,
    asset_id: viewModel.assetId,
    component_id: viewModel.componentId,
    failure_mode_id: viewModel.failureModeId,
    severity: viewModel.severity || 5,
    occurrence: viewModel.occurrence || 3,
    detection: viewModel.detection || 4,
    q1: viewModel.q1 ?? null,
    q2: viewModel.q2 ?? null,
    q3: viewModel.q3 ?? null,
    q4: viewModel.q4 ?? null,
    q5: viewModel.q5 ?? null,
    failure_cause: viewModel.failureCause || '',
    mitigations: viewModel.mitigations || '',
    frequency: viewModel.frequency || '',
    analyzed_by: viewModel.analyzedBy || '',
    notes: viewModel.notes || '',
    created_at: viewModel.createdAt || new Date().toISOString(),
    updated_at: Date.now(),
    _deleted: false
  };
}

// ─── GraphQL DTO helpers (snake_case ↔ camelCase for sync) ───

export function toGraphQLComponentType(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    is_active: row.is_active ?? true,
    created_at: row.created_at || ''
  };
}

export function fromGraphQLComponentType(data) {
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    description: data.description || '',
    is_active: data.is_active ?? true,
    created_at: data.created_at || ''
  };
}

export function toGraphQLAssetComponent(row) {
  if (!row) return null;
  return {
    id: row.id,
    asset_id: row.asset_id,
    component_type_id: row.component_type_id,
    serial_number: row.serial_number || '',
    position_reference: row.position_reference || '',
    created_at: row.created_at || ''
  };
}

export function fromGraphQLAssetComponent(data) {
  if (!data) return null;
  return {
    id: data.id,
    asset_id: data.asset_id,
    component_type_id: data.component_type_id,
    serial_number: data.serial_number || '',
    position_reference: data.position_reference || '',
    created_at: data.created_at || ''
  };
}

export function toGraphQLFailureMode(row) {
  if (!row) return null;
  return {
    id: row.id,
    component_type_id: row.component_type_id,
    mode_code: row.mode_code,
    mode_name: row.mode_name,
    description: row.description || '',
    default_severity: row.default_severity || null,
    default_occurrence: row.default_occurrence || null,
    default_detection: row.default_detection || null,
    is_active: row.is_active ?? true,
    created_at: row.created_at || ''
  };
}

export function fromGraphQLFailureMode(data) {
  if (!data) return null;
  return {
    id: data.id,
    component_type_id: data.component_type_id,
    mode_code: data.mode_code,
    mode_name: data.mode_name,
    description: data.description || '',
    default_severity: data.default_severity || null,
    default_occurrence: data.default_occurrence || null,
    default_detection: data.default_detection || null,
    is_active: data.is_active ?? true,
    created_at: data.created_at || ''
  };
}

export function toGraphQLFmeaAnalysis(row) {
  if (!row) return null;
  return {
    id: row.id,
    asset_id: row.asset_id,
    component_id: row.component_id,
    failure_mode_id: row.failure_mode_id,
    severity: row.severity,
    occurrence: row.occurrence,
    detection: row.detection,
    q1: row.q1 ?? null,
    q2: row.q2 ?? null,
    q3: row.q3 ?? null,
    q4: row.q4 ?? null,
    q5: row.q5 ?? null,
    recommended_strategy: row.recommended_strategy || null,
    failure_cause: row.failure_cause || '',
    mitigations: row.mitigations || '',
    frequency: row.frequency || '',
    analyzed_by: row.analyzed_by || '',
    notes: row.notes || '',
    created_at: row.created_at || '',
    updated_at: row.updated_at || Date.now(),
    is_deleted: Boolean(row._deleted || row.is_deleted)
  };
}

export function fromGraphQLFmeaAnalysis(data) {
  if (!data) return null;
  return {
    id: data.id,
    asset_id: data.asset_id,
    component_id: data.component_id,
    failure_mode_id: data.failure_mode_id,
    severity: data.severity,
    occurrence: data.occurrence,
    detection: data.detection,
    q1: data.q1 ?? null,
    q2: data.q2 ?? null,
    q3: data.q3 ?? null,
    q4: data.q4 ?? null,
    q5: data.q5 ?? null,
    recommended_strategy: data.recommended_strategy || null,
    failure_cause: data.failure_cause || '',
    mitigations: data.mitigations || '',
    frequency: data.frequency || '',
    analyzed_by: data.analyzed_by || '',
    notes: data.notes || '',
    created_at: data.created_at || '',
    updated_at: data.updated_at || Date.now(),
    _deleted: Boolean(data.is_deleted)
  };
}
