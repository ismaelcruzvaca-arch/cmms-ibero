# Design: FMEA Guided Analysis Wizard

## Technical Approach

Embed a 3-level FMEA+RCM wizard as a **collapsible section inside `AddAssetForm`**, gated by a toggle. Three presenters (`LevelQuick`, `LevelExpert`, `LevelEngineering`) share a common container (`FmeaWizard`) that manages unified state. A new hook (`useFmeaRepository.js`) wraps RxDB access for the 4 FMEA collections (must be registered in `rxdb.js` first). Planner bandeja is a new tab/page with RxDB query for orphan/pending analyses. All strategy computation is server-side via existing `fn_determine_rcm_strategy()` trigger — frontend sends q1-q5 and reads back `recommended_strategy`.

## Architecture Decisions

| # | Decision | Options | Tradeoffs | Chosen |
|---|----------|---------|-----------|--------|
| 1 | **State model** | Store S/O/D as 1-10 always, map down to categorical for Level 1 display | Single source of truth vs dual model with conversion bugs | **1-10 core**: Level 1 maps display labels ↔ 1-10 via constants; Level 2/3 use directly. Switching levels preserves 1-10 state |
| 2 | **Wizard state lifetime** | Keep persisted analysis rows in RxDB vs ephemeral React state | React state lost on refresh vs RxDB durable + reactive | **RxDB first**: Save on "Guardar", read back `recommended_strategy` after sync. Local state is ephemeral per-row draft |
| 3 | **FMEA collection registration** | Register in `rxdb.js` now vs separate migration | Ship block vs atomic change | **Register in `rxdb.js`** with `_deleted` field. 4 schemas for: `component_types`, `asset_components`, `failure_mode_catalog`, `fmea_rcm_analysis` |
| 4 | **Replication strategy** | Pull-only for catalogs, pull+push for analysis | Catalogs are read-only seeds from Supabase, analysis is user-generated | **Pull-only** for 3 catalog collections; **pull+push** for `fmea_rcm_analysis` (upserts flow bidirectionally) |
| 5 | **Progress tracking** | COUNT RxDB docs per asset_id vs inline counter | Query is reactive and auto-updates vs manual increment | **RxDB query**: `fmea_rcm_analysis.find().where('asset_id').eq(currentAssetId)` — reactive subscription |
| 6 | **Planner bandeja location** | New page (route) vs filter in existing dashboard | SPA has no router; adding route needs React Router | **New tab in `App.jsx`**: Add a 4th tab "Bandeja" with badge, rendered when role=PLANNER. No router dependency |
| 7 | **Action Priority (Level 3)** | Compute client-side vs compute server-side | AP matrix is a known algorithm (AIAG/VDA S×O×D thresholds), no DB trigger needed | **Client-side utility function**: `computeActionPriority(S,O,D)` → `{level:'H'|'M'|'L', color}`. No server dependency |
| 8 | **RCM question wording** | Same wording across levels vs level-specific | Shared q1-q5 fields but display text differs | **Workshop wording** for Level 1, **standard SAE JA1011 wording** for Level 2/3. Both write to same q1-q5 boolean fields |

## Component Tree

```
AddAssetForm (modified)
  ├── Collapse (toggle: "¿Realizar análisis FMEA?")
  │     └── FmeaWizard (container)
  │           ├── FmeaLevelSelector — Radio group: Rápido | Experto | Ingeniería
  │           ├── FmeaProgressBar — "FMEA: 30% — 3 de 10 modos evaluados"
  │           ├── ComponentSelector — Select filtered by asset_components
  │           ├── FailureModeSelector — Select filtered by component_type_id
  │           ├── [LevelQuick | LevelExpert | LevelEngineering] (rendered via level state)
  │           │     ├── S/O/D inputs (categorical selects or 1-10 sliders)
  │           │     └── RcmQuestions — 5 Yes/No toggles with level-specific wording
  │           ├── SodDefinitionTables (shared — reusable by all levels)
  │           └── SaveButton / Cancel
  │
App.jsx (modified)
  └── Tab "Bandeja" (visible for PLANNER role)
        └── PlannerBandeja
              ├── PendingAnalysesSection — fmea_rcm_analysis WHERE strategy IS NULL
              └── OrphanList (SDD 2 placeholder)
```

## Component Specs

