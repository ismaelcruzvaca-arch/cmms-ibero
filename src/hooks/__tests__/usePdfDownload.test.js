/**
 * Tests para usePdfDownload — hook de descarga de PDF server-side.
 *
 * Mockea:
 * - supabase.auth.getSession() para token JWT
 * - global.fetch para el Edge Function
 *
 * Cubre: descarga exitosa, validación de params, manejo de errores
 * (401, 404, 502, network), estados loading/success/error.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// ═══════════════════════════════════════════════════════════════════
// Mocks hoisteados
// ═══════════════════════════════════════════════════════════════════
const { mockSupabase, mockSession } = vi.hoisted(() => {
  const session = { access_token: 'test-jwt-token' };

  const supabase = {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session },
        error: null,
      }),
    },
  };

  return { mockSupabase: supabase, mockSession: session };
});

vi.mock('../../lib/supabaseClient', () => ({
  supabase: mockSupabase,
}));

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════
const FAKE_SIGNED_URL = 'https://test.supabase.co/storage/v1/object/signed/test.pdf';

function mockFetchSuccess(overrides = {}) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      signed_url: FAKE_SIGNED_URL,
      expires_at: '2026-06-05T13:00:00Z',
      storage_path: 'default/ot-default/wo-123-20260605T120000Z.pdf',
      report_history_id: 'rh-001',
      ...overrides,
    }),
  });
}

function mockFetchError(status, body = {}) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve(body),
  });
}

function mockFetchNetworkError() {
  global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
}

// ═══════════════════════════════════════════════════════════════════
// Import del hook bajo test
// ═══════════════════════════════════════════════════════════════════
import { usePdfDownload } from '../usePdfDownload';

describe('usePdfDownload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: successful auth session
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: mockSession },
      error: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ───── 1. Successful download ─────
  it('descarga exitosa: llama al EF, recibe signed URL, state=success', async () => {
    mockFetchSuccess();

    const { result } = renderHook(() => usePdfDownload());

    // Estado inicial
    expect(result.current.state).toBe('idle');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.pdfUrl).toBeNull();

    await act(async () => {
      await result.current.download({
        templateCode: 'ot-default',
        recordId: 'wo-123',
        recordType: 'work_order',
      });
    });

    // Verificar estado final
    expect(result.current.state).toBe('success');
    expect(result.current.loading).toBe(false);
    expect(result.current.pdfUrl).toBe(FAKE_SIGNED_URL);
    expect(result.current.error).toBeNull();

    // Verificar que se obtuvo sesión
    expect(mockSupabase.auth.getSession).toHaveBeenCalledTimes(1);

    // Verificar fetch al EF
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const fetchCall = global.fetch.mock.calls[0];
    expect(fetchCall[0]).toContain('/functions/v1/generate-pdf');
    expect(fetchCall[1]).toMatchObject({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-jwt-token',
      },
    });

    // Verificar body
    const body = JSON.parse(fetchCall[1].body);
    expect(body).toMatchObject({
      template_code: 'ot-default',
      record_id: 'wo-123',
      record_type: 'work_order',
    });
  });

  // ───── 2. Direct data injection (no recordId) ─────
  it('descarga exitosa con data directa (sin recordId)', async () => {
    mockFetchSuccess();

    const { result } = renderHook(() => usePdfDownload());

    await act(async () => {
      await result.current.download({
        templateCode: 'ot-default',
        data: { work_order_id: 'wo-123', title: 'Directo' },
      });
    });

    expect(result.current.state).toBe('success');

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.record_id).toBeUndefined();
    expect(body.data).toMatchObject({
      work_order_id: 'wo-123',
      title: 'Directo',
    });
  });

  // ───── 3. Loading state management ─────
  it('loading=true durante la descarga, loading=false al finalizar', async () => {
    // Usar una promesa que no se resuelve inmediatamente
    let resolveFetch;
    const fetchPromise = new Promise((resolve) => { resolveFetch = resolve; });
    global.fetch = vi.fn().mockReturnValue(fetchPromise);

    const { result } = renderHook(() => usePdfDownload());

    // Iniciar descarga (sin await, queremos ver el estado intermedio)
    act(() => {
      result.current.download({
        templateCode: 'ot-default',
        recordId: 'wo-123',
      });
    });

    // Debe estar en loading
    expect(result.current.loading).toBe(true);
    expect(result.current.state).toBe('loading');

    // Resolver la petición
    await act(async () => {
      resolveFetch({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          signed_url: FAKE_SIGNED_URL,
          expires_at: '2026-06-05T13:00:00Z',
          storage_path: 'test.pdf',
          report_history_id: 'rh-001',
        }),
      });
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.state).toBe('success');
  });

  // ───── 4. No session — 401 error ─────
  it('error cuando no hay sesión activa', async () => {
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    const onComplete = vi.fn();
    const { result } = renderHook(() => usePdfDownload({ onComplete }));

    await act(async () => {
      await result.current.download({
        templateCode: 'ot-default',
        recordId: 'wo-123',
      });
    });

    expect(result.current.state).toBe('error');
    expect(result.current.error).toContain('Sesión expirada');
    expect(result.current.loading).toBe(false);

    // onComplete debe indicar reauth
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, reauth: true }),
    );

    // No debe haberse llamado a fetch
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // ───── 5. 401 response from EF ─────
  it('error cuando el EF responde 401', async () => {
    mockFetchError(401, { error: 'unauthorized' });

    const { result } = renderHook(() => usePdfDownload());

    await act(async () => {
      await result.current.download({
        templateCode: 'ot-default',
        recordId: 'wo-123',
      });
    });

    expect(result.current.state).toBe('error');
    expect(result.current.error).toContain('Sesión expirada');
  });

  // ───── 6. 404 template_not_found ─────
  it('error 404 cuando template no existe', async () => {
    mockFetchError(404, { error: 'template_not_found', code: 'ot-default' });

    const { result } = renderHook(() => usePdfDownload());

    await act(async () => {
      await result.current.download({
        templateCode: 'ot-default',
        recordId: 'wo-123',
      });
    });

    expect(result.current.state).toBe('error');
    expect(result.current.error).toBe('Template no disponible');
  });

  // ───── 7. 404 record_not_found ─────
  it('error 404 cuando registro no existe', async () => {
    mockFetchError(404, { error: 'record_not_found', record_id: 'wo-999' });

    const { result } = renderHook(() => usePdfDownload());

    await act(async () => {
      await result.current.download({
        templateCode: 'ot-default',
        recordId: 'wo-999',
      });
    });

    expect(result.current.state).toBe('error');
    expect(result.current.error).toBe('Registro no encontrado');
  });

  // ───── 8. 502 Browserless failure ─────
  it('error 502 cuando Browserless falla', async () => {
    mockFetchError(502, { error: 'pdf_generation_failed' });

    const { result } = renderHook(() => usePdfDownload());

    await act(async () => {
      await result.current.download({
        templateCode: 'ot-default',
        recordId: 'wo-123',
      });
    });

    expect(result.current.state).toBe('error');
    expect(result.current.error).toContain('Intenta nuevamente');
  });

  // ───── 9. Network error ─────
  it('error cuando hay un error de red', async () => {
    mockFetchNetworkError();

    const { result } = renderHook(() => usePdfDownload());

    await act(async () => {
      await result.current.download({
        templateCode: 'ot-default',
        recordId: 'wo-123',
      });
    });

    expect(result.current.state).toBe('error');
    expect(result.current.error).toBe('Network error');
  });

  // ───── 10. Estado idle inicial ─────
  it('estado inicial idle con todos los valores por defecto', () => {
    const { result } = renderHook(() => usePdfDownload());

    expect(result.current.state).toBe('idle');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.pdfUrl).toBeNull();
    expect(result.current.download).toBeInstanceOf(Function);
    expect(result.current.reset).toBeInstanceOf(Function);
  });

  // ───── 11. Reset restaura idle ─────
  it('reset() vuelve al estado idle', async () => {
    mockFetchSuccess();

    const { result } = renderHook(() => usePdfDownload());

    await act(async () => {
      await result.current.download({
        templateCode: 'ot-default',
        recordId: 'wo-123',
      });
    });

    expect(result.current.state).toBe('success');

    act(() => {
      result.current.reset();
    });

    expect(result.current.state).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(result.current.pdfUrl).toBeNull();
  });

  // ───── 12. onComplete callback ─────
  it('onComplete se llama con resultado exitoso', async () => {
    mockFetchSuccess();
    const onComplete = vi.fn();

    const { result } = renderHook(() => usePdfDownload({ onComplete }));

    await act(async () => {
      await result.current.download({
        templateCode: 'ot-default',
        recordId: 'wo-123',
        recordType: 'work_order',
      });
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, pdfUrl: FAKE_SIGNED_URL }),
    );
  });

  // ───── 13. Ignora segunda llamada mientras loading ─────
  it('ignora llamadas concurrentes a download()', async () => {
    let resolveFetch;
    const fetchPromise = new Promise((resolve) => { resolveFetch = resolve; });
    global.fetch = vi.fn().mockReturnValue(fetchPromise);

    const { result } = renderHook(() => usePdfDownload());

    // Iniciar primera descarga
    act(() => {
      result.current.download({ templateCode: 'ot-default', recordId: 'wo-123' });
    });

    // Flush microtasks para que la primera llamada avance hasta fetch
    await act(async () => {});

    // fetch ya debe haberse llamado 1 vez
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Segunda llamada debería ser ignorada
    await act(async () => {
      await result.current.download({ templateCode: 'ot-default', recordId: 'wo-456' });
    });

    // fetch debe seguir llamándose solo 1 vez
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Resolver la primera llamada
    await act(async () => {
      resolveFetch({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          signed_url: FAKE_SIGNED_URL,
          expires_at: '2026-06-05T13:00:00Z',
          storage_path: 'test.pdf',
          report_history_id: 'rh-001',
        }),
      });
    });

    await waitFor(() => expect(result.current.state).toBe('success'));
    // Solo 1 fetch en total
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  // ───── 14. Template code vacío → error ─────
  it('error si templateCode está vacío', async () => {
    const { result } = renderHook(() => usePdfDownload());

    await act(async () => {
      await result.current.download({
        templateCode: '',
        recordId: 'wo-123',
      });
    });

    expect(result.current.state).toBe('error');
    expect(result.current.error).toContain('template requerido');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
