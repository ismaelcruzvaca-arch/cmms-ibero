/**
 * Tests para useReportSchedules — hook CRUD para report_schedules.
 *
 * Mockea:
 * - supabase client (chain pattern: .from().select().eq()...)
 *
 * Cubre:
 * - fetchSchedules: básico, vacío, error
 * - createSchedule: INSERT calculando next_run_at
 * - updateSchedule: UPDATE row
 * - deleteSchedule: DELETE row
 * - toggleActive: UPDATE is_active
 * - Error handling en todas las operaciones
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// ═══════════════════════════════════════════════════════════════════
// Mocks hoisteados
// ═══════════════════════════════════════════════════════════════════
const { createSupabaseChain, mockSupabase, baseBuilder, defaultResolve } = vi.hoisted(() => {
  function createSupabaseChain() {
    const queue = [{ data: [], error: null }];

    function nextResolve() {
      return queue.length > 0 ? queue[0] : { data: [], error: null };
    }

    function shiftResolve() {
      if (queue.length > 1) queue.shift();
    }

    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      order: vi.fn(() => builder),
      single: vi.fn(() => builder),

      insert: vi.fn(() => builder),
      update: vi.fn(() => builder),
      delete: vi.fn(() => builder),

      then: (onFulfilled, onRejected) => {
        const val = nextResolve();
        shiftResolve();
        return Promise.resolve(val).then(onFulfilled, onRejected);
      },
      catch: (onRejected) => {
        const val = nextResolve();
        shiftResolve();
        return Promise.resolve(val).catch(onRejected);
      },

      _pushResolve(val) {
        queue.push(val);
      },
      _resetResolve(val) {
        queue.length = 0;
        queue.push(val || { data: [], error: null });
      },
    };
    return builder;
  }

  const builder = createSupabaseChain();

  const supabase = {
    from: vi.fn(() => builder),
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { user: { id: 'admin-001' } } },
      }),
    },
  };

  return {
    createSupabaseChain,
    mockSupabase: supabase,
    baseBuilder: builder,
    defaultResolve: { data: [], error: null },
  };
});

vi.mock('../../lib/supabaseClient', () => ({
  supabase: mockSupabase,
}));

// ═══════════════════════════════════════════════════════════════════
// Import del hook bajo test
// ═══════════════════════════════════════════════════════════════════
import { useReportSchedules } from '../useReportSchedules';

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

/**
 * Crea un objeto schedule mock para pruebas.
 */
function makeSchedule(overrides = {}) {
  return {
    id: overrides.id || 'sched-001',
    name: overrides.name || 'Daily Report',
    template_code: overrides.template_code || 'ot-default',
    cron_expression: overrides.cron_expression || '0 9 * * *',
    recipients: overrides.recipients || ['admin@planta.com'],
    subject: overrides.subject || 'Daily Report',
    params: overrides.params || {},
    is_active: overrides.is_active ?? true,
    last_run_at: overrides.last_run_at || null,
    next_run_at: overrides.next_run_at || '2026-06-06T09:00:00Z',
    created_at: overrides.created_at || '2026-06-05T10:00:00Z',
    updated_at: overrides.updated_at || null,
  };
}

