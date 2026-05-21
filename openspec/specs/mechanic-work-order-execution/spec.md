# Spec: mechanic-work-order-execution

## Overview

The Mechanic Work Order Execution wizard provides a guided interaction overlay for mechanics to advance work orders through their ISO 14224 lifecycle. Using progressive disclosure, it reveals actions and form fields only when they are valid for the current lifecycle phase. The wizard follows the same Container/Presenter pattern established in Phase 1, with validation enforced at the INPRG→COMP transition.

## Requirements

### R1: Work Order Drawer (Overlay)

A `<WorkOrderDrawer>` MUST open as an overlay (MUI Drawer with dark backdrop) when the mechanic taps a work order card. It MUST NOT replace the current screen. It MUST show:
- Backdrop overlay that darkens the background
- Slide-in animation from the right edge
- Close button (X) in the header
- Loading state while processing transitions

### R2: Phase-Guided Actions

The drawer MUST render action buttons based on `getAllowedTransitions(phase)`:
- `APPROVED` → **"Iniciar"** button (transitions to INPRG)
- `INPRG` → **"Completar"** button (transitions to COMP)
- `COMP` → **"Cerrar"** button (transitions to CLOSED)
- `CLOSED` → No action buttons (read-only)
- `WAPPR` → Not shown (filtered by MechanicDashboard)

Each button MUST show a confirmation dialog before executing:
- "¿Estás seguro de marcar como {Iniciada/Completada/Cerrada} esta orden?"

### R3: Conditional Notes Form (INPRG only)

When `lifecycle_phase === 'INPRG'`, the drawer MUST render three textarea fields:
- `symptom_note` — "Síntomas observados" (required)
- `cause_note` — "Causa probable" (optional)
- `action_note` — "Acción realizada" (required)

These fields MUST NOT render in any other lifecycle phase.

### R4: Validation on Close (INPRG → COMP)

Before allowing the INPRG → COMP transition, the system MUST validate:
- `symptom_note` is non-empty (CRITICAL)
- `action_note` is non-empty (CRITICAL)
- `cause_note` MAY be empty (optional)

If validation fails, the **"Completar"** button MUST be disabled with a tooltip: "Completá los campos obligatorios (Síntomas y Acción) antes de finalizar."

### R5: Transition Execution with Loading

When the mechanic confirms a transition:
1. The drawer MUST show a loading state (CircularProgress overlay or disabled form)
2. The system calls `updateWorkOrder(id, { lifecycle_phase, symptom_note?, cause_note?, action_note? })`
3. On success: brief success feedback, then close the drawer
4. On error: show error message, keep drawer open, allow retry
5. The work order list MUST update reactively via RxDB subscription

### R6: Read-Only Detail View

The drawer MUST display a read-only summary of the work order at the top:
- `equipmentId` — bold header
- `description` — full text
- `lifecyclePhase` + `lifecycleLabel` — status badge
- `criticalityColor` — left accent border (same pattern as card)
- `priority`, `scheduledDate`, `woType`, `plannedHours`

## Scenarios

### Scenario 1: Mechanic opens a work order

GIVEN the mechanic taps a card in the work order list
WHEN the drawer opens
THEN it shows the work order details at the top
AND the action buttons reflect the current lifecycle_phase
AND the notes form is shown only if the phase is INPRG

### Scenario 2: Mechanic starts an approved work order

GIVEN the work order is in APPROVED phase
WHEN the mechanic clicks "Iniciar"
THEN a confirmation dialog appears
WHEN confirmed
THEN lifecycle_phase transitions to INPRG
AND the drawer updates reactively
AND the notes form now appears

### Scenario 3: Mechanic completes work with validation

GIVEN the work order is in INPRG phase
WHEN the mechanic clicks "Completar" with empty symptom_note or action_note
THEN validation fails
AND the button is disabled with a tooltip explaining why
WHEN the mechanic fills both required fields and clicks "Completar"
THEN the confirmation dialog appears
WHEN confirmed
THEN lifecycle_phase transitions to COMP
AND the drawer shows success then closes

### Scenario 4: Mechanic closes a completed work order

GIVEN the work order is in COMP phase
WHEN the mechanic clicks "Cerrar"
THEN confirmation dialog appears
WHEN confirmed
THEN lifecycle_phase transitions to CLOSED
AND the drawer shows success and closes
AND the work order no longer appears in the filtered list (filtered by WAPPR/APPROVED)

### Scenario 5: Network error during transition

GIVEN the mechanic confirms a transition
WHEN updateWorkOrder returns an error
THEN the drawer shows a clear error message
AND the mechanic can retry or close
AND no partial state is left in the UI

## Data Contracts

### WorkOrderDrawer Props
```ts
interface WorkOrderDrawerProps {
  workOrder: WorkOrderViewModel;
  open: boolean;
  onClose: () => void;
  onTransition: (id: string, updates: object) => Promise<{ success: boolean; error?: string }>;
}
```

### WorkOrderNotesForm Props
```ts
interface WorkOrderNotesFormProps {
  values: { symptom_note: string; cause_note: string; action_note: string };
  onChange: (field: string, value: string) => void;
  errors: { symptom_note?: string; action_note?: string };
  lifecyclePhase: string;
}
```

### WorkOrderActions Props
```ts
interface WorkOrderActionsProps {
  lifecyclePhase: string;
  onAction: (targetPhase: string) => void;
  isSubmitting: boolean;
  validationErrors?: string[];
}
```
