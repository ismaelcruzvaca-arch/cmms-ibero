# Delta for pdf-engine-package

## ADDED Requirements

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
