## Exploration: Safety & Permits (HSE) Module

### Current State

**The codebase has ZERO safety/HSE tables today.** No permits, no lockout/tagout, no incident tracking, no hazard registry, no risk assessments, no management of change. Every safety concept would be built from scratch.

**Relevant existing schema and patterns:**

| Feature | Status | Relevance to Safety |
|---------|--------|-------------------|
| `work_orders` | ✅ ISO 14224 lifecycle | Permits will be linked via FK `work_order_id`; `block_reason` ENUM already has `PERMIT` and `SHUTDOWN` values |
| `assets` | ✅ With criticality (A/B/C), hierarchy | Hazards, permits, LOTO all reference assets |
| `labor_records` | ✅ Clock-in/out with activity codes | `WAIT_PERMIT` is already a valid activity_code — permits blocking work is an acknowledged concept |
| `user_profiles` | ✅ Role-based (TEXT: ADMIN/PLANNER/TECHNICIAN/STOREKEEPER) | No SAFETY_OFFICER or HSE_MANAGER role exists yet |
| `audit_logs` | ✅ Generic immutable audit trail | All safety tables will reuse the generic `audit_trigger_func()` |
| `get_user_role()` | ✅ Helper for RLS policies | New safety roles need policies following the same pattern |
| FSM triggers | ✅ `validate_lifecycle_fsm()` on work_orders | Permit lifecycle needs the same BEFORE UPDATE FSM pattern |
| pgTAP tests | ✅ Pattern established (BEGIN/ROLLBACK, SAVEPOINT, is/throws_ok) | All new safety tables need similar test suites |

**Existing safety-aware patterns in the codebase:**
- `block_reason` ENUM already has values: `NONE`, `PARTS`, `TOOLS`, `CREW`, `PERMIT`, `SHUTDOWN`, `WEATHER`, `OTHER`
- `labor_records.activity_code` includes `WAIT_PERMIT` — work can be blocked by permit unavailability
- `work_orders.lifecycle_phase` includes `CANCELLED` and `REJECTED` — states useful for permit lifecycle too

**Key patterns to follow:**
1. **Naming**: snake_case columns, lowercase tables, `id UUID PK DEFAULT gen_random_uuid()`
2. **RLS**: `get_user_role()` helper, one policy per role per operation
3. **FSM**: BEFORE UPDATE triggers, forward-only linear transitions
4. **Audit**: Generic `audit_trigger_func()` attached via trigger to each new table
5. **Timestamps**: `created_at` / `updated_at` on every table via trigger
6. **ENUMs**: Prefer PostgreSQL ENUMs for constrained value sets
7. **Migrations**: Supabase format `YYYYMMDDHHMMSS_descriptive_name.sql`
8. **Documentation**: `COMMENT ON TABLE/COLUMN` for every schema object

**Existing spec pattern:**
- Requirements tables with column definitions (Type, Constraints, Default)
- Given/When/Then scenarios per requirement
- Non-functional requirements
- Data Model summary
- Migration strategy
- Acceptance criteria checklist

---

### Affected Areas

#### Database (New Migrations)

| File | What needs to change |
|------|---------------------|
| `supabase/migrations/202605<next>_safety_permit_types.sql` | **NEW** — ENUMs for permit types, statuses, LOTO types, incident types, hazard types |
| `supabase/migrations/202605<next>_safety_ptw_loto.sql` | **NEW** — work_permits, permit_tasks, permit_approvals, loto_procedures, loto_steps, loto_devices tables + RLS + FSM + audit |
| `supabase/migrations/202605<next>_safety_user_role.sql` | **NEW** (optional phase) — New SAFETY_OFFICER and HSE_MANAGER roles |
| `supabase/migrations/202605<next>_safety_incidents.sql` | **NEW** (Phase 2) — incidents, incident_injuries, incident_investigations |
| `supabase/migrations/202605<next>_safety_hazards_risk.sql` | **NEW** (Phase 2) — hazards, risk_assessments, jsa_steps, risk_matrices |
| `supabase/migrations/202605<next>_safety_moc.sql` | **NEW** (Phase 3) — moc_requests, moc_reviews |

#### Database Tests

| File | What needs to change |
|------|---------------------|
| `supabase/tests/database/safety_ptw_loto_test.sql` | **NEW** — pgTAP for permit FSM, approval workflow, LOTO procedure lifecycle |
| `supabase/tests/database/safety_incidents_test.sql` | **NEW** (Phase 2) |
| `supabase/tests/database/safety_hazards_risk_test.sql` | **NEW** (Phase 2) |
| `supabase/tests/database/safety_moc_test.sql` | **NEW** (Phase 3) |

