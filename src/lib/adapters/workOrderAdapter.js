import { getPhaseLabel, getPhaseColor } from '../fsm.js';

const CRITICALITY_COLORS = { A: 'error', B: 'warning', C: 'success' };

const WO_TYPE_LABELS = {
  preventive: 'Preventivo',
  corrective: 'Correctivo',
  predictive: 'Predictivo',
  emergency: 'Emergencia',
  inspection: 'Inspección',
  CBM: 'CBM',
  PM: 'Preventivo'
};

const WO_TYPE_COLORS = {
  preventive: 'primary',
  corrective: 'secondary',
  predictive: 'info',
  emergency: 'error',
  inspection: 'default',
  CBM: 'warning',
  PM: 'primary'
};

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Intl.DateTimeFormat('es-MX', {
      year: 'numeric', month: 'short', day: 'numeric'
    }).format(new Date(dateStr));
  } catch { return dateStr || ''; }
}

export function toViewModel(doc) {
  if (!doc) return null;
  const woType = doc.wo_type || '';
  return {
    id: doc.id,
    equipmentId: doc.equipment_id || '',
    description: doc.description || '',
    lifecyclePhase: doc.lifecycle_phase || 'WAPPR',
    lifecycleLabel: getPhaseLabel(doc.lifecycle_phase),
    lifecycleColor: getPhaseColor(doc.lifecycle_phase),
    criticality: doc.criticality || '',
    criticalityColor: CRITICALITY_COLORS[doc.criticality] || 'default',
    priority: doc.priority || '',
    hasConflict: Boolean(doc._conflict),
    isDeleted: Boolean(doc._deleted),
    scheduledDate: formatDate(doc.scheduled_date),
    assetId: doc.asset_id || '',
    woType,
    woTypeLabel: WO_TYPE_LABELS[woType] || woType,
    woTypeColor: WO_TYPE_COLORS[woType] || 'default',
    symptomNote: doc.symptom_note || '',
    jobPlanId: doc.job_plan_id || '',
    plannedHours: doc.planned_hours || 0
  };
}

export function toViewModelList(docs) {
  if (!Array.isArray(docs)) return [];
  return docs.map(toViewModel);
}

/**
 * Valida las notas técnicas requeridas para la transición INPRG → COMP.
 * @param {{ symptom_note?: string, cause_note?: string, action_note?: string }} notes
 * @returns {{ valid: boolean, errors: { symptom_note?: string, action_note?: string } }}
 */
export function validateCompletion(notes) {
  const errors = {};

  if (!notes?.symptom_note?.trim()) {
    errors.symptom_note = 'Este campo es obligatorio';
  }
  if (!notes?.action_note?.trim()) {
    errors.action_note = 'Este campo es obligatorio';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

export default toViewModel;
