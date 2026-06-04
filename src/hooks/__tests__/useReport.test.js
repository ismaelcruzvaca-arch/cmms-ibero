/**
 * Tests para useReport — hook de generación de reportes PDF.
 *
 * Mockea:
 * - initRxDB (RxDB)
 * - supabase (Supabase client)
 * - resolveTemplate (templateEngine)
 * - DEFAULT_TEMPLATE_OT (templateDefaults)
 *
 * Cubre: lookup RxDB → fallback Supabase → fallback default → print → regenerate → audit trail
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// ═══════════════════════════════════════════════════════════════════
// Mocks hoisteados
// ═══════════════════════════════════════════════════════════════════
const { mockInitRxDB, mockSupabaseChain, mockResolveTemplate, DEFAULT_TEMPLATE_OT } =
  vi.hoisted(() => {
    // ── Mock de RxDB ──────────────────────────────────────────────
    const mockRxDb = {
      report_templates: {
        findOne: vi.fn(),
      },
      report_history: {
        insert: vi.fn().mockResolvedValue({}),
      },
    };

    // Mock initRxDB retorna el mock por defecto
    const initRxDB = vi.fn().mockResolvedValue(mockRxDb);

    // ── Mock de Supabase chain ────────────────────────────────────
    const chain = {
      select: vi.fn(),
      eq: vi.fn(),
      single: vi.fn(),
    };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    // single() por defecto retorna sin datos
    chain.single.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });

    const supabaseChain = {
      from: vi.fn(() => chain),
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { user: { id: 'user-001' } } },
        }),
      },
    };

    // ── Mock de resolveTemplate ───────────────────────────────────
    const resolveTemplate = vi.fn(
      () =>
        '<!DOCTYPE html><html><body><h1>Reporte Renderizado</h1></body></html>',
    );

    // ── Mock de DEFAULT_TEMPLATE_OT ────────────────────────────────
    const defaultTemplate = {
      id: 'ot-default',
      name: 'Orden de Trabajo (fallback offline)',
      sections: [
        { type: 'header', titleField: 'title', badgeField: 'badge' },
        { type: 'divider' },
        { type: 'footer', text: 'CMMS Ibero' },
      ],
    };

    return {
      mockInitRxDB: initRxDB,
      mockSupabaseChain: supabaseChain,
      mockResolveTemplate: resolveTemplate,
      DEFAULT_TEMPLATE_OT: defaultTemplate,
    };
  });

// ═══════════════════════════════════════════════════════════════════
// Mocks de módulos
// ═══════════════════════════════════════════════════════════════════
vi.mock('../../lib/rxdb', () => ({
  initRxDB: (...args) => mockInitRxDB(...args),
}));

vi.mock('../../lib/supabaseClient', () => ({
  supabase: mockSupabaseChain,
}));

vi.mock('../../lib/pdf/templateEngine', () => ({
  resolveTemplate: (...args) => mockResolveTemplate(...args),
}));

vi.mock('../../lib/pdf/templateDefaults', () => ({
  DEFAULT_TEMPLATE_OT,
}));

// ═══════════════════════════════════════════════════════════════════
// Import del hook bajo test
// ═══════════════════════════════════════════════════════════════════
import { useReport } from '../useReport';

// ═══════════════════════════════════════════════════════════════════
// Helpers para crear contextos
// ═══════════════════════════════════════════════════════════════════
function makeContext(overrides = {}) {
  return {
    workOrder: { id: 'WO-001', description: 'Cambio de bomba' },
    asset: { id: 'AST-012', description: 'Bomba Centrífuga' },
    laborRecords: [],
    materialRequests: [],
    ...overrides,
  };
}

function makeRxDoc(overrides = {}) {
  return {
    toJSON: vi.fn(() => ({
      id: 'tmpl-active',
      code: 'work_order',
      name: 'Template OT Activo',
      is_active: true,
      template: {
        id: 'tmpl-active',
        name: 'Template OT Activo',
        sections: [{ type: 'header', titleField: 'title', badgeField: 'badge' }],
      },
      version: 2,
      ...overrides,
    })),
  };
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════
describe('useReport', () => {
  let mockRxDb;

  beforeEach(() => {
    vi.clearAllMocks();

    // Resetear el mock de RxDB a su estado por defecto
    mockRxDb = {
      report_templates: {
        findOne: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue(null),
        }),
      },
      report_history: {
        insert: vi.fn().mockResolvedValue({}),
      },
    };
    mockInitRxDB.mockResolvedValue(mockRxDb);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ───── 1. Template encontrado en RxDB → renderiza HTML ─────
  it('busca template en RxDB y renderiza HTML', async () => {
    const rxDoc = makeRxDoc();
    mockRxDb.report_templates.findOne = vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue(rxDoc),
    });

    const { result } = renderHook(() =>
      useReport({ templateCode: 'work_order', context: makeContext() }),
    );

    // Inicia en loading
    expect(result.current.loading).toBe(true);

    // Esperar a que termine
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Verificar que se llamó initRxDB
    expect(mockInitRxDB).toHaveBeenCalled();

    // Verificar que buscó en RxDB
    expect(mockRxDb.report_templates.findOne).toHaveBeenCalledWith({
      selector: { code: 'work_order', is_active: true },
    });

    // Verificar que renderizó
    expect(mockResolveTemplate).toHaveBeenCalled();
    expect(result.current.html).toContain('Reporte Renderizado');

    // No debe estar empty
    expect(result.current.empty).toBe(false);
    expect(result.current.error).toBeNull();

    // templateName debe venir del template encontrado
    expect(result.current.templateName).toBe('Template OT Activo');
  });

  // ───── 2. Template NO encontrado en RxDB → fallback a Supabase ─────
  it('fallback a Supabase cuando RxDB no tiene el template', async () => {
    // RxDB no encuentra nada
    mockRxDb.report_templates.findOne = vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue(null),
    });

    // Supabase SÍ tiene datos
    const supabaseTemplate = {
      id: 'tmpl-supabase',
      code: 'work_order',
      name: 'Template desde Supabase',
      is_active: true,
      sections: [{ type: 'title', text: 'OT: {{work_order.id}}' }],
      version: 3,
    };
    // Mockear la respuesta de single() en Supabase
    mockSupabaseChain.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: supabaseTemplate, error: null }),
    });

    const { result } = renderHook(() =>
      useReport({ templateCode: 'work_order', context: makeContext() }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Verificar que consultó Supabase
    expect(mockSupabaseChain.from).toHaveBeenCalledWith('report_templates');

    // Verificar que renderizó con el template de Supabase
    expect(mockResolveTemplate).toHaveBeenCalled();
    expect(result.current.html).toContain('Reporte Renderizado');
    expect(result.current.empty).toBe(false);
    expect(result.current.templateName).toBe('Template desde Supabase');
  });

  // ───── 3. Template NO encontrado en ningún lado → usa DEFAULT_TEMPLATE_OT + empty=true ─────
  it('usa DEFAULT_TEMPLATE_OT con empty=true cuando no hay template en RxDB ni Supabase', async () => {
    // RxDB sin datos
    mockRxDb.report_templates.findOne = vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue(null),
    });

    // Supabase sin datos (error PGRST116 = no rows)
    mockSupabaseChain.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'No rows' },
      }),
    });

    const { result } = renderHook(() =>
      useReport({ templateCode: 'work_order', context: makeContext() }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Verificar que usó el default
    expect(result.current.empty).toBe(true);
    expect(result.current.html).toContain('Reporte Renderizado');
    expect(result.current.templateName).toBe('Orden de Trabajo (fallback offline)');

    // Verificar que resolveTemplate fue llamado con DEFAULT_TEMPLATE_OT
    const callArgs = mockResolveTemplate.mock.calls[0];
    expect(callArgs[0].id).toBe('ot-default');
  });

  // ───── 4. Error en fetch de template → error !== null ─────
  it('setea error cuando initRxDB falla', async () => {
    mockInitRxDB.mockRejectedValue(new Error('Error de conexión IndexedDB'));

    const { result } = renderHook(() =>
      useReport({ templateCode: 'work_order', context: makeContext() }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Error de conexión IndexedDB');
    expect(result.current.html).toBeNull();
  });

  it('setea error cuando Supabase falla con error grave', async () => {
    // RxDB sin datos
    mockRxDb.report_templates.findOne = vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue(null),
    });

    // Supabase lanza error de red
    mockSupabaseChain.from.mockImplementation(() => {
      throw new Error('Network error');
    });

    const { result } = renderHook(() =>
      useReport({ templateCode: 'work_order', context: makeContext() }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Debe usar el fallback (el error de Supabase no es crítico, se atrapa en catch)
    expect(result.current.empty).toBe(true);
    expect(result.current.html).toContain('Reporte Renderizado');
  });

  // ───── 5. print() → abre window.open ─────
  it('print() abre ventana con window.open y llama a print', async () => {
    // Mock de window.open
    const mockPrint = vi.fn();
    const mockWrite = vi.fn();
    const mockClose = vi.fn();
    const mockFocus = vi.fn();

    const mockPrintWindow = {
      document: {
        write: mockWrite,
        close: mockClose,
        readyState: 'complete',
      },
      focus: mockFocus,
      print: mockPrint,
      onload: null,
    };

    const windowOpenSpy = vi.spyOn(window, 'open').mockReturnValue(mockPrintWindow);

    // Template encontrado en RxDB
    const rxDoc = makeRxDoc();
    mockRxDb.report_templates.findOne = vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue(rxDoc),
    });

    const { result } = renderHook(() =>
      useReport({ templateCode: 'work_order', context: makeContext() }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Llamar a print
    result.current.print();

    expect(windowOpenSpy).toHaveBeenCalledWith(
      '',
      '_blank',
      'width=800,height=600,menubar=0,toolbar=0',
    );
    expect(mockWrite).toHaveBeenCalledWith(result.current.html);
    expect(mockClose).toHaveBeenCalled();
    expect(mockFocus).toHaveBeenCalled();

    windowOpenSpy.mockRestore();
  });

  // ───── 6. regenerate() → re-ejecuta render ─────
  it('regenerate() re-ejecuta la generación de render', async () => {
    // Template encontrado en RxDB
    const rxDoc = makeRxDoc();
    mockRxDb.report_templates.findOne = vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue(rxDoc),
    });

    const { result } = renderHook(() =>
      useReport({ templateCode: 'work_order', context: makeContext() }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Resetear el contador de llamadas a resolveTemplate
    const callsBefore = mockResolveTemplate.mock.calls.length;

    // Llamar regenerate
    result.current.regenerate();

    // Los mocks resuelven síncronamente, así que React 19 puede batch
    // loading=true → loading=false en un solo render. Lo que importa
    // es que resolveTemplate se vuelva a ejecutar.
    await waitFor(() =>
      expect(mockResolveTemplate.mock.calls.length).toBeGreaterThan(callsBefore),
    );
  });

  // ───── 7. report_history insert → verifica que se llame ─────
  it('inserta en report_history después de renderizar', async () => {
    const rxDoc = makeRxDoc();
    mockRxDb.report_templates.findOne = vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue(rxDoc),
    });

    const { result } = renderHook(() =>
      useReport({ templateCode: 'work_order', context: makeContext() }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Verificar que se insertó en report_history
    expect(mockRxDb.report_history.insert).toHaveBeenCalledTimes(1);

    // Verificar los datos insertados
    const insertCall = mockRxDb.report_history.insert.mock.calls[0][0];
    expect(insertCall).toMatchObject({
      template_id: 'tmpl-active',
      template_code: 'work_order',
      template_version: 2,
      generated_by: 'user-001',
      _deleted: false,
    });
    expect(insertCall.id).toBeTruthy();
    expect(insertCall.generated_at).toBeTruthy();
    expect(insertCall.report_data).toBeTruthy();
    expect(insertCall.report_data.context_snapshot).toBeTruthy();
  });

  // ───── 8. print() sin html → no abre ventana ─────
  it('print() no abre ventana si html es null', () => {
    // Inicialmente html es null
    const windowOpenSpy = vi.spyOn(window, 'open');

    const { result } = renderHook(() =>
      useReport({ templateCode: 'work_order', context: makeContext() }),
    );

    // Llamar print inmediatamente (antes de que termine la carga)
    result.current.print();

    // No debe haber abierto ventana
    expect(windowOpenSpy).not.toHaveBeenCalled();

    windowOpenSpy.mockRestore();
  });

  // ───── 9. generate no se ejecuta dos veces concurrentemente ─────
  it('loadingRef previene ejecución concurrente de generate', async () => {
    const rxDoc = makeRxDoc();
    mockRxDb.report_templates.findOne = vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue(rxDoc),
    });

    const { result } = renderHook(() =>
      useReport({ templateCode: 'work_order', context: makeContext() }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Llamar regenerate dos veces rápido
    result.current.regenerate();
    result.current.regenerate(); // Esta debería ser ignorada por loadingRef

    await waitFor(() => expect(result.current.loading).toBe(false));

    // resolveTemplate debería haberse llamado solo 2 veces (1 inicial + 1 regenerate)
    // La segunda regenerate fue ignorada
    expect(mockResolveTemplate).toHaveBeenCalledTimes(2);
  });
});