#### Existing Migration Modifications

| File | What needs to change |
|------|---------------------|
| `supabase/migrations/20260520000001_rbac_audit.sql` | **May need update** — Add SAFETY_OFFICER/HSE_MANAGER roles to `block_reason` check if phasing requires it; or handle in a separate migration |

#### Frontend (Future Phases — Not in Scope for v1 Database)

| File | Description |
|------|-------------|
| `src/pages/PermitDashboard.jsx` | **NEW** — Permit list, status overview, approval queue |
| `src/components/safety/PermitForm.jsx` | **NEW** — Create/edit permit with type, scope, isolation info |
| `src/components/safety/PermitApprovalChain.jsx` | **NEW** — Multi-level approval widget |
| `src/components/safety/LOTOProcedureView.jsx` | **NEW** — Step-by-step LOTO procedure with lock verification |
| `src/pages/IncidentReporter.jsx` | **NEW** (Phase 2) |
| `src/pages/HazardRegistry.jsx` | **NEW** (Phase 2) |
| `src/pages/RiskAssessmentWizard.jsx` | **NEW** (Phase 2) |
| `src/pages/MOCRequestForm.jsx` | **NEW** (Phase 3) |
| `src/components/safety/RiskMatrixHeatmap.jsx` | **NEW** (Phase 2) — 5x5 risk matrix visualization |
| `src/hooks/useWorkPermits.js` | **NEW** — RxDB collection + replication for permits |
| `src/hooks/useLOTO.js` | **NEW** — RxDB collection for LOTO procedures |
| `src/lib/rxdb.js` | **MODIFY** — Add safety collections to replication handlers |

---

### Approaches

#### Approach 1: Minimal v1 — Only PTW + LOTO Tables

**Description**: Create only the Permit to Work and Lockout/Tagout schema. No incidents, hazards, risk assessments, or MOC. Focus on the most critical safety integration: permits linked to work orders and asset isolation via LOTO.

**Schema scope (6 tables, 3 ENUMs):**

New ENUMs:
- `permit_type`: `HOT_WORK, COLD_WORK, CONFINED_SPACE, HEIGHT_WORK, EXCAVATION, ELECTRICAL, RADIATION`
- `permit_status`: `DRAFT, SUBMITTED, REVIEW, APPROVED, ACTIVE, COMPLETED, CANCELLED, REJECTED, EXPIRED`
- `loto_step_type`: `LOCK, TAG, VERIFY, TRY, RELEASE`

Tables:
- `work_permits` — Permit record linked to WO and asset, with validity period, FSM on status, isolation info
- `permit_tasks` — Specific tasks covered by the permit (child of work_permits)
- `permit_approvals` — Multi-level approval chain (permit → multiple approval levels with reviewer + decision)
- `loto_procedures` — LOTO header linked to WO and asset, verified_by
- `loto_steps` — Step-by-step isolation sequence (step_type, device, energy_source, completion status)
- `loto_devices` — Lock/tag device inventory (tracking, assignment, status)

**Pros:**
- Focused scope — directly addresses the most common safety integration: permits blocking maintenance work
- Natural integration with existing work_orders (the `WAIT_PERMIT` activity code already exists)
- FSM pattern on permits is directly analogous to the existing work_orders FSM — same trigger pattern
- LOTO devices inventory has no external dependencies
- Minimal ENUMs — only what PTW/LOTO needs
- Approval chain pattern reusable later for MOC

**Cons:**
- No incident tracking — injuries/near-misses can't be recorded
- No hazard registry — no proactive hazard identification
- No risk assessment — permits reference risk level but can't calculate it
- Risk assessment tables would later need permit_id FK added (migration)
- Safety picture is incomplete — only control-of-work, no investigation or prevention

**Effort**: Medium (~3-5 days)
- Schema: ~350 lines SQL (6 tables, 3 ENUMs, FSM triggers, RLS, audit triggers, COMMENTS)
- Tests: ~250 lines pgTAP (permit FSM, approval workflow, LOTO lifecycle, RLS isolation)
- Migration files: 1-2 (ENUMs in first, tables in second)
- Risk: Low — well-understood domain, similar patterns to existing code

---

#### Approach 2: Complete HSE — All 6 Sub-modules in One Change

**Description**: Design and implement the full HSE schema in a single massive change. All 6 domains (PTW, LOTO, Incidents, Hazards, Risk Assessment, MOC) at once. Single migration or tightly coupled set.

