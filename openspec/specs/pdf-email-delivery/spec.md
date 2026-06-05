# pdf-email-delivery Specification

## Purpose

Server-side PDF email delivery via a `send-report` Edge Function. The function generates a PDF through the `@cmms/pdf-engine` pipeline (reusing Browserless) and sends it as an attachment through the Resend API.

## Requirements

### Requirement: Edge Function Endpoint

The system MUST expose a `send-report` function accepting POST with JSON body `{to: string | string[], subject: string, template_code: string, record_id: string, message?: string}`. A valid JWT Bearer is REQUIRED in the `Authorization` header. The function MUST use the service role key for downstream API calls.

#### Scenario: Authenticated request sends email

- GIVEN a valid JWT and body `{to: "user@example.com", subject: "Report", template_code: "ot_default", record_id: "wo-123"}`
- WHEN POSTing to `send-report`
- THEN the function generates the PDF, sends it via Resend, and returns `200` with `{messageId: string}`

#### Scenario: Unauthenticated request rejected

- GIVEN no `Authorization` header
- WHEN POSTing to `send-report`
- THEN the response status is `401`

#### Scenario: Multiple recipients

- GIVEN `to: ["a@example.com", "b@example.com"]`
- WHEN the function sends the email
- THEN both recipients receive the email with the PDF attachment

### Requirement: Resend API Integration

The function MUST POST to `https://api.resend.com/emails` with Bearer token auth using `RESEND_API_KEY`. The PDF MUST be attached as a base64-encoded `application/pdf` attachment. The `from` address MUST be configured via `RESEND_FROM_EMAIL`.

#### Scenario: Successful delivery

- GIVEN valid `RESEND_API_KEY` and `RESEND_FROM_EMAIL` environment variables
- AND a generated PDF buffer
- WHEN the function POSTs to Resend
- THEN Resend returns `{id}` and the function returns `200 {messageId}` to the caller

#### Scenario: Missing RESEND_API_KEY

- GIVEN `RESEND_API_KEY` is not set
- WHEN the function starts
- THEN it returns status `500` with a missing-configuration error

### Requirement: Input Validation and Error Handling

The function MUST validate `to` as valid email address(es), `template_code` as a known template, and `record_id` as a resolvable record. Returns `400` for invalid input, `404` for missing records, `502` for Resend failures, and surfaces Resend `429` rate limits.

#### Scenario: Invalid email rejected

- GIVEN `to: "not-an-email"`
- WHEN the function validates input
- THEN status `400` with an email validation error

#### Scenario: Missing record returns 404

- GIVEN a non-existent `record_id`
- WHEN the function tries to fetch data
- THEN status `404` with a not-found error

#### Scenario: Resend API failure

- GIVEN the Resend API returns a non-2xx status
- WHEN the function processes the response
- THEN status `502` with the upstream error message

### Requirement: Frontend Email Dialog

The WorkOrderDrawer MUST include an "Enviar por email" button that opens a MUI dialog with `to` (email input), `subject` (text), and optional `message` (multiline) fields. The dialog MUST show a loading spinner while sending, display validation errors inline, show a success snackbar on completion, and close the dialog.

#### Scenario: Dialog opens and sends

- GIVEN the WorkOrderDrawer is open for work order `wo-123`
- WHEN the user clicks "Enviar por email"
- THEN a dialog appears with `to`, `subject`, and optional `message` fields
- AND when submitted with valid data, a POST is sent to `send-report`
- AND on success a snackbar confirms delivery and the dialog closes

#### Scenario: Inline validation on invalid email

- GIVEN the email dialog is open
- AND the user enters an invalid email and clicks Send
- WHEN the function returns `400`
- THEN an inline error message is displayed below the `to` field

#### Scenario: Loading state during send

- GIVEN the dialog is open with valid fields
- WHEN the user clicks Send and the request is in flight
- THEN the send button shows a loading spinner and is disabled
