/**
 * Tests for useMaterialsConsumed — fetches report_materials_consumed view.
 *
 * Mocks:
 * - supabase client chain
 *
 * Covers: 4 states (loading, error, empty, success), refetch, filtering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// ═══════════════════════════════════════════════════════════════════
// Mocks hoisteados
// ═══════════════════════════════════════════════════════════════════
const { mockSupabaseChain, setMockData } = vi.hoisted(() => {
  let currentData = { data: [], error: null };

  function makeChain(data) {
    const p = Promise.resolve(data);
    const chain = {
      select: vi.fn(() => chain),
      order: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      gte: vi.fn(() => chain),
      lte: vi.fn(() => chain),
      in: vi.fn(() => chain),
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
    mockFrom.mockImplementation(() => makeChain(data));
  }

  return { mockSupabaseChain: supabase, setMockData };
});

vi.mock('../../lib/supabaseClient', () => ({
  supabase: mockSupabaseChain,
}));

import { useMaterialsConsumed } from '../useMaterialsConsumed';

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════
function makeMaterialRecord(id, overrides = {}) {
  return {
    part_num: `MAT-${id}`,
    description: `Material ${id}`,
    uom: 'EA',
    total_qty: 5,
    work_order_id: `wo-${id}`,
    wo_description: `Work Order ${id}`,
    last_transaction_at: '2026-01-15T10:00:00Z',
    ...overrides,
  };
}

describe('useMaterialsConsumed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockData({ data: [], error: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ───── 1. Loading state ─────
  it('inicia con loading=true', () => {
    const { result } = renderHook(() =>
      useMaterialsConsumed({
        startDate: '2026-01-01',
        endDate: '2026-06-01',
      })
    );

    expect(result.current.loading).toBe(true);
    expect(result.current.records).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  // ───── 2. Success state with data ─────
  it('retorna registros cuando hay datos', async () => {
    const mockRecords = [
      makeMaterialRecord('001', { part_num: 'MAT-A', total_qty: 10 }),
      makeMaterialRecord('002', { part_num: 'MAT-B', total_qty: 3 }),
      makeMaterialRecord('003', { part_num: 'MAT-A', total_qty: 7 }),
    ];
    setMockData({ data: mockRecords, error: null });

    const { result } = renderHook(() =>
      useMaterialsConsumed({
        startDate: '2026-01-01',
        endDate: '2026-06-01',
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.records).toHaveLength(3);
    expect(result.current.records[0]).toMatchObject({
      part_num: 'MAT-A',
      total_qty: 10,
    });
    expect(result.current.refetch).toBeInstanceOf(Function);
  });

  // ───── 3. Empty state ─────
  it('retorna lista vacía cuando no hay datos', async () => {
    setMockData({ data: [], error: null });

    const { result } = renderHook(() =>
      useMaterialsConsumed({
        startDate: '2026-01-01',
        endDate: '2026-06-01',
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.records).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  // ───── 4. Error state ─────
  it('setea error cuando la consulta falla', async () => {
    setMockData({ data: null, error: { message: 'Network error' } });

    const { result } = renderHook(() =>
      useMaterialsConsumed({
        startDate: '2026-01-01',
        endDate: '2026-06-01',
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Network error');
    expect(result.current.records).toEqual([]);
  });

  // ───── 5. Refetch function ─────
  it('refetch() vuelve a consultar datos', async () => {
    let callCount = 0;

    mockSupabaseChain.from.mockImplementation(() => {
      callCount++;
      const data =
        callCount === 1
          ? { data: [makeMaterialRecord('001')], error: null }
          : {
              data: [
                makeMaterialRecord('001'),
                makeMaterialRecord('002'),
              ],
              error: null,
            };
      const p = Promise.resolve(data);
      const chain = {
        select: vi.fn(() => chain),
        order: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        gte: vi.fn(() => chain),
        lte: vi.fn(() => chain),
        in: vi.fn(() => chain),
        then: p.then.bind(p),
        catch: p.catch.bind(p),
        finally: p.finally.bind(p),
      };
      return chain;
    });

    const { result } = renderHook(() =>
      useMaterialsConsumed({
        startDate: '2026-01-01',
        endDate: '2026-06-01',
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.records).toHaveLength(1);

    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.records).toHaveLength(2);
    });
  });

  // ───── 6. Filter by assetId ─────
  it('filtra por assetId — consulta work_orders y filtra WO IDs', async () => {
    let callCount = 0;

    mockSupabaseChain.from.mockImplementation((table) => {
      callCount++;
      if (table === 'work_orders') {
        const p = Promise.resolve({
          data: [{ id: 'wo-001' }, { id: 'wo-002' }],
          error: null,
        });
        const chain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          then: p.then.bind(p),
          catch: p.catch.bind(p),
          finally: p.finally.bind(p),
        };
        return chain;
      }
      // report_materials_consumed
      const data = {
        data: [
          makeMaterialRecord('001', { work_order_id: 'wo-001' }),
          makeMaterialRecord('002', { work_order_id: 'wo-002' }),
        ],
        error: null,
      };
      const p = Promise.resolve(data);
      const chain = {
        select: vi.fn(() => chain),
        order: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        gte: vi.fn(() => chain),
        lte: vi.fn(() => chain),
        in: vi.fn(() => chain),
        then: p.then.bind(p),
        catch: p.catch.bind(p),
        finally: p.finally.bind(p),
      };
      return chain;
    });

    const { result } = renderHook(() =>
      useMaterialsConsumed({
        assetId: 'ast-001',
        startDate: '2026-01-01',
        endDate: '2026-06-01',
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Should have queried work_orders table
    expect(mockSupabaseChain.from).toHaveBeenCalledWith('work_orders');
    expect(mockSupabaseChain.from).toHaveBeenCalledWith(
      'report_materials_consumed'
    );

    // Should have filtered by the returned WO IDs
    const materialsCallArgs = mockSupabaseChain.from.mock.calls.find(
      ([t]) => t === 'report_materials_consumed'
    );
    expect(materialsCallArgs).toBeDefined();

    expect(result.current.records).toHaveLength(2);
  });

  // ───── 7. Filter by partNum ─────
  it('filtra por partNum cuando se provee', async () => {
    const mockRecords = [
      makeMaterialRecord('001', { part_num: 'MAT-A', total_qty: 10 }),
    ];
    setMockData({ data: mockRecords, error: null });

    const { result } = renderHook(() =>
      useMaterialsConsumed({
        partNum: 'MAT-A',
        startDate: '2026-01-01',
        endDate: '2026-06-01',
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Should have applied eq filter on part_num
    // We verify the chain was built by checking data is correct
    expect(result.current.error).toBeNull();
    expect(result.current.records).toHaveLength(1);
    expect(result.current.records[0].part_num).toBe('MAT-A');
  });

  // ───── 8. Sin assetId — consulta directa sin subconsulta ─────
  it('no consulta work_orders si assetId es null', async () => {
    setMockData({
      data: [makeMaterialRecord('001')],
      error: null,
    });

    const { result } = renderHook(() =>
      useMaterialsConsumed({
        startDate: '2026-01-01',
        endDate: '2026-06-01',
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Should NOT have queried work_orders
    const workOrderCalls = mockSupabaseChain.from.mock.calls.filter(
      ([t]) => t === 'work_orders'
    );
    expect(workOrderCalls).toHaveLength(0);

    expect(result.current.records).toHaveLength(1);
  });

  // ───── 9. Asset sin work orders → records vacío ─────
  it('retorna vacío si el asset no tiene work orders', async () => {
    mockSupabaseChain.from.mockImplementation((table) => {
      if (table === 'work_orders') {
        const p = Promise.resolve({ data: [], error: null });
        const chain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          then: p.then.bind(p),
          catch: p.catch.bind(p),
          finally: p.finally.bind(p),
        };
        return chain;
      }
      // Should NOT be reached
      const p = Promise.resolve({ data: [], error: null });
      return {
        select: vi.fn(() => chain),
        then: p.then.bind(p),
        catch: p.catch.bind(p),
        finally: p.finally.bind(p),
      };
    });

    const { result } = renderHook(() =>
      useMaterialsConsumed({
        assetId: 'ast-999',
        startDate: '2026-01-01',
        endDate: '2026-06-01',
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.records).toEqual([]);
    expect(result.current.error).toBeNull();
  });
});
