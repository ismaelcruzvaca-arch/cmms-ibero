/**
 * Tests para useWorkOrders — hook RxDB con replicación y CRUD de Work Orders.
 *
 * Mockea:
 * - initRxDB (RxDB)
 * - startReplication (replicación)
 *
 * Cubre: init → consulta → filtro lifecycle → syncStatus → CRUD → errores → cleanup
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// ═══════════════════════════════════════════════════════════════════
// Mocks hoisteados
// ═══════════════════════════════════════════════════════════════════
const { mockInitRxDB, mockStartReplication, makeRxDoc } = vi.hoisted(() => {
  function makeRxDoc(overrides = {}) {
    return {
      toJSON: vi.fn(() => ({
        id: 'WO-001',
        equipment_id: 'EQ-001',
        description: 'Cambio de bomba',
        asset_id: 'AST-001',
        wo_type: 'corrective',
        lifecycle_phase: 'INPRG',
        priority: 'high',
        criticality: 'A',
        percentage_complete: 50,
        assigned_to: 'user-001',
        planned_hours: 8,
        actual_hours: 0,
        cost_estimate: 500,
        actual_cost: 0,
        location: 'Planta A',
        _deleted: false,
        _conflict: false,
        created_at: '2026-06-01T10:00:00Z',
        updated_at: 1717236000000,
        ...overrides,
      })),
      update: vi.fn().mockResolvedValue({}),
    };
  }

  const initRxDB = vi.fn();
  const startReplication = vi.fn();

  return {
    mockInitRxDB: initRxDB,
    mockStartReplication: startReplication,
    makeRxDoc,
  };
});

// ═══════════════════════════════════════════════════════════════════
// Mocks de módulos
// ═══════════════════════════════════════════════════════════════════
vi.mock('../../lib/rxdb', () => ({
  initRxDB: (...args) => mockInitRxDB(...args),
  startReplication: (...args) => mockStartReplication(...args),
}));

// ═══════════════════════════════════════════════════════════════════
// Import del hook bajo test
// ═══════════════════════════════════════════════════════════════════
import { useWorkOrders } from '../useWorkOrders';

// ═══════════════════════════════════════════════════════════════════
// Helpers para construir mocks
// ═══════════════════════════════════════════════════════════════════
function createMockDb(overrides = {}) {
  const findExec = vi.fn().mockResolvedValue([]);
  const subscribeHandlers = { next: null, error: null };

  const db = {
    work_orders: {
      find: vi.fn(() => ({
        exec: findExec,
        $: {
          subscribe: vi.fn(({ next, error }) => {
            subscribeHandlers.next = next;
            subscribeHandlers.error = error;
            return { unsubscribe: vi.fn() };
          }),
        },
      })),
      findOne: vi.fn(() => ({
        exec: vi.fn().mockResolvedValue(null),
      })),
      insert: vi.fn().mockResolvedValue({}),
    },
    ...overrides,
  };

  return { db, findExec, subscribeHandlers };
}

function createRepState(initialActive = false) {
  let currentValue = initialActive;
  const activeHandlers = [];
  const active$ = {
    subscribe: vi.fn((handler) => {
      activeHandlers.push(handler);
      // Llamar al handler inmediatamente con el valor actual,
      // igual que hace RxDB real
      handler(currentValue);
      return { unsubscribe: vi.fn() };
    }),
  };

  return {
    active$,
    cancel: vi.fn(),
    /** Emitir cambio de active desde afuera */
    emitActive: (val) => {
      currentValue = val;
      activeHandlers.forEach(h => h(val));
    },
  };
}

