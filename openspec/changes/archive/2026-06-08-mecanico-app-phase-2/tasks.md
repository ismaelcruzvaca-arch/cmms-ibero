# Tasks: App del Mecánico (Fase 2) — Ejecución de OT

## Review Workload Forecast
- Estimated changed lines: **~280**
- 400-line budget risk: **Low**
- Chained PRs recommended: **No**
- Decision needed before apply: **No**

## Task List

### Phase 1: Adapter — Validation Function

- [x] Task 1.1: Add validateCompletion to adapter
**File**: `src/lib/adapters/workOrderAdapter.js`
**Action**: Modify
**Description**: Add a pure function `validateCompletion(notes)` that validates the INPRG→COMP transition:
- `symptom_note` trimmed, non-empty → error "Este campo es obligatorio"
- `action_note` trimmed, non-empty → error "Este campo es obligatorio"
- `cause_note` optional, no validation
- Returns `{ valid: boolean, errors: { symptom_note?: string, action_note?: string } }`
- Export as named export. No side effects, no imports beyond existing ones.
**Acceptance**: `validateCompletion({ symptom_note: '', action_note: 'Fixed' })` returns `{ valid: false, errors: { symptom_note: 'Este campo es obligatorio' } }`; all fields filled returns `{ valid: true, errors: {} }`; cause_note omitted is valid.

### Phase 2: Presenters

- [x] Task 2.1: Create WorkOrderDetail
**File**: `src/components/mechanic/WorkOrderDetail.jsx`
**Action**: Create
**Description**: Presenter component. Props: `{ workOrder: WorkOrderViewModel }`. Renders a read-only detail view using MUI Card/CardContent:
- equipmentId (bold, large)
- WorkOrderStatusBadge
- description (full, no truncation)
- criticality accent bar (left border, same pattern as WorkOrderCard)
- Row: Prioridad, Tipo, Horas Planificadas
- Row: Fecha Programada
- Left border colored by criticalityColor (same as card)
No hooks, no data fetching. Default export.
**Acceptance**: Renders all fields read-only; criticalityColor drives border; integrates WorkOrderStatusBadge.

- [x] Task 2.2: Create WorkOrderNotesForm
**File**: `src/components/mechanic/WorkOrderNotesForm.jsx`
**Action**: Create
**Description**: Presenter component. Props: `{ values, onChange, errors, lifecyclePhase }`. Renders three MUI TextField (multiline, minRows=3) in a stacked layout only when `lifecyclePhase === 'INPRG'`:
- "Síntomas observados" (required) — value=values.symptom_note, error=!!errors.symptom_note, helperText=errors.symptom_note
- "Causa probable" (optional) — value=values.cause_note, no error state
- "Acción realizada" (required) — value=values.action_note, error=!!errors.action_note, helperText=errors.action_note
Each calls `onChange(field, value)` on input. Section labeled "Notas técnicas" with a small header.
No hooks, no data fetching. Default export.
**Acceptance**: Renders 3 textareas when INPRG; renders nothing for other phases; onChange fires per keystroke; error state renders red border + helperText.

- [x] Task 2.3: Create WorkOrderActions
**File**: `src/components/mechanic/WorkOrderActions.jsx`
**Action**: Create
**Description**: Presenter component. Props: `{ lifecyclePhase, onAction, isSubmitting, validationErrors }`. Inspects `getAllowedTransitions(phase)` from fsm.js. Renders a single MUI Button with:
- Phase→label mapping: APPROVED→"Iniciar", INPRG→"Completar", COMP→"Cerrar"
- Color mapping: APPROVED→primary, INPRG→success, COMP→warning
- `disabled` when isSubmitting or validationErrors.length > 0
- Shows CircularProgress(size=20) inside button when isSubmitting
- MUI Tooltip wrapping the button when disabled by validationErrors: "Completá los campos obligatorios (Síntomas y Acción) antes de finalizar."
- If no allowed transitions (CLOSED), renders nothing
No hooks. Default export. Import `getAllowedTransitions` from `../../lib/fsm.js`.
**Acceptance**: APPROVED shows "Iniciar" button; INPRG shows "Completar" (disabled + tooltip when validation errors); COMP shows "Cerrar"; CLOSED renders nothing; isSubmitting shows spinner.

