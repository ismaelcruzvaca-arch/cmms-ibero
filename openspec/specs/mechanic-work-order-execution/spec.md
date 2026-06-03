# Spec: mechanic-work-order-execution

## Overview

The Mechanic Work Order Execution wizard provides a guided interaction overlay for mechanics to advance work orders through their ISO 14224 lifecycle. Using progressive disclosure, it reveals actions and form fields only when they are valid for the current lifecycle phase. The wizard follows the same Container/Presenter pattern established in Phase 1, with validation enforced at the INPRG→COMP transition. Checklist sampling resolution occurs at APPROVED→INPRG, and Focus Mode provides full-screen checklist execution during INPRG.

## Requirements

### R1: Work Order Drawer (Overlay)

A `<WorkOrderDrawer>` MUST open as an overlay (MUI Drawer with dark backdrop) when the mechanic taps a work order card. It MUST NOT replace the current screen. It MUST show:
- Backdrop overlay that darkens the background
- Slide-in animation from the right edge
- Close button (X) in the header
- Loading state while processing transitions

### R2: Phase-Guided Actions

(Previously: R2 listed only Iniciar, Completar, Cerrar buttons.)
The drawer MUST render action buttons based on `getAllowedTransitions(phase)`:
- `APPROVED` → **"Iniciar"** button (transitions to INPRG)
- `INPRG` → **"Iniciar Cierre"** (Begin Close-Out) button that opens FocusModeModal instead of triggering a direct transition, AND a **"Completar"** button that is disabled (with tooltip) while checklist items are pending
- `COMP` → **"Cerrar"** button (transitions to CLOSED)
- `CLOSED` → No action buttons (read-only)
- `WAPPR` → Not shown (filtered by MechanicDashboard)

The "Completar" button SHALL be disabled with tooltip "Completá el checklist de cierre primero" when Block A checklist is incomplete.

Each button MUST show a confirmation dialog before executing:
- "¿Estás seguro de marcar como {Iniciada/Completada/Cerrada} esta orden?"

### R3: Conditional Notes Form (INPRG only)

When `lifecycle_phase === 'INPRG'`, the drawer MUST render three textarea fields:
- `symptom_note` — "Síntomas observados" (required)
- `cause_note` — "Causa probable" (optional)
- `action_note` — "Acción realizada" (required)

These fields MUST NOT render in any other lifecycle phase.

### R4: Validation on Close (INPRG → COMP)

(Previously: R4 validated only symptom_note and action_note.)
Before the INPRG → COMP transition, the system MUST additionally validate:
- `symptom_note` is non-empty (CRITICAL)
- `action_note` is non-empty (CRITICAL)
- `cause_note` MAY be empty (optional)
- Block A checklist is COMPLETED with all items PASS (HARD) OR no Block A template applies
- Blocks B/C: if within SOFT period, allow with audit flag; if HARD period, block

If checklist validation fails, the **"Completar"** button MUST be disabled with a tooltip: "Completá el checklist de cierre primero" (Block A) or "El checklist Bloque {B|C} es obligatorio — contactá a tu supervisor" (Blocks B/C grace expired).

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

### R7: Health Index Display (Deferred to Phase 2)

No frontend changes in Phase 1. The data contract for WorkOrderDrawer SHALL be extended in Phase 2 to include `health_index` and `condition_event_id` fields when a CBM work order originates from a condition event. The WorkOrderDrawer UI will display these fields in a read-only section.

#### Scenario: Phase 2 — CBM WO shows HI in drawer

- GIVEN a CBM work order with condition_event_id and health_index=0.35
- WHEN the mechanic opens the WorkOrderDrawer (Phase 2)
- THEN a read-only HI badge SHALL be displayed at the top of the drawer
- AND the diagnosis text SHALL be shown in a condition summary section

### R8: Sampling Resolution at WO Open

When the mechanic transitions APPROVED → INPRG, the system MUST resolve which checklist templates apply by:
1. Find the work order's module (via asset → technological_modules)
2. Find templates for that module (module-wide + job_plan-specific)
3. Apply deterministic hash sampling for each block
4. Gate Block C by technician level (>= 3)
5. Create `checklist_instances` with IN_PROGRESS for each matching template

#### Scenario: Sampling resolves Block A only

- GIVEN a work order in module M-PACK
- AND Block A sampling_rate=100, Block B sampling_rate=0
- WHEN APPROVED → INPRG transition completes
- THEN only the Block A checklist_instance is created (IN_PROGRESS)

#### Scenario: Block C gated by level

- GIVEN a work order in module M-PACK
- AND the technician has `current_level=2` in M-PACK
- AND Block C sampling_rate=100
- WHEN APPROVED → INPRG transition completes
- THEN Block C checklist_instance SHALL NOT be created

