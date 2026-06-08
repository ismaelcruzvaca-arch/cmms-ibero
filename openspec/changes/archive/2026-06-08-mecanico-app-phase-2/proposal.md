# Proposal: App del Mecánico (Fase 2) — Ejecución de OT

## Problem
The mechanic can see the work order list but cannot interact with any work order. Tapping a card only logs the ID. The mechanic needs a guided wizard to advance work orders through their lifecycle (INICIAR → COMPLETAR → CERRAR) with progressive disclosure of fields.

## Approach
- **WorkOrderDrawer** (MUI Drawer overlay) opens on card tap
- Actions determined by FSM: APPROVED→"Iniciar", INPRG→"Completar", COMP→"Cerrar"
- Notes form (symptom_note, cause_note, action_note) renders only in INPRG
- INPRG→COMP requires symptom_note + action_note (validated by adapter pure function)
- Container/Presenter pattern, single PR, ~280 lines

## Scope
- Drawer overlay with dark backdrop, slide from right
- Phase-guided action buttons with confirmation dialog
- Conditional technical notes form
- Validation at INPRG→COMP transition
- Loading/error states during transitions
- Read-only detail view at top of drawer

## Out of Scope
- Photo capture
- Parts/materials tracking
- Navigation to separate detail page
- Signature capture