function createSubscriptionHandler() {
  let currentNext = null;
  let currentError = null;
  return {
    setNext: (fn) => { currentNext = fn; },
    setError: (fn) => { currentError = fn; },
    getNext: () => currentNext,
    getError: () => currentError,
    subscribeFn: vi.fn(({ next, error }) => {
      currentNext = next;
      currentError = error;
      return { unsubscribe: vi.fn() };
    }),
  };
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════
describe('useWorkOrders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ───── 1. Estado inicial ─────
  it('inicia con loading=true, workOrders vacío, syncStatus offline', () => {
    const { result } = renderHook(() => useWorkOrders());

    expect(result.current.loading).toBe(true);
    expect(result.current.workOrders).toEqual([]);
    expect(result.current.allWorkOrders).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.syncStatus).toBe('offline');
    expect(result.current.createWorkOrder).toBeInstanceOf(Function);
    expect(result.current.updateWorkOrder).toBeInstanceOf(Function);
    expect(result.current.deleteWorkOrder).toBeInstanceOf(Function);
  });

  // ───── 2. Inicializa RxDB y replicación ─────
  it('inicializa RxDB y startReplication al montar', async () => {
    const { db } = createMockDb();
    const rep = createRepState(false);
    mockInitRxDB.mockResolvedValue(db);
    mockStartReplication.mockResolvedValue({ work_orders: rep });

    const { result } = renderHook(() => useWorkOrders());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockInitRxDB).toHaveBeenCalled();
    expect(mockStartReplication).toHaveBeenCalledWith(db);
    expect(result.current.syncStatus).toBe('online');
    expect(result.current.error).toBeNull();
  });

  // ───── 3. Carga workOrders desde RxDB ─────
  it('carga documentos desde la colección work_orders', async () => {
    const docs = [
      makeRxDoc({ id: 'WO-001', description: 'Tarea A' }),
      makeRxDoc({ id: 'WO-002', description: 'Tarea B' }),
    ];
    const { db, subscribeHandlers } = createMockDb();
    db.work_orders.find = vi.fn(() => ({
      exec: vi.fn().mockResolvedValue(docs),
      $: {
        subscribe: vi.fn(({ next, error }) => {
          subscribeHandlers.next = next;
          subscribeHandlers.error = error;
          return { unsubscribe: vi.fn() };
        }),
      },
    }));
    const rep = createRepState(false);
    mockInitRxDB.mockResolvedValue(db);
    mockStartReplication.mockResolvedValue({ work_orders: rep });

    const { result } = renderHook(() => useWorkOrders());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.workOrders).toHaveLength(2);
    expect(result.current.workOrders[0].id).toBe('WO-001');
    expect(result.current.workOrders[1].id).toBe('WO-002');
    expect(result.current.error).toBeNull();
  });

  // ───── 4. Aplica lifecycleFilter ─────
  it('filtra workOrders por lifecycleFilter', async () => {
    const docs = [
      makeRxDoc({ id: 'WO-001', lifecycle_phase: 'INPRG' }),
      makeRxDoc({ id: 'WO-002', lifecycle_phase: 'COMP' }),
      makeRxDoc({ id: 'WO-003', lifecycle_phase: 'APPROVED' }),
    ];
    const { db } = createMockDb();
    db.work_orders.find = vi.fn(() => ({
      exec: vi.fn().mockResolvedValue(docs),
      $: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) },
    }));
    mockInitRxDB.mockResolvedValue(db);
    mockStartReplication.mockResolvedValue({ work_orders: createRepState(false) });

    const { result } = renderHook(() =>
      useWorkOrders({ lifecycleFilter: ['INPRG', 'COMP'] }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.workOrders).toHaveLength(2);
    expect(result.current.workOrders.map(w => w.id)).toEqual(['WO-001', 'WO-002']);
  });

  // ───── 5. Sin filter (null) muestra todos los no eliminados ─────
  it('sin lifecycleFilter muestra todos los docs no eliminados', async () => {
    const docs = [
      makeRxDoc({ id: 'WO-001', lifecycle_phase: 'INPRG' }),
      makeRxDoc({ id: 'WO-002', lifecycle_phase: 'COMP', _deleted: true }),
      makeRxDoc({ id: 'WO-003', lifecycle_phase: 'APPROVED' }),
    ];
    const { db } = createMockDb();
    db.work_orders.find = vi.fn(() => ({
      exec: vi.fn().mockResolvedValue(docs),
      $: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) },
    }));
    mockInitRxDB.mockResolvedValue(db);
    mockStartReplication.mockResolvedValue({ work_orders: createRepState(false) });

    const { result } = renderHook(() => useWorkOrders());

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Solo WO-001 y WO-003 (WO-002 está _deleted: true)
    expect(result.current.workOrders).toHaveLength(2);
    expect(result.current.workOrders.map(w => w.id)).toEqual(['WO-001', 'WO-003']);
  });

  // ───── 6. syncStatus transiciona de offline → syncing → online ─────
  it('syncStatus cambia según active$ de replicación', async () => {
    const { db } = createMockDb();
    const rep = createRepState(false);
    mockInitRxDB.mockResolvedValue(db);
    mockStartReplication.mockResolvedValue({ work_orders: rep });

    const { result } = renderHook(() => useWorkOrders());

    // init: offline
    expect(result.current.syncStatus).toBe('offline');

    // Después de init: active$ false → online
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.syncStatus).toBe('online');

    // Emitir active=true → syncing
    await act(async () => {
      rep.emitActive(true);
    });
    expect(result.current.syncStatus).toBe('syncing');

    // Emitir active=false → online
    await act(async () => {
      rep.emitActive(false);
    });
    expect(result.current.syncStatus).toBe('online');
  });

  // ───── 7. createWorkOrder exitoso ─────
  it('createWorkOrder inserta documento correctamente', async () => {
    const { db } = createMockDb();
    mockInitRxDB.mockResolvedValue(db);
    mockStartReplication.mockResolvedValue({ work_orders: createRepState(false) });

    const { result } = renderHook(() => useWorkOrders());

    await waitFor(() => expect(result.current.loading).toBe(false));

    const wo = { id: 'WO-NEW', equipment_id: 'EQ-001', description: 'Nueva OT' };
    const res = await result.current.createWorkOrder(wo);

    expect(res).toEqual({ success: true });
    expect(db.work_orders.insert).toHaveBeenCalledWith({
      ...wo,
      created_at: expect.any(String),
      updated_at: expect.any(Number),
      _deleted: false,
    });
  });

  // ───── 8. createWorkOrder genera ID si no se provee ─────
  it('createWorkOrder genera ID tipo WO-{timestamp} si no se pasa id', async () => {
    const { db } = createMockDb();
    mockInitRxDB.mockResolvedValue(db);
    mockStartReplication.mockResolvedValue({ work_orders: createRepState(false) });

    const { result } = renderHook(() => useWorkOrders());

    await waitFor(() => expect(result.current.loading).toBe(false));

    const wo = { equipment_id: 'EQ-001', description: 'OT sin ID' };
    const res = await result.current.createWorkOrder(wo);

    expect(res).toEqual({ success: true });
    expect(db.work_orders.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^WO-\d+$/),
        _deleted: false,
      }),
    );
  });

  // ───── 9. createWorkOrder sin db ─────
  it('createWorkOrder retorna error si db no está inicializada', async () => {
    // initRxDB queda pendiente — db sigue null mientras loading=true
    let resolveDb;
    mockInitRxDB.mockImplementation(() => new Promise(r => { resolveDb = r; }));

    const { result } = renderHook(() => useWorkOrders());

    // Sigue en loading — db es null
    expect(result.current.loading).toBe(true);

    const res = await result.current.createWorkOrder({ description: 'Test' });
    expect(res).toEqual({ error: 'DB not initialized' });

    // Resolver para cleanup
    resolveDb({ work_orders: { find: vi.fn(() => ({ exec: vi.fn(), $: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) } })) } });
  });

  // ───── 10. updateWorkOrder exitoso ─────
  it('updateWorkOrder encuentra y actualiza documento', async () => {
    const doc = makeRxDoc({ id: 'WO-001' });
    const { db } = createMockDb();
    db.work_orders.findOne = vi.fn(() => ({
      exec: vi.fn().mockResolvedValue(doc),
    }));
    mockInitRxDB.mockResolvedValue(db);
    mockStartReplication.mockResolvedValue({ work_orders: createRepState(false) });

    const { result } = renderHook(() => useWorkOrders());

    await waitFor(() => expect(result.current.loading).toBe(false));

    const res = await result.current.updateWorkOrder('WO-001', {
      description: 'Actualizado',
      priority: 'critical',
    });

    expect(res).toEqual({ success: true });
    expect(db.work_orders.findOne).toHaveBeenCalledWith('WO-001');
    expect(doc.update).toHaveBeenCalledWith({
      $set: { description: 'Actualizado', priority: 'critical', updated_at: expect.any(Number) },
    });
  });

  // ───── 11. updateWorkOrder no encontrado ─────
  it('updateWorkOrder retorna error si documento no existe', async () => {
    const { db } = createMockDb();
    db.work_orders.findOne = vi.fn(() => ({
      exec: vi.fn().mockResolvedValue(null),
    }));
    mockInitRxDB.mockResolvedValue(db);
    mockStartReplication.mockResolvedValue({ work_orders: createRepState(false) });

    const { result } = renderHook(() => useWorkOrders());

    await waitFor(() => expect(result.current.loading).toBe(false));

    const res = await result.current.updateWorkOrder('WO-INEXISTENTE', { description: 'Nope' });

    expect(res).toEqual({ error: 'Document not found' });
  });

  // ───── 12. updateWorkOrder sin db ─────
  it('updateWorkOrder retorna error si db no está inicializada', async () => {
    let resolveDb;
    mockInitRxDB.mockImplementation(() => new Promise(r => { resolveDb = r; }));

    const { result } = renderHook(() => useWorkOrders());

    const res = await result.current.updateWorkOrder('WO-001', { description: 'X' });
    expect(res).toEqual({ error: 'DB not initialized' });

    resolveDb({ work_orders: { find: vi.fn(() => ({ exec: vi.fn(), $: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) } })) } });
  });

  // ───── 13. deleteWorkOrder (soft delete) ─────
  it('deleteWorkOrder marca _deleted true', async () => {
    const doc = makeRxDoc({ id: 'WO-001' });
    const { db } = createMockDb();
    db.work_orders.findOne = vi.fn(() => ({
      exec: vi.fn().mockResolvedValue(doc),
    }));
    mockInitRxDB.mockResolvedValue(db);
    mockStartReplication.mockResolvedValue({ work_orders: createRepState(false) });

    const { result } = renderHook(() => useWorkOrders());

    await waitFor(() => expect(result.current.loading).toBe(false));

    const res = await result.current.deleteWorkOrder('WO-001');

    expect(res).toEqual({ success: true });
    expect(doc.update).toHaveBeenCalledWith({
      $set: { _deleted: true, updated_at: expect.any(Number) },
    });
  });

  // ───── 14. deleteWorkOrder no encontrado ─────
  it('deleteWorkOrder retorna error si documento no existe', async () => {
    const { db } = createMockDb();
    db.work_orders.findOne = vi.fn(() => ({
      exec: vi.fn().mockResolvedValue(null),
    }));
    mockInitRxDB.mockResolvedValue(db);
    mockStartReplication.mockResolvedValue({ work_orders: createRepState(false) });

    const { result } = renderHook(() => useWorkOrders());

    await waitFor(() => expect(result.current.loading).toBe(false));

    const res = await result.current.deleteWorkOrder('WO-INEXISTENTE');
    expect(res).toEqual({ error: 'Document not found' });
  });

  // ───── 15. deleteWorkOrder sin db ─────
  it('deleteWorkOrder retorna error si db no está inicializada', async () => {
    let resolveDb;
    mockInitRxDB.mockImplementation(() => new Promise(r => { resolveDb = r; }));

    const { result } = renderHook(() => useWorkOrders());

    const res = await result.current.deleteWorkOrder('WO-001');
    expect(res).toEqual({ error: 'DB not initialized' });

    resolveDb({ work_orders: { find: vi.fn(() => ({ exec: vi.fn(), $: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) } })) } });
  });

  // ───── 16. Error en initRxDB ─────
  it('setea error si initRxDB falla', async () => {
    mockInitRxDB.mockRejectedValue(new Error('IndexedDB no soportado'));

    const { result } = renderHook(() => useWorkOrders());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error.message).toBe('IndexedDB no soportado');
    expect(result.current.syncStatus).toBe('offline');
    expect(result.current.workOrders).toEqual([]);
  });

  // ───── 17. Colección no encontrada ─────
  it('setea error específico si la colección work_orders no existe', async () => {
    const db = {};
    mockInitRxDB.mockResolvedValue(db);

    const { result } = renderHook(() => useWorkOrders());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toEqual(
      new Error('Colección work_orders no encontrada'),
    );
    expect(result.current.workOrders).toEqual([]);
  });

  // ───── 18. Suscripción reactiva actualiza workOrders ─────
  it('la subscripción a collection.$ actualiza workOrders en vivo', async () => {
    let subNext = null;
    const { db } = createMockDb();
    db.work_orders.find = vi.fn(() => ({
      exec: vi.fn().mockResolvedValue([]),
      $: {
        subscribe: vi.fn(({ next }) => {
          subNext = next;
          return { unsubscribe: vi.fn() };
        }),
      },
    }));
    mockInitRxDB.mockResolvedValue(db);
    mockStartReplication.mockResolvedValue({ work_orders: createRepState(false) });

    const { result } = renderHook(() => useWorkOrders());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.workOrders).toEqual([]);

    // Emitir nuevos docs desde la subscripción
    const newDocs = [
      makeRxDoc({ id: 'WO-REALTIME', description: 'Llegó en vivo' }),
    ];

    await act(async () => {
      subNext(newDocs);
    });

    expect(result.current.workOrders).toHaveLength(1);
    expect(result.current.workOrders[0].id).toBe('WO-REALTIME');
  });

  // ───── 19. Error en suscripción no crashea ─────
  it('error en subscripción no crashea el hook', async () => {
    let subError = null;
    const { db } = createMockDb();
    db.work_orders.find = vi.fn(() => ({
      exec: vi.fn().mockResolvedValue([]),
      $: {
        subscribe: vi.fn(({ next, error }) => {
          subError = error;
          return { unsubscribe: vi.fn() };
        }),
      },
    }));
    mockInitRxDB.mockResolvedValue(db);
    mockStartReplication.mockResolvedValue({ work_orders: createRepState(false) });

    const { result } = renderHook(() => useWorkOrders());

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Emitir error en subscripción — no debe crashear
    await act(async () => {
      subError(new Error('Error de red'));
    });

    expect(result.current.loading).toBe(false);
  });

  // ───── 20. Re-filter cuando cambia lifecycleFilter ─────
  it('re-filtra cuando lifecycleFilter cambia', async () => {
    const docs = [
      makeRxDoc({ id: 'WO-001', lifecycle_phase: 'INPRG' }),
      makeRxDoc({ id: 'WO-002', lifecycle_phase: 'COMP' }),
      makeRxDoc({ id: 'WO-003', lifecycle_phase: 'APPROVED' }),
    ];
    const { db } = createMockDb();
    db.work_orders.find = vi.fn(() => ({
      exec: vi.fn().mockResolvedValue(docs),
      $: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) },
    }));
    mockInitRxDB.mockResolvedValue(db);
    mockStartReplication.mockResolvedValue({ work_orders: createRepState(false) });

    const { result, rerender } = renderHook(
      ({ lifecycleFilter }) => useWorkOrders({ lifecycleFilter }),
      { initialProps: { lifecycleFilter: ['INPRG'] } },
    );

    await waitFor(() => {
      expect(result.current.workOrders).toHaveLength(1);
      expect(result.current.workOrders[0].id).toBe('WO-001');
    });

    // Cambiar filtro
    rerender({ lifecycleFilter: ['COMP', 'APPROVED'] });

    await waitFor(() => {
      expect(result.current.workOrders).toHaveLength(2);
      expect(result.current.workOrders.map(w => w.id)).toEqual(['WO-002', 'WO-003']);
    });
  });

  // ───── 21. Cleanup en unmount ─────
  it('unsubscribe y cancel en unmount', async () => {
    let subUnsub = vi.fn();
    const { db } = createMockDb();
    const rep = createRepState(false);
    db.work_orders.find = vi.fn(() => ({
      exec: vi.fn().mockResolvedValue([]),
      $: {
        subscribe: vi.fn(() => ({ unsubscribe: subUnsub })),
      },
    }));
    mockInitRxDB.mockResolvedValue(db);
    mockStartReplication.mockResolvedValue({ work_orders: rep });

    const { result, unmount } = renderHook(() => useWorkOrders());

    await waitFor(() => expect(result.current.loading).toBe(false));

    unmount();

    expect(subUnsub).toHaveBeenCalled();
    expect(rep.cancel).toHaveBeenCalled();
  });

  // ───── 22. Error en consulta inicial es capturado ─────
  it('error en consulta inicial es capturado sin crashear', async () => {
    const { db } = createMockDb();
    db.work_orders.find = vi.fn(() => ({
      exec: vi.fn().mockRejectedValue(new Error('Query error')),
      $: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) },
    }));
    mockInitRxDB.mockResolvedValue(db);
    mockStartReplication.mockResolvedValue({ work_orders: createRepState(false) });

    const { result } = renderHook(() => useWorkOrders());

    await waitFor(() => expect(result.current.loading).toBe(false));
    // Error de query se captura con console.warn, no setea error state
    expect(result.current.error).toBeNull();
  });

  // ───── 23. Documentos con _deleted son filtrados en subscripción ─────
  it('subscripción filtra _deleted documents', async () => {
    let subNext = null;
    const { db } = createMockDb();
    db.work_orders.find = vi.fn(() => ({
      exec: vi.fn().mockResolvedValue([]),
      $: {
        subscribe: vi.fn(({ next }) => {
          subNext = next;
          return { unsubscribe: vi.fn() };
        }),
      },
    }));
    mockInitRxDB.mockResolvedValue(db);
    mockStartReplication.mockResolvedValue({ work_orders: createRepState(false) });

    const { result } = renderHook(() => useWorkOrders());

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Emitir docs mezclando deleted y no deleted
    await act(async () => {
      subNext([
        makeRxDoc({ id: 'WO-001', _deleted: false }),
        makeRxDoc({ id: 'WO-002', _deleted: true }),
        makeRxDoc({ id: 'WO-003', _deleted: false }),
      ]);
    });

    expect(result.current.workOrders).toHaveLength(2);
    expect(result.current.workOrders.map(w => w.id)).toEqual(['WO-001', 'WO-003']);
  });

  // ───── 24. startReplication sin active$ → syncStatus online ─────
  it('sin active$ en repState setea syncStatus online', async () => {
    const { db } = createMockDb();
    const repSinActive = { cancel: vi.fn() }; // sin active$
    mockInitRxDB.mockResolvedValue(db);
    mockStartReplication.mockResolvedValue({ work_orders: repSinActive });

    const { result } = renderHook(() => useWorkOrders());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.syncStatus).toBe('online');
  });

  // ───── 25. Error en insert es capturado ─────
  it('createWorkOrder captura error de insert', async () => {
    const { db } = createMockDb();
    db.work_orders.insert = vi.fn().mockRejectedValue(new Error('Constraint violation'));
    mockInitRxDB.mockResolvedValue(db);
    mockStartReplication.mockResolvedValue({ work_orders: createRepState(false) });

    const { result } = renderHook(() => useWorkOrders());

    await waitFor(() => expect(result.current.loading).toBe(false));

    const res = await result.current.createWorkOrder({ id: 'WO-DUP' });
    expect(res).toEqual({ error: 'Constraint violation' });
  });
});
