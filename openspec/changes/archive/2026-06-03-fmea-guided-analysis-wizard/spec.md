# FMEA Guided Analysis Wizard — Main Spec

## Purpose

Integrate a 3-level FMEA+RCM wizard into the asset creation/editing form. Mechanics, planners, and reliability engineers each get a tailored interface for failure mode analysis, with auto-computed RPN and maintenance strategy. A planner bandeja surfaces orphan failure occurrences and pending analyses. All specs are additive frontend — backend (tables, triggers, RLS) is already implemented in SDD 1.

## Domain Specs

| Domain | File | Audience | Key Feature |
|--------|------|----------|-------------|
| Quick Wizard | `specs/fmea-quick-wizard/spec.md` | Mechanic/Supervisor | Categorical S/O/D, workshop language |
| Expert Wizard | `specs/fmea-expert-wizard/spec.md` | Planner | 1-10 sliders, AIAG/VDA tables |
| Engineering Wizard | `specs/fmea-engineering-wizard/spec.md` | Reliability Engineer | FMECA, Action Priority, mitigations |
| Planner Bandeja | `specs/planner-bandeja/spec.md` | Planner | Orphan occurrences, pending badge |

## Cross-Cutting Rules

1. **Wizard is OPTIONAL** — collapsible section gated by toggle "¿Realizar análisis FMEA?" in `AddAssetForm`
2. **Level selector** — tabs or radio group at top: Rápido | Experto | Ingeniería
3. **Progress bar** — "FMEA: X% — N de M modos evaluados" visible at all wizard levels
4. **RPN** = Severity × Occurrence × Detection, computed client-side for preview, confirmed by DB trigger post-save
5. **Strategy** — read-only after DB trigger populates `recommended_strategy`
6. **RLS** — TECHNICIAN writes own analyses (analyzed_by = auth.uid()), PLANNER reads/writes all, ADMIN all (enforced server-side via existing backend)
7. **RxDB** — all 4 collections are pull-only (catalogs) or pull+push (analyses). No direct Supabase calls.
