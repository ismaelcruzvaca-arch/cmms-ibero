/**
 * Tests for useLaborHoursReport — fetches labor_records + user_profiles, aggregates by tech × activity_code.
 *
 * Mocks:
 * - supabase client chain
 *
 * Covers: 4 states (loading, error, empty, success), aggregation by tech × activity_code, grand total.
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

import { useLaborHoursReport } from '../useLaborHoursReport';

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════
function makeLaborRecord(id, overrides = {}) {
  return {
    id,
    work_order_id: 'wo-001',
    technician_id: 'tech-001',
    start_time: '2026-01-15T08:00:00Z',
    end_time: '2026-01-15T12:00:00Z',
    activity_code: 'REP',
    total_hours: 4,
    user_profiles: { full_name: 'Carlos Pérez' },
    ...overrides,
  };
}

describe('useLaborHoursReport', () => {
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
      useLaborHoursReport({
        startDate: '2026-01-01',
        endDate: '2026-06-01',
      })
    );

    expect(result.current.loading).toBe(true);
    expect(result.current.records).toEqual([]);
    expect(result.current.grandTotal).toBe(0);
    expect(result.current.error).toBeNull();
  });

  // ───── 2. Success state with data ─────
  it('retorna registros agregados por técnico × activity_code', async () => {
    const mockRecords = [
      makeLaborRecord('lr-001', {
        technician_id: 'tech-001',
        activity_code: 'REP',
        total_hours: 4,
        user_profiles: { full_name: 'Carlos Pérez' },
      }),
      makeLaborRecord('lr-002', {
        technician_id: 'tech-001',
        activity_code: 'REP',
        total_hours: 3,
        user_profiles: { full_name: 'Carlos Pérez' },
      }),
      makeLaborRecord('lr-003', {
        technician_id: 'tech-001',
        activity_code: 'INS',
        total_hours: 2,
        user_profiles: { full_name: 'Carlos Pérez' },
      }),
      makeLaborRecord('lr-004', {
        technician_id: 'tech-002',
        activity_code: 'REP',
        total_hours: 5,
        user_profiles: { full_name: 'María Gómez' },
      }),
    ];
    setMockData({ data: mockRecords, error: null });

    const { result } = renderHook(() =>
      useLaborHoursReport({
        startDate: '2026-01-01',
        endDate: '2026-06-01',
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.records).toHaveLength(2);
    expect(result.current.grandTotal).toBe(14);

    // Tech 1: Carlos Pérez — 4+3+2 = 9
    const tech1 = result.current.records.find((r) => r.technicianId === 'tech-001');
    expect(tech1).toBeDefined();
    expect(tech1.technicianName).toBe('Carlos Pérez');
    expect(tech1.totalHours).toBe(9);
    expect(tech1.activityBreakdown).toEqual({ REP: 7, INS: 2 });

    // Tech 2: María Gómez — 5
    const tech2 = result.current.records.find((r) => r.technicianId === 'tech-002');
    expect(tech2).toBeDefined();
    expect(tech2.technicianName).toBe('María Gómez');
    expect(tech2.totalHours).toBe(5);
    expect(tech2.activityBreakdown).toEqual({ REP: 5 });
  });

  // ───── 3. Empty state ─────
  it('retorna records vacío si no hay datos', async () => {
    setMockData({ data: [], error: null });

    const { result } = renderHook(() =>
      useLaborHoursReport({
        startDate: '2026-01-01',
        endDate: '2026-06-01',
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.records).toEqual([]);
    expect(result.current.grandTotal).toBe(0);
    expect(result.current.error).toBeNull();
  });

  // ───── 4. Error state ─────
  it('setea error cuando la consulta falla', async () => {
    setMockData({ data: null, error: { message: 'Error de conexión' } });

    const { result } = renderHook(() =>
      useLaborHoursReport({
        startDate: '2026-01-01',
        endDate: '2026-06-01',
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Error de conexión');
  });

  // ───── 5. Filtrar por technician_id ─────
  it('filtra por technician_id cuando se provee', async () => {
    // Return data with multiple techs, only tech-001 should be in results
    // because the hook only queries for tech-001
    const mockRecords = [
      makeLaborRecord('lr-001', {
        technician_id: 'tech-001',
        activity_code: 'REP',
        total_hours: 4,
        user_profiles: { full_name: 'Carlos Pérez' },
      }),
    ];
    setMockData({ data: mockRecords, error: null });

    const { result } = renderHook(() =>
      useLaborHoursReport({
        techId: 'tech-001',
        startDate: '2026-01-01',
        endDate: '2026-06-01',
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.records).toHaveLength(1);
    expect(result.current.records[0].technicianId).toBe('tech-001');
    expect(result.current.records[0].technicianName).toBe('Carlos Pérez');
  });

  // ───── 6. Refetch function ─────
  it('refetch() vuelve a consultar datos', async () => {
    let callCount = 0;

    mockSupabaseChain.from.mockImplementation(() => {
      callCount++;
      const data =
        callCount === 1
          ? { data: [], error: null }
          : {
              data: [makeLaborRecord('lr-001', {
                technician_id: 'tech-001',
                activity_code: 'REP',
                total_hours: 4,
    user_profiles: { full_name: 'Carlos Pérez' },
              })],
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
      useLaborHoursReport({
        startDate: '2026-01-01',
        endDate: '2026-06-01',
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.records).toHaveLength(0);

    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.records).toHaveLength(1);
    });
  });

  // ───── 7. Maneja records sin user_profiles ─────
  it('usa technicianId como nombre si no hay user_profiles', async () => {
    const mockRecords = [
      makeLaborRecord('lr-001', {
        technician_id: 'tech-001',
        activity_code: 'REP',
        total_hours: 4,
        user_profiles: null,
      }),
    ];
    setMockData({ data: mockRecords, error: null });

    const { result } = renderHook(() =>
      useLaborHoursReport({
        startDate: '2026-01-01',
        endDate: '2026-06-01',
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.records).toHaveLength(1);
    expect(result.current.records[0].technicianName).toBe('Técnico tech-001');
  });
});
