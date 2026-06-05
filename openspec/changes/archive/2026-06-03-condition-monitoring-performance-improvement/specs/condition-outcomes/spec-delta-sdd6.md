# Spec Delta: Condition Outcomes
**Change**: condition-monitoring-performance-improvement (SDD 6)
**Domain**: condition-outcomes (NEW)

## ADDED Requirements

### OUT-D6-001: condition_outcomes table
- **Description**: CREATE TABLE condition_outcomes: id UUID PK, diagnosis_id UUID FK, work_order_id UUID FK, actual_failure_mode TEXT, actual_component TEXT, actual_cause TEXT, confirmed_status TEXT CHECK (confirmed/partial/rejected/unknown), failure_date TIMESTAMPTZ, technician_notes TEXT, evidence_quality TEXT, reviewed_by TEXT, reviewed_at TIMESTAMPTZ, created_at TIMESTAMPTZ
- **Rationale**: SDD 5 feedback is "technician says". Outcomes are "operational truth post-WO". Separate table because they have different lifecycle and purpose.
- **Acceptance**: Table exists, FKs valid, different from condition_diagnosis_feedback

### OUT-D6-002: Relationship to SDD 5 feedback
- **Description**: condition_outcomes is populated from work_order closure + technician findings. It is NOT the same as condition_diagnosis_feedback (which is inline feedback from diagnosis panel). Both coexist.
- **Rationale**: Feedback is immediate, outcomes are post-execution.
- **Acceptance**: Both tables exist, can be JOINed via diagnosis_id, feedback_status and confirmed_status may differ for same diagnosis

### OUT-D6-003: RLS
- **Description**: SELECT authenticated. INSERT by function (via WO closure workflow). ADMIN can UPDATE.
- **Rationale**: Outcomes should be created as part of a process, not direct INSERT.
- **Acceptance**: Direct INSERT blocked by RLS; ADMIN UPDATE succeeds; all authenticated SELECT

### OUT-D6-004: 1:N relationship diagnosis → outcomes
- **Description**: A single diagnosis MAY have multiple outcomes if multiple WOs reference it over time.
- **Rationale**: Diagnosis stays active; each WO closure generates a new outcome snapshot.
- **Acceptance**: Multiple outcomes per diagnosis_id allowed, no UNIQUE constraint on diagnosis_id
