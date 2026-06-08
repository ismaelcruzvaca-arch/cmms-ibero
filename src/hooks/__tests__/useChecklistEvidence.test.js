/**
 * Tests for useChecklistEvidence — fetches COMPLETED checklist_instances
 * with item responses and photo evidence, computing PASS/FAIL/NA stats.
 *
 * Mocks:
 * - supabase client chain for checklist_instances query with joins
 *
 * Covers: 4 states (loading, error, empty, success), refetch, filtering,
 * photo handling, summary aggregation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// ═══════════════════════════════════════════════════════════════════
// Mocks hoisteados — same pattern as useComplianceReport.test.js
// ═══════════════════════════════════════════════════════════════════
const { mockSupabaseChain, setMockFrom } = vi.hoisted(() => {
  const fromHandlers = {};

  function makeChain(data) {
    const p = Promise.resolve(data);
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      gte: vi.fn(() => chain),
      lte: vi.fn(() => chain),
      order: vi.fn(() => chain),
      then: p.then.bind(p),
      catch: p.catch.bind(p),
      finally: p.finally.bind(p),
    };
    return chain;
  }

  const mockFrom = vi.fn((table) => {
    const handler = fromHandlers[table];
    const data = handler ? handler() : { data: [], error: null };
    return makeChain(data);
  });

  const supabase = {
    from: mockFrom,
    auth: { getSession: vi.fn() },
  };

  function setMockFrom(handlers) {
    Object.assign(fromHandlers, handlers);
  }

  return { mockSupabaseChain: supabase, setMockFrom };
});

vi.mock('../../lib/supabaseClient', () => ({
  supabase: mockSupabaseChain,
}));

import { useChecklistEvidence } from '../useChecklistEvidence';

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a mock checklist_instance with default values.
 * Responses are embedded under checklist_item_responses.
 */
function makeInstance(id, overrides = {}) {
  const responses = overrides.checklist_item_responses ?? [];
  return {
    id: `inst-${id}`,
    work_order_id: `WO-${id}`,
    checklist_template_id: `tpl-${id}`,
    technician_id: `tech-${id}`,
    asset_id: `ast-${id}`,
    status: 'COMPLETED',
    completed_at: '2026-06-01T10:00:00Z',
    started_at: '2026-06-01T09:00:00Z',
    user_profiles: { full_name: `Técnico ${id}` },
    checklist_item_responses: responses,
    ...overrides,
  };
}

/**
 * Build a mock checklist_item_response.
 */
