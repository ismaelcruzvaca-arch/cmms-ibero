/**
 * Tests for useReportExport — html2canvas capture + jsPDF assembly.
 *
 * Mocks:
 * - html2canvas (returns a canvas with toDataURL)
 * - jspdf (returns mock jsPDF instance)
 *
 * Covers: capture → assemble → download, error handling, no-data guard, progress tracking, reset.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// ═══════════════════════════════════════════════════════════════════
// Mocks hoisteados — all setup in hoisted scope to avoid temporal dead zone issues
// ═══════════════════════════════════════════════════════════════════
const { html2canvasSpy, jsPdfSpy, makeMockCanvas, resetJsPdfTracking, getJsPdfInstances, getJsPdfCallCount, setJsPdfThrowOnNext } = vi.hoisted(() => {
  // A canvas factory that doesn't use vi.fn
  function makeMockCanvas(dataUrl) {
    return {
      toDataURL: () => dataUrl || 'data:image/png;base64,fakeimg',
    };
  }

  // Default html2canvas implementation — resolves immediately with a mock canvas
  const defaultHtml2canvas = vi.fn(async () => makeMockCanvas('data:image/png;base64,fakeimg'));

  // jsPDF must be a REAL constructor (not vi.fn) because the hook uses `new jsPDF(...)`
  // vi.fn() mocks are NOT constructors — they cannot be used with `new`.
  let callCount = 0;
  let instances = [];
  let shouldThrow = false;
  let throwMessage = '';

  function createMockJsPdfInstance() {
    return {
      addImage: vi.fn(),
      addPage: vi.fn(),
      setFontSize: vi.fn(),
      text: vi.fn(),
      save: vi.fn(),
      deletePage: vi.fn(),
      getNumberOfPages: vi.fn(() => 1),
      internal: {
        pageSize: { getWidth: () => 210, getHeight: () => 297 },
      },
    };
  }

  // This is a spy factory — tracks calls AND returns fresh instances
  function jsPdfConstructor(options) {
    if (shouldThrow) {
      shouldThrow = false;
      throw new Error(throwMessage);
    }
    callCount++;
    const instance = createMockJsPdfInstance();
    instances.push(instance);
    return instance;
  }

  function resetTracking() {
    callCount = 0;
    instances = [];
    shouldThrow = false;
    throwMessage = '';
  }

  function getInstances() {
    return instances;
  }

  function getCount() {
    return callCount;
  }

  function setJsPdfThrowOnNext(msg) {
    shouldThrow = true;
    throwMessage = msg;
  }

  return {
    html2canvasSpy: defaultHtml2canvas,
    jsPdfSpy: jsPdfConstructor,
    makeMockCanvas,
    resetJsPdfTracking: resetTracking,
    getJsPdfInstances: getInstances,
    getJsPdfCallCount: getCount,
    setJsPdfThrowOnNext,
  };
});

vi.mock('html2canvas', () => ({
  default: function() { return html2canvasSpy.apply(this, arguments); },
}));

// IMPORTANT: The mock MUST use regular functions (not arrow functions)
// because the hook uses `new jsPDF(...)`, and arrow functions cannot be constructors.
vi.mock('jspdf', () => {
  function jsPDF() {
    return jsPdfSpy.apply(this, arguments);
  }
  return {
    default: jsPDF,
    jsPDF: jsPDF,
  };
});

import { useReportExport } from '../useReportExport';

describe('useReportExport', () => {
  let mockGetLastInstance;

  beforeEach(() => {
    // Reset spy call counts WITHOUT removing the default implementation
    html2canvasSpy.mockClear();
    resetJsPdfTracking();

    // Reset to default resolved value
    html2canvasSpy.mockResolvedValue(makeMockCanvas('data:image/png;base64,fakeimg'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createWidgetRef(id, label, selected = true) {
    return {
      id,
      label,
      ref: { current: document.createElement('div') },
      selected,
    };
  }

  // ───── 1. Estado inicial ─────
  it('inicia con idle, progress 0, error null', () => {
    const { result } = renderHook(() => useReportExport());

    expect(result.current.state).toBe('idle');
    expect(result.current.progress).toBe(0);
    expect(result.current.error).toBeNull();
    expect(result.current.exportPdf).toBeInstanceOf(Function);
    expect(result.current.reset).toBeInstanceOf(Function);
  });

  // ───── 2. Export exitoso con widgets ─────
  it('captura widgets, ensambla PDF y descarga', async () => {
    const widgetRefs = [
      createWidgetRef('chart-1', 'Gráfico de barras'),
      createWidgetRef('table-1', 'Tabla de detalle'),
    ];

    const { result } = renderHook(() => useReportExport());

    await act(async () => {
      await result.current.exportPdf({ widgets: widgetRefs, filename: 'test-report.pdf' });
    });

    // Both widgets captured
    expect(html2canvasSpy).toHaveBeenCalledTimes(2);
    expect(html2canvasSpy).toHaveBeenCalledWith(
      widgetRefs[0].ref.current,
      expect.objectContaining({ scale: 2, useCORS: true }),
    );

    // jsPDF constructor should have been called once
    expect(getJsPdfCallCount()).toBe(1);

    // jsPDF should have been called with correct options
    // (Since we can't spy on a regular function's arguments easily,
    // we verify the behavior through the instance methods)

    // Should have called addImage for each captured widget
    const instances = getJsPdfInstances();
    expect(instances).toHaveLength(1);
    expect(instances[0].addImage).toHaveBeenCalledTimes(2);
    expect(instances[0].save).toHaveBeenCalledWith('test-report.pdf');

    // Final state
    expect(result.current.state).toBe('done');
    expect(result.current.progress).toBe(100);
    expect(result.current.error).toBeNull();
  });

  // ───── 3. Export con widgets no seleccionados ─────
  it('solo captura widgets seleccionados', async () => {
    const widgetRefs = [
      createWidgetRef('chart-1', 'Gráfico', true),
      createWidgetRef('table-1', 'Tabla', false),
    ];

    const { result } = renderHook(() => useReportExport());

    await act(async () => {
      await result.current.exportPdf({ widgets: widgetRefs });
    });

    expect(html2canvasSpy).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('done');
  });

  // ───── 4. Error si html2canvas falla ─────
  it('maneja error de html2canvas con placeholder', async () => {
    // Override: first call rejects
    html2canvasSpy
      .mockReset()
      .mockRejectedValueOnce(new Error('Canvas taint'));

    const widgetRefs = [createWidgetRef('chart-1', 'Gráfico')];

    const { result } = renderHook(() => useReportExport());

    await act(async () => {
      await result.current.exportPdf({ widgets: widgetRefs });
    });

    // Should not crash — should finish with done (error handled per-widget)
    expect(result.current.state).toBe('done');
    expect(result.current.progress).toBe(100);
  });

  // ───── 5. No-data guard: sin widgets → no hace nada ─────
  it('no exporta si no hay widgets seleccionados', async () => {
    const { result } = renderHook(() => useReportExport());

    await act(async () => {
      await result.current.exportPdf({ widgets: [] });
    });

    expect(html2canvasSpy).not.toHaveBeenCalled();
    expect(getJsPdfCallCount()).toBe(0);
    expect(result.current.state).toBe('done');
    expect(result.current.error).toBeNull();
  });

  // ───── 6. Progress tracking ─────
  it('actualiza progress durante la captura', async () => {
    // Slow capture to observe progress
    let resolve1, resolve2;
    const p1 = new Promise((r) => { resolve1 = r; });
    const p2 = new Promise((r) => { resolve2 = r; });

    html2canvasSpy.mockReset();
    html2canvasSpy
      .mockReturnValueOnce(p1)
      .mockReturnValueOnce(p2);

    const widgetRefs = [
      createWidgetRef('w1', 'W1'),
      createWidgetRef('w2', 'W2'),
    ];

    const { result } = renderHook(() => useReportExport());

    let exportPromise;
    act(() => {
      exportPromise = result.current.exportPdf({ widgets: widgetRefs });
    });

    // After first capture, progress should be at 25 (50% of 50)
    await act(async () => {
      resolve1(makeMockCanvas('data:image/png;base64,img1'));
    });

    // Wait for React to process the state update
    await vi.waitFor(() => {
      expect(result.current.progress).toBeGreaterThanOrEqual(25);
    });

    // Resolve second capture
    await act(async () => {
      resolve2(makeMockCanvas('data:image/png;base64,img2'));
    });

    await act(async () => {
      await exportPromise;
    });

    expect(result.current.state).toBe('done');
    expect(result.current.progress).toBe(100);
  });

  // ───── 7. Reset restaura estado ─────
  it('reset() vuelve a idle', async () => {
    const widgetRefs = [createWidgetRef('chart-1', 'Gráfico')];

    const { result } = renderHook(() => useReportExport());

    await act(async () => {
      await result.current.exportPdf({ widgets: widgetRefs });
    });

    expect(result.current.state).toBe('done');

    act(() => {
      result.current.reset();
    });

    expect(result.current.state).toBe('idle');
    expect(result.current.progress).toBe(0);
    expect(result.current.error).toBeNull();
  });

  // ───── 8. runningRef evita ejecución concurrente ─────
  it('runningRef previene exportPdf concurrente', async () => {
    // Hacer html2canvas lento para mantener runningRef=true
    let slowResolve;
    html2canvasSpy.mockReset();
    html2canvasSpy.mockReturnValue(new Promise(r => { slowResolve = r; }));

    const widgetRefs = [createWidgetRef('chart-1', 'Gráfico')];
    const { result } = renderHook(() => useReportExport());

    let firstCall;
    act(() => {
      firstCall = result.current.exportPdf({ widgets: widgetRefs });
    });

    // Segundo llamado mientras runningRef.current = true
    await act(async () => {
      await result.current.exportPdf({ widgets: widgetRefs });
    });

    // html2canvas solo debe haberse llamado 1 vez (el segundo fue ignorado por runningRef)
    expect(html2canvasSpy).toHaveBeenCalledTimes(1);

    // Resolver la primera llamada para cleanup
    await act(async () => {
      slowResolve(makeMockCanvas('data:image/png;base64,img'));
    });
    await act(async () => {
      await firstCall;
    });
  });

  // ───── 9. Filename por defecto ─────
  it('exportPdf usa filename por defecto si no se provee', async () => {
    const widgetRefs = [createWidgetRef('chart-1', 'Gráfico')];
    const { result } = renderHook(() => useReportExport());

    await act(async () => {
      await result.current.exportPdf({ widgets: widgetRefs });
    });

    const instances = getJsPdfInstances();
    expect(instances[0].save).toHaveBeenCalledWith(
      expect.stringMatching(/^reporte-\d{4}-\d{2}-\d{2}\.pdf$/),
    );
  });

  // ───── 10. jsPDF error → state error ─────
  it('setea state error si el constructor de jsPDF falla', async () => {
    // Hacer que el constructor de jsPDF lance error
    setJsPdfThrowOnNext('jsPDF memory limit');

    const widgetRefs = [createWidgetRef('chart-1', 'Gráfico')];
    const { result } = renderHook(() => useReportExport());

    await act(async () => {
      await result.current.exportPdf({ widgets: widgetRefs });
    });

    expect(result.current.state).toBe('error');
    expect(result.current.error).toBe('jsPDF memory limit');
  });

  // ───── 11. Múltiples widgets → addPage llamado ─────
  it('con múltiples widgets llama addPage para cada uno después del primero', async () => {
    const widgetRefs = [
      createWidgetRef('chart-1', 'Gráfico 1'),
      createWidgetRef('chart-2', 'Gráfico 2'),
      createWidgetRef('chart-3', 'Gráfico 3'),
    ];

    const { result } = renderHook(() => useReportExport());

    await act(async () => {
      await result.current.exportPdf({ widgets: widgetRefs });
    });

    const instances = getJsPdfInstances();
    // addPage debe haberse llamado 2 veces (para widget 2 y 3)
    expect(instances[0].addPage).toHaveBeenCalledTimes(2);
    // addImage para cada widget
    expect(instances[0].addImage).toHaveBeenCalledTimes(3);
  });

  // ───── 12. Error en html2canvas → placeholder text en PDF ─────
  it('error de html2canvas escribe placeholder text en PDF', async () => {
    html2canvasSpy
      .mockReset()
      .mockRejectedValueOnce(new Error('Canvas taint'));

    const widgetRefs = [createWidgetRef('chart-1', 'Gráfico')];
    const { result } = renderHook(() => useReportExport());

    await act(async () => {
      await result.current.exportPdf({ widgets: widgetRefs });
    });

    const instances = getJsPdfInstances();
    // Debe haber escrito el placeholder en el PDF
    expect(instances[0].text).toHaveBeenCalledWith(
      'Error al capturar el gráfico',
      expect.any(Number),
      expect.any(Number),
    );
    // No debe llamar a addImage para el widget fallido
    expect(instances[0].addImage).not.toHaveBeenCalled();
  });

  // ───── 13. State transitions: idle → capturing → assembling → done ─────
  it('sigue la secuencia de estados correcta', async () => {
    let resolve1, resolve2;
    const p1 = new Promise(r => { resolve1 = r; });
    const p2 = new Promise(r => { resolve2 = r; });

    html2canvasSpy.mockReset();
    html2canvasSpy
      .mockReturnValueOnce(p1)
      .mockReturnValueOnce(p2);

    const widgetRefs = [
      createWidgetRef('w1', 'W1'),
      createWidgetRef('w2', 'W2'),
    ];

    const { result } = renderHook(() => useReportExport());

    let exportPromise;
    act(() => {
      exportPromise = result.current.exportPdf({ widgets: widgetRefs });
    });

    // Debe estar en capturing
    expect(result.current.state).toBe('capturing');

    // Resolver primera captura
    await act(async () => {
      resolve1(makeMockCanvas('data:image/png;base64,img1'));
    });

    // Sigue en capturing
    expect(result.current.state).toBe('capturing');

    // Resolver segunda captura → pasa a assembling
    await act(async () => {
      resolve2(makeMockCanvas('data:image/png;base64,img2'));
    });

    // Después de resolver ambas capturas, pasa a assembling y luego a done
    await act(async () => {
      await exportPromise;
    });

    expect(result.current.state).toBe('done');
  });
});
