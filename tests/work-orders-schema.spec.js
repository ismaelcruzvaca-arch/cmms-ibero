import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env');
const envText = fs.readFileSync(envPath, 'utf-8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const sep = trimmed.indexOf('=');
  if (sep === -1) continue;
  const key = trimmed.slice(0, sep).trim();
  let value = trimmed.slice(sep + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  env[key] = value;
}

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const anonSupabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

test.beforeAll(async () => {
  const { error } = await supabase.auth.signInWithPassword({
    email: env.VITE_TEST_EMAIL || 'e2e-test@testuser.com',
    password: env.VITE_TEST_PASSWORD || 'TestPass123!'
  });
  expect(error).toBeNull();

  // Clean up leftover test data from previous runs
  const { error: cleanupErr } = await supabase
    .from('work_orders')
    .delete()
    .ilike('id', 'TEST-WO-%');
  if (cleanupErr) console.warn('[cleanup] work_orders:', cleanupErr.message);
});

test.afterAll(async () => {
  await supabase.auth.signOut();
});

test.describe.serial('Commit 1: schema changes + new columns', () => {
  const testId = 'TEST-WO-C1-' + Date.now();

  test.afterAll(async () => {
    await supabase.from('work_orders').delete().eq('id', testId);
    await supabase.from('work_orders').delete().eq('id', testId + '-enum');
    await supabase.from('work_orders').delete().eq('id', testId + '-fk');
    await supabase.from('work_orders').delete().eq('id', testId + '-check');
  });

  test('can insert work order with new enterprise fields @commit1', async () => {
    const { data: asset } = await supabase.from('assets').select('id').limit(1).single();
    expect(asset).not.toBeNull();
    const assetId = asset.id;

    const { data, error } = await supabase.from('work_orders').insert({
      id: testId,
      equipment_id: 'TEST-EQ-001',
      description: 'Test work order',
      status: 'pending',
      asset_id: assetId,
      wo_type: 'corrective',
      planned_hours: 10,
      actual_hours: 5,
      cost_estimate: 1000,
      actual_cost: 500,
      requested_by: 'user1',
      approved_by: 'admin',
      approval_date: new Date().toISOString(),
      start_date: new Date().toISOString(),
      end_date: null,
      hold_reason: '',
      close_reason: '',
      cancel_reason: '',
      work_center: 'WC-01',
      planner_group: 'PG-01',
      downtime_hours: 2,
      percentage_complete: 50,
      _conflict: false
    }).select();

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data[0].wo_type).toBe('corrective');
    expect(data[0].planned_hours).toBe(10);
    expect(data[0].percentage_complete).toBe(50);
  });

  test('rejects invalid wo_type enum value @commit1', async () => {
    const { data: asset } = await supabase.from('assets').select('id').limit(1).single();
    const assetId = asset.id;

    const { error } = await supabase.from('work_orders').insert({
      id: testId + '-enum',
      equipment_id: 'TEST-EQ-002',
      description: 'Test',
      status: 'pending',
      asset_id: assetId,
      wo_type: 'invalid_type'
    });

    expect(error).not.toBeNull();
    expect(error.code).toBe('22P02');
  });

  test('allows any asset_id value since no FK constraint exists @commit1', async () => {
    // Design Delta C1: asset_id is TEXT without FK constraint (assets.id is INTEGER)
    const { data, error } = await supabase.from('work_orders').insert({
      id: testId + '-fk',
      equipment_id: 'TEST-EQ-003',
      description: 'Test',
      status: 'pending',
      asset_id: 'nonexistent-asset-id'
    }).select();

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data[0].asset_id).toBe('nonexistent-asset-id');
  });

  test('rejects negative planned_hours @commit1', async () => {
    const { data: asset } = await supabase.from('assets').select('id').limit(1).single();
    const assetId = asset.id;

    const { error } = await supabase.from('work_orders').insert({
      id: testId + '-check',
      equipment_id: 'TEST-EQ-004',
      description: 'Test',
      status: 'pending',
      asset_id: assetId,
      planned_hours: -5
    });

    expect(error).not.toBeNull();
    expect(error.code).toBe('23514');
  });
});

