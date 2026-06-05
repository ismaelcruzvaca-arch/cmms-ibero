/**
 * Tests para usePdfEmail — hook de envío de PDF por email.
 *
 * Mockea:
 * - supabase.auth.getSession() para token JWT
 * - global.fetch para el Edge Function
 *
 * Cubre: envío exitoso, validación de params, manejo de errores
 * (400, 401, 429, 502, network), estados loading/success/error.
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
const FAKE_MESSAGE_ID = 'msg-resend-abc123';

function mockFetchSuccess(overrides = {}) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      messageId: FAKE_MESSAGE_ID,
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
import { usePdfEmail } from '../usePdfEmail';

describe('usePdfEmail', () => {
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

  // ───── 1. Successful send ─────
  it('envío exitoso: POST al EF, recibe messageId, state=success', async () => {
    mockFetchSuccess();

    const { result } = renderHook(() => usePdfEmail());

    // Estado inicial
    expect(result.current.state).toBe('idle');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.messageId).toBeNull();

    await act(async () => {
      await result.current.sendEmail({
        to: 'user@example.com',
        subject: 'Reporte',
        templateCode: 'ot-default',
        recordId: 'wo-123',
      });
    });

    // Verificar estado final
    expect(result.current.state).toBe('success');
    expect(result.current.loading).toBe(false);
    expect(result.current.messageId).toBe(FAKE_MESSAGE_ID);
    expect(result.current.error).toBeNull();

    // Verificar que se obtuvo sesión
    expect(mockSupabase.auth.getSession).toHaveBeenCalledTimes(1);

    // Verificar fetch al EF
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const fetchCall = global.fetch.mock.calls[0];
    expect(fetchCall[0]).toContain('/functions/v1/send-report');
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
      to: 'user@example.com',
      subject: 'Reporte',
      template_code: 'ot-default',
      record_id: 'wo-123',
    });
  });

  // ───── 2. Send with optional message ─────
  it('envío exitoso con mensaje opcional', async () => {
    mockFetchSuccess();

    const { result } = renderHook(() => usePdfEmail());

    await act(async () => {
      await result.current.sendEmail({
        to: ['a@example.com', 'b@example.com'],
        subject: 'Reporte mensual',
        message: 'Adjunto el reporte solicitado.',
        templateCode: 'ot-default',
        recordId: 'wo-123',
      });
    });

    expect(result.current.state).toBe('success');

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.to).toEqual(['a@example.com', 'b@example.com']);
    expect(body.message).toBe('Adjunto el reporte solicitado.');
  });

  // ───── 3. Loading state management ─────
  it('loading=true durante el envío, loading=false al finalizar', async () => {
    let resolveFetch;
    const fetchPromise = new Promise((resolve) => { resolveFetch = resolve; });
    global.fetch = vi.fn().mockReturnValue(fetchPromise);

    const { result } = renderHook(() => usePdfEmail());

    act(() => {
      result.current.sendEmail({
        to: 'user@example.com',
        subject: 'Test',
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
        json: () => Promise.resolve({ messageId: FAKE_MESSAGE_ID }),
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
    const { result } = renderHook(() => usePdfEmail({ onComplete }));

    await act(async () => {
      await result.current.sendEmail({
        to: 'user@example.com',
        subject: 'Test',
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

    const { result } = renderHook(() => usePdfEmail());

    await act(async () => {
      await result.current.sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        templateCode: 'ot-default',
        recordId: 'wo-123',
      });
    });

    expect(result.current.state).toBe('error');
    expect(result.current.error).toContain('Sesión expirada');
  });

  // ───── 6. 400 validation error ─────
  it('error 400 cuando el payload es inválido', async () => {
    mockFetchError(400, {
      error: 'invalid_payload',
      details: ['to must be a valid email address'],
    });

    const { result } = renderHook(() => usePdfEmail());

    await act(async () => {
      await result.current.sendEmail({
        to: 'not-an-email',
        subject: 'Test',
        templateCode: 'ot-default',
        recordId: 'wo-123',
      });
    });

    expect(result.current.state).toBe('error');
    expect(result.current.error).toContain('email');
  });

  // ───── 7. 429 rate limited ─────
  it('error 429 cuando Resend rate limitea', async () => {
    mockFetchError(429, { error: 'rate_limited' });

    const { result } = renderHook(() => usePdfEmail());

    await act(async () => {
      await result.current.sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        templateCode: 'ot-default',
        recordId: 'wo-123',
      });
    });

    expect(result.current.state).toBe('error');
    expect(result.current.error).toContain('Intenta nuevamente');
  });

  // ───── 8. 502 upstream failure ─────
  it('error 502 cuando el upstream falla', async () => {
    mockFetchError(502, { error: 'email_delivery_failed' });

    const { result } = renderHook(() => usePdfEmail());

    await act(async () => {
      await result.current.sendEmail({
        to: 'user@example.com',
        subject: 'Test',
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

    const { result } = renderHook(() => usePdfEmail());

    await act(async () => {
      await result.current.sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        templateCode: 'ot-default',
        recordId: 'wo-123',
      });
    });

    expect(result.current.state).toBe('error');
    expect(result.current.error).toBe('Network error');
  });

  // ───── 10. Estado idle inicial ─────
  it('estado inicial idle con todos los valores por defecto', () => {
    const { result } = renderHook(() => usePdfEmail());

    expect(result.current.state).toBe('idle');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.messageId).toBeNull();
    expect(result.current.sendEmail).toBeInstanceOf(Function);
    expect(result.current.reset).toBeInstanceOf(Function);
  });

  // ───── 11. Reset restaura idle ─────
  it('reset() vuelve al estado idle', async () => {
    mockFetchSuccess();

    const { result } = renderHook(() => usePdfEmail());

    await act(async () => {
      await result.current.sendEmail({
        to: 'user@example.com',
        subject: 'Test',
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
    expect(result.current.messageId).toBeNull();
  });

  // ───── 12. onComplete callback en éxito ─────
  it('onComplete se llama con resultado exitoso', async () => {
    mockFetchSuccess();
    const onComplete = vi.fn();

    const { result } = renderHook(() => usePdfEmail({ onComplete }));

    await act(async () => {
      await result.current.sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        templateCode: 'ot-default',
        recordId: 'wo-123',
      });
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, messageId: FAKE_MESSAGE_ID }),
    );
  });

  // ───── 13. Ignora segunda llamada mientras loading ─────
  it('ignora llamadas concurrentes a sendEmail()', async () => {
    let resolveFetch;
    const fetchPromise = new Promise((resolve) => { resolveFetch = resolve; });
    global.fetch = vi.fn().mockReturnValue(fetchPromise);

    const { result } = renderHook(() => usePdfEmail());

    // Iniciar primer envío
    act(() => {
      result.current.sendEmail({ to: 'user@example.com', subject: 'Test', templateCode: 'ot-default', recordId: 'wo-123' });
    });

    // Flush microtasks
    await act(async () => {});

    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Segunda llamada debería ser ignorada
    await act(async () => {
      await result.current.sendEmail({ to: 'other@example.com', subject: 'Other', templateCode: 'ot-default', recordId: 'wo-456' });
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Resolver
    await act(async () => {
      resolveFetch({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ messageId: FAKE_MESSAGE_ID }),
      });
    });

    await waitFor(() => expect(result.current.state).toBe('success'));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
