# Delta for mechanic-work-order-execution

## ADDED Requirements

### Requirement: Focus Mode Modal

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

### Requirement: Sampling Resolution at WO Open

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

### Requirement: Work Order Auditability

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

### Requirement: Block A HARD Gate on INPRG → COMP

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

### Requirement: Blocks B/C SOFT Gate with 60d Grace Period

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

## MODIFIED Requirements

### Requirement: Phase-Guided Actions

(Previously: R2 listed only Iniciar, Completar, Cerrar buttons.)
The drawer MUST show a **"Begin Close-Out"** button when `lifecycle_phase = 'INPRG'` that opens FocusModeModal instead of triggering a direct transition. The existing **"Completar"** button SHALL remain but SHALL be disabled (with tooltip) while checklist items are pending.

#### Scenario: INPRG drawer shows Begin Close-Out

- GIVEN a work order in INPRG phase
- WHEN the drawer opens
- THEN a "Iniciar Cierre" (Begin Close-Out) button is shown
- AND the "Completar" button is disabled with tooltip "Completá el checklist de cierre primero"

### Requirement: Validation on Close (INPRG → COMP)

(Previously: R4 validated only symptom_note and action_note.)
Before the INPRG → COMP transition, the system MUST additionally validate:
- Block A checklist is COMPLETED with all items PASS (HARD) OR no Block A template applies
- Blocks B/C: if within SOFT period, allow with audit flag; if HARD period, block

#### Scenario: Block A validation added to close

- GIVEN a work order with an IN_PROGRESS Block A checklist
- WHEN the mechanic attempts INPRG → COMP
- THEN validation fails with Block A message
- AND the button remains disabled until Block A is completed
