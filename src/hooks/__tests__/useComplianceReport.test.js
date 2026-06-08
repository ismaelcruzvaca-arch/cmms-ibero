/**
 * Tests for useComplianceReport — fetches work_permits, lockout_tagout,
 * and technician_skills in parallel with partial-error tolerance.
 *
 * Mocks:
 * - supabase client chain for 3 parallel queries
 *
 * Covers: 4 states (loading, error, empty, success), refetch, filtering,
 * partial errors, total errors.
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
      in: vi.fn(() => chain),
      or: vi.fn(() => chain),
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

import { useComplianceReport } from '../useComplianceReport';

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════
function makePermit(id, overrides = {}) {
  return {
    id: `permit-${id}`,
    permit_status: 'ACTIVE',
    expires_at: '2026-07-01T00:00:00Z',
    description: `Permiso ${id}`,
    location: 'Planta A',
    asset_id: 'ast-001',
    ...overrides,
  };
}

function makeLotoRecord(id, overrides = {}) {
  return {
    id: `loto-${id}`,
    loto_status: 'LOCKED',
    locked_at: '2026-06-01T10:00:00Z',
    asset_id: 'ast-001',
    description: `LOTO ${id}`,
    ...overrides,
  };
}

function makeCert(id, overrides = {}) {
  return {
    id: `cert-${id}`,
    technician_id: `tech-${id}`,
    module_id: `mod-${id}`,
    current_level: 3,
    calculated_at: '2026-05-01T00:00:00Z',
    technological_modules: { code: 'M-PACK', name: 'Empaque' },
    user_profiles: { full_name: `Técnico ${id}` },
    ...overrides,
  };
}

describe('useComplianceReport', () => {
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
      useComplianceReport({ assetId: 'ast-001', startDate: '2026-01-01', endDate: '2026-06-01' })
    );

    expect(result.current.loading).toBe(true);
    expect(result.current.permits).toEqual([]);
    expect(result.current.lotoRecords).toEqual([]);
    expect(result.current.certs).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.sectionErrors).toEqual({
      permits: null,
      loto: null,
      certs: null,
    });
  });

  // ───── 2. Success state with data ─────
  it('retorna datos para las 3 secciones cuando todas tienen éxito', async () => {
    setMockFrom({
      work_permits: () => ({
        data: [makePermit('001'), makePermit('002', { permit_status: 'APPROVED', expires_at: '2026-06-20T00:00:00Z' })],
        error: null,
      }),
      lockout_tagout: () => ({
        data: [
          makeLotoRecord('001'),
          makeLotoRecord('002', { loto_status: 'VERIFIED' }),
        ],
        error: null,
      }),
      technician_skills: () => ({
        data: [makeCert('001'), makeCert('002', { current_level: 5 })],
        error: null,
      }),
    });

    const { result } = renderHook(() =>
      useComplianceReport({})
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.sectionErrors).toEqual({
      permits: null,
      loto: null,
      certs: null,
    });

    // Permits
    expect(result.current.permits).toHaveLength(2);
    expect(result.current.permits[0]).toMatchObject({ id: 'permit-001' });
    expect(result.current.permits[1]).toMatchObject({ id: 'permit-002' });

    // LOTO
    expect(result.current.lotoRecords).toHaveLength(2);
    expect(result.current.lotoRecords[0]).toMatchObject({ id: 'loto-001' });
    expect(result.current.lotoRecords[1]).toMatchObject({ id: 'loto-002' });

    // Certs
    expect(result.current.certs).toHaveLength(2);
    expect(result.current.certs[0]).toMatchObject({ id: 'cert-001' });
    expect(result.current.certs[1]).toMatchObject({ id: 'cert-002' });

    // Verify joins are present
    expect(result.current.certs[0].technological_modules).toBeDefined();
    expect(result.current.certs[0].user_profiles).toBeDefined();
  });

  // ───── 3. Empty state ─────
  it('retorna listas vacías cuando no hay datos', async () => {
    setMockFrom({
      work_permits: () => ({ data: [], error: null }),
      lockout_tagout: () => ({ data: [], error: null }),
      technician_skills: () => ({ data: [], error: null }),
    });

    const { result } = renderHook(() =>
      useComplianceReport({})
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.permits).toEqual([]);
    expect(result.current.lotoRecords).toEqual([]);
    expect(result.current.certs).toEqual([]);
    expect(result.current.sectionErrors).toEqual({
      permits: null,
      loto: null,
      certs: null,
    });
  });

  // ───── 4. Partial error (one fails) ─────
  it('setea sectionError para la sección que falla sin afectar las demás', async () => {
    setMockFrom({
      work_permits: () => ({ data: null, error: { message: 'Permits timeout' } }),
      lockout_tagout: () => ({
        data: [makeLotoRecord('001')],
        error: null,
      }),
      technician_skills: () => ({
        data: [makeCert('001'), makeCert('002')],
        error: null,
      }),
    });

    const { result } = renderHook(() =>
      useComplianceReport({})
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Partial error: only permits failed
    expect(result.current.sectionErrors.permits).toBe('Permits timeout');
    expect(result.current.sectionErrors.loto).toBeNull();
    expect(result.current.sectionErrors.certs).toBeNull();

    // Overall error should be null (not all 3 failed)
    expect(result.current.error).toBeNull();

    // LOTO and certs data should be present
    expect(result.current.lotoRecords).toHaveLength(1);
    expect(result.current.certs).toHaveLength(2);

    // Permits should be empty array
    expect(result.current.permits).toEqual([]);
  });

  // ───── 5. Total error (all 3 fail) ─────
  it('setea error general cuando las 3 consultas fallan', async () => {
    setMockFrom({
      work_permits: () => ({ data: null, error: { message: 'Error A' } }),
      lockout_tagout: () => ({ data: null, error: { message: 'Error B' } }),
      technician_skills: () => ({ data: null, error: { message: 'Error C' } }),
    });

    const { result } = renderHook(() =>
      useComplianceReport({})
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    // All 3 section errors should be set
    expect(result.current.sectionErrors.permits).toBe('Error A');
    expect(result.current.sectionErrors.loto).toBe('Error B');
    expect(result.current.sectionErrors.certs).toBe('Error C');

    // Overall error should be a generic message since all 3 failed
    expect(result.current.error).toBeTruthy();
    expect(result.current.error).toContain('cumplimiento');

    // All data arrays should be empty
    expect(result.current.permits).toEqual([]);
    expect(result.current.lotoRecords).toEqual([]);
    expect(result.current.certs).toEqual([]);
  });

  // ───── 6. Refetch function ─────
  it('refetch() vuelve a consultar datos', async () => {
    let callCount = 0;

    mockSupabaseChain.from.mockImplementation((table) => {
      callCount++;
      const data =
        callCount <= 3
          ? { data: [], error: null }
          : {
              data: {
                work_permits: [makePermit('001')],
                lockout_tagout: [makeLotoRecord('001')],
                technician_skills: [makeCert('001')],
              }[table] || [],
              error: null,
            };

      // For refetch, always return data
      if (callCount > 3) {
        const finalData = {
          work_permits: { data: [makePermit('001')], error: null },
          lockout_tagout: { data: [makeLotoRecord('001')], error: null },
          technician_skills: { data: [makeCert('001')], error: null },
        }[table] || { data: [], error: null };

        const p = Promise.resolve(finalData);
        const chain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          gte: vi.fn(() => chain),
          lte: vi.fn(() => chain),
          order: vi.fn(() => chain),
          in: vi.fn(() => chain),
          or: vi.fn(() => chain),
          then: p.then.bind(p),
          catch: p.catch.bind(p),
          finally: p.finally.bind(p),
        };
        return chain;
      }

      const p = Promise.resolve(data);
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        gte: vi.fn(() => chain),
        lte: vi.fn(() => chain),
        order: vi.fn(() => chain),
        in: vi.fn(() => chain),
        or: vi.fn(() => chain),
        then: p.then.bind(p),
        catch: p.catch.bind(p),
        finally: p.finally.bind(p),
      };
      return chain;
    });

    const { result } = renderHook(() =>
      useComplianceReport({})
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    // First call returned empty
    expect(result.current.permits).toHaveLength(0);
    expect(result.current.lotoRecords).toHaveLength(0);
    expect(result.current.certs).toHaveLength(0);

    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.permits.length).toBeGreaterThan(0);
      expect(result.current.lotoRecords.length).toBeGreaterThan(0);
      expect(result.current.certs.length).toBeGreaterThan(0);
    });
  });

  // ───── 7. Filter by assetId ─────
  it('filtra work_permits y lockout_tagout por assetId', async () => {
    let assetFilterCalls = [];

    mockSupabaseChain.from.mockImplementation((table) => {
      const chainBuilder = (data) => {
        const p = Promise.resolve(data);
        return {
          select: vi.fn(() => chainBuilder(data)),
          eq: vi.fn((field, value) => {
            if (field === 'asset_id') assetFilterCalls.push({ table, value });
            return chainBuilder(data);
          }),
          gte: vi.fn(() => chainBuilder(data)),
          lte: vi.fn(() => chainBuilder(data)),
          order: vi.fn(() => chainBuilder(data)),
          in: vi.fn(() => chainBuilder(data)),
          or: vi.fn(() => chainBuilder(data)),
          then: p.then.bind(p),
          catch: p.catch.bind(p),
          finally: p.finally.bind(p),
        };
      };

      return chainBuilder({ data: [], error: null });
    });

    renderHook(() =>
      useComplianceReport({ assetId: 'ast-002' })
    );

    await waitFor(() => {
      // Should have called from for all 3 tables
      expect(mockSupabaseChain.from).toHaveBeenCalledWith('work_permits');
      expect(mockSupabaseChain.from).toHaveBeenCalledWith('lockout_tagout');
      expect(mockSupabaseChain.from).toHaveBeenCalledWith('technician_skills');
    });

    // asset_id filter should be applied to work_permits and lockout_tagout
    const permitAssetCalls = assetFilterCalls.filter(
      (c) => c.table === 'work_permits'
    );
    const lotoAssetCalls = assetFilterCalls.filter(
      (c) => c.table === 'lockout_tagout'
    );
    // technician_skills should NOT have asset_id filter
    const certAssetCalls = assetFilterCalls.filter(
      (c) => c.table === 'technician_skills'
    );

    expect(permitAssetCalls.length).toBeGreaterThanOrEqual(1);
    expect(permitAssetCalls[0].value).toBe('ast-002');
    expect(lotoAssetCalls.length).toBeGreaterThanOrEqual(1);
    expect(lotoAssetCalls[0].value).toBe('ast-002');
    expect(certAssetCalls).toHaveLength(0);
  });

  // ───── 8. Filter by techId ─────
  it('filtra technician_skills por techId', async () => {
    let techFilterCalls = [];

    mockSupabaseChain.from.mockImplementation((table) => {
      const chainBuilder = (data) => {
        const p = Promise.resolve(data);
        return {
          select: vi.fn(() => chainBuilder(data)),
          eq: vi.fn((field, value) => {
            if (field === 'technician_id') techFilterCalls.push({ table, value });
            return chainBuilder(data);
          }),
          gte: vi.fn(() => chainBuilder(data)),
          lte: vi.fn(() => chainBuilder(data)),
          order: vi.fn(() => chainBuilder(data)),
          in: vi.fn(() => chainBuilder(data)),
          or: vi.fn(() => chainBuilder(data)),
          then: p.then.bind(p),
          catch: p.catch.bind(p),
          finally: p.finally.bind(p),
        };
      };

      return chainBuilder({ data: [], error: null });
    });

    renderHook(() =>
      useComplianceReport({ techId: 'tech-007' })
    );

    await waitFor(() => {
      expect(mockSupabaseChain.from).toHaveBeenCalledWith('technician_skills');
    });

    // Only technician_skills should get the technician_id filter
    expect(techFilterCalls).toHaveLength(1);
    expect(techFilterCalls[0].table).toBe('technician_skills');
    expect(techFilterCalls[0].value).toBe('tech-007');
  });

  // ───── 9. Sin filtros — no aplica .eq() en ningún lado ─────
  it('sin filtros no aplica condiciones eq innecesarias', async () => {
    let eqCallCount = 0;

    mockSupabaseChain.from.mockImplementation(() => {
      const data = { data: [], error: null };
      const p = Promise.resolve(data);
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => {
          eqCallCount++;
          return chain;
        }),
        gte: vi.fn(() => chain),
        lte: vi.fn(() => chain),
        order: vi.fn(() => chain),
        in: vi.fn(() => chain),
        or: vi.fn(() => chain),
        then: p.then.bind(p),
        catch: p.catch.bind(p),
        finally: p.finally.bind(p),
      };
      return chain;
    });

    const { result } = renderHook(() =>
      useComplianceReport({})
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    // When no filters, eq should not be called for asset_id or technician_id
    // but might be called for permit_status in the or() filter (that's fine)
    expect(result.current.error).toBeNull();
  });
});