| Component | File | Props | State | Behavior |
|-----------|------|-------|-------|----------|
| **FmeaWizard** | `src/components/fmea/FmeaWizard.jsx` | `assetId`, `db` | `level` (1-3), `selectedComponent`, `selectedFm`, `sodValues` {s,o,d}, `q1-q5`, `notes`, `failureCause`, `mitigations`, `frequency` | Container: manages all wizard state, calls `useFmeaRepository` for CRUD, passes down to level presenters |
| **FmeaProgressBar** | `src/components/fmea/FmeaProgressBar.jsx` | `assetId`, `componentId`, `db` | `completed`, `total`, `loading` | RxDB subscription: count analysis for (assetId, componentId) / count failure modes for component type |
| **LevelQuick** | `src/components/fmea/LevelQuick.jsx` | `sodValues`, `onChange`, `q1-q5`, `onQChange` | — (controlled) | Renders categorical selects, maps labels↔1-10, workshop RCM wording |
| **LevelExpert** | `src/components/fmea/LevelExpert.jsx` | `sodValues`, `onChange`, `q1-q5`, `onQChange`, `notes`, `onNotesChange` | — (controlled) | MUI Slider 1-10 with marks, info icon opens SodDefinitionTables, standard RCM wording, notes multiline |
| **LevelEngineering** | `src/components/fmea/LevelEngineering.jsx` | All LevelExpert props + `failureCause`, `onCauseChange`, `mitigations`, `onMitigationsChange`, `frequency`, `onFreqChange` | — (controlled) | Inherits Expert UI + action priority display (client-side AP computation), cause+mitigation textareas, frequency Select |
| **FmeaLevelSelector** | `src/components/fmea/FmeaLevelSelector.jsx` | `level`, `onLevelChange` | — | MUI ToggleButtonGroup with tooltips explaining each level's audience |
| **SodDefinitionTables** | `src/components/fmea/SodDefinitionTables.jsx` | `dimension` ('severity'\|'occurrence'\|'detection') | — (open/close via parent) | MUI Dialog with AIAG/VDA definition table for the selected dimension |
| **RcmQuestions** | `src/components/fmea/RcmQuestions.jsx` | `q1-q5` values, `onChange`, `wordingStyle` ('quick'\|'standard') | — | 5 rows of Switch/Checkbox with level-appropriate labels |
| **PlannerBandeja** | `src/components/fmea/PlannerBandeja.jsx` | `db`, `userId` | `pending`, `orphans`, `filter` | RxDB subscriptions for pending analyses (strategy IS NULL) and orphans from `failure_occurrences` (SDD 2) |

## Data Flow

```
AddAssetForm (asset_id known)
    │
    ▼
FmeaWizard (mounts after user toggles ON)
    │
    ├── useFmeaRepository hook
    │       ├── db.component_types.find()     ──► pull-only catalog
    │       ├── db.asset_components.find()    ──► pull-only catalog
    │       ├── db.failure_mode_catalog.find()──► pull-only catalog
    │       └── db.fmea_rcm_analysis.upsert() ──► pull+push ──► Supabase
    │                                                 │
    │                                                 ▼
    │                                         fn_determine_rcm_strategy()
    │                                         (trigger computes strategy)
    │                                                 │
    │           ◄── re-sync reads recommended_strategy back
    │
    └── Display: RPN = S × O × D (client computed preview)
                 Strategy = recommended_strategy (read back from DB trigger)

PlannerBandeja
    ├── db.fmea_rcm_analysis.find({ strategy: null })  ──► pending list
    └── db.failure_occurrences.find({ no_analysis_link })──► orphans (SDD 2)
```

## Route Design

No new routes. `PlannerBandeja` is a new tab in `App.jsx` (index 3, after Órdenes/Activos, gated by role). The existing tab system avoids adding React Router.

## File Changes

### New Files (11)

| File | Description |
|------|-------------|
| `src/hooks/useFmeaRepository.js` | RxDB hook for 4 FMEA collections: CRUD, reactive subscriptions, SOD mapping |
| `src/components/fmea/FmeaWizard.jsx` | Container component — mounts in AddAssetForm, manages level+SOD+RCM state |
| `src/components/fmea/FmeaLevelSelector.jsx` | ToggleButtonGroup: Rápido/Experto/Ingeniería |
| `src/components/fmea/FmeaProgressBar.jsx` | LinearProgress + label "FMEA: X% — N de M" |
| `src/components/fmea/LevelQuick.jsx` | Categorical S/O/D selects + workshop RCM |
| `src/components/fmea/LevelExpert.jsx` | 1-10 sliders + standard RCM + notes |
| `src/components/fmea/LevelEngineering.jsx` | Expert + cause, mitigations, frequency, AP |
| `src/components/fmea/SodDefinitionTables.jsx` | AIAG/VDA definition dialogs for S/O/D |
| `src/components/fmea/RcmQuestions.jsx` | Shared 5-question Yes/No component |
| `src/components/fmea/PlannerBandeja.jsx` | Planner page: pending + orphans sections |
| `src/fmeaConstants.js` | Maps: level1 labels↔1-10, RCM wording tables, AP matrix |

