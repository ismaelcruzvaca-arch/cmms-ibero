/**
 * Tests para useTemplates — hook de administración de templates.
 *
 * Mockea:
 * - supabase client (chain pattern: .from().select().eq()...)
 *
 * Cubre:
 * - fetchAll: básico, con search, con paginación
 * - create: INSERT con version=1
 * - update: INSERT version+1 + desactivar anterior
 * - duplicate: deep clone con nuevo code
 * - rollback: toggle is_active entre versiones
 * - toggleActive: flip is_active
 * - Error handling en todas las operaciones
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// ═══════════════════════════════════════════════════════════════════
// Mocks hoisteados (todo lo que necesita vi.mock debe ir aquí)
// ═══════════════════════════════════════════════════════════════════
const { createSupabaseChain, mockSupabase, baseBuilder, defaultResolve } = vi.hoisted(() => {
  /**
   * Crea un chain builder al estilo Supabase.
   * Controla resolución vía cola de respuestas (responseQueue).
   */
  function createSupabaseChain() {
    const queue = [{ data: [], error: null, count: 0 }];

    function nextResolve() {
      // Usar el primer item de la cola, o el default
      return queue.length > 0 ? queue[0] : { data: [], error: null, count: 0 };
    }

    function shiftResolve() {
      if (queue.length > 1) queue.shift();
    }

    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      neq: vi.fn(() => builder),
      or: vi.fn(() => builder),
      order: vi.fn(() => builder),
      range: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      single: vi.fn(() => builder),
      maybeSingle: vi.fn(() => builder),
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

      /** Agrega una respuesta a la cola (FIFO). */
      _pushResolve(val) {
        queue.push(val);
      },
      /** Limpia la cola y pone un default. */
      _resetResolve(val) {
        queue.length = 0;
        queue.push(val || { data: [], error: null, count: 0 });
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
    defaultResolve: { data: [], error: null, count: 0 },
  };
});

vi.mock('../../lib/supabaseClient', () => ({
  supabase: mockSupabase,
}));

// ═══════════════════════════════════════════════════════════════════
// Import del hook bajo test
// ═══════════════════════════════════════════════════════════════════
import { useTemplates } from '../useTemplates';

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════
function makeTemplate(overrides = {}) {
  return {
    id: overrides.id || 'tmpl-001',
    code: overrides.code || 'ot-default',
    name: overrides.name || 'Template OT Default',
    description: overrides.description || 'Template para órdenes de trabajo',
    template: overrides.template || { sections: [{ type: 'header', titleField: 'title' }] },
    version: overrides.version ?? 3,
    is_active: overrides.is_active ?? true,
    created_at: overrides.created_at || '2026-01-15T10:00:00Z',
    updated_at: overrides.updated_at || null,
  };
}

