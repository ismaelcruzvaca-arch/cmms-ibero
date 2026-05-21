const ALLOWED_TRANSITIONS = {
  WAPPR: ['APPROVED'],
  APPROVED: ['INPRG'],
  INPRG: ['COMP'],
  COMP: ['CLOSED'],
  CLOSED: []
};

const PHASE_LABELS = {
  WAPPR: 'Pendiente Aprobación',
  APPROVED: 'Aprobada',
  INPRG: 'En Progreso',
  COMP: 'Completada',
  CLOSED: 'Cerrada'
};

const PHASE_COLORS = {
  WAPPR: 'warning',
  APPROVED: 'info',
  INPRG: 'primary',
  COMP: 'success',
  CLOSED: 'default'
};

export function isValidTransition(fromPhase, toPhase) {
  if (fromPhase === toPhase) return true;
  return ALLOWED_TRANSITIONS[fromPhase]?.includes(toPhase) ?? false;
}

export function getAllowedTransitions(phase) {
  return ALLOWED_TRANSITIONS[phase] ?? [];
}

export function isTerminal(phase) {
  return ALLOWED_TRANSITIONS[phase]?.length === 0;
}

export function getPhaseLabel(phase) {
  return PHASE_LABELS[phase] || phase;
}

export function getPhaseColor(phase) {
  return PHASE_COLORS[phase] || 'default';
}
