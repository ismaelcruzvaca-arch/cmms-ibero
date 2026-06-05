# Spec Delta: Diagnostic Performance Metrics
**Change**: condition-monitoring-performance-improvement (SDD 6)
**Domain**: diagnostic-performance-metrics (NEW)

## ADDED Requirements

### MET-D6-001: Performance metrics definition
- **Description**: Define and compute: confirmed_rate = confirmed / NULLIF(reviewed, 0), rejection_rate = rejected / NULLIF(reviewed, 0), feedback_coverage = reviewed / NULLIF(total_diagnoses, 0), per-failure-mode performance, per-rule performance, per-source performance
- **Rationale**: Metrics with clear denominators prevent self-deception on sparse data
- **Acceptance**: Metrics computable from existing tables (condition_diagnoses + condition_diagnosis_feedback + condition_outcomes)

### MET-D6-002: compute_performance_metrics() function
- **Description**: SQL function that computes all performance metrics from condition_diagnoses + condition_diagnosis_feedback + condition_outcomes. Returns TABLE with all rates and breakdowns. Returns 0s (not errors) when no data.
- **Rationale**: Single source of truth for performance numbers
- **Acceptance**: Function exists, returns correct structure with 0s when no data

### MET-D6-003: Metrics by failure mode
- **Description**: Performance breakdown per failure_mode_key: total diagnoses, confirmed, rejected, partial, confirmed_rate, avg_confidence
- **Rationale**: Some failure modes may have better detection than others
- **Acceptance**: Breakdown query works, failure modes with 0 diagnoses handled consistently

### MET-D6-004: Metrics by rule
- **Description**: Performance breakdown per condition_rule: how many diagnoses it generated, how many confirmed/rejected, false positive rate
- **Rationale**: Identifies noisy rules
- **Acceptance**: Breakdown query works, rules with 0 diagnoses show 0s

### MET-D6-005: Metrics by source
- **Description**: Performance breakdown per source: diagnoses from data originating from each source, confirmation rates
- **Rationale**: Some sources may produce unreliable data leading to false diagnoses
- **Acceptance**: Breakdown query works, sources with low confirmed rates identifiable

### MET-D6-006: Daily metrics integration
- **Description**: Performance metrics SHALL integrate with condition_daily_metrics (SDD 5) via pg_cron at 00:10. Idempotent upsert pattern.
- **Rationale**: Trend analysis requires daily snapshots of performance metrics
- **Acceptance**: Idempotent, re-running same date produces identical results
