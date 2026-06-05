# Spec: Diagnostic Performance Metrics
**Domain**: diagnostic-performance-metrics
**SDD**: 6 (condition-monitoring-performance-improvement)

## Purpose

Compute and expose diagnostic accuracy metrics: confirmation rates, rejection rates, feedback coverage, and performance broken down by failure mode, rule, and data source. Metrics use clear denominators (NULLIF) to prevent self-deception on sparse data. All metrics are queryable via a single function and consumable by the `condition_daily_metrics` table for trend analysis.

## Requirements

### MET-001: Metrics definition

**Priority**: MUST

The system MUST define these metrics with NULLIF denominators: confirmed_rate = confirmed / NULLIF(reviewed, 0), rejection_rate = rejected / NULLIF(reviewed, 0), feedback_coverage = reviewed / NULLIF(total_diagnoses, 0). All rates MUST be NUMERIC(5,4) and return 0 when denominator is 0 (not NULL).

#### Scenario: Rates compute correctly with data
- **GIVEN** 100 diagnoses, 60 reviewed, 40 confirmed, 15 rejected
- **WHEN** metrics are computed
- **THEN** confirmed_rate = 0.4000, rejection_rate = 0.1500, feedback_coverage = 0.6000

#### Scenario: Zero diagnoses returns 0s not errors
- **GIVEN** no diagnoses exist in the system
- **WHEN** metrics are computed
- **THEN** all rates return 0 (not NULL, not error)

#### Scenario: No reviews returns 0 rates
- **GIVEN** 50 diagnoses exist but none reviewed
- **WHEN** metrics are computed
- **THEN** confirmed_rate = 0, rejection_rate = 0, feedback_coverage = 0

### MET-002: compute_performance_metrics() function

**Priority**: MUST

The system MUST provide a SQL function `compute_performance_metrics()` that returns TABLE with: total_diagnoses INT, reviewed_count INT, confirmed_count INT, rejected_count INT, partial_count INT, confirmed_rate NUMERIC(5,4), rejection_rate NUMERIC(5,4), feedback_coverage NUMERIC(5,4), avg_confidence NUMERIC(5,4). Source data from condition_diagnoses + condition_diagnosis_feedback + condition_outcomes.

#### Scenario: Function returns correct structure
- **GIVEN** function exists
- **WHEN** SELECT * FROM compute_performance_metrics()
- **THEN** returns row with all columns, correct types

#### Scenario: Function handles empty data
- **GIVEN** no data in any source table
- **WHEN** function is called
- **THEN** returns single row with all counts = 0 and rates = 0.0000

#### Scenario: Function incorporates outcomes
- **GIVEN** outcome records with confirmed_status values
- **WHEN** function computes confirmed_count
- **THEN** it includes outcomes.confirmed_status = 'confirmed' in confirmed_count

### MET-003: Metrics by failure mode

**Priority**: MUST

The system MUST provide breakdown per failure_mode_key: total_diagnoses, confirmed_count, rejected_count, partial_count, confirmed_rate, avg_confidence, rejection_rate. Breakdown SHALL query from condition_diagnoses JOIN condition_failure_mode_catalog.

#### Scenario: Breakdown returns per-FM rows
- **GIVEN** diagnoses for 3 failure modes
- **WHEN** breakdown is queried
- **THEN** 3 rows returned, each with correct aggregates for that FM

#### Scenario: Failure mode with 0 diagnoses excluded
- **GIVEN** failure_mode_key=`bearing.fracture` exists in catalog but has 0 diagnoses
- **WHEN** breakdown is queried
- **THEN** that FM is NOT returned (or returned with 0s — consistent behavior)

### MET-004: Metrics by rule

**Priority**: MUST

The system MUST provide breakdown per condition_rule: diagnoses_count, confirmed_count, rejected_count, false_positive_rate = rejected / NULLIF(total_diagnoses, 0), avg_confidence. Source from condition_diagnoses through rule evaluation lineage.

#### Scenario: Breakdown per rule
- **GIVEN** 3 rules each generating different diagnosis counts
- **WHEN** breakdown is queried
- **THEN** each rule has correct diagnoses_count, confirmed_count, rejected_count

#### Scenario: Rule with 0 diagnoses shows 0s
- **GIVEN** condition_rule with id=`rule-001` exists but generated no diagnoses
- **WHEN** breakdown is queried
- **THEN** rule-001 appears in results with diagnoses_count = 0, false_positive_rate = 0

### MET-005: Metrics by source

**Priority**: MUST

The system MUST provide breakdown per data source: diagnoses_from_source, confirmed_count, rejected_count, confirmed_rate, rejection_rate. Source lineage from condition_windows → condition_sources → condition_analysis_results → condition_diagnoses.

#### Scenario: Breakdown per data source
- **GIVEN** diagnoses originating from 2 different data sources
- **WHEN** breakdown is queried
- **THEN** each source has correct totals

#### Scenario: Source with unreliable data flagged
- **GIVEN** source `manual-log` with confirmed_rate < 0.1
- **WHEN** breakdown is queried
- **THEN** source shows low confirmed_rate indicating potentially unreliable data

### MET-006: Idempotent daily ingestion

**Priority**: SHOULD

The system SHOULD integrate with `condition_daily_metrics` (SDD 5) and `compute_daily_metrics()` via pg_cron at 00:10. Re-running the same day SHALL produce identical results (upsert, not duplicate).

#### Scenario: Daily metrics idempotent
- **GIVEN** function runs at 00:10 for date 2026-06-03
- **WHEN** run again for same date
- **THEN** row is updated, no duplicate created, values identical
