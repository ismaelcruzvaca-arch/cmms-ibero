# Proposal: Safety & Permits — Phase 1 (PTW + LOTO)

## Intent

CMMS references permits (`WAIT_PERMIT`, `PERMIT` block_reason) but has zero HSE tables. Add Permit to Work and Lockout/Tagout — the highest-value safety entry point — so planners issue, approve, and track work permits with isolation procedures.

## Scope

### In Scope
- 5 tables: `permit_types`, `work_permits`, `permit_tasks`, `lockout_tagout`, `tagout_devices`
- `SAFETY_OFFICER` role added to `user_profiles` CHECK
- ENUMs: `permit_status` (7 states), `device_type` (LOCK/TAG/HASPS/CHAIN)
- FSM trigger on `permit_status` (REQUESTED→APPROVED→ACTIVE→COMPLETED|REJECTED|CANCELLED|EXPIRED)
- RLS per role, audit triggers (reuse existing), pgTAP tests, Spanish COMMENTS

### Out of Scope
- Incidents, hazards, risk, MOC (Phase 2/3)
- Frontend, notifications, RxDB/offline

## Capabilities

### New Capabilities
- `permit-to-work`: PTW lifecycle, permit types catalog, tasks/precautions, isolation & gas test tracking
- `lockout-tagout`: LOTO procedures linked to permits/WOs, device tracking, status workflow (PLANNED→LOCKED→VERIFIED→REMOVED)

### Modified Capabilities
- `auth-rbac`: Add SAFETY_OFFICER to role matrix

## Approach

Phase 1 of Phased HSE. Schema-only. Follow existing patterns: UUID PKs, TIMESTAMPTZ, generic audit trigger, forward-only FSM, RLS via `get_user_role()`, pgTAP BEGIN/ROLLBACK. Permits FK to work_orders/assets. LOTO FK to permits or WOs.

## Affected Areas

| Area | Impact |
|------|--------|
| `supabase/migrations/*_safety_permit_types.sql` | New |
| `supabase/migrations/*_safety_ptw_loto.sql` | New |
| `supabase/migrations/*_add_safety_officer_role.sql` | New |
| `supabase/tests/database/safety_ptw_loto_test.sql` | New |
| `openspec/specs/permit-to-work/spec.md` | New |
| `openspec/specs/lockout-tagout/spec.md` | New |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| SAFETY_OFFICER needs wider RBAC changes | High | ADMIN approver fallback; role migration isolated |
| Permit FSM too simple for real-world | Med | 7 states; HOLD/SUSPENDED via ENUM later |
| LOTO device inventory complexity | Low | AVAILABLE/IN_USE/LOST/DAMAGED only |

## Rollback Plan

Drop migrations in reverse order (role, ptw_loto, permit_types). Independent — no cross-migration data deps. Data loss limited to safety tables.

## Dependencies

- `work_orders`, `assets`, `user_profiles` (all exist)

## Success Criteria

- [ ] PLANNER creates work permit linked to a WO
- [ ] SAFETY_OFFICER approves/rejects; unauthorized roles cannot
- [ ] FSM enforces valid forward-only transitions
- [ ] LOTO procedure created, locked, verified, removed
- [ ] RLS restricts access by role on all tables
- [ ] All pgTAP tests pass