**Schema scope (15+ tables, 8+ ENUMs):**
Everything from Approach 1 plus:
- `incidents`, `incident_injuries`, `incident_investigations`
- `hazards`
- `risk_assessments`, `jsa_steps`, `risk_matrices`
- `moc_requests`, `moc_reviews`
- New roles: `SAFETY_OFFICER`, `HSE_MANAGER`
- `safety_plans` (optional)

**Pros:**
- Single coherent data model — all relationships defined upfront
- Risk assessments directly reference hazards AND permits AND MOC
- No migration churn — no "add FK later" migrations
- Complete documentation in one spec
- One review cycle for the full safety architecture

**Cons:**
- MASSIVE scope — 15+ tables, 8+ ENUMs, dozens of triggers, hundreds of RLS policies
- Review is painful — impossible to meaningfully review 1500 lines of SQL
- High risk of design mistakes across unfamiliar domains (e.g., incident OSHA compliance nuances)
- Cannot ship value incrementally — must wait for everything to be done
- Risk of analysis paralysis during design
- Test suite would be enormous and hard to maintain
- Parallel work impossible — single migration

**Effort**: Very High (~4-6 weeks)
- Schema: ~1000+ lines SQL
- Tests: ~800+ lines pgTAP
- Risk: High — too much coupling, hard to test, high cognitive load

---

#### Approach 3: Phased HSE — PTW First, Then Incidents+Hazards+Risk, Then MOC

**Description**: Three independent phases, each building on the previous. Phase 1 is identical to Approach 1 (PTW + LOTO). Phase 2 adds incidents, hazards, and risk assessment. Phase 3 adds MOC.

**Phase 1 — PTW + LOTO** (same as Approach 1):
- ENUMs: permit_type, permit_status, loto_step_type
- Tables: work_permits, permit_tasks, permit_approvals, loto_procedures, loto_steps, loto_devices
- FSM trigger on work_permits.status (DRAFT → SUBMITTED → [REVIEW →] APPROVED → ACTIVE → COMPLETED / CANCELLED / REJECTED / EXPIRED)
- RLS by role: SAFETY_OFFICER can approve, TECHNICIAN can view assigned, PLANNER can create
- Audit: generic audit_trigger_func() on all tables
- Link to work_orders via work_permits.work_order_id

**Phase 2 — Incidents + Hazards + Risk Assessment** (next change):
- ENUMs: incident_type, hazard_type, risk_level
- Tables: incidents, incident_injuries, incident_investigations, hazards, risk_assessments, jsa_steps, risk_matrices
- safety_plans table linking hazards + precautions to assets
- OSHA-compliant incident fields (OSHA 300/300A/301 ready)
- Generated risk_level column (likelihood × severity matrix)
- Link back: incidents.work_order_id, risk_assessments.hazard_id, risk_assessments.asset_id
- FSM on incident status (OPEN → INVESTIGATING → CLOSED)

**Phase 3 — Management of Change** (final change):
- ENUMs: moc_type, moc_status
- Tables: moc_requests, moc_reviews
- Reuses risk_assessments schema from Phase 2 (FK moc_requests.risk_assessment_id)
- Reuses multi-level approval pattern from Phase 1 PTW (moc_reviews table mirrors permit_approvals pattern)
- FSM on moc_status with pre/post start checklists

**Pros:**
- Incremental value — PTW is shippable in days, not weeks
- Each phase is reviewable (6 tables vs 15+ tables)
- Phase 2 learns from Phase 1 — approval patterns can be refined
- Phase 3 reuses patterns from Phase 1 (approval chain) and Phase 2 (risk assessment) — lower risk
- Parallel test development possible — test patterns established in Phase 1 reused in Phases 2/3
- Easier to adjust scope based on user feedback between phases
- Each phase is a single migration — manageable

**Cons:**
- Phase 2 might need to add `permit_id` FK to `risk_assessments` — small schema evolution migration
- Takes longer to reach full HSE capability (months vs weeks)
- Phase 1 design must anticipate Phase 2/3 relationships (e.g., use UUID PKs everywhere, design for extensibility)
- Some ENUMs might need ALTER TYPE ADD VALUE across phases

**Effort**: Medium per phase (~3-5 days each, ~2-3 weeks total)
- Phase 1: ~350 SQL + ~250 tests = ~3-5 days
- Phase 2: ~400 SQL + ~300 tests = ~3-5 days
- Phase 3: ~200 SQL + ~150 tests = ~2-3 days
- Risk: Medium — manageable if Phase 1 is designed with future phases in mind

---

### Recommendation

**Approach 3 — Phased HSE** (Phase 1: PTW + LOTO, Phase 2: Incidents+Hazards+Risk, Phase 3: MOC).