### Modified Files (3)

| File | Change |
|------|--------|
| `src/lib/rxdb.js` | Register 4 new collections (`component_types`, `asset_components`, `failure_mode_catalog`, `fmea_rcm_analysis`) + their replication handlers in `startAllReplications()` |
| `src/components/AddAssetForm.jsx` | Add Collapse section with toggle + FmeaWizard embed after technical specs section |
| `src/App.jsx` | Add 4th Tab "Bandeja" (gated by role=PLANNER), import PlannerBandeja, add pending count badge to tab |

## Interfaces / Contracts

```javascript
// SOD mapping constants (src/fmeaConstants.js)
const LEVEL1_MAP = {
  severity: [
    { label: 'Bajo',   range: [1,3],  value: 2 },
    { label: 'Medio',  range: [4,7],  value: 5 },
    { label: 'Alto',   range: [8,10], value: 9 },
  ],
  occurrence: [
    { label: 'Nunca',     range: [1,2],  value: 1 },
    { label: 'Rara vez',  range: [3,5],  value: 4 },
    { label: 'Seguido',   range: [6,8],  value: 7 },
    { label: 'Siempre',   range: [9,10], value: 9 },
  ],
  detection: [
    { label: 'Siempre', range: [1,2],  value: 1 },
    { label: 'A veces', range: [3,6],  value: 5 },
    { label: 'No',      range: [7,10], value: 8 },
  ],
};

// Core SOD state shape (shared across levels)
const sodStateShape = { severity: 5, occurrence: 3, detection: 4 }; // 1-10 integers

// Action Priority (Level 3 only)
function computeActionPriority(S, O, D) {
  const rpn = S * O * D;
  if (S >= 9 && O >= 5 && D >= 5) return { level: 'H', label: 'Alta', color: 'error', rpn };
  if (S >= 7 && O >= 6 && D >= 3)  return { level: 'H', label: 'Alta', color: 'error', rpn };
  if (S >= 4 && O >= 3 && D >= 5)  return { level: 'M', label: 'Media', color: 'warning', rpn };
  return { level: 'L', label: 'Baja', color: 'success', rpn };
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| **Unit** | `fmeaConstants`: LEVEL1_MAP bidirectional mapping (label→1-10, 1-10→label) | Jest: verify each category maps to correct numeric value and range |
| **Unit** | `computeActionPriority()`: all AP threshold combos | Jest: test all H/M/L boundary conditions |
| **Unit** | RCM decision truth table: q1-q5 → expected strategy | Jest: test all 8 strategy combos match DB trigger logic |
| **Integration** | `useFmeaRepository`: insert/query/update analysis in RxDB | Vitest with fake Dexie: verify upsert, reactive subscription fires |
| **Integration** | `FmeaWizard`: level switching preserves state | React Testing Library: mount with test DB, change level, verify SOD values persist |
| **Integration** | `PlannerBandeja`: RxDB query filters pending analyses | RTL + fake Dexie with known data shape, verify correct rows render |
| **E2E** | Full wizard flow in AddAssetForm | Playwright: toggle ON, select component+FM, complete Level 1, save, verify row in RxDB |
| **E2E** | Strategy read-back after DB trigger | Playwright (requires Supabase branch): save analysis, wait for sync, verify strategy badge appears |

**Note**: E2E tests depend on Supabase branch with seeded FMEA data (component_types, failure_mode_catalog). The RxDB registration in `rxdb.js` is a prerequisite for all integration tests.

## Migration / Rollout

No migration — additive frontend only. The RxDB collections are new registrations; existing data is unaffected. Rollback: remove FMEA collections from `rxdb.js`, delete `src/components/fmea/`, remove toggle from `AddAssetForm`, remove Bandeja tab from `App.jsx`.

## Open Questions

- [ ] **SDD 2 dependency**: `PlannerBandeja` orphan occurrences section depends on `failure_occurrences` table (SDD 2, not yet implemented). Should we ship the bandeja with only pending analyses section first and add orphans later?
- [ ] **Level 3 `failure_cause` column**: The spec says store in `fmea_rcm_analysis.failure_cause` but backend SDD 1 may not include this column. Need to verify and potentially add via migration if missing.
- [ ] **Router future**: Adding more pages (planner bandeja, etc.) may warrant React Router. Decision deferred — tabs suffice for now.
