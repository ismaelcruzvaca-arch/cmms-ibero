-- =============================================================================
-- Schema Migration: work_orders ISO 14224 — Test Suite
-- 7 test cases (TDD): Forward/Bidir INSERT/UPDATE, Anti-Loop, Priority
--
-- Valida que el trigger trg_sync_legacy_status funciona correctamente
-- manteniendo lifecycle_phase ↔ status en sincronía bidireccional.
--
-- Ejecutar DESPUÉS de aplicar la migración schema-evolution-production
-- =============================================================================

BEGIN;

SELECT plan(8);

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Setup: asset + job_plan mínimos para FKs (work_orders puede requerirlos)
--    Usamos asset_id TEXT que ya existe en producción
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO assets (id, equipment_id, description, asset_type_id)
VALUES ('MIG-TEST-ASSET', 'EQ-MIG-TEST', 'Asset de prueba migración', 'TEST')
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Test 1: Forward INSERT — lifecycle_phase → status
--    Simula PM Engine creando OT con lifecycle_phase='WAPPR'
-- ─────────────────────────────────────────────────────────────────────────────
SAVEPOINT test1;

INSERT INTO work_orders (id, equipment_id, asset_id, lifecycle_phase)
VALUES ('T1-FWD-INSERT'::text, 'EQ-TEST-1', 'MIG-TEST-ASSET', 'WAPPR');

SELECT is(status, 'pending', 'Test 1 — Forward INSERT: lifecycle_phase=WAPPR → status=pending');

ROLLBACK TO SAVEPOINT test1;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Test 2: Backward INSERT — status → lifecycle_phase
--    Simula tablet del mecánico (RxDB) insertando solo status
-- ─────────────────────────────────────────────────────────────────────────────
SAVEPOINT test2;

INSERT INTO work_orders (id, equipment_id, asset_id, status)
VALUES ('T2-BWD-INSERT'::text, 'EQ-TEST-2', 'MIG-TEST-ASSET', 'completed');

SELECT is(lifecycle_phase, 'COMP'::lifecycle_phase,
  'Test 2 — Backward INSERT: status=completed → lifecycle_phase=COMP');

ROLLBACK TO SAVEPOINT test2;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Test 3: Forward UPDATE — lifecycle_phase cambia → status sincroniza
--    Simula planificador aprobando una OT (WAPPR → APPROVED)
-- ─────────────────────────────────────────────────────────────────────────────
SAVEPOINT test3;

INSERT INTO work_orders (id, equipment_id, asset_id, lifecycle_phase)
VALUES ('T3-FWD-UPDATE'::text, 'EQ-TEST-3', 'MIG-TEST-ASSET', 'WAPPR');

UPDATE work_orders SET lifecycle_phase = 'COMP'
WHERE id = 'T3-FWD-UPDATE';

SELECT is(status, 'completed',
  'Test 3 — Forward UPDATE: lifecycle_phase WAPPR→COMP → status=completed');

ROLLBACK TO SAVEPOINT test3;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Test 4: Backward UPDATE — status cambia → lifecycle_phase sincroniza
--    Simula técnico en piso marcando OT como in_progress desde la tablet
-- ─────────────────────────────────────────────────────────────────────────────
SAVEPOINT test4;

INSERT INTO work_orders (id, equipment_id, asset_id, lifecycle_phase)
VALUES ('T4-BWD-UPDATE'::text, 'EQ-TEST-4', 'MIG-TEST-ASSET', 'WAPPR');

UPDATE work_orders SET status = 'in_progress'
WHERE id = 'T4-BWD-UPDATE';

SELECT is(lifecycle_phase, 'INPRG'::lifecycle_phase,
  'Test 4 — Backward UPDATE: status pending→in_progress → lifecycle_phase=INPRG');

ROLLBACK TO SAVEPOINT test4;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Test 5: Anti-Loop — UPDATE columna irrelevante
--    Ambos estados deben quedar intactos (IS DISTINCT FROM funciona)
-- ─────────────────────────────────────────────────────────────────────────────
SAVEPOINT test5;

INSERT INTO work_orders (id, equipment_id, asset_id, lifecycle_phase, status)
VALUES ('T5-ANTILOOP'::text, 'EQ-TEST-5', 'MIG-TEST-ASSET', 'WAPPR', 'pending');

UPDATE work_orders SET description = 'Cambio irrelevante — no debe tocar estados'
WHERE id = 'T5-ANTILOOP';

SELECT is(lifecycle_phase, 'WAPPR'::lifecycle_phase,
  'Test 5 — Anti-Loop: lifecycle_phase intacto tras UPDATE description');
SELECT is(status, 'pending',
  'Test 5 — Anti-Loop: status intacto tras UPDATE description');

ROLLBACK TO SAVEPOINT test5;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Test 6: Prioridad — ambos seteados, lifecycle_phase gana
--    Si ambos se envían, lifecycle_phase es fuente de verdad
-- ─────────────────────────────────────────────────────────────────────────────
SAVEPOINT test6;

INSERT INTO work_orders (id, equipment_id, asset_id, lifecycle_phase, status)
VALUES ('T6-PRIORITY'::text, 'EQ-TEST-6', 'MIG-TEST-ASSET', 'COMP', 'pending');

SELECT is(lifecycle_phase, 'COMP'::lifecycle_phase,
  'Test 6 — Prioridad: lifecycle_phase=COMP preservado');
SELECT is(status, 'completed',
  'Test 6 — Prioridad: status sincronizado desde lifecycle_phase (pending→completed)');

ROLLBACK TO SAVEPOINT test6;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Test 7: FSM — transiciones inválidas son rechazadas
--    WAPPR → COMP no es válida (salta APPROVED → INPRG)
-- ─────────────────────────────────────────────────────────────────────────────
SAVEPOINT test7;

INSERT INTO work_orders (id, equipment_id, asset_id, lifecycle_phase)
VALUES ('T7-FSM-REJECT'::text, 'EQ-TEST-7', 'MIG-TEST-ASSET', 'WAPPR');

SELECT throws_ok(
  $$ UPDATE work_orders SET lifecycle_phase = 'COMP'
     WHERE id = 'T7-FSM-REJECT' $$,
  'P0001',
  NULL,
  'Test 7 — FSM: WAPPR→COMP rechazada (salta APPROVED→INPRG)'
);

ROLLBACK TO SAVEPOINT test7;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Cleanup
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM work_orders WHERE id LIKE 'T1-%' OR id LIKE 'T2-%' OR id LIKE 'T3-%'
  OR id LIKE 'T4-%' OR id LIKE 'T5-%' OR id LIKE 'T6-%' OR id LIKE 'T7-%';
DELETE FROM assets WHERE id = 'MIG-TEST-ASSET';

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Finalizar
-- ─────────────────────────────────────────────────────────────────────────────
SELECT * FROM finish();

ROLLBACK;