test.describe.serial('Commit 2: FSM validation trigger + audit trigger', () => {
  const testId = 'TEST-WO-C2-' + Date.now();

  test.afterAll(async () => {
    await supabase.from('work_order_status_history').delete().eq('work_order_id', testId);
    await supabase.from('work_orders').delete().eq('id', testId);
  });

  test('auto-populates updated_at on insert @commit2', async () => {
    // Design Delta C2: work_orders uses updated_at BIGINT (epoch ms), no updated_at_ms column
    const { data: asset } = await supabase.from('assets').select('id').limit(1).single();
    const assetId = asset.id;

    const { data, error } = await supabase.from('work_orders').insert({
      id: testId,
      equipment_id: 'TEST-EQ-005',
      description: 'Trigger test',
      status: 'pending',
      asset_id: assetId
    }).select();

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(typeof data[0].updated_at).toBe('number');
    expect(data[0].updated_at).toBeGreaterThan(0);
  });

  test('valid transition pending -> in_progress creates audit row @commit2', async () => {
    const { error: updError } = await supabase.from('work_orders')
      .update({ status: 'in_progress', start_date: new Date().toISOString() })
      .eq('id', testId);

    expect(updError).toBeNull();

    const { data: history, error: histError } = await supabase
      .from('work_order_status_history')
      .select('*')
      .eq('work_order_id', testId);

    expect(histError).toBeNull();
    expect(history).toHaveLength(1);
    expect(history[0].from_status).toBe('pending');
    expect(history[0].to_status).toBe('in_progress');
  });

  test('no-op status update does not create additional audit row @commit2', async () => {
    const { error: updError } = await supabase.from('work_orders')
      .update({ status: 'in_progress' })
      .eq('id', testId);

    expect(updError).toBeNull();

    const { data: history, error: histError } = await supabase
      .from('work_order_status_history')
      .select('*')
      .eq('work_order_id', testId);

    expect(histError).toBeNull();
    expect(history).toHaveLength(1);
  });

  test('invalid transition in_progress -> pending is rejected @commit2', async () => {
    const { error } = await supabase.from('work_orders')
      .update({ status: 'pending' })
      .eq('id', testId);

    expect(error).not.toBeNull();

    const { data: history } = await supabase
      .from('work_order_status_history')
      .select('*')
      .eq('work_order_id', testId);

    expect(history).toHaveLength(1);
  });

  test('terminal state rejects any transition @commit2', async () => {
    // move to completed first
    await supabase.from('work_orders').update({ status: 'completed' }).eq('id', testId);

    const { error } = await supabase.from('work_orders')
      .update({ status: 'cancelled' })
      .eq('id', testId);

    expect(error).not.toBeNull();
  });
});

test.describe.serial('Commit 3: RLS policies + backfill', () => {
  test('RLS select policy hides deleted rows @commit3', async () => {
    const testIdRls = 'TEST-WO-RLS-' + Date.now();
    const { data: asset } = await supabase.from('assets').select('id').limit(1).single();
    const assetId = asset.id;

    // Insert a row and then soft-delete it
    await supabase.from('work_orders').insert({
      id: testIdRls,
      equipment_id: 'TEST-EQ-RLS',
      description: 'RLS test',
      status: 'pending',
      asset_id: assetId
    });

    await supabase.from('work_orders').update({ _deleted: true }).eq('id', testIdRls);

    // Authenticated user should not see it via SELECT policy
    const { data } = await supabase
      .from('work_orders')
      .select('*')
      .eq('id', testIdRls);

    expect(data).toHaveLength(0);

    // Cleanup
    await supabase.from('work_orders').delete().eq('id', testIdRls);
  });

  test('backfill set _conflict and _deleted defaults @commit3', async () => {
    // Verify that existing rows were backfilled with defaults
    const { data, error } = await supabase
      .from('work_orders')
      .select('_conflict, _deleted')
      .limit(1)
      .single();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data._conflict).toBe(false);
    expect(data._deleted).toBe(false);
  });
});
