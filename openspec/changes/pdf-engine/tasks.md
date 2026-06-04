# Tasks: pdf-report-engine (Fase 1)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 650–800 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: DB+RxDB → PR 2: Engine → PR 3: UI → PR 4: Tests |
| Delivery strategy | ask-on-risk |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Database migration + RxDB collections | PR 1 | ~180 lines, base = main |
| 2 | Template engine core (resolver + defaults) | PR 2 | ~230 lines, depends on PR 1 |
| 3 | Report UI (hook + preview + drawer) | PR 3 | ~180 lines, depends on PR 2 |
| 4 | Tests (engine + hook + component) | PR 4 | ~210 lines, depends on PR 3 |

## Phase 1: Database + RxDB Foundation

- [x] 1.1 Create migration `20260604100030_pdf_report_engine.sql` — `report_templates` + `report_history` + RLS + indexes + audit trigger + seed template `ot-default` (6 sections: header, field_table, divider, labor-table, materials-conditional, footer)
- [x] 1.2 Create RxDB schemas for `report_templates` (pull-only) and `report_history` (pull+push) in rxdb.js
- [x] 1.3 Create `src/lib/adapters/reportTemplateAdapter.js` — `toViewModel`, `toViewModelList`
- [x] 1.4 Add pull/push replication handlers in rxdb.js + register both collections in `addCollections` and `startAllReplications`

## Phase 2: Template Engine Core

- [x] 2.1 Create `src/lib/pdf/templateEngine.js` — resolveTemplate, resolveField, applyPipe (10 pipes), parseSections (12 types), evaluateCondition (5 syntaxes), validateTemplate
- [x] 2.2 Create `src/lib/pdf/templateDefaults.js` — DEFAULT_PIPES, SECTION_RENDERERS, DEFAULT_CSS @media print, DEFAULT_TEMPLATE_OT
- [x] 2.3 Create `src/lib/pdf/index.js` — barrel export

## Phase 3: Report UI Integration

- [x] 3.1 Create `src/hooks/useReport.js` — hook returns { html, loading, error, empty, print, regenerate, historyId, templateName }
- [x] 3.2 Create `src/components/pdf/HtmlReportPreview.jsx` — MUI Dialog + iframe srcdoc + loading/error/empty states + Imprimir/Cerrar buttons
- [x] 3.3 Modify `src/components/mechanic/WorkOrderDrawer.jsx` — add "Imprimir OT" icon button visible in COMP/CLOSED states

## Phase 4: Verification

- [x] 4.1 Create `src/lib/pdf/__tests__/templateEngine.test.js` — resolvePlaceholders, applyPipe (10 pipes), evaluateCondition (5 types), resolveSections (12 types), validateTemplate, edge cases (60 tests, created in Phase 2)
- [x] 4.1b Create `src/lib/pdf/__tests__/templateEngine.integration.test.js` — integration tests: full template render, real data, chained pipes, conditionals, tables, details-grid, validateTemplate, special characters (25 tests)
- [x] 4.2 Create `src/hooks/__tests__/useReport.test.js` — template found/not found/empty WO/regenerate with RxDB mocks
- [x] 4.3 Create `src/components/pdf/__tests__/HtmlReportPreview.test.js` — modal render, iframe, loading/error/empty states, print/close buttons
