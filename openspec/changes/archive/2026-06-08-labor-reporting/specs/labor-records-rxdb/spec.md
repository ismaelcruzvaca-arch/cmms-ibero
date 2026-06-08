# Labor Records RxDB Specification

## Purpose

Provide offline-first labor record storage via RxDB, with replication, a React hook, and an adapter following the project's established patterns.

## Requirements

### R1: RxDB Collection Schema

The system MUST register a `labor_records` RxDB collection with fields matching the database table. The schema MUST include:
- `id` (string, primary key)
- `work_order_id` (string, indexed)
- `technician_id` (string, indexed)
- `start_time` (string, ISO 8601)
- `end_time` (string, ISO 8601, nullable)
- `activity_code` (string)
- `notes` (string, nullable)
- `device_timestamp` (string, ISO 8601, nullable)

#### Scenario: Labor records collection registered

- GIVEN the app initializes RxDB
- WHEN addCollections() is called
- THEN a labor_records collection MUST exist with the defined schema

### R2: Push/Pull Replication

Labor records MUST participate in the same replication pipeline as work_orders. Push MUST send local INSERT/UPDATE operations to Supabase; pull MUST fetch records relevant to the authenticated technician.

#### Scenario: Offline insert syncs on reconnect

- GIVEN the device is offline
- WHEN a labor_record is inserted via RxDB
- THEN when connectivity returns, the record MUST be pushed to Supabase

### R3: useLaborRecords Hook

A `useLaborRecords` hook MUST provide:
- `records: LaborRecordViewModel[]` — live query of labor records for a given work_order_id
- `activeSession: LaborRecordViewModel | null` — the currently running session (end_time IS NULL)
- `clockIn(activityCode, notes?)` — inserts a new record with start_time=NOW()
- `clockOut()` — sets end_time=NOW() on the active session
- `loading: boolean` — initial load state
- `error: string | null` — error state

#### Scenario: Hook returns active session

- GIVEN a technician has an active labor_record (end_time IS NULL) for a WO
- WHEN useLaborRecords({ workOrderId }) is called
- THEN activeSession MUST be the record with end_time IS NULL

### R4: laborAdapter

A `laborAdapter` MUST map between RxDB LaborRecordDoc and LaborRecordViewModel, following the same pattern as workOrderAdapter. The ViewModel MUST include:
- All table fields as camelCase (e.g., `workOrderId`, `technicianId`, `activityCode`)
- `durationHours: number | null` — calculated (null if session active)

#### Scenario: Adapter maps document to view model

- GIVEN an RxDB LaborRecordDoc
- WHEN laborAdapter.toViewModel(doc) is called
- THEN it returns a LaborRecordViewModel with camelCase keys and durationHours computed
