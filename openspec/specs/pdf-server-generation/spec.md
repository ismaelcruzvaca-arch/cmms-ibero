# pdf-server-generation Specification

## Purpose

Server-side PDF generation via Supabase Edge Function, Supabase Storage (`generated_pdfs` bucket), signed URL download, and a download button in WorkOrderDrawer.

## Requirements

### Requirement: Edge Function Endpoint

The system MUST expose a `generate-pdf` Edge Function accepting POST with JSON body `{template_code: string, record_id?: string, data?: object}`. The function MUST require a valid JWT Bearer in the `Authorization` header.

#### Scenario: Authenticated request succeeds

- GIVEN a valid JWT token for an authenticated user
- AND a POST body `{template_code: "ot_default", record_id: "wo-123"}`
- WHEN the request reaches `generate-pdf`
- THEN the response status is `200` with body `{url: string, expires_at: string}`

#### Scenario: Unauthenticated request rejected

- GIVEN no `Authorization` header
- WHEN POSTing to `generate-pdf`
- THEN the response status is `401`

#### Scenario: Data payload accepted

- GIVEN `{template_code: "ot_default", data: {work_order_id: "wo-123"}}` without `record_id`
- WHEN the function receives the request
- THEN it uses the provided `data` directly without a database lookup

### Requirement: HTML-to-PDF via Browserless

The generated HTML MUST be sent to `https://chrome.browserless.io/pdf` for conversion. The function MUST retry on HTTP 503 (max 2 retries, exponential backoff).

#### Scenario: Successful PDF conversion

- GIVEN Browserless returns a valid PDF buffer (status 200)
- WHEN the function submits the HTML
- THEN the PDF buffer is returned for storage

#### Scenario: Browserless transient error

- GIVEN Browserless returns 503 on first attempt
- WHEN the function retries up to 2 times
- THEN the function either succeeds on retry or returns `502` with error details after exhausting retries

### Requirement: Storage in generated_pdfs Bucket

The PDF MUST be uploaded to the `generated_pdfs` bucket. Storage path SHOULD be `{user_id}/{record_id}_{timestamp}.pdf`.

#### Scenario: PDF stored with correct path

- GIVEN a PDF buffer for user `u1`, record `wo-123`, at timestamp `20260605T120000Z`
- WHEN the function uploads to storage
- THEN the storage path is `u1/wo-123_20260605T120000Z.pdf`

### Requirement: Report History Entry

The function MUST insert a row into `report_history` with `user_id`, `record_type`, `record_id`, `storage_path`, `created_at`, `signed_url_expires_at`.

#### Scenario: History row created

- GIVEN a successful PDF upload to storage path `u1/wo-123_...pdf`
- WHEN the function completes
- THEN a `report_history` row exists with matching `storage_path` and a non-null `signed_url_expires_at`

### Requirement: Signed URL Download

The function MUST return a signed URL valid for 1 hour via `storage.from("generated_pdfs").createSignedUrl()`.

#### Scenario: URL works within expiry

- GIVEN a signed URL returned from the function
- WHEN accessed within 1 hour
- THEN the PDF file is downloadable

### Requirement: RLS Policies

The `generated_pdfs` bucket MUST enforce: authenticated users SELECT own files (path starts with `{auth.uid}/`). Users with `app_role = 'ADMIN'` SELECT all files. INSERT requires authentication.

#### Scenario: User reads own file

- GIVEN authenticated user `u1`
- WHEN they SELECT from `generated_pdfs` WHERE path starts with `u1/`
- THEN the row is returned

#### Scenario: User cannot read others' files

- GIVEN authenticated user `u1`
- WHEN they SELECT from `generated_pdfs` WHERE path starts with `u2/`
- THEN no rows are returned

#### Scenario: ADMIN reads all

- GIVEN user with `app_role = 'ADMIN'`
- WHEN they SELECT from `generated_pdfs`
- THEN all rows across all user paths are returned

### Requirement: Frontend Download Button

The WorkOrderDrawer MUST include a download PDF button that calls the Edge Function with `record_id` matching the current work order and triggers a file download.

#### Scenario: Button triggers download

- GIVEN the WorkOrderDrawer is open for work order `wo-123`
- WHEN the user clicks the "Download PDF" button
- THEN a `POST` request is sent to `generate-pdf` with `record_id: "wo-123"`
- AND on success, the browser triggers a file save dialog for `wo-123.pdf`
