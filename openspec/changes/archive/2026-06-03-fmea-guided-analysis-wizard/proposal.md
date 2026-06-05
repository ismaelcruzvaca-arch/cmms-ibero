# Proposal: FMEA Guided Analysis Wizard

## Intent

Mechanics and supervisors lack reliability engineering training but need optimal maintenance strategies when creating assets. This wizard makes FMEA+RCM accessible at 3 skill levels, auto-computes RPN and RCM strategy via existing backend, and feeds pending analyses into the planner's workflow.

## Scope

### In Scope
- 3-level wizard as expandable section in `AddAssetForm`
- Level 1 (Quick): simplified S/O/D selectors (3/4/3 options) mapped to 1-10
- Level 2 (Expert): exact 1-10 sliders + AIAG/VDA tables + 5 RCM binary questions
- Level 3 (Engineering): Action Priority, mitigations, failure cause, task frequency
- Component selector filtered by asset's `asset_components`
- Failure mode selector filtered by component type
- RPN auto-calculation (S×O×D) + RCM strategy via DB trigger
- Progress bar: "FMEA Analysis: X% — N of M modes evaluated"
- Wizard is OPTIONAL — skippable during asset creation
- Pending analyses as badge count in planner's bandeja

### Out of Scope
- Notifications/OT generation, BI dashboards (future SDD 3), bulk import, backend schema changes (done in SDD 1)

## Capabilities

### New Capabilities
- **`fmea-guided-analysis-wizard`**: 3-level FMEA wizard with S/O/D rating, RPN, RCM strategy, progress tracking, planner bandeja badge

### Modified Capabilities
- None — additive frontend only

## Approach

1. **Components** at `src/components/fmea/`: `FmeaWizard.jsx` (container), `LevelQuick.jsx`, `LevelExpert.jsx`, `LevelEngineering.jsx`, `FmeaProgressBar.jsx`, `SODTableDefinitions.js`
2. **Mount** in `AddAssetForm` as collapsible section after specs, gated by toggle "¿Realizar análisis FMEA?"
3. **RxDB**: connect to existing `asset_components`, `failure_mode_catalog`, `fmea_rcm_analysis` collections (SDD 1). Pull catalogs read-only, push analysis via existing handlers
4. **S/O/D**: JS map converts Level 1 labels → 1-10; Level 2 uses sliders with tooltip definitions
5. **Strategy**: read `recommended_strategy` post-save from DB trigger
6. **Bandeja**: count query on `fmea_rcm_analysis WHERE strategy IS NULL` feeds nav badge

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/components/AddAssetForm.jsx` | Modified | Wizard toggle + FmeaWizard embed |
| `src/components/fmea/` | New | 6 component files |
| Planner nav | Modified | Pending analyses badge |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Component tree bloats form | Low | Collapsible + `React.lazy` |
| RxDB collections missing | Med | Verify before wiring |

## Rollback Plan

Revert the commit. Remove `src/components/fmea/`. Remove toggle from `AddAssetForm.jsx`. DB data unaffected.

## Dependencies

- SDD 1: 4 backend tables seeded + RLS in place
- RxDB collections registered + replicating
- Planner nav component exists for badge

## Success Criteria

- [ ] Level 1: mechanic completes FMEA in <2 min with 3 dropdowns
- [ ] Level 2: planner sees 1-10 scales, 5 RCM questions, strategy auto-computed
- [ ] Level 3: analyst documents mitigations, causes, task frequency
- [ ] Progress bar reflects evaluated modes correctly
- [ ] Wizard skippable — asset creation without FMEA succeeds
- [ ] Analysis pushes replicate to `fmea_rcm_analysis`
- [ ] `recommended_strategy` populated by DB trigger
- [ ] Planner bandeja badge shows pending count
