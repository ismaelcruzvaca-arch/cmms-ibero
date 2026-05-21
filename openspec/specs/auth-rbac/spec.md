# RBAC (Auth & Roles) — Specification

## Purpose

Define the role-based access control system for the CMMS platform, powered by Supabase Auth and a `user_profiles` table synced from `auth.users`.

## Requirements

### Requirement: user_profiles Table

The system MUST create a `user_profiles` table with the following columns:

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, FK to `auth.users` |
| role | TEXT | NOT NULL, DEFAULT `'TECHNICIAN'` |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() |

A database trigger on `auth.users` INSERT MUST auto-create a corresponding row in `user_profiles` with role `TECHNICIAN` (default).

#### Scenario: user_profiles synced on auth.users INSERT

- GIVEN a new user signs up via Supabase Auth
- WHEN a row is inserted into `auth.users`
- THEN a corresponding row SHALL appear in `user_profiles` with role `TECHNICIAN` (default)

### Requirement: Role Matrix

The system SHALL support four roles with the following access permissions:

| Role | work_orders | assets |
|------|-------------|--------|
| ADMIN | CRUD | CRUD |
| PLANNER | CRUD | SELECT |
| TECHNICIAN | UPDATE (lifecycle_phase, action_note, timestamps) | SELECT |
| STOREKEEPER | SELECT | SELECT |

RLS policies MUST enforce role-based access on `work_orders` and `assets`. ADMIN MUST bypass all restrictions.

#### Scenario: ADMIN creates a work order

- GIVEN an authenticated user with role `ADMIN`
- WHEN they INSERT into `work_orders`
- THEN the row is created successfully

#### Scenario: TECHNICIAN attempts to delete a work order

- GIVEN an authenticated user with role `TECHNICIAN`
- WHEN they attempt to DELETE a work order
- THEN the RLS policy rejects the operation

#### Scenario: Unauthenticated request

- GIVEN a request with no valid session
- WHEN it queries `work_orders`
- THEN RLS returns zero rows

### Requirement: Helper Function

The system MUST provide a `get_user_role()` helper function returning TEXT for use in RLS policies. This function SHALL be the single source of truth for role resolution — all policies MUST call `get_user_role()` instead of inline subqueries.

#### Scenario: get_user_role() returns correct role

- GIVEN an authenticated user with a row in `user_profiles`
- WHEN `get_user_role()` is called in an RLS policy context
- THEN it SHALL return the user's current role

## Non-Functional Requirements

- **RLS enforcement**: `user_profiles` MUST have RLS enabled to prevent unauthorized role changes.
- **Default security**: New users MUST default to the least-privilege role (`TECHNICIAN`).
- **Performance**: The `get_user_role()` function MUST be efficient — it is called on every row-level operation.

## Acceptance Criteria

- [ ] `user_profiles` table exists with columns: `id` (UUID PK, FK to auth.users), `role` (TEXT), `created_at`, `updated_at`
- [ ] Trigger on `auth.users` INSERT auto-creates profile with default role `TECHNICIAN`
- [ ] `get_user_role()` function exists and returns TEXT
- [ ] RLS policies on `work_orders` enforce row-level access per role matrix
- [ ] RLS policies on `assets` enforce row-level access per role matrix
- [ ] ADMIN can bypass all restrictions
- [ ] Unauthenticated requests return zero rows
