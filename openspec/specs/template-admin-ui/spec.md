# Template Admin UI — Specification

## Purpose

Admin interface for PLANNER/ADMIN to manage PDF report templates: list, search,
edit JSON template structure with live preview, duplicate, and version control.

## Requirements

### Requirement: Template Manager (List + CRUD)

The system MUST provide a `TemplateManager` component with an MUI table that
displays all report templates with columns: code, name, version, is_active,
created_at. It MUST support search by code/name, pagination, toggle
active/inactive, and a duplicate action.

#### Scenario: PLANNER lists all templates with search

- GIVEN an authenticated user with role `PLANNER` or `ADMIN`
- WHEN they navigate to the Admin > Templates tab
- THEN the system SHALL display the full list of `report_templates` ordered by
  `code, version DESC`
- AND the table SHALL show exactly one row per `(code, version)` pair with the
  latest active version highlighted

#### Scenario: Search filters by code or name

- GIVEN the template list is displayed
- WHEN the user types `ot-default` in the search field
- THEN the table SHALL filter to only templates whose `code` or `name`
  contains `ot-default` (case-insensitive)

#### Scenario: Toggle active/inactive

- GIVEN a template row is visible in the list
- WHEN a PLANNER clicks the toggle switch
- THEN the system SHALL call the backend to update `is_active` on that row
- AND the table SHALL reflect the new state immediately

#### Scenario: Duplicate creates a new code with version 1

- GIVEN a template with code `ot-default` and version `5`
- WHEN the PLANNER clicks "Duplicate" on that row
- THEN the system SHALL create a new row with code = `ot-default (copy)` and
  version = `1`
- AND the new template SHALL copy all fields from the source template

### Requirement: Template Editor (CodeMirror 6 + Live Preview)

The system MUST provide a `TemplateEditor` with a split-pane layout: CodeMirror 6
with `@codemirror/lang-json` on the left for editing the `template` JSONB, and a
live `TemplatePreview` iframe on the right. The editor MUST debounce preview
updates by 500ms. CodeMirror 6 MUST be lazy-loaded via dynamic import.

#### Scenario: Edit template JSON with live preview

- GIVEN a PLANNER opens a template in the editor
- WHEN they modify a field in the CodeMirror pane (e.g., change `primary_color`
  to `#FF0000`)
- THEN after 500ms of no further edits, the preview iframe SHALL re-render with
  the updated JSON applied via `resolveTemplate()`

#### Scenario: Invalid JSON shows error, hides preview

- GIVEN the CodeMirror pane contains valid JSON
- WHEN the user types a malformed JSON (e.g., missing comma)
- THEN the editor SHALL show a syntax error indicator in the gutter
- AND the preview pane SHALL display "Error de sintaxis JSON" instead of
  the rendered template

#### Scenario: CodeMirror loads lazily

- GIVEN a user navigates to the Admin tab
- THEN CodeMirror 6 (`@codemirror/lang-json`, `@codemirror/view`,
  `@codemirror/state`) SHALL NOT be loaded in the initial bundle
- WHEN the user opens the TemplateEditor
- THEN the CodeMirror modules SHALL be fetched via dynamic `import()`

### Requirement: Template Preview (iframe with resolveTemplate)

The system MUST provide a `TemplatePreview` component that renders a complete
HTML document inside an iframe `srcdoc` using the real `resolveTemplate()`
function with representative mock data (a mock work order object, labor
records, and material requests).

#### Scenario: Preview renders mock work order data

- GIVEN the user is editing a template in the editor
- WHEN the debounced JSON is passed to `resolveTemplate()`
- THEN the iframe `srcdoc` SHALL contain a valid HTML document with
  sections rendered from the template configuration
- AND mock data SHALL include all fields referenced by the default
  `ot-default` template

#### Scenario: Preview with invalid template still renders

- GIVEN the template JSON is structurally valid but references a section type
  that does not exist
- WHEN `resolveTemplate()` processes it
- THEN the preview SHALL render the valid sections
- AND SHALL silently skip unknown section types (no crash)

### Requirement: Versioning — INSERT on save, rollback via is_active

Every template save MUST INSERT a new row with `version + 1` and the same
`code`. The UNIQUE `(code, version)` constraint prevents duplicates. Rollback
toggles `is_active` on a previous version.

#### Scenario: Save creates new version

- GIVEN template `ot-default` version `3` is active
- WHEN the PLANNER clicks "Save" after editing
- THEN a new row SHALL be INSERTED with `code = 'ot-default'`,
  `version = 4`, and `is_active = true`
- AND the previous version 3 SHALL have `is_active = false`

#### Scenario: Rollback reactivates previous version

- GIVEN `ot-default` version 4 is active and version 3 is inactive
- WHEN the PLANNER clicks "Rollback" to version 3
- THEN the version 3 row SHALL have `is_active = true`
- AND version 4 SHALL have `is_active = false`

### Requirement: useTemplates Hook

The system MUST provide a `useTemplates` React hook exposing `fetchAll`,
`create`, `update`, `duplicate`, `rollback`, and `toggleActive` operations
against both the local RxDB and Supabase (via push handler).

#### Scenario: create inserts local then pushes

- GIVEN the user is online
- WHEN `create(templateData)` is called
- THEN the document SHALL first be written to the local RxDB collection
- AND SHALL be pushed to Supabase via the push replication handler
- AND the returned document SHALL include the generated `id` and `version`

### Requirement: RxDB Push Handler for report_templates

The system MUST add a push handler to the `report_templates` replication in
`src/lib/rxdb.js`. Currently pull-only, it SHALL support upsert and soft-delete.

#### Scenario: Push handler replicates local writes to Supabase

- GIVEN a local change to `report_templates` (create or update)
- WHEN the RxDB replication cycle runs
- THEN the push handler SHALL send an `upsert` to Supabase with the
  `report_templates` table
- AND SHALL map `_deleted` to `is_active = false` on soft-delete

### Requirement: Admin Tab in Navigation

The system MUST add an "Admin" tab in `App.jsx` that appears only for
PLANNER/ADMIN roles. Within Admin, a subtab "Templates" renders the
`TemplateManager`.

#### Scenario: Admin tab visible for PLANNER

- GIVEN a user with role `PLANNER` or `ADMIN`
- WHEN `App.jsx` renders
- THEN the tab bar SHALL include an "Admin" tab with a "Templates" subtab

#### Scenario: Admin tab hidden for TECHNICIAN

- GIVEN a user with role `TECHNICIAN` or `OPERATOR`
- WHEN `App.jsx` renders
- THEN the tab bar SHALL NOT show the "Admin" tab

## Non-Functional Requirements

- **Bundle size**: CodeMirror 6 MUST be lazy-loaded — it SHALL NOT appear in
  the main chunk. Only users who open TemplateEditor pay the cost (~50KB gzip).
- **Debounce**: Preview updates MUST debounce 500ms from the last keystroke.
- **Offline resilience**: All CRUD operations MUST work locally via RxDB
  first, then sync to Supabase when online.

## Acceptance Criteria

- [ ] TemplateManager renders MUI table with search, pagination, toggle, duplicate
- [ ] TemplateEditor shows CodeMirror 6 (lazy) + live preview iframe
- [ ] Preview uses real `resolveTemplate()` with mock data
- [ ] Save increments version; rollback toggles is_active
- [ ] useTemplates hook provides all CRUD operations
- [ ] Push handler added for report_templates in RxDB replication
- [ ] Admin tab visible only for PLANNER/ADMIN
