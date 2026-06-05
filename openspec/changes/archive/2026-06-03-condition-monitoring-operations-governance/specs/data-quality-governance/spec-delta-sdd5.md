# Spec Delta: data-quality-governance
**Change**: condition-monitoring-operations-governance (SDD 5)
**Source**: proposal.md

## Requirements

### DQG-D5-001: Quality distribution per source
- **Description**: Dashboard shows % distribution of G0/G1/G2/G3 per source from condition_feature_values
- **Rationale**: Source quality drives diagnosis confidence. Bad data = bad diagnoses.
- **Acceptance**: Per-source breakdown renders in dashboard and SourceManagementPanel

### DQG-D5-002: Stale source detection
- **Description**: Dashboard shows sources with last_seen_at older than 24 hours
- **Rationale**: No data flow = no condition monitoring for that asset
- **Acceptance**: Stale sources highlighted in dashboard and SourceManagementPanel

### DQG-D5-003: Dead-letter count per source
- **Description**: Dashboard shows count of dead-letter entries per source (from condition_ingest_failures)
- **Rationale**: High dead-letter count indicates integration problems
- **Acceptance**: Count renders per source, clickable → DeadLetterPanel

### DQG-D5-004: SourceManagementPanel quality indicators
- **Description**: Existing SourceManagementPanel extended with quality badge per source
- **Rationale**: Operators managing sources need immediate quality feedback
- **Acceptance**: Badge shows G0-G3 dominant quality, stale indicator, dead-letter badge

### DQG-D5-005: compute_source_quality_stats() function
- **Description**: SQL function that returns quality stats per source: source_id, total_values, g0_pct, g1_pct, g2_pct, g3_pct, last_data_at, dead_letter_count
- **Rationale**: Single source of truth for quality data, reusable by dashboard and panel
- **Acceptance**: Function exists, returns correct structure, performs well with indexes

### DQG-D5-006: Stale source via last_seen_at
- **Description**: Stale detection uses condition_sources.last_seen_at column
- **Rationale**: No new table needed; existing column already tracks last contact
- **Acceptance**: Query uses existing index, returns accurate staleness
