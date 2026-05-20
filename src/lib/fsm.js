/**
 * FSM — Finite State Machine for Work Order status transitions
 */

const ALLOWED_TRANSITIONS = {
  pending: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: []
};

export function isValidTransition(fromStatus, toStatus) {
  if (fromStatus === toStatus) return true;
  return ALLOWED_TRANSITIONS[fromStatus]?.includes(toStatus) ?? false;
}

export function getAllowedTransitions(status) {
  return ALLOWED_TRANSITIONS[status] ?? [];
}

export function isTerminal(status) {
  return ALLOWED_TRANSITIONS[status]?.length === 0;
}
