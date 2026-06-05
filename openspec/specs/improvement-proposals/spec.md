# Spec: Improvement Proposals
**Domain**: improvement-proposals
**SDD**: 6 (condition-monitoring-performance-improvement)

## Purpose

The system detects improvement opportunities — noisy rules, high FP rates, RUL bias, low data quality, model readiness increases — and generates structured proposals for human review. The system NEVER auto-implements; it proposes, humans decide.

## Requirements

### IMP-D6-001: Improvement proposals table
- **Description**: CREATE TABLE condition_improvement_proposals: id UUID PK DEFAULT gen_random_uuid(), proposal_key TEXT UNIQUE NOT NULL, title TEXT NOT NULL, description TEXT, proposal_type TEXT NOT NULL CHECK (proposal_type IN ('threshold_adjustment','rule_review','pattern_update','baseline_recalibration','policy_change','model_switch','rul_method_change')), source_analysis TEXT NOT NULL, current_state JSONB, proposed_state JSONB, expected_benefit TEXT, risk TEXT, status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','approved','rejected','implemented','superseded')), created_at TIMESTAMPTZ DEFAULT NOW(), reviewed_at TIMESTAMPTZ, implemented_at TIMESTAMPTZ, change_proposal_id UUID REFERENCES condition_change_proposals(id) ON DELETE SET NULL
- **Rationale**: The system detects improvement opportunities but does NOT auto-apply them. It creates proposals for human review and, when approved, links to the change control workflow for implementation.
- **Acceptance**: Table exists with all columns, UNIQUE on proposal_key, CHECK constraints enforce valid proposal_type and status

### IMP-D6-002: Proposal generation sources
- **Description**: CREATE OR REPLACE FUNCTION generate_improvement_proposals() RETURNS INT LANGUAGE plpgsql. Scans five sources and INSERTs draft proposals: (1) noisy rules where condition_false_positive_review.fp_rate > 0.5, (2) rules/analyses with confirmed_rate < 0.30 in condition_performance_metrics, (3) RUL predictions where ABS(bias) > 0.20 in condition_prediction_calibration, (4) sources with quality='G3' for >7 consecutive days in condition_source_registry, (5) assets where assessed DRL increased and a candidate model exists with min_drl <= new DRL. Deduplicates by proposal_key: skips if same proposal_key already exists and is not superseded/rejected.
- **Rationale**: Proposals must come from measurable, computable conditions. Every proposal traces to specific data, not hunches.
- **Acceptance**: Function exists, scans all 5 sources, creates draft proposals, skips duplicates, returns count of new proposals inserted

### IMP-D6-003: Proposal lifecycle
- **Description**: Status transitions: draft → review → approved → implemented → superseded. Or draft → review → rejected. Transition to implemented SHALL populate change_proposal_id by creating or linking a condition_change_proposals row with before_state captured from current_state. Superseded is terminal from implemented. Rejected is terminal from review.
- **Rationale**: Proposals are reviewed by humans; implementation goes through change control. The linked change_proposal_id provides the full audit trail of what actually changed.
- **Acceptance**: Status transitions enforced, change_proposal_id populated on implementation, audit entries created per transition via condition_audit_log trigger

### IMP-D6-004: No auto-implementation
- **Description**: The system MUST NOT auto-advance any proposal past 'review' status. No trigger, scheduler, or function SHALL set status to 'approved' or 'implemented' automatically. The generate_improvement_proposals() function MUST insert at status 'draft' only.
- **Rationale**: Critical safety constraint. All improvements require human review and explicit approval. The system proposes, humans decide.
- **Acceptance**: No function or trigger auto-advances proposals past 'review'. All INSERTs via generate_improvement_proposals() produce status='draft'.

### IMP-D6-005: RLS
- **Description**: SELECT for all authenticated users. INSERT by function generate_improvement_proposals() only (SECURITY DEFINER). UPDATE of status: PLANNER can set review → approved or review → rejected. ADMIN can set approved → implemented. Non-status fields locked after review state.
- **Rationale**: Improvement proposals are read-visible but mutation-gated by role. Only the generation function inserts; only PLANNER/ADMIN advance lifecycle. Content locked once under review.
- **Acceptance**: RLS policies exist, INSERT fails for direct user calls, PLANNER transitions enforced, ADMIN-only for implementation