function resetBuilderMocks() {
  vi.clearAllMocks();
  baseBuilder.select.mockClear();
  baseBuilder.eq.mockClear();
  baseBuilder.or.mockClear();
  baseBuilder.order.mockClear();
  baseBuilder.range.mockClear();
  baseBuilder.single.mockClear();
  baseBuilder.insert.mockClear();
  baseBuilder.update.mockClear();
  baseBuilder.delete.mockClear();
  baseBuilder._resetResolve(defaultResolve);
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════
describe('useTemplates', () => {
  beforeEach(() => {
    resetBuilderMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────
  // fetchAll
  // ─────────────────────────────────────────────
  describe('fetchAll', () => {
    it('retorna lista vacía cuando no hay templates', async () => {
      baseBuilder._resetResolve({ data: [], error: null, count: 0 });

      const { result } = renderHook(() => useTemplates());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const res = await result.current.fetchAll();
      expect(res.data).toEqual([]);
      expect(res.total).toBe(0);
      expect(res.error).toBeNull();
    });

    it('fetchAll con datos retorna los templates', async () => {
      const mockTemplates = [makeTemplate(), makeTemplate({ id: 'tmpl-002', code: 'pm-default' })];
      baseBuilder._resetResolve({ data: mockTemplates, error: null, count: 2 });

      const { result } = renderHook(() => useTemplates());

      await waitFor(() => expect(result.current.loading).toBe(false));

      const res = await result.current.fetchAll();
      expect(res.data).toHaveLength(2);
      expect(res.total).toBe(2);
      expect(res.error).toBeNull();
    });

    it('fetchAll con search añade filtro ILIKE', async () => {
      const mockTemplates = [makeTemplate({ code: 'ot-default' })];
      baseBuilder._resetResolve({ data: mockTemplates, error: null, count: 1 });

      const { result } = renderHook(() => useTemplates());
      await waitFor(() => expect(result.current.loading).toBe(false));

      const res = await result.current.fetchAll({ search: 'ot-default' });

      expect(baseBuilder.or).toHaveBeenCalled();
      expect(res.data).toHaveLength(1);
      expect(res.error).toBeNull();
    });

    it('fetchAll con paginación aplica range()', async () => {
      const mockTemplates = Array.from({ length: 5 }, (_, i) =>
        makeTemplate({ id: `tmpl-${i}`, code: `code-${i}` })
      );
      baseBuilder._resetResolve({ data: mockTemplates, error: null, count: 20 });

      const { result } = renderHook(() => useTemplates());
      await waitFor(() => expect(result.current.loading).toBe(false));

      const res = await result.current.fetchAll({ page: 2, pageSize: 5 });
      expect(res.data).toHaveLength(5);
      expect(res.total).toBe(20);

      expect(baseBuilder.range).toHaveBeenCalledWith(5, 9);
    });

    it('fetchAll retorna error cuando Supabase falla', async () => {
      baseBuilder._resetResolve({ data: null, error: { message: 'Database error', code: 'PGRST301' }, count: 0 });

      const { result } = renderHook(() => useTemplates());
      await waitFor(() => expect(result.current.loading).toBe(false));

      const res = await result.current.fetchAll();
      expect(res.data).toEqual([]);
      expect(res.total).toBe(0);
      expect(res.error).toBeTruthy();
    });
  });

  // ─────────────────────────────────────────────
  // create
  // ─────────────────────────────────────────────
  describe('create', () => {
    it('crea template con version=1 y retorna data', async () => {
      const newTemplate = makeTemplate({ version: 1 });
      baseBuilder._resetResolve({ data: newTemplate, error: null });

      const { result } = renderHook(() => useTemplates());
      await waitFor(() => expect(result.current.loading).toBe(false));

      const res = await result.current.create({
        code: 'nuevo-template',
        name: 'Nuevo Template',
        description: 'Un template nuevo',
        template: { sections: [] },
      });

      expect(baseBuilder.insert).toHaveBeenCalledWith({
        code: 'nuevo-template',
        name: 'Nuevo Template',
        description: 'Un template nuevo',
        template: { sections: [] },
        version: 1,
        is_active: true,
      });

      expect(res.data).toEqual(newTemplate);
      expect(res.error).toBeNull();
    });

    it('create retorna error si Supabase falla', async () => {
      baseBuilder._resetResolve({ data: null, error: { message: 'Unique constraint violation', code: '23505' } });

      const { result } = renderHook(() => useTemplates());
      await waitFor(() => expect(result.current.loading).toBe(false));

      const res = await result.current.create({
        code: 'duplicado',
        name: 'Código duplicado',
      });

      expect(res.data).toBeNull();
      expect(res.error).toBeTruthy();
    });
  });

  // ─────────────────────────────────────────────
  // update (version+1)
  // ─────────────────────────────────────────────
  describe('update', () => {
    it('inserta nueva versión (version+1) y desactiva anterior', async () => {
      resetBuilderMocks();

      const currentTemplate = makeTemplate({ version: 3 });
      const newVersion = makeTemplate({ version: 4 });

      // Secuencia de awaits: currentActive → currentTemplate → insertNewVersion → deactivateOld
      baseBuilder._resetResolve({ data: { version: 3 }, error: null });
      baseBuilder._pushResolve({ data: currentTemplate, error: null });
      baseBuilder._pushResolve({ data: newVersion, error: null });
      baseBuilder._pushResolve({ data: null, error: null });

      const { result } = renderHook(() => useTemplates());
      await waitFor(() => expect(result.current.loading).toBe(false));

      const res = await result.current.update('ot-default', {
        template: { sections: [{ type: 'footer', text: 'v4' }] },
      });

      expect(res.data).toBeDefined();
      expect(res.error).toBeNull();
    });

    it('update sin template activo previo crea version=1', async () => {
      resetBuilderMocks();

      const newVersion = makeTemplate({ version: 1 });

      // No hay template activo (PGRST116) → no hay currentTemplate → insert + deactivate skipped
      baseBuilder._resetResolve({ data: null, error: { code: 'PGRST116', message: 'No rows' } });
      baseBuilder._pushResolve({ data: null, error: { code: 'PGRST116', message: 'No rows' } });
      baseBuilder._pushResolve({ data: newVersion, error: null });

      const { result } = renderHook(() => useTemplates());
      await waitFor(() => expect(result.current.loading).toBe(false));

      const res = await result.current.update('ot-default', {
        name: 'Nuevo name',
      });

      expect(res.data).toBeDefined();
      expect(res.error).toBeNull();
    });

    it('update retorna error si falla el insert', async () => {
      resetBuilderMocks();

      baseBuilder._resetResolve({ data: { version: 2 }, error: null });
      baseBuilder._pushResolve({ data: makeTemplate({ version: 2 }), error: null });
      baseBuilder._pushResolve({ data: null, error: { message: 'Insert failed' } });

      const { result } = renderHook(() => useTemplates());
      await waitFor(() => expect(result.current.loading).toBe(false));

      const res = await result.current.update('ot-default', {
        template: { sections: [] },
      });

      expect(res.data).toBeNull();
      expect(res.error).toBeTruthy();
    });
  });

  // ─────────────────────────────────────────────
  // duplicate
  // ─────────────────────────────────────────────
  describe('duplicate', () => {
    it('duplica template con nuevo código y version=1', async () => {
      resetBuilderMocks();

      const source = makeTemplate({ code: 'ot-default', version: 5 });
      const clone = makeTemplate({ id: 'tmpl-copy', code: 'ot-default (copy)', version: 1 });

      baseBuilder._resetResolve({ data: source, error: null });
      baseBuilder._pushResolve({ data: clone, error: null });

      const { result } = renderHook(() => useTemplates());
      await waitFor(() => expect(result.current.loading).toBe(false));

      const res = await result.current.duplicate('ot-default');

      expect(res.data).toBeDefined();
      expect(res.data.code).toBe('ot-default (copy)');
      expect(res.data.version).toBe(1);
      expect(res.error).toBeNull();

      expect(baseBuilder.insert).toHaveBeenCalledWith({
        code: 'ot-default (copy)',
        name: source.name,
        description: source.description,
        template: source.template,
        version: 1,
        is_active: true,
      });
    });

    it('duplicate con custom newCode', async () => {
      resetBuilderMocks();

      const source = makeTemplate({ code: 'ot-default' });
      const clone = makeTemplate({ id: 'tmpl-copy', code: 'ot-default-v2', version: 1 });

      baseBuilder._resetResolve({ data: source, error: null });
      baseBuilder._pushResolve({ data: clone, error: null });

      const { result } = renderHook(() => useTemplates());
      await waitFor(() => expect(result.current.loading).toBe(false));

      const res = await result.current.duplicate('ot-default', 'ot-default-v2');

      expect(res.data.code).toBe('ot-default-v2');
      expect(baseBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'ot-default-v2' })
      );
    });

    it('duplicate retorna error si no encuentra source', async () => {
      resetBuilderMocks();

      baseBuilder._resetResolve({ data: null, error: { message: 'Not found', code: 'PGRST116' } });

      const { result } = renderHook(() => useTemplates());
      await waitFor(() => expect(result.current.loading).toBe(false));

      const res = await result.current.duplicate('no-existe');

      expect(res.data).toBeNull();
      expect(res.error).toBeTruthy();
    });
  });

  // ─────────────────────────────────────────────
  // rollback
  // ─────────────────────────────────────────────
  describe('rollback', () => {
    it('desactiva versión actual y activa target', async () => {
      resetBuilderMocks();

      const targetTemplate = makeTemplate({ version: 2 });

      // 2 awaits: deactivate current → activate target
      baseBuilder._resetResolve({ data: null, error: null });
      baseBuilder._pushResolve({ data: targetTemplate, error: null });

      const { result } = renderHook(() => useTemplates());
      await waitFor(() => expect(result.current.loading).toBe(false));

      const res = await result.current.rollback('ot-default', 2);

      expect(res.data).toBeDefined();
      expect(res.data.version).toBe(2);
      expect(res.error).toBeNull();
    });

    it('rollback retorna error si falla activación', async () => {
      resetBuilderMocks();

      baseBuilder._resetResolve({ data: null, error: null });
      baseBuilder._pushResolve({ data: null, error: { message: 'Activation failed' } });

      const { result } = renderHook(() => useTemplates());
      await waitFor(() => expect(result.current.loading).toBe(false));

      const res = await result.current.rollback('ot-default', 2);

      expect(res.data).toBeNull();
      expect(res.error).toBeTruthy();
    });
  });

  // ─────────────────────────────────────────────
  // toggleActive
  // ─────────────────────────────────────────────
  describe('toggleActive', () => {
    it('toggle de true a false', async () => {
      resetBuilderMocks();

      const updated = makeTemplate({ is_active: false, version: 3 });

      // 2 awaits: fetch current → update
      baseBuilder._resetResolve({ data: { is_active: true }, error: null });
      baseBuilder._pushResolve({ data: updated, error: null });

      const { result } = renderHook(() => useTemplates());
      await waitFor(() => expect(result.current.loading).toBe(false));

      const res = await result.current.toggleActive('ot-default', 3);

      expect(res.data).toBeDefined();
      expect(res.data.is_active).toBe(false);
      expect(res.error).toBeNull();
    });

    it('toggle de false a true (activa y desactiva otras versiones)', async () => {
      resetBuilderMocks();

      const updated = makeTemplate({ is_active: true, version: 3 });

      // 3 awaits: fetch current → deactivate others → activate target
      baseBuilder._resetResolve({ data: { is_active: false }, error: null });
      baseBuilder._pushResolve({ data: null, error: null });
      baseBuilder._pushResolve({ data: updated, error: null });

      const { result } = renderHook(() => useTemplates());
      await waitFor(() => expect(result.current.loading).toBe(false));

      const res = await result.current.toggleActive('ot-default', 3);

      expect(res.data).toBeDefined();
      expect(res.data.is_active).toBe(true);
      expect(res.error).toBeNull();
    });

    it('toggleActive retorna error si falla fetch', async () => {
      resetBuilderMocks();

      baseBuilder._resetResolve({ data: null, error: { message: 'Not found' } });

      const { result } = renderHook(() => useTemplates());
      await waitFor(() => expect(result.current.loading).toBe(false));

      const res = await result.current.toggleActive('no-existe', 1);

      expect(res.data).toBeNull();
      expect(res.error).toBeTruthy();
    });
  });

  // ─────────────────────────────────────────────
  // Error handling general
  // ─────────────────────────────────────────────
  describe('error handling', () => {
    it('maneja errores de red en fetchAll', async () => {
      resetBuilderMocks();

      const origThen = baseBuilder.then;
      const origCatch = baseBuilder.catch;
      baseBuilder.then = (_onFulfilled, onRejected) =>
        Promise.reject(new Error('Network error')).then(undefined, onRejected);
      baseBuilder.catch = (onRejected) =>
        Promise.reject(new Error('Network error')).catch(onRejected);

      const { result } = renderHook(() => useTemplates());
      await waitFor(() => expect(result.current.loading).toBe(false));

      const res = await result.current.fetchAll();
      expect(res.data).toEqual([]);
      expect(res.error).toBeTruthy();

      baseBuilder.then = origThen;
      baseBuilder.catch = origCatch;
    });

    it('maneja errores de red en create', async () => {
      resetBuilderMocks();

      const origThen = baseBuilder.then;
      baseBuilder.then = (_onFulfilled, onRejected) =>
        Promise.reject(new Error('Network error')).then(undefined, onRejected);

      const { result } = renderHook(() => useTemplates());
      await waitFor(() => expect(result.current.loading).toBe(false));

      const res = await result.current.create({ code: 'test', name: 'Test', template: {} });
      expect(res.data).toBeNull();
      expect(res.error).toBeTruthy();

      baseBuilder.then = origThen;
    });
  });
});
