# Tasks: pdf-template-editor (Fase 2)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 700–950 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: Foundation → PR 2: Admin Data & List → PR 3: Editor & Integration |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Storage migration + RxDB push handler + deps | PR 1 | ~120 lines, base = main |
| 2 | useTemplates hook + TemplateManager + TemplatePreview + their tests | PR 2 | ~320 lines, base = main |
| 3 | TemplateEditor (CodeMirror) + branding upload + App.jsx admin tab + tests | PR 3 | ~350 lines, depends on PR 2 |

## Phase 1: Foundation (DB + RxDB + Config)

- [x] 1.1 Create migration `20260605100001_pdf_template_admin_storage.sql` — bucket `branding` (public read auth, write PLANNER/ADMIN via RLS)
- [x] 1.2 Register push handler for `report_templates` in `src/lib/rxdb.js` (`startAllReplications` + `getPushHandler`) — no-op that returns `[]` (writes bypass RxDB)
- [x] 1.3 Add `@codemirror/lang-json`, `@codemirror/view`, `@codemirror/state` to `package.json`

## Phase 2: Admin Data Layer & List UI

- [x] 2.1 Create `src/hooks/useTemplates.js` — `fetchAll({search,page,pageSize})`, `create`, `update` (INSERT version+1), `duplicate`, `rollback`, `toggleActive` via Supabase REST
- [x] 2.2 Create `src/components/pdf/TemplatePreview.jsx` — iframe `srcdoc` using `resolveTemplate()` with representative mock data (work_order, asset, labor_records, material_requests)
- [x] 2.3 Create `src/components/pdf/TemplateManager.jsx` — MUI table with columns code/name/version/is_active/created_at, search by code/name, pagination, toggle active/inactive switch, duplicate button, row actions (Edit opens editor, Rollback)
- [x] 2.4 Create `src/hooks/__tests__/useTemplates.test.js` — mock supabase client, test each CRUD operation including version+1 on update and rollback toggle
- [x] 2.5 Create `src/components/pdf/__tests__/TemplatePreview.test.jsx` — render with mock json, assert iframe srcdoc contains expected sections
- [x] 2.6 Create `src/components/pdf/__tests__/TemplateManager.test.jsx` — render table with mock templates, test search filtering, pagination, toggle, duplicate

## Phase 3: Editor, Branding & Integration

- [x] 3.1 Create `src/components/pdf/TemplateEditor.jsx` — split-pane layout: CodeMirror 6 (`@codemirror/lang-json`) left, `TemplatePreview` right, lazy-loaded via `React.lazy()`, 500ms debounce on preview update
- [x] 3.2 Add branding upload section to `TemplateEditor` — drag-and-drop zone (PNG/JPG/SVG/WEBP, ≤2MB), `supabase.storage.from('branding').upload()`, preview thumbnail, update `branding.logo_url` in template JSON
- [x] 3.3 Modify `src/App.jsx` — add "Admin" tab after FMEA (index 3) for PLANNER/ADMIN only, with "Templates" subtab, shift `monitoringTabIndex` from 3→4 for PLANNER/ADMIN
- [x] 3.4 Create `src/components/pdf/__tests__/TemplateEditor.test.jsx` — 19 tests: render, JSON validation, debounce structure, branding upload, save flow (update/create), error states (snackbar, invalid JSON prevention)
- [x] 3.5 Create integration test: admin tab visibility — 8 tests: PLANNER sees Admin tab, ADMIN sees Admin tab, TECHNICIAN does NOT, Monitoreo de Condición present for both, TemplateManager renders inside Admin tab, Bandeja FMEA visibility control test
