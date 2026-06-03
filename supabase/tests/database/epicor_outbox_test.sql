-- =============================================================================
-- epicor_outbox — Test Suite (pgTAP)
-- 3 test cases: table exists, trigger works, payload correct
-- =============================================================================

BEGIN;

SELECT plan(9);

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Setup: seed data para material_requests (asset, work_order, spare_part)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO asset_types (id, name) VALUES ('OUTBOX_TEST', 'Outbox Test Type')
ON CONFLICT (id) DO NOTHING;

INSERT INTO assets (id, equipment_id, description, asset_type_id)
VALUES ('OUTBOX-TEST-ASSET', 'EQ-OUTBOX-TEST', 'Outbox test asset', 'OUTBOX_TEST')
ON CONFLICT (id) DO NOTHING;

INSERT INTO work_orders (id, equipment_id, asset_id, wo_type, lifecycle_phase)
VALUES ('00000000-0000-0000-0000-000000000001', 'EQ-OUTBOX-WO', 'OUTBOX-TEST-ASSET', 'corrective', 'WAPPR')
ON CONFLICT (id) DO NOTHING;

INSERT INTO spare_parts (part_num, description)
VALUES ('OUTBOX-TEST-PART', 'Outbox test part')
ON CONFLICT (part_num) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Test 1: La tabla epicor_outbox existe
-- ─────────────────────────────────────────────────────────────────────────────
SELECT has_table('epicor_outbox', 'Test 1 — Tabla epicor_outbox existe');

-- ─────────────────────────────────────────────────────────────────────────────
-- Test 2: Trigger encola automáticamente al insertar material_request
-- ─────────────────────────────────────────────────────────────────────────────
SAVEPOINT test2;

INSERT INTO material_requests (work_order_id, part_num, line_desc, requested_qty, is_non_stock)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'OUTBOX-TEST-PART',
  'Outbox integration test request',
  5,
  false
);

SELECT is(
  (SELECT COUNT(*) FROM epicor_outbox WHERE event_type = 'MATERIAL_REQUEST_CREATE'),
  1::bigint,
  'Test 2 — Trigger creó 1 registro en epicor_outbox con event_type correcto'
);

SELECT is(
  (SELECT status FROM epicor_outbox WHERE event_type = 'MATERIAL_REQUEST_CREATE'),
  'PENDING',
  'Test 2 — Status del registro es PENDING'
);

SELECT ok(
  (SELECT next_retry_at <= NOW() FROM epicor_outbox WHERE event_type = 'MATERIAL_REQUEST_CREATE'),
  'Test 2 — next_retry_at <= NOW() (listo para procesar)'
);

ROLLBACK TO SAVEPOINT test2;

-- ─────────────────────────────────────────────────────────────────────────────
-- Test 3: Payload contiene los campos esperados
-- ─────────────────────────────────────────────────────────────────────────────
SAVEPOINT test3;

INSERT INTO material_requests (work_order_id, part_num, line_desc, requested_qty, is_non_stock)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'OUTBOX-TEST-PART',
  'Payload verification test',
  3,
  false
);

SELECT ok(
  (SELECT payload ? 'material_request_id' FROM epicor_outbox WHERE event_type = 'MATERIAL_REQUEST_CREATE'),
  'Test 3 — Payload contiene material_request_id'
);

SELECT ok(
  (SELECT payload ? 'work_order_id' FROM epicor_outbox WHERE event_type = 'MATERIAL_REQUEST_CREATE'),
  'Test 3 — Payload contiene work_order_id'
);

SELECT ok(
  (SELECT payload ? 'part_num' FROM epicor_outbox WHERE event_type = 'MATERIAL_REQUEST_CREATE'),
  'Test 3 — Payload contiene part_num'
);

SELECT ok(
  (SELECT payload ? 'requested_qty' FROM epicor_outbox WHERE event_type = 'MATERIAL_REQUEST_CREATE'),
  'Test 3 — Payload contiene requested_qty'
);

SELECT is(
  (SELECT payload->>'requested_qty' FROM epicor_outbox WHERE event_type = 'MATERIAL_REQUEST_CREATE'),
  '3',
  'Test 3 — requested_qty en payload coincide con el INSERT'
);

ROLLBACK TO SAVEPOINT test3;

-- ─────────────────────────────────────────────────────────────────────────────
-- Cleanup
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM material_requests WHERE line_desc LIKE 'Outbox%';
DELETE FROM work_orders WHERE id = '00000000-0000-0000-0000-000000000001';
DELETE FROM spare_parts WHERE part_num = 'OUTBOX-TEST-PART';
DELETE FROM assets WHERE id = 'OUTBOX-TEST-ASSET';
DELETE FROM asset_types WHERE id = 'OUTBOX_TEST';

SELECT * FROM finish();

ROLLBACK;
