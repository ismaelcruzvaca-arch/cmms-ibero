# Spec: CBM Outcome Metrics
**Domain**: cbm-outcome-metrics
**SDD**: 5 (condition-monitoring-operations-governance)

## Requirements

### MET-D5-001: condition_daily_metrics table
- **Description**: CREATE TABLE: id UUID PK, metric_date DATE NOT NULL, asset_id TEXT NOT NULL, diagnoses_created INT DEFAULT 0, diagnoses_confirmed INT DEFAULT 0, diagnoses_rejected INT DEFAULT 0, recommendations_created INT DEFAULT 0, recommendations_approved INT DEFAULT 0, recommendations_dismissed INT DEFAULT 0, recommendations_converted_to_wo INT DEFAULT 0, cbm_wo_created INT DEFAULT 0, cbm_wo_closed INT DEFAULT 0, feedback_pending_count INT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW()
- **Rationale**: Daily snapshots enable trend analysis and performance baselines for SDD 6
- **Acceptance**: Table exists, columns correct, defaults work

### MET-D5-002: UNIQUE(metric_date, asset_id)
- **Description**: Unique constraint prevents duplicate metrics for same asset+day
- **Rationale**: compute_daily_metrics() is idempotent; re-running updates existing row
- **Acceptance**: Duplicate INSERT fails, upsert works

### MET-D5-003: compute_daily_metrics() function
- **Description**: SQL function that aggregates from condition_diagnoses, maintenance_recommendations, work_orders, condition_diagnosis_feedback. Inserts/updates rows in condition_daily_metrics.
- **Rationale**: Single function for metrics computation, callable on demand or via cron
- **Acceptance**: Function exists, returns correct counts for test data

### MET-D5-004: Idempotent
- **Description**: Function uses INSERT ... ON CONFLICT (metric_date, asset_id) DO UPDATE
- **Rationale**: Safe to run multiple times; no duplicates, no errors
- **Acceptance**: Run twice, same results, no errors

### MET-D5-005: pg_cron schedule
- **Description**: Schedule compute_daily_metrics() daily at 00:05 via pg_cron
- **Rationale**: Automated daily metrics without manual intervention
- **Acceptance**: Cron job exists, runs successfully

### MET-D5-006: No UI in SDD 5
- **Description**: Metrics table and function are data infrastructure only. No dashboard or list in SDD 5.
- **Rationale**: SDD 6 will consume this data for performance analytics dashboards
- **Acceptance**: No UI component references condition_daily_metrics
