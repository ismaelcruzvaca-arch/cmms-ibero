# Archive Report: pm-due-calendar

**Status**: COMPLETE ✅
**Archived**: 2026-06-03
**Mode**: hybrid (Engram + OpenSpec)

## Deliverables

| Artifact | Filesystem Path |
|----------|----------------|
| Proposal | `openspec/changes/archive/2026-06-03-pm-due-calendar/proposal.md` |
| Spec | `openspec/changes/archive/2026-06-03-pm-due-calendar/spec.md` |
| Design | `openspec/changes/archive/2026-06-03-pm-due-calendar/design.md` |
| Tasks | `openspec/changes/archive/2026-06-03-pm-due-calendar/tasks.md` |
| Archive Report | `openspec/changes/archive/2026-06-03-pm-due-calendar/archive-report.md` |

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `pm-due-calendar` | Created | New main spec at `openspec/specs/pm-due-calendar/spec.md` (full spec, not delta — 3 requirements, 5 scenarios) |

## Task Completion

- [x] 1.1 Create migration `20260525000001_pm_due_calendar.sql`
- [x] 1.2 Add COMMENT ON VIEW and COMMENT ON COLUMN documentation
- [x] 2.1 Write pgTAP test: view exists and returns rows
- [x] 2.2 Write pgTAP test: all 10 columns present
- [x] 2.3 Write pgTAP test: projected_date ascending order
- [x] 3.1 Apply migration to Supabase production
- [x] 3.2 Run pgTAP tests against deployed migration
- [x] 3.3 Verify SELECT returns correct OVERDUE/PENDING status

**Progress**: 8/8 tasks complete ✅

## Engram Observation IDs

No Engram observations were created during the SDD phases for this change (retrospective documentation was filesystem-only). The archive report is the first Engram artifact.

## Source of Truth Updated

- `openspec/specs/pm-due-calendar/spec.md` — new domain spec

## Notes

- Retrospective documentation of already-deployed `pm_due_calendar` view
- View was originally implemented as part of `pm-engine-cron-calendar` (archived 2026-05-23)
- This archive closes the standalone `pm-due-calendar` SDD documentation cycle
