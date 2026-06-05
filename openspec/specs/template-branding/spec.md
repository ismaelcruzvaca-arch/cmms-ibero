# Template Branding — Specification

## Purpose

Enable PLANNER/ADMIN to upload brand assets (logos) to Supabase Storage and
preview them in the Template Editor. The branding is stored in a dedicated
`branding` bucket with role-based access control.

## Requirements

### Requirement: Branding Storage Bucket

The system MUST create a `branding` Storage bucket in Supabase. RLS policies
MUST restrict INSERT, UPDATE, and DELETE to PLANNER/ADMIN roles. SELECT MUST
be available to all authenticated users (logos are referenced in PDFs rendered
for any role).

#### Scenario: Bucket exists after migration

- GIVEN a new Supabase environment
- WHEN the Storage migration runs
- THEN a bucket named `branding` SHALL exist
- AND the bucket SHALL be public for read (SELECT) to all authenticated users
- AND INSERT/UPDATE/DELETE SHALL require `get_user_role() IN ('PLANNER', 'ADMIN')`

#### Scenario: TECHNICIAN cannot upload logo

- GIVEN an authenticated user with role `TECHNICIAN`
- WHEN they attempt to upload a file to the `branding` bucket
- THEN the RLS policy SHALL reject the operation (401 Unauthorized)

### Requirement: Logo Upload UI with Drag & Drop

The system MUST provide a drag-and-drop file upload component in the
Template Editor's branding section. It MUST accept common image formats
(PNG, JPG, SVG, WEBP) and show a preview after upload.

#### Scenario: PLANNER uploads a logo

- GIVEN a PLANNER is editing a template's branding section
- WHEN they drag a PNG file onto the upload zone
- THEN the file SHALL be uploaded to `branding/{template_code}/{filename}`
- AND a preview thumbnail SHALL appear in the upload zone
- AND the template's `branding.logo_url` field SHALL be updated to the
  Storage public URL

#### Scenario: File type rejected

- GIVEN the upload zone is active
- WHEN the user drops a `.exe` file
- THEN the system SHALL reject the file with a message
  "Formato no soportado. Usá PNG, JPG, SVG o WEBP."
- AND SHALL NOT upload or modify anything

### Requirement: Logo Preview in TemplateEditor

The system MUST display the current logo (if any) in the Template Editor
branding section and in the live TemplatePreview iframe.

#### Scenario: Preview shows uploaded logo

- GIVEN a template with `branding.logo_url` pointing to a Storage URL
- WHEN the TemplateEditor loads
- THEN the branding section SHALL display a thumbnail of the logo
- AND the live preview iframe SHALL render the logo via the `<img>` tag
  in the report header

## Non-Functional Requirements

- **File size**: Maximum upload size SHALL be 2MB per logo.
- **Cache**: Storage URLs SHOULD include cache-busting query params to avoid
  stale previews after re-upload.
- **Accessibility**: The upload zone MUST have an invisible `<input type="file">`
  as keyboard fallback.

## Acceptance Criteria

- [ ] `branding` Storage bucket created with RLS policies
- [ ] Drag-and-drop upload accepts PNG/JPG/SVG/WEBP, rejects others
- [ ] Uploaded files stored at `branding/{template_code}/{filename}`
- [ ] Logo preview thumbnail in Template Editor
- [ ] Logo renders in TemplatePreview iframe via `resolveTemplate()`
- [ ] Only PLANNER/ADMIN can upload; all authenticated users can read