function makeResponse(id, overrides = {}) {
  return {
    id: `resp-${id}`,
    checklist_instance_id: `inst-${id}`,
    template_item_id: `tpl-item-${id}`,
    status: 'PASS',
    photo_url: null,
    comment: null,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════
describe('useChecklistEvidence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ───── 1. Loading state ─────
  it('inicia con loading=true y summary en cero', () => {
    setMockFrom({});

    const { result } = renderHook(() =>
      useChecklistEvidence({ startDate: '2026-01-01', endDate: '2026-06-01' })
    );

    expect(result.current.loading).toBe(true);
    expect(result.current.instances).toEqual([]);
    expect(result.current.summary).toEqual({
      totalInstances: 0,
      passCount: 0,
      failCount: 0,
      naCount: 0,
      withPhotoCount: 0,
    });
    expect(result.current.error).toBeNull();
  });

  // ───── 2. Success with instances + mixed responses + photos ─────
  it('retorna instancias con respuestas y summary agregado', async () => {
    setMockFrom({
      checklist_instances: () => ({
        data: [
          makeInstance('001', {
            checklist_item_responses: [
              makeResponse('r01', {
                checklist_instance_id: 'inst-001',
                status: 'PASS',
              }),
              makeResponse('r02', {
                checklist_instance_id: 'inst-001',
                status: 'FAIL',
                photo_url: 'http://example.com/fail-photo.jpg',
              }),
              makeResponse('r03', {
                checklist_instance_id: 'inst-001',
                status: 'NA',
              }),
            ],
          }),
          makeInstance('002', {
            checklist_item_responses: [
              makeResponse('r04', {
                checklist_instance_id: 'inst-002',
                status: 'PASS',
                photo_url: 'http://example.com/pass-photo.jpg',
              }),
              makeResponse('r05', {
                checklist_instance_id: 'inst-002',
                status: 'PASS',
              }),
            ],
          }),
        ],
        error: null,
      }),
    });

    const { result } = renderHook(() =>
      useChecklistEvidence({})
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.instances).toHaveLength(2);
    expect(result.current.instances[0]).toMatchObject({ id: 'inst-001' });
    expect(result.current.instances[1]).toMatchObject({ id: 'inst-002' });

    // Verify joins present
    expect(result.current.instances[0].user_profiles).toBeDefined();
    expect(result.current.instances[0].user_profiles.full_name).toBe('Técnico 001');
    expect(result.current.instances[0].checklist_item_responses).toHaveLength(3);
    expect(result.current.instances[1].checklist_item_responses).toHaveLength(2);

    // Summary: 2 instances, PASS=3, FAIL=1, NA=1, photos=2
    expect(result.current.summary).toEqual({
      totalInstances: 2,
      passCount: 3,
      failCount: 1,
      naCount: 1,
      withPhotoCount: 2,
    });
  });

  // ───── 3. Success without photos ─────
  it('retorna withPhotoCount=0 cuando ninguna respuesta tiene foto', async () => {
    setMockFrom({
      checklist_instances: () => ({
        data: [
          makeInstance('001', {
            checklist_item_responses: [
              makeResponse('r01', {
                checklist_instance_id: 'inst-001',
                status: 'PASS',
              }),
              makeResponse('r02', {
                checklist_instance_id: 'inst-001',
                status: 'PASS',
              }),
            ],
          }),
        ],
        error: null,
      }),
    });

    const { result } = renderHook(() =>
      useChecklistEvidence({})
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.summary).toEqual({
      totalInstances: 1,
      passCount: 2,
      failCount: 0,
      naCount: 0,
      withPhotoCount: 0,
    });
  });

  // ───── 4. Empty data ─────
  it('retorna listas vacías y summary en cero cuando no hay datos', async () => {
    setMockFrom({
      checklist_instances: () => ({ data: [], error: null }),
    });

    const { result } = renderHook(() =>
      useChecklistEvidence({})
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.instances).toEqual([]);
    expect(result.current.summary).toEqual({
      totalInstances: 0,
      passCount: 0,
      failCount: 0,
      naCount: 0,
      withPhotoCount: 0,
    });
  });

  // ───── 5. Error state ─────
  it('setea error cuando la consulta falla', async () => {
    setMockFrom({
      checklist_instances: () => ({
        data: null,
        error: { message: 'Error de conexión con la base de datos' },
      }),
    });

    const { result } = renderHook(() =>
      useChecklistEvidence({})
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeTruthy();
    expect(result.current.error).toContain('Error de conexión');
    expect(result.current.instances).toEqual([]);
    expect(result.current.summary).toEqual({
      totalInstances: 0,
      passCount: 0,
      failCount: 0,
      naCount: 0,
      withPhotoCount: 0,
    });
  });

  // ───── 6. Refetch ─────
  it('refetch() vuelve a consultar y actualiza datos', async () => {
    // Initial: empty data
    setMockFrom({
      checklist_instances: () => ({ data: [], error: null }),
    });

    const { result } = renderHook(() =>
      useChecklistEvidence({})
    );

    // Wait for initial fetch (empty)
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.instances).toHaveLength(0);

    // Update mock to return data on subsequent calls
    setMockFrom({
      checklist_instances: () => ({
        data: [
          makeInstance('001', {
            id: 'inst-001',
            checklist_item_responses: [
              makeResponse('r01', {
                checklist_instance_id: 'inst-001',
                status: 'PASS',
              }),
            ],
          }),
        ],
        error: null,
      }),
    });

    // Trigger refetch
    await act(async () => {
      await result.current.refetch();
    });

    // Now should have data
    await waitFor(() => {
      expect(result.current.instances.length).toBeGreaterThan(0);
      expect(result.current.summary.totalInstances).toBeGreaterThan(0);
      expect(result.current.summary.passCount).toBeGreaterThan(0);
    });
  });

  // ───── 8. SKIPPED responses no se cuentan en summary ─────
  it('no cuenta respuestas SKIPPED en pass/fail/na count', async () => {
    setMockFrom({
      checklist_instances: () => ({
        data: [
          makeInstance('001', {
            checklist_item_responses: [
              makeResponse('r01', {
                checklist_instance_id: 'inst-001',
                status: 'PASS',
              }),
              makeResponse('r02', {
                checklist_instance_id: 'inst-001',
                status: 'SKIPPED',
              }),
              makeResponse('r03', {
                checklist_instance_id: 'inst-001',
                status: 'SKIPPED',
              }),
            ],
          }),
        ],
        error: null,
      }),
    });

    const { result } = renderHook(() =>
      useChecklistEvidence({})
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Only 1 PASS counted; the 2 SKIPPED are ignored
    expect(result.current.summary).toEqual({
      totalInstances: 1,
      passCount: 1,
      failCount: 0,
      naCount: 0,
      withPhotoCount: 0,
    });
  });

  // ───── 9. Instancia con checklist_item_responses: null ─────
  it('no falla si una instancia tiene responses null', async () => {
    setMockFrom({
      checklist_instances: () => ({
        data: [
          {
            id: 'inst-001',
            work_order_id: 'WO-001',
            checklist_template_id: 'tpl-001',
            technician_id: 'tech-001',
            asset_id: 'ast-001',
            status: 'COMPLETED',
            completed_at: '2026-06-01T10:00:00Z',
            started_at: '2026-06-01T09:00:00Z',
            user_profiles: { full_name: 'Técnico 001' },
            checklist_item_responses: null,
          },
        ],
        error: null,
      }),
    });

    const { result } = renderHook(() =>
      useChecklistEvidence({})
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.instances).toHaveLength(1);
    // Null responses should not crash; all counts remain 0
    expect(result.current.summary).toEqual({
      totalInstances: 1,
      passCount: 0,
      failCount: 0,
      naCount: 0,
      withPhotoCount: 0,
    });
  });

  // ───── 7. Filter by technician_id and template_id ─────
  it('aplica filtros de technician_id y template_id en la consulta', async () => {
    const filterCalls = [];

    mockSupabaseChain.from.mockImplementation(() => {
      const p = Promise.resolve({ data: [], error: null });
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn((field, value) => {
          filterCalls.push({ field, value });
          return chain;
        }),
        gte: vi.fn(() => chain),
        lte: vi.fn(() => chain),
        order: vi.fn(() => chain),
        then: p.then.bind(p),
        catch: p.catch.bind(p),
        finally: p.finally.bind(p),
      };
      return chain;
    });

    renderHook(() =>
      useChecklistEvidence({ techId: 'tech-007', templateId: 'tpl-099' })
    );

    await waitFor(() => {
      expect(mockSupabaseChain.from).toHaveBeenCalledWith('checklist_instances');
    });

    // Verify .eq() was called with the expected filters
    const techEq = filterCalls.find((c) => c.field === 'technician_id');
    const templateEq = filterCalls.find(
      (c) => c.field === 'checklist_template_id'
    );
    const statusEq = filterCalls.find((c) => c.field === 'status');

    expect(statusEq).toBeDefined();
    expect(statusEq.value).toBe('COMPLETED');
    expect(techEq).toBeDefined();
    expect(techEq.value).toBe('tech-007');
    expect(templateEq).toBeDefined();
    expect(templateEq.value).toBe('tpl-099');
  });
});