function resetBuilderMocks() {
  vi.clearAllMocks();
  baseBuilder.select.mockClear();
  baseBuilder.eq.mockClear();
  baseBuilder.order.mockClear();
  baseBuilder.single.mockClear();
  baseBuilder.insert.mockClear();
  baseBuilder.update.mockClear();
  baseBuilder.delete.mockClear();
  baseBuilder._resetResolve(defaultResolve);
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════
describe('useReportSchedules', () => {
  beforeEach(() => {
    resetBuilderMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────
  // fetchSchedules
  // ─────────────────────────────────────────────
  describe('fetchSchedules', () => {
    it('retorna schedules vacío cuando no hay datos', async () => {
      baseBuilder._resetResolve({ data: [], error: null });

      const { result } = renderHook(() => useReportSchedules());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await result.current.fetchSchedules();
      expect(result.current.schedules).toEqual([]);
      expect(result.current.error).toBeNull();
    });

    it('retorna schedules desde Supabase ordenados por created_at', async () => {
      const mockSchedules = [
        makeSchedule({ id: 'sched-001', name: 'Daily Report' }),
        makeSchedule({ id: 'sched-002', name: 'Weekly Report' }),
      ];
      baseBuilder._resetResolve({ data: mockSchedules, error: null });

      const { result } = renderHook(() => useReportSchedules());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await result.current.fetchSchedules();

      await waitFor(() => {
        expect(mockSupabase.from).toHaveBeenCalledWith('report_schedules');
        expect(baseBuilder.order).toHaveBeenCalledWith('created_at', { ascending: false });
        expect(result.current.schedules).toHaveLength(2);
        expect(result.current.schedules[0].name).toBe('Daily Report');
        expect(result.current.schedules[1].name).toBe('Weekly Report');
      });
    });

    it('setea error cuando Supabase falla', async () => {
      baseBuilder._resetResolve({ data: null, error: { message: 'Database connection error' } });

      const { result } = renderHook(() => useReportSchedules());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await result.current.fetchSchedules();
      await waitFor(() => {
        expect(result.current.schedules).toEqual([]);
        expect(result.current.error).toBe('Database connection error');
      });
    });
  });

  // ─────────────────────────────────────────────
  // computeNextRun helper (pure function)
  // ─────────────────────────────────────────────
  describe('computeNextRun (via cron-parser)', () => {
    it('usa fallback de 1 hora si cron_expression es inválida', async () => {
      baseBuilder._resetResolve({ data: null, error: null });
      baseBuilder._pushResolve({ data: [], error: null });

      const { result } = renderHook(() => useReportSchedules());
      await waitFor(() => expect(result.current.loading).toBe(false));

      const before = Date.now();
      await result.current.createSchedule({
        name: 'Invalid Cron',
        template_code: 'ot-default',
        cron_expression: '99 99 * * *',
        recipients: ['a@b.com'],
        subject: 'Test',
      });

      const insertCall = baseBuilder.insert.mock.calls[0][0];
      const nextRun = new Date(insertCall.next_run_at).getTime();
      // Should be ~1 hour from now (with some tolerance)
      expect(nextRun).toBeGreaterThanOrEqual(before + 50 * 60 * 1000);
      expect(nextRun).toBeLessThanOrEqual(before + 70 * 60 * 1000);
    });

    it('calcula next_run_at correctamente para cron diaria a las 9am', async () => {
      baseBuilder._resetResolve({ data: null, error: null });
      baseBuilder._pushResolve({ data: [], error: null });

      const { result } = renderHook(() => useReportSchedules());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await result.current.createSchedule({
        name: 'Daily 9am',
        template_code: 'ot-default',
        cron_expression: '0 9 * * *',
        recipients: ['a@b.com'],
        subject: 'Test',
      });

      const insertCall = baseBuilder.insert.mock.calls[0][0];
      const nextRun = new Date(insertCall.next_run_at);
      // Verify it's a future date with the correct minutes (0) — timezone-independent
      expect(nextRun.getTime()).toBeGreaterThan(Date.now());
      expect(nextRun.getUTCMinutes()).toBe(0);
      // Hour depends on local timezone, but seconds must be 0
      expect(nextRun.getUTCSeconds()).toBe(0);
    });
  });

  // ─────────────────────────────────────────────
  // createSchedule
  // ─────────────────────────────────────────────
  describe('createSchedule', () => {
    it('inserta schedule con next_run_at calculado y refresca la lista', async () => {
      const newSchedule = makeSchedule({ id: 'sched-new', name: 'New Report' });

      baseBuilder._resetResolve({ data: null, error: null });
      baseBuilder._pushResolve({ data: [newSchedule], error: null });

      const { result } = renderHook(() => useReportSchedules());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await result.current.createSchedule({
        name: 'New Report',
        template_code: 'ot-default',
        cron_expression: '0 9 * * *',
        recipients: ['admin@planta.com'],
        subject: 'Daily Report',
        params: { scope: 'all' },
      });

      // Verify insert was called with computed next_run_at
      const insertCall = baseBuilder.insert.mock.calls[0][0];
      expect(insertCall.name).toBe('New Report');
      expect(insertCall.template_code).toBe('ot-default');
      expect(insertCall.cron_expression).toBe('0 9 * * *');
      expect(insertCall.recipients).toEqual(['admin@planta.com']);
      expect(insertCall.subject).toBe('Daily Report');
      expect(insertCall.params).toEqual({ scope: 'all' });
      expect(insertCall.is_active).toBe(true);
      expect(insertCall.next_run_at).toBeTruthy();
      expect(new Date(insertCall.next_run_at)).toBeInstanceOf(Date);

      // After create, schedules should be refreshed
      await waitFor(() => {
        expect(result.current.schedules).toHaveLength(1);
      });
    });

    it('no setea error si la creación es exitosa', async () => {
      baseBuilder._resetResolve({ data: [makeSchedule()], error: null });

      const { result } = renderHook(() => useReportSchedules());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await result.current.createSchedule({
        name: 'Test',
        template_code: 'ot-default',
        cron_expression: '0 9 * * *',
        recipients: ['a@b.com'],
        subject: 'Test',
      });

      expect(result.current.error).toBeNull();
    });

    it('crea schedule con is_active=false explícito', async () => {
      baseBuilder._resetResolve({ data: null, error: null });
      baseBuilder._pushResolve({ data: [], error: null });

      const { result } = renderHook(() => useReportSchedules());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await result.current.createSchedule({
        name: 'Inactive',
        template_code: 'ot-default',
        cron_expression: '0 9 * * *',
        recipients: ['a@b.com'],
        subject: 'Test',
        is_active: false,
      });

      const insertCall = baseBuilder.insert.mock.calls[0][0];
      expect(insertCall.is_active).toBe(false);
    });
  });

  // ─────────────────────────────────────────────
  // updateSchedule
  // ─────────────────────────────────────────────
  describe('updateSchedule', () => {
    it('actualiza campos del schedule', async () => {
      const updated = makeSchedule({ id: 'sched-001', name: 'Updated Name' });
      baseBuilder._resetResolve({ data: [updated], error: null });

      const { result } = renderHook(() => useReportSchedules());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await result.current.updateSchedule('sched-001', { name: 'Updated Name' });

      expect(baseBuilder.update).toHaveBeenCalled();
      expect(baseBuilder.eq).toHaveBeenCalledWith('id', 'sched-001');
    });

    it('recalcula next_run_at cuando cambia cron_expression', async () => {
      baseBuilder._resetResolve({ data: [], error: null });

      const { result } = renderHook(() => useReportSchedules());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await result.current.updateSchedule('sched-001', {
        cron_expression: '30 14 * * *',
      });

      const updateCall = baseBuilder.update.mock.calls[0][0];
      expect(updateCall.cron_expression).toBe('30 14 * * *');
      expect(updateCall.next_run_at).toBeTruthy();
      const nextRun = new Date(updateCall.next_run_at);
      expect(nextRun.getTime()).toBeGreaterThan(Date.now());
      expect(nextRun.getUTCMinutes()).toBe(30);
      expect(nextRun.getUTCSeconds()).toBe(0);
    });

    it('setea error si falla update', async () => {
      baseBuilder._resetResolve({ data: null, error: { message: 'Update failed' } });

      const { result } = renderHook(() => useReportSchedules());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await result.current.updateSchedule('sched-001', { name: 'X' });
      await waitFor(() => {
        expect(result.current.error).toBe('Update failed');
      });
    });
  });

  // ─────────────────────────────────────────────
  // deleteSchedule
  // ─────────────────────────────────────────────
  describe('deleteSchedule', () => {
    it('elimina schedule por id', async () => {
      baseBuilder._resetResolve({ data: [], error: null });

      const { result } = renderHook(() => useReportSchedules());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await result.current.deleteSchedule('sched-001');

      expect(baseBuilder.delete).toHaveBeenCalled();
      expect(baseBuilder.eq).toHaveBeenCalledWith('id', 'sched-001');
    });

    it('setea error si falla delete', async () => {
      baseBuilder._resetResolve({ data: null, error: { message: 'Delete failed' } });

      const { result } = renderHook(() => useReportSchedules());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await result.current.deleteSchedule('sched-001');
      await waitFor(() => {
        expect(result.current.error).toBe('Delete failed');
      });
    });
  });

  // ─────────────────────────────────────────────
  // toggleActive
  // ─────────────────────────────────────────────
  describe('toggleActive', () => {
    it('actualiza is_active y refresca lista', async () => {
      const toggled = makeSchedule({ id: 'sched-001', is_active: false });
      baseBuilder._resetResolve({ data: [toggled], error: null });

      const { result } = renderHook(() => useReportSchedules());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await result.current.toggleActive('sched-001', false);

      expect(baseBuilder.update).toHaveBeenCalled();
      const updateArg = baseBuilder.update.mock.calls[0][0];
      expect(updateArg.is_active).toBe(false);
    });

    it('setea error si falla toggle', async () => {
      baseBuilder._resetResolve({ data: null, error: { message: 'Toggle failed' } });

      const { result } = renderHook(() => useReportSchedules());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await result.current.toggleActive('sched-001', true);
      await waitFor(() => {
        expect(result.current.error).toBe('Toggle failed');
      });
    });
  });

  // ─────────────────────────────────────────────
  // Error handling general (network errors)
  // ─────────────────────────────────────────────
  describe('error handling', () => {
    it('maneja error de red en fetchSchedules', async () => {
      const origThen = baseBuilder.then;
      const origCatch = baseBuilder.catch;
      baseBuilder.then = (_onFulfilled, onRejected) =>
        Promise.reject(new Error('Network error')).then(undefined, onRejected);
      baseBuilder.catch = (onRejected) =>
        Promise.reject(new Error('Network error')).catch(onRejected);

      const { result } = renderHook(() => useReportSchedules());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await result.current.fetchSchedules();
      await waitFor(() => {
        expect(result.current.schedules).toEqual([]);
        expect(result.current.error).toBeTruthy();
      });

      baseBuilder.then = origThen;
      baseBuilder.catch = origCatch;
    });

    it('maneja error de red en createSchedule', async () => {
      const origThen = baseBuilder.then;
      baseBuilder.then = (_onFulfilled, onRejected) =>
        Promise.reject(new Error('Network error')).then(undefined, onRejected);

      const { result } = renderHook(() => useReportSchedules());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await result.current.createSchedule({
        name: 'Test',
        template_code: 'ot-default',
        cron_expression: '0 9 * * *',
        recipients: ['a@b.com'],
        subject: 'Test',
      });
      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
      });

      baseBuilder.then = origThen;
    });
  });
});
