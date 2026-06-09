# pdf-engine-package Specification

## Purpose

Shared template engine for server-side PDF generation. Published as `@cmms/pdf-engine` on JSR, importable from both Deno (Edge Functions) and browser/Vite (frontend).

## Requirements

### Requirement: Package Published on JSR

The package MUST be published to JSR as `@cmms/pdf-engine` with valid semver versioning. The package SHOULD be importable from Deno (with `npm:` or `jsr:` specifier) AND from browser/Vite (via npm-compatible `@cmms/pdf-engine`).

#### Scenario: Successful publish

- GIVEN a valid JSR account with `@cmms` scope
- WHEN the package is published with version `1.0.0`
- THEN it is importable as `@cmms/pdf-engine` via `jsr:@cmms/pdf-engine`

#### Scenario: Deno import resolves

- GIVEN a Deno project (Edge Function) with `@cmms/pdf-engine` in import map
- WHEN `import { resolveTemplate } from "@cmms/pdf-engine"` is executed
- THEN the import resolves without errors

#### Scenario: Vite import resolves

- GIVEN a Vite project with `@cmms/pdf-engine` in `package.json`
- WHEN `import { resolveTemplate } from "@cmms/pdf-engine"` is compiled
- THEN the import resolves without bundler errors

### Requirement: Exported API Surface

The package MUST export the following: `resolveTemplate`, `validateTemplate`, `renderSection`, `evaluateCondition`, `DEFAULT_TEMPLATE_OT`, `DEFAULT_CSS`.

#### Scenario: All exports present

- GIVEN the package is imported
- WHEN enumerating its public exports
- THEN ALL six named exports (`resolveTemplate`, `validateTemplate`, `renderSection`, `evaluateCondition`, `DEFAULT_TEMPLATE_OT`, `DEFAULT_CSS`) are present and callable

### Requirement: Template Rendering

`resolveTemplate(templateCode, data)` MUST return a complete HTML string. The function MUST support section markers (`SECTION:<name>`) and conditional markers (`CONDITION:<expr>`). Sections with a false condition MUST be omitted from output.

#### Scenario: Happy path — renders with data

- GIVEN a template code containing `{{work_order_id}}` placeholder
- AND a data object `{work_order_id: "WO-001"}`
- WHEN `resolveTemplate(templateCode, data)` is called
- THEN the returned HTML contains `"WO-001"` in place of the placeholder

#### Scenario: Conditional section suppressed

- GIVEN a template with `CONDITION:show_details` before a section
- AND data `{show_details: false}`
- WHEN `resolveTemplate` is called
- THEN the section content is NOT present in the output HTML

### Requirement: Template Validation

`validateTemplate(templateCode)` MUST return `{valid: boolean, errors: string[]}`. It MUST detect missing section references, malformed condition syntax, and unbalanced `SECTION:` markers.

#### Scenario: Valid template passes

- GIVEN a syntactically correct template
- WHEN `validateTemplate` is called
- THEN result has `valid: true` and `errors` is empty

#### Scenario: Invalid condition detected

- GIVEN a template with `CONDITION:` followed by invalid syntax (e.g. unmatched parentheses)
- WHEN `validateTemplate` is called
- THEN result has `valid: false` and `errors` contains a description of the syntax error

### Requirement: Default Assets

The package MUST export `DEFAULT_TEMPLATE_OT` (a default work order template string) and `DEFAULT_CSS` (default print CSS styles).

#### Scenario: Default template renders standalone

- GIVEN `DEFAULT_TEMPLATE_OT` and `DEFAULT_CSS`
- WHEN `resolveTemplate(DEFAULT_TEMPLATE_OT, sampleData)` is called
- THEN the output is valid HTML that includes the CSS from `DEFAULT_CSS` in a `<style>` tag

### Requirement: Label Lookup Pipes

The `DEFAULT_PIPES` export MUST include the following 5 pipes. Each pipe MUST accept a raw code string and return a human-readable label. When a code has no matching label, the pipe MUST return the raw value unchanged.

| Pipe | Input | Output | Lookup scope |
|------|-------|--------|-------------|
| `status_label` | lifecycle phase code (`OPEN`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`) | Spanish label | Lifecycle phases |
| `wo_type_label` | WO type code (`CM`, `PM`, `EM`, `PROJECT`) | Spanish label | WO type catalog |
| `priority_label` | priority code (`HIGH`, `MEDIUM`, `LOW`) | Spanish label | Priority catalog |
| `datetime` | ISO 8601 timestamp string | Formatted `DD/MM/YYYY HH:mm` string | — (date format pipe) |
| `activity_label` | activity code (`INSP`, `REPAIR`, `INSTALL`, `REMOVE`) | Spanish label | Activity code catalog |

#### Scenario: Known code renders human-readable label

- GIVEN a template containing `{{status_label work_order_status}}`
- AND render data where `work_order_status` is `"OPEN"`
- WHEN `resolveTemplate` is called
- THEN the output HTML contains `"Abierta"` (or equivalent Spanish label)

#### Scenario: Unknown code passes through unchanged

- GIVEN a template containing `{{priority_label priority}}`
- AND render data where `priority` is `"UNKNOWN"` (not in the lookup map)
- WHEN `resolveTemplate` is called
- THEN the output HTML contains the raw string `"UNKNOWN"`

#### Scenario: datetime formats ISO timestamps

- GIVEN a template containing `{{datetime created_at}}`
- AND render data where `created_at` is `"2026-06-09T14:30:00Z"`
- WHEN `resolveTemplate` is called
- THEN the output HTML contains `"09/06/2026 14:30"`

#### Scenario: Existing pipes remain unchanged

- GIVEN an existing template that uses only pre-existing pipes (`date`, `number`, `upper`, `lower`, etc.)
- WHEN `resolveTemplate` is called with the same data as before the change
- THEN the output HTML is identical to the pre-change output
