/**
 * Tests for useKpiMetrics — fetches 3 KPI views and aggregates monthly.
 *
 * Mocks:
 * - supabase client chain for kpi_mtbf, kpi_mttr, kpi_availability views
 *
 * Covers: 4 states (loading, error, empty, success), monthly aggregation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// ═══════════════════════════════════════════════════════════════════
// Mocks hoisteados
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

import { useKpiMetrics } from '../useKpiMetrics';

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════
function makeMtbfRow(overrides = {}) {
  return {
    asset_id: 'ast-001',
    period_month: '2026-01-01',
    mtbf_hours: 45.2,
    wo_count: 3,
    ...overrides,
  };
}

function makeMttrRow(overrides = {}) {
  return {
    asset_id: 'ast-001',
    period_month: '2026-01-01',
    mttr_hours: 3.5,
    wo_count: 3,
    ...overrides,
  };
}

function makeAvailabilityRow(overrides = {}) {
  return {
    asset_id: 'ast-001',
    period_month: '2026-01-01',
    availability_pct: 97.8,
    ...overrides,
  };
}

describe('useKpiMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ───── 1. Loading state ─────
  it('inicia con loading=true', () => {
    setMockFrom({});

    const { result } = renderHook(() =>
      useKpiMetrics({
        assetId: 'ast-001',
        startDate: '2026-01-01',
        endDate: '2026-06-01',
      })
    );

    expect(result.current.loading).toBe(true);
    expect(result.current.current).toEqual({
      mtbfHours: null,
      mttrHours: null,
      availabilityPct: null,
      totalWos: 0,
    });
    expect(result.current.monthly).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  // ───── 2. Success state with data ─────
  it('retorna KPIs actuales y mensuales cuando hay datos', async () => {
    setMockFrom({
      kpi_mtbf: () => ({
        data: [
          makeMtbfRow({ period_month: '2026-01-01', mtbf_hours: 45.2 }),
          makeMtbfRow({ period_month: '2026-02-01', mtbf_hours: 32.1 }),
        ],
        error: null,
      }),
      kpi_mttr: () => ({
        data: [
          makeMttrRow({ period_month: '2026-01-01', mttr_hours: 3.5 }),
          makeMttrRow({ period_month: '2026-02-01', mttr_hours: 4.2 }),
        ],
        error: null,
      }),
      kpi_availability: () => ({
        data: [
          makeAvailabilityRow({ period_month: '2026-01-01', availability_pct: 97.8 }),
          makeAvailabilityRow({ period_month: '2026-02-01', availability_pct: 95.3 }),
        ],
        error: null,
      }),
    });

    const { result } = renderHook(() =>
      useKpiMetrics({
        assetId: 'ast-001',
        startDate: '2026-01-01',
        endDate: '2026-06-01',
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    // Current should be the aggregate
    expect(result.current.current.mtbfHours).toBeTypeOf('number');
    expect(result.current.current.mttrHours).toBeTypeOf('number');
    expect(result.current.current.availabilityPct).toBeTypeOf('number');
    expect(result.current.current.totalWos).toBeGreaterThan(0);

    // Monthly should have 2 entries
    expect(result.current.monthly).toHaveLength(2);
    expect(result.current.monthly[0]).toMatchObject({
      periodMonth: '2026-01-01',
      mtbfHours: 45.2,
      mttrHours: 3.5,
      availabilityPct: 97.8,
    });
    expect(result.current.monthly[1]).toMatchObject({
      periodMonth: '2026-02-01',
      mtbfHours: 32.1,
      mttrHours: 4.2,
      availabilityPct: 95.3,
    });
  });

  // ───── 3. Empty state ─────
  it('retorna current null cuando no hay datos', async () => {
    setMockFrom({
      kpi_mtbf: () => ({ data: [], error: null }),
      kpi_mttr: () => ({ data: [], error: null }),
      kpi_availability: () => ({ data: [], error: null }),
    });

    const { result } = renderHook(() =>
      useKpiMetrics({
        assetId: 'ast-001',
        startDate: '2026-01-01',
        endDate: '2026-06-01',
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.current).toEqual({
      mtbfHours: null,
      mttrHours: null,
      availabilityPct: null,
      totalWos: 0,
    });
    expect(result.current.monthly).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  // ───── 4. Error state ─────
  it('setea error cuando alguna vista falla', async () => {
    setMockFrom({
      kpi_mtbf: () => ({ data: null, error: { message: 'Permission denied' } }),
    });

    const { result } = renderHook(() =>
      useKpiMetrics({
        assetId: 'ast-001',
        startDate: '2026-01-01',
        endDate: '2026-06-01',
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Permission denied');
  });

  // ───── 5. Refetch function ─────
  it('refetch() vuelve a consultar datos', async () => {
    let callCount = 0;

    mockSupabaseChain.from.mockImplementation(() => {
      callCount++;
      const data =
        callCount <= 3
          ? { data: [], error: null }
          : {
              data: [
                makeMtbfRow({ period_month: '2026-01-01', mtbf_hours: 50 }),
                makeMttrRow({ period_month: '2026-01-01', mttr_hours: 2.0 }),
                makeAvailabilityRow({ period_month: '2026-01-01', availability_pct: 99 }),
              ],
              error: null,
            };
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
    });

    const { result } = renderHook(() =>
      useKpiMetrics({
        assetId: 'ast-001',
        startDate: '2026-01-01',
        endDate: '2026-06-01',
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.monthly).toHaveLength(0);

    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.monthly.length).toBeGreaterThan(0);
    });
  });
});
