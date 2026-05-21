# OEE Webhook Specification

## Purpose

Define the behavior of the `oee-webhook` endpoint that receives external OEE system triggers and converts them into corrective work orders.

## Requirements

### Requirement: Authentication

The endpoint MUST reject any request that does not present a valid `Authorization: Bearer <token>` header matching the configured OEE secret key. The endpoint SHALL return HTTP 401 for missing or invalid tokens.

#### Scenario: Valid bearer token

- GIVEN the request includes a valid `Authorization: Bearer <token>` header
- WHEN the endpoint receives the request
- THEN the request SHALL proceed to payload validation

#### Scenario: Missing authorization header

- GIVEN the request has no `Authorization` header
- WHEN the endpoint receives the request
- THEN it SHALL respond with HTTP 401

#### Scenario: Invalid bearer token

- GIVEN the request includes an `Authorization: Bearer <token>` header with an incorrect value
- WHEN the endpoint receives the request
- THEN it SHALL respond with HTTP 401

### Requirement: Payload Validation

The endpoint MUST accept a JSON payload containing exactly `equipment_id` (string) and `sintoma` (string). The endpoint SHALL return HTTP 400 if the payload is missing, malformed, or missing required fields.

#### Scenario: Valid payload

- GIVEN the request body is valid JSON with `equipment_id` and `sintoma`
- WHEN the endpoint receives the request
- THEN payload validation SHALL pass

#### Scenario: Missing required field

- GIVEN the request body is valid JSON but missing `sintoma`
- WHEN the endpoint receives the request
- THEN it SHALL respond with HTTP 400

#### Scenario: Malformed JSON

- GIVEN the request body is not valid JSON
- WHEN the endpoint receives the request
- THEN it SHALL respond with HTTP 400

### Requirement: Asset Resolution

The endpoint MUST resolve the provided `equipment_id` to a single existing asset. The endpoint SHALL return HTTP 404 if no matching asset exists.

#### Scenario: Existing equipment_id

- GIVEN an asset exists with `equipment_id` equal to the payload value
- WHEN the endpoint resolves the payload
- THEN it SHALL return the corresponding `asset_id`

#### Scenario: Nonexistent equipment_id

- GIVEN no asset exists with the provided `equipment_id`
- WHEN the endpoint resolves the payload
- THEN it SHALL respond with HTTP 404

### Requirement: Work Order Creation

Upon successful authentication, payload validation, and asset resolution, the endpoint MUST create a work order with the following properties:

- `asset_id`: the resolved asset identifier
- `lifecycle_phase`: `'WAPPR'`
- `block_reason`: `'NONE'`
- `symptom_note`: the value of `sintoma` from the payload
- `wo_type`: `'corrective'`

The `sintoma` field SHALL map directly to `symptom_note` (not to `description`, which no longer exists).

#### Scenario: Successful work order creation

- GIVEN a valid authenticated request with a valid payload and existing `equipment_id`
- WHEN the endpoint processes the request
- THEN a work order SHALL be created with the resolved `asset_id`
- AND `lifecycle_phase` SHALL be `'WAPPR'`
- AND `block_reason` SHALL be `'NONE'`
- AND `symptom_note` SHALL contain the `sintoma` text
- AND `description` SHALL NOT be set (column removed)
- AND `wo_type` SHALL be `'corrective'`

#### Scenario: OEE trigger with missing sintoma

- GIVEN a valid authenticated request with `equipment_id` but empty `sintoma`
- WHEN the endpoint processes the request
- THEN it SHALL respond with HTTP 400 (sintoma is required for symptom_note)

### Requirement: Response Format

On successful work order creation, the endpoint MUST return HTTP 200 with the created work order's unique identifier in the response body.

#### Scenario: Successful response

- GIVEN a valid authenticated request with a valid payload and existing `equipment_id`
- WHEN the endpoint completes processing
- THEN it SHALL respond with HTTP 200
- AND the response body SHALL contain the work order `id`
