# Spec Delta: False Positive / False Negative Review
**Change**: condition-monitoring-performance-improvement (SDD 6)
**Domain**: false-positive-negative (NEW)

## ADDED Requirements

### FPN-D6-001: False positive definition
- **Description**: A diagnosis is a false positive IF feedback_status='rejected' OR outcome.confirmed_status='rejected'. View condition_false_positives.
- **Rationale**: Clear, computable definition from existing data
- **Acceptance**: Query returns false positives from existing data, rejection_source identifies origin (feedback vs outcome)

### FPN-D6-002: False negative / missed detection
- **Description**: A missed detection occurs when a corrective work_order (wo_type='CM') is closed with a failure_mode_key, AND no condition_diagnosis exists for that asset+failure_mode in the preceding N days (configurable: 30/60/90). View condition_missed_detections.
- **Rationale**: False negatives require crossing OT data with diagnosis data
- **Acceptance**: View exists, returns candidates for missed detections, respects window configuration

### FPN-D6-003: Noisy rule detection
- **Description**: Rules with high false positive rate (>50%) or very low confirmed_rate (<10%) are flagged as noisy. View condition_noisy_rules.
- **Rationale**: Identifies rules that need review
- **Acceptance**: View exists, flags rules meeting threshold, rules with 0 diagnoses not flagged

### FPN-D6-004: RLS
- **Description**: All FPN views are SELECT authenticated
- **Rationale**: Read-only analytical views, no write operations needed
- **Acceptance**: SELECT works for authenticated users; INSERT fails (views are read-only)
