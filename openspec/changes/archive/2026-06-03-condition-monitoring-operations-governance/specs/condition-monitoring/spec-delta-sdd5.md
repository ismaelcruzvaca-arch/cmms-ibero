# Spec Delta: condition-monitoring
**Change**: condition-monitoring-operations-governance (SDD 5)
**Source**: proposal.md

## Requirements

### DSH-001: Active assets with critical diagnoses
- **Description**: Dashboard shows count of active assets that have at least one diagnosis with status 'active' and confidence >= 0.7
- **Rationale**: Operators need to know at a glance how many assets have confirmed active problems
- **Acceptance**: Tile renders count, clickable → drills to DiagnosisPanel filtered by critical

### DSH-002: Open diagnoses by failure mode
- **Description**: Dashboard shows count of open diagnoses (status IN candidate, field_trial, active) grouped by failure_mode_key
- **Rationale**: Shows which failure modes are most prevalent in the plant
- **Acceptance**: Renders as list or bar with failure_mode_key + count

### DSH-003: Top 5 lowest RUL estimates
- **Description**: Dashboard shows top 5 lowest RUL estimates with asset_id and rul_hours
- **Rationale**: Operators prioritize assets with least remaining useful life
- **Acceptance**: Renders sorted list, RUL < 7d highlighted in red

### DSH-004: Pending recommendations by priority
- **Description**: Dashboard shows count of pending recommendations (status IN suggested, review_required) grouped by priority
- **Rationale**: Shows workload for maintenance planning
- **Acceptance**: Renders count per priority level

### DSH-005: Data quality % by source
- **Description**: Dashboard shows percentage distribution of quality flags (G0/G1/G2/G3) per source
- **Rationale**: Data quality directly impacts diagnosis reliability
- **Acceptance**: Renders per-source breakdown, G2/G3 highlighted as warnings

### DSH-006: Stale sources
- **Description**: Dashboard shows sources where last_seen_at > 24h ago
- **Rationale**: Stale sources mean no data = no diagnostics possible
- **Acceptance**: Renders source list with time since last data

### DSH-007: Drill-down navigation
- **Description**: Each dashboard tile is clickable and navigates to the relevant sub-tab
- **Rationale**: Dashboard is the entry point; operators need to go from overview to detail
- **Acceptance**: Clicking an asset count → DiagnosisPanel. Clicking RUL → filtered diagnosis view

### DSH-008: Performance
- **Description**: Dashboard loads all tiles in <2s with real data volumes
- **Rationale**: Operators won't wait; slow dashboard = unused dashboard
- **Acceptance**: Composite indexes on condition_diagnoses(asset_id, diagnosis_status, created_at), condition_analysis_results(asset_id, analysis_type, window_end)