### R9: Focus Mode Modal

The system MUST provide a `<FocusModeModal>` component — a full-screen modal overlay that presents checklist items one at a time. It SHALL NOT use the existing Drawer pattern.

- Full-screen with dark backdrop, no slide-in (unlike Drawer)
- One question per screen with large touch-friendly cards
- Large PASS (green) and FAIL (red) buttons with icons
- If FAIL: a causa_falla selector appears below (6 options from catalog)
- Photo capture button (if `requires_photo`), comment textarea (if `requires_comment`)
- Swipe/Next navigation — cannot proceed without PASS/FAIL on current item
- Progress indicator: "Item 3 de 12"
- Summary screen at end: all items with PASS/FAIL badges, option to review failed items
- "Submit" button on summary screen completes the checklist

#### Scenario: Focus Mode opens full-screen

- GIVEN a mechanic taps "Begin Close-Out" on a work order
- WHEN FocusModeModal opens
- THEN the modal is full-screen
- AND item 1 of N is displayed with PASS and FAIL buttons

#### Scenario: FAIL requires causa_falla selection

- GIVEN the mechanic taps FAIL on an item
- WHEN the causa_falla selector appears
- THEN submission is blocked until a causa_falla is selected
- AND the item cannot be left as FAIL without a cause

#### Scenario: Summary shows all results

- GIVEN the mechanic has responded to all N items
- WHEN reaching the summary screen
- THEN each item shows PASS/FAIL badge
- AND items with FAIL show their causa_falla
- AND the mechanic can tap "Submit" to finalize

#### Scenario: Skip optional item

- GIVEN an item with `optional=true`
- WHEN the mechanic taps "Skip" (or swipes without selecting)
- THEN no response is recorded for that item
- AND the mechanic proceeds to the next item

### R10: Block A HARD Gate on INPRG → COMP

The system MUST enforce a HARD gate on the INPRG → COMP transition: if a Block A checklist instance exists for the work order AND its status is NOT 'COMPLETED' with all items PASS, the transition SHALL be blocked.

#### Scenario: Block A checklist prevents COMP

- GIVEN a work order with an IN_PROGRESS Block A checklist
- WHEN the mechanic attempts INPRG → COMP
- THEN the transition SHALL be rejected
- AND the drawer SHALL show: "Completá el checklist de seguridad (Bloque A) antes de finalizar"

#### Scenario: Block A all PASS allows COMP

- GIVEN a work order with a COMPLETED Block A checklist where all items PASS
- WHEN the mechanic attempts INPRG → COMP
- THEN the transition SHALL succeed

### R11: Blocks B/C SOFT Gate with 60d Grace Period

The system MUST enforce a SOFT gate on Blocks B/C checklist completion: the transition INPRG → COMP SHALL be allowed even without checklist completion, but a 60-day grace period SHALL apply.

- If the checklist was NOT completed: the transition is ALLOWED, `is_auditable` is set, and warning is logged
- Within 60 days of the first SOFT violation, the behavior remains SOFT (warning + audit flag)
- After 60 days from the first SOFT violation, the gate becomes HARD permanently for that module+block combination globally

The 60d timer SHALL be calculated from the FIRST work order that had a SOFT violation for that module+block. After expiry, ALL work orders in that module+block SHALL have HARD gates.

#### Scenario: First SOFT violation starts 60d clock

- GIVEN a work order sampled for Block B
- AND no previous SOFT violations exist for this module+block
- WHEN the mechanic completes without the checklist
- THEN `is_auditable=true`
- AND the 60-day clock starts NOW for M-PACK Block B

#### Scenario: Within 60d, SOFT gate allows completion

- GIVEN the 60d grace period has not expired for M-PACK Block B
- WHEN the mechanic completes another work order without Block B checklist
- THEN the transition is allowed (SOFT)
- AND `is_auditable=true`

#### Scenario: After 60d, SOFT becomes HARD permanently

- GIVEN the 60d grace period has expired for M-PACK Block B
- WHEN any mechanic attempts COMP without Block B checklist completed
- THEN the transition is blocked (HARD)
- AND the drawer SHALL show: "El checklist Bloque B es obligatorio — contactá a tu supervisor"

### R12: Work Order Auditability

The `work_orders` table MUST add two columns:

| Column | Type | Constraints |
|--------|------|-------------|
| is_auditable | BOOLEAN | NOT NULL DEFAULT false |
| audit_reason | TEXT | NULLABLE |

`is_auditable` SHALL be set to `true` when a SOFT gate violation occurs (Block B or C checklist required but work order completed without it). `audit_reason` SHALL store the descriptive reason.

#### Scenario: SOFT gate violation triggers audit flag