**Why Phase 3 over Minimal v1 or Complete HSE:**

1. **PTW + LOTO is the highest-value entry point.** The codebase already acknowledges permits as a blocking concept (`WAIT_PERMIT`, `PERMIT` block_reason). Shipping PTW first closes the gap between "we know permits can block work" and "we actually manage permits."

2. **Incremental delivery matches the existing pattern.** The codebase was built incrementally — ISO 14224 work_orders, then inventory, then PM/CBM, then labor_records. Each was a focused, shippable change. Safety should follow the same pattern.

3. **Phase 3 (MOC) naturally depends on Phases 1 and 2.** MOC requires risk assessment (Phase 2) for evaluation and approval chains (Phase 1) for multi-level review. Building MOC first would require stubs.

4. **Design for extensibility from Phase 1.** Use UUID PKs everywhere. Permit types and statuses are ENUMs (easily extended). Approval chain table design will be reused by MOC. The `permit_approvals` pattern (multi-level, sequential approvals with reviewer_id + decision) is directly transferable to `moc_reviews`.

5. **Each phase is independently testable and revertible.** If Phase 1 ships and PTW works, there's no pressure to rush Phase 2. If Phase 2 reveals design issues, only Phase 2 is rolled back.

**Key design decisions for Phase 1:**
- New roles: Add `SAFETY_OFFICER` via new migration (or extend role mechanism) — needed for permit approval authority
- Permit FSM: `DRAFT → SUBMITTED → REVIEW → APPROVED → ACTIVE → COMPLETED | CANCELLED | REJECTED | EXPIRED` — back transitions only to DRAFT from SUBMITTED
- LOTO verification: Two-person rule (creator locks, verifier confirms) modeled via `created_by` + `verified_by` on `loto_procedures`
- Permit numbering: Human-readable `permit_no` with prefix (e.g., `PTW-2026-0001`) generated via trigger
- Audit trail: Reuse existing `audit_trigger_func()` on all new tables — zero new code for audit

---

### Risks

| Risk | Likelihood | Severity | Mitigation |
|------|-----------|----------|------------|
| **New roles (SAFETY_OFFICER) need wider RBAC changes** | High | Medium | Start Phase 1 with existing ADMIN acting as permit approver. Add SAFETY_OFFICER role as a separate migration before frontend work. |
| **Phase 1 schema doesn't account for Phase 2 relationships** | Medium | Medium | Add `permit_id` nullable FK to `risk_assessments` in Phase 2 migration. UUID PKs make this straightforward. |
| **Permit FSM complexity — real-world permits have nuanced states** | Medium | High | Research more deeply before finalizing ENUM. Consider extending with `HOLD`, `SUSPENDED`, `VOID` states if needed. Start with the core 8 states above. |
| **LOTO device tracking introduces inventory management complexity** | Low | Medium | LOTO devices are simple inventory — no reorder points, no costing. Track as basic AVAILABLE/IN_USE/LOST/DAMAGED. |
| **OSHA compliance requires domain expertise** | Medium | High | Phase 1 doesn't touch OSHA. Phase 2 (incidents) must include proper OSHA 300/300A/301 fields. Research OSHA regulations before Phase 2 design. |
| **Permit approval chain needs notification system** | Medium | Low | Phase 1 is schema-only. Notifications (email/in-app) are frontend/infrastructure work for later phases. |
| **Multi-day permits and extensions** | Low | Medium | Include `extended_to` column and extension workflow in Phase 1 schema. Approval for extensions follows same chain. |
| **Concurrent permits on the same asset** | Low | Low | Allow multiple permits per asset but validate no overlapping ACTIVE permits of conflicting types (e.g., HOT_WORK with another HOT_WORK on same asset). |

---

### Ready for Proposal
**Yes.** The exploration is complete. The orchestrator should present the user with the three approaches, recommend Approach 3 (Phased HSE starting with PTW + LOTO), and confirm scope before moving to proposal phase.

**Key questions for the user before proposal:**
1. Confirm Phase 1 scope: PTW + LOTO only (no incidents, hazards, risk, MOC)?
2. Do we need new roles (SAFETY_OFFICER) immediately, or can ADMIN act as permit approver in Phase 1?
3. Is LOTO device tracking needed, or just procedure steps (no device inventory)?
4. Confirm schema-only Phase 1 (no frontend) — database tables + RLS + FSM triggers + tests?
5. Any specific permit types needed beyond the standard list (HOT_WORK, COLD_WORK, CONFINED_SPACE, HEIGHT_WORK, EXCAVATION, ELECTRICAL, RADIATION)?
