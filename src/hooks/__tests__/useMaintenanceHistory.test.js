/**
 * Tests for useMaintenanceHistory — fetches work_orders + assets by assetId + dateRange.
 *
 * Mocks:
 * - supabase client chain
 *
 * Covers: 4 states (loading, error, empty, success), timeline aggregation, assetName extraction, refetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// ═══════════════════════════════════════════════════════════════════
// Mocks hoisteados
// ═══════════════════════════════════════════════════════════════════
const { mockSupabaseChain, setMockData } = vi.hoisted(() => {
  let currentData = { data: [], error: null };

  // A chain builder that produces a thenable, fully-chainable mock
  function makeChain(data) {
    const p = Promise.resolve(data);
    const chain = {
      select: vi.fn(() => chain),
      order: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      gte: vi.fn(() => chain),
      lte: vi.fn(() => chain),
      then: p.then.bind(p),
      catch: p.catch.bind(p),
      finally: p.finally.bind(p),
    };
    return chain;
  }

  const mockFrom = vi.fn(() => makeChain(currentData));

  const supabase = {
    from: mockFrom,
    auth: { getSession: vi.fn() },
  };

  function setMockData(data) {
    currentData = data;
    mockFrom.mockImplementation(() => makeChain(currentData));
  }

  return { mockSupabaseChain: supabase, setMockData };
});

vi.mock('../../lib/supabaseClient', () => ({
  supabase: mockSupabaseChain,
}));

import { useMaintenanceHistory } from '../useMaintenanceHistory';

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════
function makeWorkOrder(id, overrides = {}) {
  return {
    id,
    wo_type: 'CM',
    lifecycle_phase: 'COMP',
    description: `Work order ${id}`,
    created_at: '2026-01-15T10:00:00Z',
    completed_at: '2026-01-16T14:00:00Z',
    machine_down_at: '2026-01-15T08:00:00Z',
    machine_up_at: '2026-01-15T12:00:00Z',
    problem_code: 'BRK',
    cause_code: 'WEA',
    remedy_code: 'REP',
    actual_hours: 4,
    assets: { description: 'Bomba Centrífuga' },
    ...overrides,
  };
}

describe('useMaintenanceHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockData({ data: [], error: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ───── 1. Loading state ─────
  it('inicia con loading=true', () => {
    // Don't resolve — keep pending to see loading
    const { result } = renderHook(() =>
      useMaintenanceHistory({
        assetId: 'ast-001',
        startDate: '2026-01-01',
        endDate: '2026-06-01',
      })
    );

    expect(result.current.loading).toBe(true);
    expect(result.current.wos).toEqual([]);
    expect(result.current.timeline).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  // ───── 2. Success state with data ─────
  it('retorna work orders y timeline cuando hay datos', async () => {
    const mockWos = [
      makeWorkOrder('wo-001', { created_at: '2026-01-15T10:00:00Z' }),
      makeWorkOrder('wo-002', { created_at: '2026-01-20T10:00:00Z' }),
      makeWorkOrder('wo-003', { created_at: '2026-02-10T10:00:00Z' }),
    ];
    setMockData({ data: mockWos, error: null });

    const { result } = renderHook(() =>
      useMaintenanceHistory({
        assetId: 'ast-001',
        startDate: '2026-01-01',
        endDate: '2026-06-01',
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.wos).toHaveLength(3);
    expect(result.current.assetName).toBe('Bomba Centrífuga');
    expect(result.current.timeline).toHaveLength(2);
    expect(result.current.timeline[0]).toMatchObject({ month: '2026-01', count: 2 });
    expect(result.current.timeline[1]).toMatchObject({ month: '2026-02', count: 1 });
    expect(result.current.refetch).toBeInstanceOf(Function);
  });

  // ───── 3. Empty state ─────
  it('retorna timeline vacío cuando no hay datos', async () => {
    setMockData({ data: [], error: null });

    const { result } = renderHook(() =>
      useMaintenanceHistory({
        assetId: 'ast-001',
        startDate: '2026-01-01',
        endDate: '2026-06-01',
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.wos).toEqual([]);
    expect(result.current.timeline).toEqual([]);
    expect(result.current.assetName).toBeNull();
    expect(result.current.error).toBeNull();
  });

  // ───── 4. Error state ─────
  it('setea error cuando la consulta falla', async () => {
    setMockData({ data: null, error: { message: 'Network error' } });

    const { result } = renderHook(() =>
      useMaintenanceHistory({
        assetId: 'ast-001',
        startDate: '2026-01-01',
        endDate: '2026-06-01',
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Network error');
    expect(result.current.wos).toEqual([]);
  });

  // ───── 5. Refetch function ─────
  it('refetch() vuelve a consultar datos', async () => {
    let callCount = 0;

    // Override mock to return different data per call
    mockSupabaseChain.from.mockImplementation(() => {
      callCount++;
      const data =
        callCount === 1
          ? { data: [makeWorkOrder('wo-001')], error: null }
          : { data: [makeWorkOrder('wo-001'), makeWorkOrder('wo-002')], error: null };
      const p = Promise.resolve(data);
      const chain = {
        select: vi.fn(() => chain),
        order: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        gte: vi.fn(() => chain),
        lte: vi.fn(() => chain),
        then: p.then.bind(p),
        catch: p.catch.bind(p),
        finally: p.finally.bind(p),
      };
      return chain;
    });

    const { result } = renderHook(() =>
      useMaintenanceHistory({
        assetId: 'ast-001',
        startDate: '2026-01-01',
        endDate: '2026-06-01',
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.wos).toHaveLength(1);

    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.wos).toHaveLength(2);
    });
  });

  // ───── 6. Sin assetId — consulta sin filtro eq ─────
  it('no aplica filtro eq si assetId es null', async () => {
    const spyEq = vi.fn(() => {
      const p = Promise.resolve({ data: [makeWorkOrder('wo-001')], error: null });
      return { then: p.then.bind(p), catch: p.catch.bind(p), finally: p.finally.bind(p) };
    });

    mockSupabaseChain.from.mockImplementation(() => {
      const p = Promise.resolve({ data: [makeWorkOrder('wo-001')], error: null });
      const chain = {
        select: vi.fn(() => chain),
        order: vi.fn(() => chain),
        eq: spyEq,
        gte: vi.fn(() => chain),
        lte: vi.fn(() => chain),
        then: p.then.bind(p),
        catch: p.catch.bind(p),
        finally: p.finally.bind(p),
      };
      return chain;
    });

    renderHook(() =>
      useMaintenanceHistory({
        assetId: null,
        startDate: '2026-01-01',
        endDate: '2026-06-01',
      })
    );

    await vi.waitFor(() => {
      expect(mockSupabaseChain.from).toHaveBeenCalled();
    });

    // eq should NOT be called for asset_id when assetId is null
    const eqCalls = spyEq.mock.calls.filter((c) => c[0] === 'asset_id');
    expect(eqCalls).toHaveLength(0);
  });
});
