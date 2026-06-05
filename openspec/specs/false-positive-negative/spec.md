# Spec: False Positive / False Negative Review
**Domain**: false-positive-negative
**SDD**: 6 (condition-monitoring-performance-improvement)

## Purpose

Detect and flag diagnosis quality issues: false positives (diagnoses rejected by feedback or outcome), missed detections (corrective work orders without prior diagnosis), and noisy rules (rules with high false positive rates). All detections are advisory — they inform review but do not auto-disable rules or diagnoses.

## Requirements

### FPN-001: False positive definition

**Priority**: MUST

A diagnosis MUST be classified as a false positive IF: condition_diagnosis_feedback.feedback_status = 'rejected' OR condition_outcomes.confirmed_status = 'rejected'. The system SHALL provide a view `condition_false_positives` listing these diagnoses with their rejection source.

#### Scenario: False positive from feedback rejection
- **GIVEN** diagnosis `diag-001` has feedback_status=`rejected` in condition_diagnosis_feedback
- **WHEN** querying condition_false_positives
- **THEN** diag-001 appears with rejection_source=`feedback`

#### Scenario: False positive from outcome rejection
- **GIVEN** diagnosis `diag-002` has outcome with confirmed_status=`rejected`
- **WHEN** querying condition_false_positives
- **THEN** diag-002 appears with rejection_source=`outcome`

#### Scenario: Confirmed diagnosis not flagged
- **GIVEN** diagnosis `diag-003` has feedback_status=`confirmed`
- **WHEN** querying condition_false_positives
- **THEN** diag-003 does NOT appear

### FPN-002: False negative / missed detection view

**Priority**: MUST

The system MUST create a view `condition_missed_detections` that identifies corrective work orders (wo_type='CM') closed with a failure_mode_key, where no condition_diagnosis exists for the same asset+failure_mode in the preceding N days (configurable: 30, 60, 90). The view SHALL return: asset_id, work_order_id, failure_mode_key, wo_close_date, preceding_days_setting, last_diagnosis_date (NULL if none).

#### Scenario: CM without prior diagnosis detected
- **GIVEN** corrective WO `wo-001` for asset `BOMBA-02` with failure_mode_key=`pump.cavitation` closed on 2026-06-01
- **AND** no condition_diagnosis for BOMBA-02+pump.cavitation in preceding 60 days
- **WHEN** querying condition_missed_detections with preceding_days=60
- **THEN** wo-001 appears with last_diagnosis_date=NULL

#### Scenario: CM with prior diagnosis NOT flagged
- **GIVEN** corrective WO `wo-002` for asset `BOMBA-02` with failure_mode_key=`pump.cavitation`
- **AND** condition_diagnosis exists for BOMBA-02+pump.cavitation 15 days before WO close
- **WHEN** querying with preceding_days=30
- **THEN** wo-002 does NOT appear (diagnosis was within window)

#### Scenario: Configurable window
- **GIVEN** a diagnosis exists 45 days before WO close
- **WHEN** querying with preceding_days=30
- **THEN** WO is flagged (45 > 30)
- **WHEN** querying with preceding_days=90
- **THEN** WO is NOT flagged (45 < 90)

#### Scenario: Non-CM work orders excluded
- **GIVEN** work_order with wo_type='PM' closed with failure_mode_key
- **WHEN** querying condition_missed_detections
- **THEN** PM work order does NOT appear

### FPN-003: Noisy rule detection view

**Priority**: MUST

The system MUST create a view `condition_noisy_rules` that flags condition_rules where false_positive_rate > 0.50 OR confirmed_rate < 0.10. The view SHALL return: rule_id, rule_name, total_diagnoses, confirmed_count, rejected_count, false_positive_rate, confirmed_rate, flagged_for_review (BOOLEAN).

#### Scenario: Rule with high FP rate flagged
- **GIVEN** rule `vibration-spike` with 20 diagnoses: 2 confirmed, 15 rejected
- **WHEN** querying condition_noisy_rules
- **THEN** rule is flagged (FP rate = 0.75 > 0.50), flagged_for_review = true

#### Scenario: Rule with diagnosis count=0 not flagged
- **GIVEN** rule `temp-rising` with 0 diagnoses
- **WHEN** querying condition_noisy_rules
- **THEN** rule is NOT flagged (FP rate = 0, confirmed_rate = 0 — no data to judge)

#### Scenario: Healthy rule not flagged
- **GIVEN** rule `bearing-wear` with 30 diagnoses: 25 confirmed, 2 rejected
- **WHEN** querying condition_noisy_rules
- **THEN** flagged_for_review = false (FP rate = 0.067, confirmed_rate = 0.833)

### FPN-004: RLS

**Priority**: MUST

All FPN views (`condition_false_positives`, `condition_missed_detections`, `condition_noisy_rules`) MUST allow SELECT for all authenticated users. No INSERT/UPDATE/DELETE required (analytical views only).

#### Scenario: Authenticated user can read FPN views
- **GIVEN** authenticated user
- **WHEN** SELECT from any FPN view
- **THEN** all rows returned

#### Scenario: INSERT blocked by view nature
- **GIVEN** authenticated user
- **WHEN** attempting INSERT on any FPN view
- **THEN** operation fails (views are read-only)