- GIVEN a work order is sampled for Block B
- AND the mechanic completes the work order without completing the checklist
- WHEN INPRG → COMP transition completes
- THEN `is_auditable` SHALL be set to true
- AND `audit_reason` SHALL contain "Block B checklist required but not completed"

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
AND sampling resolution creates checklist_instances for applicable blocks
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

### Scenario 6: Sampling resolves with Block A only

GIVEN a work order in module M-PACK
AND Block A sampling_rate=100, Block B sampling_rate=0
WHEN APPROVED → INPRG transition completes
THEN only the Block A checklist_instance is created (IN_PROGRESS)

### Scenario 7: Block C gated by level

GIVEN a work order in module M-PACK
AND the technician has `current_level=2` in M-PACK
AND Block C sampling_rate=100
WHEN APPROVED → INPRG transition completes
THEN Block C checklist_instance SHALL NOT be created

### Scenario 8: Focus Mode opens full-screen

GIVEN a mechanic taps "Begin Close-Out" on a work order
WHEN FocusModeModal opens
THEN the modal is full-screen
AND item 1 of N is displayed with PASS and FAIL buttons

### Scenario 9: FAIL requires causa_falla selection

GIVEN the mechanic taps FAIL on an item
WHEN the causa_falla selector appears
THEN submission is blocked until a causa_falla is selected
AND the item cannot be left as FAIL without a cause

### Scenario 10: Summary shows all results

GIVEN the mechanic has responded to all N items
WHEN reaching the summary screen
THEN each item shows PASS/FAIL badge
AND items with FAIL show their causa_falla
AND the mechanic can tap "Submit" to finalize

### Scenario 11: Skip optional item

GIVEN an item with `optional=true`
WHEN the mechanic taps "Skip" (or swipes without selecting)
THEN no response is recorded for that item
AND the mechanic proceeds to the next item

### Scenario 12: Block A checklist prevents COMP

GIVEN a work order with an IN_PROGRESS Block A checklist
WHEN the mechanic attempts INPRG → COMP
THEN the transition SHALL be rejected
AND the drawer SHALL show: "Completá el checklist de seguridad (Bloque A) antes de finalizar"

### Scenario 13: Block A all PASS allows COMP

GIVEN a work order with a COMPLETED Block A checklist where all items PASS
WHEN the mechanic attempts INPRG → COMP
THEN the transition SHALL succeed

### Scenario 14: First SOFT violation starts 60d clock

GIVEN a work order sampled for Block B
AND no previous SOFT violations exist for this module+block
WHEN the mechanic completes without the checklist
THEN `is_auditable=true`
AND the 60-day clock starts NOW for M-PACK Block B

### Scenario 15: Within 60d, SOFT gate allows completion

GIVEN the 60d grace period has not expired for M-PACK Block B
WHEN the mechanic completes another work order without Block B checklist
THEN the transition is allowed (SOFT)
AND `is_auditable=true`

### Scenario 16: After 60d, SOFT becomes HARD permanently

GIVEN the 60d grace period has expired for M-PACK Block B
WHEN any mechanic attempts COMP without Block B checklist completed
THEN the transition is blocked (HARD)
AND the drawer SHALL show: "El checklist Bloque B es obligatorio — contactá a tu supervisor"

### Scenario 17: SOFT gate violation triggers audit flag

GIVEN a work order is sampled for Block B
AND the mechanic completes the work order without completing the checklist
WHEN INPRG → COMP transition completes
THEN `is_auditable` SHALL be set to true
AND `audit_reason` SHALL contain "Block B checklist required but not completed"

### Scenario 18: INPRG drawer shows Begin Close-Out

GIVEN a work order in INPRG phase
WHEN the drawer opens
THEN a "Iniciar Cierre" (Begin Close-Out) button is shown
AND the "Completar" button is disabled with tooltip "Completá el checklist de cierre primero"

### Scenario 19: Block A validation added to close

GIVEN a work order with an IN_PROGRESS Block A checklist
WHEN the mechanic attempts INPRG → COMP
THEN validation fails with Block A message
AND the button remains disabled until Block A is completed

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
  checklistGate?: {
    allowed: boolean;
    blocks: Array<{ block: string; status: string; soft?: boolean; reason?: string }>;
  };
  showBeginCloseOut?: boolean;
  onBeginCloseOut?: () => void;
}
```

### Data Contract Extension (Planned — Phase 2)

```ts
// Phase 2 extension of WorkOrderViewModel
interface WorkOrderViewModel {
  // ...existing fields
  health_index?: number;        // 0-1, only for CBM WOs
  condition_event_id?: string;  // FK, only for CBM WOs
  diagnosis?: string;           // from condition_events
  is_auditable?: boolean;       // from Phase 1 checklist gates
  audit_reason?: string;        // from Phase 1 checklist gates
}
```
