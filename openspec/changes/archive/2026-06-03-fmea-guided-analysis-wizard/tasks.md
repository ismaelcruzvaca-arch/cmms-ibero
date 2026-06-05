# Tasks: FMEA Guided Analysis Wizard

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,200 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (Foundation) → PR 2 (Components) → PR 3 (Levels) → PR 4 (Integration) |
| Delivery strategy | ask-on-risk |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Base | Lines |
|------|------|-----------|------|-------|
| 1 | Foundation: RxDB collections, adapter, hook, constants | PR 1 | feature branch `fmea-wizard` | ~350 |
| 2 | Reusable UI components: wizard container, selectors, progress, tables, RCM | PR 2 | PR 1 branch | ~400 |
| 3 | Level implementations: Quick, Expert, Engineering | PR 3 | PR 2 branch | ~450 |
| 4 | Integration + Bandeja: AddAssetForm, App.jsx, PlannerBandeja | PR 4 | PR 3 branch | ~210 |

## Phase 1: Foundation — RxDB, adapter, hook

- [x] 1.1 Register 4 schemas (`component_types`, `asset_components`, `failure_mode_catalog`, `fmea_rcm_analysis`) in `src/lib/rxdb.js` with `_deleted` field, version: 0
- [x] 1.2 Add pull-only replication handlers for 3 catalog collections + pull+push for `fmea_rcm_analysis` in `startAllReplications()`
- [x] 1.3 Create `src/lib/adapters/fmeaAdapter.js` with `toViewModel` DTO mapping RxDB fields to view model
- [x] 1.4 Create `src/hooks/useFmeaRepository.js` — CRUD + reactive RxDB subscriptions for all 4 collections, following `useLaborRecords` pattern

## Phase 2: Shared constants

- [x] 2.1 Create `src/components/fmea/fmeaConstants.js`: SEVERITY_SIMPLIFIED, OCCURRENCE_SIMPLIFIED, DETECTION_SIMPLIFIED, AIAG/VDA standard tables, RCM questions/strategies/decision-tree, ACTION_PRIORITY matrix, computeActionPriority, WIZARD_LEVELS, 6 helper functions

## Phase 3: UI Components

- [ ] 3.1 Create `src/components/fmea/FmeaLevelSelector.jsx` — MUI ToggleButtonGroup: Rápido | Experto | Ingeniería with audience tooltips
- [ ] 3.2 Create `src/components/fmea/FmeaProgressBar.jsx` — LinearProgress with RxDB count subscription per asset+component, shows "FMEA: X% — N de M"
- [ ] 3.3 Create `src/components/fmea/RcmQuestions.jsx` — 5 binary toggles (q1-q5) with `wordingStyle` prop (quick|standard), blocks save if incomplete
- [ ] 3.4 Create `src/components/fmea/SodDefinitionTables.jsx` — MUI Dialog with AIAG/VDA definition table for severity/occurrence/detection, triggered by info icon
- [ ] 3.5 Create `src/components/fmea/LevelQuick.jsx` — 3-4 categorical selects (BAJO/MEDIO/ALTO, etc.) mapped to 1-10, workshop RCM wording, client-side RPN preview
- [ ] 3.6 Create `src/components/fmea/LevelExpert.jsx` — MUI Slider 1-10 per dimension with marks + info icon for AIAG/VDA tables, standard RCM, notes multiline
- [ ] 3.7 Create `src/components/fmea/LevelEngineering.jsx` — inherits Expert, adds failure cause + mitigation textareas, frequency dropdown (`TRIMESTRAL`/etc.), Action Priority color badge
- [ ] 3.8 Create `src/components/fmea/FmeaWizard.jsx` — container managing level state, component+FM selectors filtered by asset_components/component_type_id, orchestrates all children, save upserts to RxDB

## Phase 4: Integration + Bandeja

- [ ] 4.1 Wire `FmeaWizard` into `AddAssetForm.jsx` — Collapse section gated by "¿Realizar análisis FMEA?" toggle after technical specs, pass `assetId` and `db`
- [ ] 4.2 Create `src/components/fmea/PlannerBandeja.jsx` — pending analyses section (strategy IS NULL) grouped by asset, filterable by component type, orphan placeholder
- [ ] 4.3 Add Bandeja tab in `App.jsx` (index 3, gated by `role === 'PLANNER'`) with pending count badge, import `PlannerBandeja`

**Total: 17 tasks**
