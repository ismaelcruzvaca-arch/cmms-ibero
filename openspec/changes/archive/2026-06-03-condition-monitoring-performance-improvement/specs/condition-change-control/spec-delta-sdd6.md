# Spec Delta: Condition Change Control
**Change**: condition-monitoring-performance-improvement (SDD 6)
**Source**: proposal.md

## ADDED Requirements

### CHG-D6-001: Change proposals table
- **Description**: CREATE TABLE condition_change_proposals: id UUID PK DEFAULT gen_random_uuid(), proposal_key TEXT UNIQUE NOT NULL, title TEXT NOT NULL, description TEXT, entity_type TEXT NOT NULL CHECK (entity_type IN ('threshold','rule','diagnostic_pattern','baseline','hitl_policy','rul_method','degradation_model')), entity_id TEXT NOT NULL, change_type TEXT NOT NULL CHECK (change_type IN ('update','replace','deactivate','activate')), before_state JSONB, after_state JSONB, justification TEXT, expected_impact TEXT, proposed_by TEXT, reviewed_by TEXT, status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','approved','rejected','active','rolled_back')), created_at TIMESTAMPTZ DEFAULT NOW(), reviewed_at TIMESTAMPTZ, active_at TIMESTAMPTZ
- **Rationale**: Every change to condition monitoring configuration must be proposed, reviewed, and approved before activation. Traceability of WHO changed WHAT and WHY is non-negotiable.
- **Acceptance**: Table exists, UNIQUE on proposal_key, CHECK constraints enforce valid status and entity_type

### CHG-D6-002: Change diff view
- **Description**: CREATE OR REPLACE FUNCTION compare_change_proposal(p_proposal_id UUID) RETURNS JSONB LANGUAGE plpgsql. Returns JSONB with structure: { "before": JSONB, "after": JSONB, "changed_keys": TEXT[] } comparing before_state vs after_state.
- **Rationale**: Reviewers need to see WHAT changed, not just that something changed. Diff view highlights exactly which fields differ.
- **Acceptance**: Function exists, returns meaningful diff with changed_keys array

### CHG-D6-003: Proposal lifecycle enforcement
- **Description**: Status transitions: draft → review → approved → active → rolled_back. Or draft → review → rejected. Each transition triggers condition_audit_log entry. Rejected and rolled_back are terminal from their respective paths.
- **Rationale**: Changes must be traceable through their entire lifecycle. No shortcut from draft to active.
- **Acceptance**: Status transitions enforced, audit populated, rejected/rolled_back are terminal

### CHG-D6-004: Rollback support
- **Description**: CREATE OR REPLACE FUNCTION rollback_change(p_proposal_id UUID) RETURNS VOID LANGUAGE plpgsql. Reapplies before_state to the affected entity, sets status to rolled_back, logs to condition_audit_log.
- **Rationale**: If a change causes issues, rollback must be one action, not manual reverse-engineering. The before_state captured at proposal time is the source of truth.
- **Acceptance**: Function exists, restores before_state, logs rollback, status transitions to rolled_back

### CHG-D6-005: RLS
- **Description**: SELECT for all authenticated users. INSERT (draft only) for authenticated users. UPDATE of status: PLANNER can set review→approved or review→rejected. ADMIN can set approved→active or active→rolled_back. Non-status fields locked after review.
- **Rationale**: Change control has strict role-based gates. Only ADMIN can activate or rollback. Once in review, proposal content is locked.
- **Acceptance**: RLS policies exist, role gates enforced, non-status UPDATE blocked after review state

### CHG-D6-006: Audit integration
- **Description**: Trigger AFTER UPDATE of status on condition_change_proposals logs to condition_audit_log with action='change_proposed|change_approved|change_rejected|change_activated|change_rolled_back', before/after states captured.
- **Rationale**: Change control must be fully traceable. Every status transition is an auditable governance event.
- **Acceptance**: Trigger exists, all status transitions produce audit entries with correct action type
