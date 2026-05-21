# Design: App del Mecánico (Fase 2) — Ejecución de OT

## Architecture Overview

```
<MechanicDashboard>                              ← CONTAINER (exists)
  └── <WorkOrderList onSelect={handleSelect}>    ← opens drawer
       └── <WorkOrderCard />                     ← tap handler

<WorkOrderDrawer>                                ← NUEVO CONTAINER (overlay)
  ├── WorkOrderDetail (presenter, read-only)
  ├── WorkOrderNotesForm (presenter, conditional)
  └── WorkOrderActions (presenter, phase-driven)
       └── ConfirmationDialog (inline)
```

## Component Tree

```
<App>
  └── <MechanicDashboard>
       ├── <NavSyncIndicator />
       ├── <WorkOrderList onSelect={openDrawer}>
       │    └── <WorkOrderCard onSelect={fn} />
       └── <WorkOrderDrawer                      ← NEW
              workOrder={selectedWO}
              open={drawerOpen}
              onClose={closeDrawer}
              onTransition={handleTransition}>
            ├── <WorkOrderDetail                  ← NEW (presenter)
            │      workOrder={vm} />
            ├── {phase === 'INPRG' && (
            │    <WorkOrderNotesForm              ← NEW (presenter)
            │      values={notes}
            │      onChange={handleNoteChange}
            │      errors={validationErrors} />
            │ )}
            └── <WorkOrderActions                 ← NEW (presenter)
                   lifecyclePhase={phase}
                   onAction={handleAction}
                   isSubmitting={submitting}
                   validationErrors={validationErrors} />
       </WorkOrderDrawer>
```

## Data Flow

```
1. Mechanic taps WorkOrderCard → MechanicDashboard.handleSelect(id)
2. handleSelect: setSelectedWorkOrder(findById), setDrawerOpen(true)
3. WorkOrderDrawer renders with the selected work order
4. User fills notes (if INPRG) and clicks action button
5. ConfirmationDialog: confirm/cancel
6. On confirm:
   a. validateNotes() if INPRG→COMP → if fail, setErrors, disable button
   b. setSubmitting(true)
   c. updateWorkOrder(id, { lifecycle_phase: targetPhase, ...notes })
   d. if success → setTimeout(closeDrawer, 800)
   e. if error → setError(message), setSubmitting(false)
7. RxDB subscription reactively updates the work order list
```

## Key Design Decisions

### DD1: WorkOrderDrawer as Container
- **File**: `src/components/mechanic/WorkOrderDrawer.jsx`
- Owns the wizard state: notes values, validation errors, isSubmitting, transitionError
- Receives `workOrder` as a prop (already transformed by MechanicDashboard)
- Calls `updateWorkOrder` from the hook (passed down via `onTransition` callback)
- Uses MUI `<Drawer>` with `anchor="right"` and `variant="temporary"`
- Slide transition, dark backdrop, `width: { xs: '100%', sm: 420 }`

### DD2: WorkOrderDetail (Presenter)
- **File**: `src/components/mechanic/WorkOrderDetail.jsx`
- Props: `{ workOrder: WorkOrderViewModel }`
- Renders the same card layout as WorkOrderCard but full-width and read-only
- Shows all fields: equipmentId, description, lifecycle badge, criticality indicator, priority, scheduledDate, woType, plannedHours
- No hooks, no data fetching

### DD3: WorkOrderNotesForm (Presenter)
- **File**: `src/components/mechanic/WorkOrderNotesForm.jsx`
- Props: `{ values, onChange, errors, lifecyclePhase }`
- Renders ONLY when `lifecyclePhase === 'INPRG'` (gate controlled by parent)
- Three MUI `<TextField>` multiline fields:
  - `symptom_note`: label "Síntomas observados", required, `error` + `helperText` when empty
  - `cause_note`: label "Causa probable", optional
  - `action_note`: label "Acción realizada", required, `error` + `helperText` when empty
- Each field calls `onChange(field, value)` on input
- Section has a subtle "Notas técnicas" header with icon
- No hooks, no side effects

### DD4: WorkOrderActions (Presenter)
- **File**: `src/components/mechanic/WorkOrderActions.jsx`
- Props: `{ lifecyclePhase, onAction, isSubmitting, validationErrors }`
- Renders action buttons based on `getAllowedTransitions(phase)`:
  - Takes the FIRST allowed transition (no multiple choices in current FSM)
  - Button label maps: APPROVED→"Iniciar", INPRG→"Completar", COMP→"Cerrar"
- Button is:
  - `disabled` when isSubmitting OR validationErrors.length > 0
  - Shows `<CircularProgress size={20} />` when isSubmitting
  - Shows MUI `<Tooltip>` with validation message when disabled due to errors
- No hooks, no side effects

### DD5: Confirmation via Dialog (in Drawer container)
- Before executing a transition, the Drawer shows a MUI `<Dialog>`:
  - "¿Estás seguro de marcar como {Iniciada/Completada/Cerrada} esta orden?"
  - "Cancelar" and "Confirmar" buttons
  - The Dialog is owned by the Drawer container (not a separate component)

### DD6: Validation Logic
- **File**: `src/lib/adapters/workOrderAdapter.js` (add `validateCompletion` function)
- Pure function: `validateCompletion(notes)` → `{ valid: boolean, errors: { symptom_note?: string, action_note?: string } }`
- `symptom_note` must be non-empty (trim): "Este campo es obligatorio"
- `action_note` must be non-empty (trim): "Este campo es obligatorio"
- `cause_note` is optional, no error returned

### DD7: No Over-Fetching
- The Drawer receives the work order as a ViewModel from MechanicDashboard
- No additional database reads when the drawer opens
- All mutations go through the existing `updateWorkOrder` function

## File Map

| File | Action | Description |
|------|--------|-------------|
| `src/pages/MechanicDashboard.jsx` | MODIFY | Add drawer state, handleSelect opens drawer, handleTransition calls updateWorkOrder |
| `src/components/mechanic/WorkOrderDrawer.jsx` | CREATE | Container: MUI Drawer with wizard state, confirmation dialog, transition logic |
| `src/components/mechanic/WorkOrderDetail.jsx` | CREATE | Presenter: read-only detail view |
| `src/components/mechanic/WorkOrderNotesForm.jsx` | CREATE | Presenter: conditional notes fields with validation |
| `src/components/mechanic/WorkOrderActions.jsx` | CREATE | Presenter: phase-driven action buttons |
| `src/lib/adapters/workOrderAdapter.js` | MODIFY | Add `validateCompletion()` pure function |

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| **Drawer width too narrow on mobile** | Medium | Responsive width: 100% on xs, 420px on sm+. Test on 360px viewport. |
| **User closes drawer mid-transition** | Low | Block drawer close (disable backdrop click + X button) while isSubmitting. |
| **RxDB write fails silently** | Low | updateWorkOrder returns `{ error }` object — Drawer checks and displays it. |
| **Confirmation fatigue** | Low | Only one confirmation per action, action buttons are clearly labeled. |