### Phase 3: Container

- [x] Task 3.1: Create WorkOrderDrawer
**File**: `src/components/mechanic/WorkOrderDrawer.jsx`
**Action**: Create
**Description**: Container component. Props: `{ workOrder, open, onClose, onTransition }`. MUI Drawer with `anchor="right"`, `width: { xs: '100%', sm: 420 }`. Contains:
- **Header**: "Orden de Trabajo" title + Close (X) IconButton
- **WorkOrderDetail** (read-only)
- **Divider**
- **WorkOrderNotesForm** (conditional: only when lifecyclePhase === 'INPRG')
- **Divider** before actions
- **WorkOrderActions** at the bottom
- **ConfirmationDialog**: MUI Dialog shown before executing transition

State management inside the drawer:
- `notes: { symptom_note, cause_note, action_note }` — local state for form fields
- `errors: { symptom_note?: string, action_note?: string }` — validation errors
- `isSubmitting: boolean` — loading state during transition
- `confirmOpen: boolean` — confirmation dialog visibility
- `pendingTransition: string | null` — the target phase to transition to

Flow:
1. Action button clicked → validate (if INPRG→COMP) → if invalid, setErrors → if valid, setPendingTransition, setConfirmOpen(true)
2. Confirmation confirmed → setSubmitting(true), call onTransition(id, { lifecycle_phase, ...notes })
3. onTransition returns `{ success, error }`:
   - Success → snackbar/success feedback → setTimeout(onClose, 800)
   - Error → setErrorMessage, setSubmitting(false)
4. Confirmation cancelled → setPendingTransition(null), setConfirmOpen(false)

On drawer close/open: reset notes, errors, isSubmitting state.
Close blocked when isSubmitting (backdrop click disabled, X button disabled).

Load WorkOrderNotesForm validation errors from adapter's `validateCompletion`.
Import: `validateCompletion` from adapter, `getAllowedTransitions` from fsm.js.
Default export.
**Acceptance**: Opens as overlay with dark backdrop; shows all components; validation blocks INPRG→COMP; success closes drawer; errors show inline.

- [x] Task 3.2: Wire into MechanicDashboard
**File**: `src/pages/MechanicDashboard.jsx`
**Action**: Modify
**Description**: Add draw state management:
- `const [selectedWorkOrder, setSelectedWorkOrder] = useState(null)`
- `const [drawerOpen, setDrawerOpen] = useState(false)`
- Update `handleSelect(id)` to find the work order by ID, set state, open drawer
- Add `handleTransition(id, updates)` that calls `updateWorkOrder(id, updates)` from the hook
- Import `updateWorkOrder` from hook return destructure (it's already returned)
- Import `WorkOrderDrawer` from `../components/mechanic/WorkOrderDrawer.jsx`
- Render `<WorkOrderDrawer>` at the bottom of the component tree (inside the Box)
**Acceptance**: Tapping a card opens the drawer; transitions update RxDB; drawer reflects state changes.

## Migration Safety Cross-Check

| Concern | Mitigation |
|---------|------------|
| **Drawer opens without data** | handleSelect finds by ID from existing workOrders state — always synchronous |
| **Validation bypass on INPRG→COMP** | Both UI (tooltip+disabled) and adapter layer (pure function) enforce it |
| **Re-render on notes change** | Notes are local state in Drawer, not in RxDB — no unnecessary replication |
| **Concurrent transitions** | isSubmitting blocks all buttons and drawer close during transition |
| **Drawer width on mobile** | Responsive: 100% on xs (<600px), 420px on sm+ |
