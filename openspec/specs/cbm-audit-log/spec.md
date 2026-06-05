# Spec: CBM Audit Log
**Domain**: cbm-audit-log
**SDD**: 5 (condition-monitoring-operations-governance)

## Requirements

### AUD-D5-001: condition_audit_log table
- **Description**: CREATE TABLE: id UUID PK DEFAULT gen_random_uuid(), action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, before_state JSONB, after_state JSONB, reason TEXT, changed_by TEXT NOT NULL, changed_at TIMESTAMPTZ DEFAULT NOW()
- **Rationale**: Every governance action must be traceable: who changed what, why, and when
- **Acceptance**: Table exists, columns correct, NOT NULL constraints work

### AUD-D5-002: Indexes
- **Description**: CREATE INDEX idx_audit_entity ON condition_audit_log(entity_type, entity_id), idx_audit_action(action), idx_audit_at(changed_at)
- **Rationale**: Audit queries filter by entity, action, and time range
- **Acceptance**: Indexes exist, queries use them

### AUD-D5-003: Automatic triggers
- **Description**: Triggers on: maintenance_recommendations (BEFORE UPDATE of status), condition_automation_policies (AFTER INSERT/UPDATE/DELETE), condition_diagnosis_feedback (AFTER INSERT)
- **Rationale**: Critical governance actions must always be logged; cannot depend on application code
- **Acceptance**: Triggers exist, logging works, before/after states captured correctly

### AUD-D5-004: Manual audit function
- **Description**: Function log_audit_entry(action, entity_type, entity_id, before_state, after_state, reason) for ADMIN use
- **Rationale**: Some audit entries (policy overrides, manual interventions) are not trigger-driven
- **Acceptance**: Function exists, inserts into audit_log, RLS restricted to ADMIN

### AUD-D5-005: Immutable entries
- **Description**: Audit log is INSERT-only. No UPDATE/DELETE policies exist on the table.
- **Rationale**: Audit trail integrity is non-negotiable
- **Acceptance**: UPDATE and DELETE fail for all roles

### AUD-D5-006: RLS
- **Description**: All authenticated roles can SELECT from audit log
- **Rationale**: Transparency: anyone can see what changed, but only the database can write
- **Acceptance**: SELECT works for authenticated, INSERT fails for non-ADMIN
