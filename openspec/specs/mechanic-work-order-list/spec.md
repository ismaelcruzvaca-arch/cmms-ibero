# Spec: mechanic-work-order-list

## Overview

The Mechanic Work Order List provides a read-only filtered view of work orders for mechanics, showing only WAPPR and APPROVED lifecycle phases with human-readable ISO 14224 status badges, offline conflict awareness, and real-time sync status. Data flows through a pure adapter layer that transforms RxDB documents into a UI presentation model, keeping presenters stateless and free of database imports.

## Requirements

### R1: Work Order List Display

The system MUST display a list of work orders filtered by `lifecycle_phase` = `WAPPR` or `APPROVED`.

Each item MUST show:
- `equipment_id` (denormalized from the work order document)
- `description` (free-text work description)
- `lifecycle_phase` as a human-readable label
- `criticality` as a color-coded indicator
- `priority` as text
- `scheduled_date` formatted as locale-friendly date

The list MUST update reactively when RxDB data changes — no manual refresh required.

### R2: ISO 14224 Lifecycle Status

`lifecycle_phase` MUST display as human-readable labels:
- `WAPPR` → "Pendiente Aprobación"
- `APPROVED` → "Aprobada"

The status badge MUST use distinct MUI colors per phase:
- `WAPPR` → MUI `warning` (amber/orange)
- `APPROVED` → MUI `info` (blue)

A `WorkOrderStatusBadge` presenter component MUST encapsulate this rendering.

### R3: Offline Conflict Awareness

When `_conflict = true` on a work order document, the card MUST display a sync conflict warning badge with tooltip text "Conflicto de sincronización".

The `SyncStatusIndicator` component MUST show the current replication state:
- `online` — green dot, "En línea"
- `syncing` — animated pulse, "Sincronizando"
- `offline` — red dot, "Sin conexión"

The work order list MUST continue to display cached RxDB data when offline. Each card MAY show its last-known sync status via a subtle visual cue.

### R4: Adapter Layer

The adapter MUST transform RxDB `work_orders` documents to a UI presentation model. It MUST:
- Flatten `lifecycle_phase`, `criticality`, `priority` into display-friendly strings
- Expose `_conflict` as a boolean for UI consumption
- Produce a plain object (no class instances) consumable by presenters

The adapter MUST be a pure function — no side effects, no RxDB/Supabase imports.

### R5: Container/Presenter Separation

`MechanicDashboard` (container) MUST:
- Own the RxDB subscription via `useWorkOrders` hook
- Pass the `lifecycleFilter` parameter: `['WAPPR', 'APPROVED']`
- Transform raw docs through the adapter before passing to presenters
- Manage loading and error states

`WorkOrderList`, `WorkOrderCard`, `WorkOrderStatusBadge` (presenters) MUST:
- Receive all data as props — no hooks, no data fetching
- Not import RxDB or Supabase directly
- Be pure render components

## Scenarios

### Scenario 1: Mechanic opens the work order list

GIVEN the mechanic opens the app
WHEN the MechanicDashboard loads
THEN it fetches work orders from RxDB
AND filters by `lifecycle_phase` = `WAPPR` or `APPROVED`
AND transforms each doc through the adapter
AND displays them as a list of WorkOrderCards
AND the SyncStatusIndicator shows current sync status

### Scenario 2: Work order has a sync conflict

GIVEN a work order has `_conflict = true`
WHEN it appears in the list
THEN its card shows a sync conflict warning badge with tooltip
AND the card background subtly tints to indicate conflict state (e.g., light amber border)

### Scenario 3: Network goes offline

GIVEN the app was online
WHEN the network disconnects
THEN the SyncStatusIndicator shows "offline" state with red dot
AND the work order list still displays cached RxDB data
AND each card shows its last-known sync status

### Scenario 4: Work order updates via replication

GIVEN a work order's `lifecycle_phase` changes on the server
WHEN RxDB replication syncs the change
THEN the list reactively updates
AND the card now reflects the new phase label and badge color

## Data Contracts

### RxDB → UI Presentation Model (via adapter)

| Field | Source Type | Transformed | Notes |
|-------|-------------|-------------|-------|
| `id` | string | `id: string` | Passthrough |
| `equipment_id` | string | `equipmentId: string` | Renamed to camelCase |
| `description` | string | `description: string` | Passthrough, nullable → empty string |
| `lifecycle_phase` | string (`WAPPR`/`APPROVED`) | `lifecyclePhaseLabel: string` → "Pendiente Aprobación" / "Aprobada" | Human-readable |
| `criticality` | string (`A`/`B`/`C`) | `criticalityColor: MUI.Color` → `error`/`warning`/`success` | Mapped to MUI chip color |
| `priority` | string | `priority: string` | Passthrough |
| `scheduled_date` | string (ISO) | `scheduledDate: string` (formatted) | Locale-friendly via `Intl.DateTimeFormat` |
| `_conflict` | boolean | `hasConflict: boolean` | UI-facing flag |
| `_deleted` | boolean | `isDeleted: boolean` | Passthrough |

### Filter Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `lifecycleFilter` | `string[]` | `['WAPPR', 'APPROVED']` | Lifecycle phases to include in the mechanic list |

### Component Props

**MechanicDashboard** (container): none (self-subscribing via hook)
**WorkOrderList**: `workOrders: WorkOrderViewModel[]`, `syncStatus: SyncStatus`
**WorkOrderCard**: `workOrder: WorkOrderViewModel`
**WorkOrderStatusBadge**: `phase: string`
**SyncStatusIndicator**: `status: 'online' | 'syncing' | 'offline'`
