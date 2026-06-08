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
const { html2canvasSpy, jsPdfSpy, makeMockCanvas, resetJsPdfTracking, getJsPdfInstances, getJsPdfCallCount } = vi.hoisted(() => {
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
    callCount++;
    const instance = createMockJsPdfInstance();
    instances.push(instance);
    return instance;
  }

  function resetTracking() {
    callCount = 0;
    instances = [];
  }

  function getInstances() {
    return instances;
  }

  function getCount() {
    return callCount;
  }

  return {
    html2canvasSpy: defaultHtml2canvas,
    jsPdfSpy: jsPdfConstructor,
    makeMockCanvas,
    resetJsPdfTracking: resetTracking,
    getJsPdfInstances: getInstances,
    getJsPdfCallCount: getCount,
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
});
