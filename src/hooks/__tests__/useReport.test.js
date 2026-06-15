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

  // ═══════════════════════════════════════════════════════════════════
  // Tests nuevos para cubrir código faltante (buildRenderData, sanitizeContext, edge cases)
  // ═══════════════════════════════════════════════════════════════════

  // ───── 10. buildRenderData — datos correctos con snake_case ─────
  it('buildRenderData pasa datos snake_case correctamente a resolveTemplate', async () => {
    const rxDoc = makeRxDoc();
    mockRxDb.report_templates.findOne = vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue(rxDoc),
    });

    const ctx = makeContext({
      workOrder: {
        id: 'WO-123',
        equipment_id: 'EQ-045',
        description: 'Mantenimiento correctivo',
        asset_id: 'AST-007',
        lifecycle_phase: 'INPRG',
        priority: 'high',
        criticality: 'A',
        wo_type: 'corrective',
        planned_hours: 10,
        actual_hours: 3,
        scheduled_date: '2026-06-15',
        actual_start_at: '2026-06-15T08:00:00Z',
        completed_at: '2026-06-15T11:00:00Z',
        assigned_to: 'mec.rodriguez',
      },
    });

    const { result } = renderHook(() =>
      useReport({ templateCode: 'work_order', context: ctx }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Verificar los datos pasados a resolveTemplate
    const callArgs = mockResolveTemplate.mock.calls[0];
    const renderData = callArgs[1];

    // title y badge del fallback
    expect(renderData.title).toBe('Mantenimiento correctivo');
    expect(renderData.badge).toBe('INPRG');

    // work_order snake_case
    expect(renderData.work_order).toBeDefined();
    expect(renderData.work_order.id).toBe('WO-123');
    expect(renderData.work_order.equipment_id).toBe('EQ-045');
    expect(renderData.work_order.description).toBe('Mantenimiento correctivo');
    expect(renderData.work_order.lifecycle_phase).toBe('INPRG');
    expect(renderData.work_order.priority).toBe('high');
    expect(renderData.work_order.criticality).toBe('A');
  });

  // ───── 11. buildRenderData — ViewModel camelCase → snake_case ─────
  it('buildRenderData convierte camelCase ViewModel a snake_case', async () => {
    const rxDoc = makeRxDoc();
    mockRxDb.report_templates.findOne = vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue(rxDoc),
    });

    const ctx = makeContext({
      workOrder: {
        id: 'WO-456',
        equipmentId: 'EQ-099',
        description: 'Inspección programada',
        assetId: 'AST-012',
        lifecyclePhase: 'APPROVED',
        priority: 'medium',
        criticality: 'B',
        woType: 'preventive',
        plannedHours: 4,
        actualHours: 0,
        scheduledDate: '2026-06-20',
        assignedTo: 'tec.lopez',
      },
    });

    const { result } = renderHook(() =>
      useReport({ templateCode: 'work_order', context: ctx }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    const callArgs = mockResolveTemplate.mock.calls[0];
    const renderData = callArgs[1];

    expect(renderData.work_order.equipment_id).toBe('EQ-099');
    expect(renderData.work_order.asset_id).toBe('AST-012');
    expect(renderData.work_order.lifecycle_phase).toBe('APPROVED');
    expect(renderData.work_order.priority).toBe('medium');
    expect(renderData.work_order.wo_type).toBe('preventive');
    expect(renderData.work_order.planned_hours).toBe(4);
    expect(renderData.work_order.actual_hours).toBe(0);
    expect(renderData.work_order.scheduled_date).toBe('2026-06-20');
    expect(renderData.work_order.assigned_to).toBe('tec.lopez');
  });

  // ───── 12. buildRenderData — sin workOrder ─────
  it('buildRenderData no crashea con workOrder undefined', async () => {
    const rxDoc = makeRxDoc();
    mockRxDb.report_templates.findOne = vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue(rxDoc),
    });

    const ctx = makeContext({ workOrder: undefined });

    const { result } = renderHook(() =>
      useReport({ templateCode: 'work_order', context: ctx }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    const callArgs = mockResolveTemplate.mock.calls[0];
    const renderData = callArgs[1];

    // title = `OT ${workOrder?.id || ''}` → workOrder.id es undefined → ''
    expect(renderData.title).toBe('OT ');
    expect(renderData.work_order).toEqual({});
    expect(renderData.fields).toEqual([]);
  });

  // ───── 13. buildRenderData — con labor records y materials ─────
  it('buildRenderData mapea laborRecords y materialRequests al fallback', async () => {
    const rxDoc = makeRxDoc();
    mockRxDb.report_templates.findOne = vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue(rxDoc),
    });

    const ctx = makeContext({
      laborRecords: [
        { technicianName: 'Juan Pérez', hours: 6, work: 'Cambio de rodamiento' },
        { technicianName: 'María Gómez', hours: 4, work: 'Alineación' },
      ],
      materialRequests: [
        { partNum: 'ROD-001', requestedQty: 2, cost: 150 },
        { partNum: 'ACE-005', requestedQty: 5, cost: 45.50 },
      ],
    });

    const { result } = renderHook(() =>
      useReport({ templateCode: 'work_order', context: ctx }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    const callArgs = mockResolveTemplate.mock.calls[0];
    const renderData = callArgs[1];

    // labor fallback
    expect(renderData.labor).toHaveLength(2);
    expect(renderData.labor[0].technician).toBe('Juan Pérez');
    expect(renderData.labor[0].hours).toBe('6');
    expect(renderData.labor[0].work).toBe('Cambio de rodamiento');

    // materials fallback
    expect(renderData.materials).toHaveLength(2);
    expect(renderData.materials[0].part).toBe('ROD-001');
    expect(renderData.materials[0].qty).toBe(2);
    expect(renderData.materials[0].cost).toBe(150);

    // También pasa los arrays completos con nombres Supabase
    expect(renderData.labor_records).toEqual(ctx.laborRecords);
    expect(renderData.material_requests).toEqual(ctx.materialRequests);
  });

  // ───── 14. db.report_templates no existe → salta RxDB ─────
  it('si db no tiene report_templates, salta RxDB y va a Supabase', async () => {
    mockRxDb.report_templates = undefined; // Sacar la colección

    // Supabase tiene datos
    const supabaseTemplate = {
      id: 'tmpl-supabase',
      code: 'work_order',
      name: 'Template desde Supabase',
      sections: [{ type: 'title', text: 'OT: {{work_order.id}}' }],
      version: 3,
    };
    mockSupabaseChain.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: supabaseTemplate, error: null }),
    });

    const { result } = renderHook(() =>
      useReport({ templateCode: 'work_order', context: makeContext() }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Debe haber ido a Supabase directamente
    expect(mockSupabaseChain.from).toHaveBeenCalledWith('report_templates');
    expect(result.current.templateName).toBe('Template desde Supabase');
    expect(result.current.error).toBeNull();
  });

  // ───── 15. Supabase error no-PGRST116 → no crashea, usa fallback ─────
  it('Supabase error code distinto de PGRST116 no crashea y usa fallback', async () => {
    // RxDB sin datos
    mockRxDb.report_templates.findOne = vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue(null),
    });

    // Supabase con error real (no PGRST116)
    mockSupabaseChain.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { code: '42P01', message: 'relation not found' },
      }),
    });

    const { result } = renderHook(() =>
      useReport({ templateCode: 'work_order', context: makeContext() }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Debe usar fallback (DEFAULT_TEMPLATE_OT)
    expect(result.current.empty).toBe(true);
    expect(result.current.templateName).toBe('Orden de Trabajo (fallback offline)');
    expect(result.current.html).toContain('Reporte Renderizado');
    expect(result.current.error).toBeNull();
  });

  // ───── 16. Supabase fetch lanza error de red → no crashea ─────
  it('Supabase error de red no crashea y usa fallback', async () => {
    // RxDB sin datos
    mockRxDb.report_templates.findOne = vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue(null),
    });

    // Supabase lanza excepción de red
    mockSupabaseChain.from.mockImplementation(() => {
      throw new Error('Network error');
    });

    const { result } = renderHook(() =>
      useReport({ templateCode: 'work_order', context: makeContext() }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.empty).toBe(true);
    expect(result.current.html).toContain('Reporte Renderizado');
  });

  // ───── 17. report_history no existe → no falla ─────
  it('si db no tiene report_history, no falla el reporte', async () => {
    mockRxDb.report_history = undefined;

    const rxDoc = makeRxDoc();
    mockRxDb.report_templates.findOne = vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue(rxDoc),
    });

    const { result } = renderHook(() =>
      useReport({ templateCode: 'work_order', context: makeContext() }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    // El reporte se generó igual
    expect(result.current.html).toContain('Reporte Renderizado');
    expect(result.current.error).toBeNull();
  });

  // ───── 18. report_history insert falla → no crashea ─────
  it('error al insertar report_history no crashea el reporte', async () => {
    mockRxDb.report_history.insert = vi.fn().mockRejectedValue(
      new Error('Disk full'),
    );

    const rxDoc = makeRxDoc();
    mockRxDb.report_templates.findOne = vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue(rxDoc),
    });

    const { result } = renderHook(() =>
      useReport({ templateCode: 'work_order', context: makeContext() }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    // El reporte se generó pese al error de auditoría
    expect(result.current.html).toContain('Reporte Renderizado');
    expect(result.current.error).toBeNull();
  });

  // ───── 19. print con popups bloqueados → error ─────
  it('print() setea error si popup es bloqueado', async () => {
    const rxDoc = makeRxDoc();
    mockRxDb.report_templates.findOne = vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue(rxDoc),
    });

    // window.open retorna null (popup bloqueado)
    const windowOpenSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    const { result } = renderHook(() =>
      useReport({ templateCode: 'work_order', context: makeContext() }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.print();

    // setError se ejecuta en el print, esperar al re-render
    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
    });
    expect(result.current.error).toContain('pop-ups');
    expect(windowOpenSpy).toHaveBeenCalled();

    windowOpenSpy.mockRestore();
  });

  // ───── 20. print con HTML — verifica window.open y write ─────
  it('print() abre ventana y escribe HTML correctamente', async () => {
    const mockPrint = vi.fn();
    const mockWrite = vi.fn();
    const mockClose = vi.fn();
    const mockFocus = vi.fn();

    const mockPrintWindow = {
      document: { write: mockWrite, close: mockClose, readyState: 'complete' },
      focus: mockFocus,
      print: mockPrint,
      onload: null,
    };

    const windowOpenSpy = vi.spyOn(window, 'open').mockReturnValue(mockPrintWindow);

    const rxDoc = makeRxDoc();
    mockRxDb.report_templates.findOne = vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue(rxDoc),
    });

    const { result } = renderHook(() =>
      useReport({ templateCode: 'work_order', context: makeContext() }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.print();

    expect(windowOpenSpy).toHaveBeenCalledWith('', '_blank', 'width=800,height=600,menubar=0,toolbar=0');
    expect(mockWrite).toHaveBeenCalledWith(result.current.html);
    expect(mockClose).toHaveBeenCalled();
    expect(mockFocus).toHaveBeenCalled();

    windowOpenSpy.mockRestore();
  });

  // ───── 21. sanitizeContext — sin asset ─────
  it('sanitizeContext maneja asset null en report_history', async () => {
    const rxDoc = makeRxDoc();
    mockRxDb.report_templates.findOne = vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue(rxDoc),
    });

    const ctx = makeContext({ asset: null });

    const { result } = renderHook(() =>
      useReport({ templateCode: 'work_order', context: ctx }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    const insertCall = mockRxDb.report_history.insert.mock.calls[0][0];
    expect(insertCall.report_data.context_snapshot.asset).toBeNull();
    expect(insertCall.report_data.context_snapshot.workOrder).toBeDefined();
  });

  // ───── 22. regenerate respeta stale renderId ─────
  it('generate no actualiza estado si renderId cambió (stale)', async () => {
    // Hacer que el generate sea lento para provocar stale
    let resolveInit;
    mockInitRxDB.mockImplementation(() => new Promise(r => { resolveInit = r; }));

    const rxDoc = makeRxDoc();
    mockRxDb.report_templates.findOne = vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue(rxDoc),
    });

    const { result, rerender } = renderHook(
      ({ templateCode }) => useReport({ templateCode, context: makeContext() }),
      { initialProps: { templateCode: 'work_order' } },
    );

    // Está cargando
    expect(result.current.loading).toBe(true);

    // Cambiar templateCode mientras carga — esto incrementa renderCount
    rerender({ templateCode: 'inspection' });

    // Resolver el primer initRxDB — su renderId ya es stale
    resolveInit(mockRxDb);

    // El primer generate (stale) no debe setear loading=false
    // El segundo generate se ejecuta por el cambio de templateCode
    await waitFor(() => expect(result.current.loading).toBe(false));

    // resolveTemplate debe haberse llamado al menos 1 vez (el segundo generate)
    expect(mockResolveTemplate).toHaveBeenCalled();
  });

});
