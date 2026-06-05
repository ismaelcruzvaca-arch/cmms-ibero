/**
 * Tests para PdfEmailButton — diálogo MUI de envío de PDF por email.
 *
 * Mockea el hook usePdfEmail para controlar estados:
 * - idle: diálogo cerrado, botón "Enviar por email" visible
 * - loading: spinner en botón Send, deshabilitado
 * - success: snackbar "Reporte enviado", diálogo se cierra
 * - error: snackbar con mensaje
 *
 * Verifica comportamiento visual y de interacción.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fireEvent } from '@testing-library/react';

// ═══════════════════════════════════════════════════════════════════
// Mocks hoisteados
// ═══════════════════════════════════════════════════════════════════
const mockUsePdfEmail = vi.hoisted(() => vi.fn());

vi.mock('../../../hooks/usePdfEmail', () => ({
  usePdfEmail: (...args) => mockUsePdfEmail(...args),
}));

// ═══════════════════════════════════════════════════════════════════
// Import del componente bajo test
// ═══════════════════════════════════════════════════════════════════
import PdfEmailButton from '../PdfEmailButton';

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════
function createMockHook(stateOverrides = {}) {
  const defaults = {
    sendEmail: vi.fn(),
    loading: false,
    error: null,
    messageId: null,
    state: 'idle',
    reset: vi.fn(),
  };
  return { ...defaults, ...stateOverrides };
}

const defaultProps = {
  templateCode: 'ot-default',
  recordId: 'wo-123',
  recordType: 'work_order',
};

function isDisabled(element) {
  return element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true';
}

describe('PdfEmailButton', () => {
  beforeEach(() => {
    mockUsePdfEmail.mockReturnValue(createMockHook());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ───── 1. Botón "Enviar por email" presente y habilitado ─────
  it('renderiza botón "Enviar por email" habilitado con props válidas', () => {
    render(<PdfEmailButton {...defaultProps} />);

    const button = screen.getByRole('button', { name: /enviar por email/i });
    expect(button).toBeDefined();
    expect(isDisabled(button)).toBe(false);
  });

  // ───── 2. Botón deshabilitado cuando falta templateCode ─────
  it('botón deshabilitado cuando templateCode está vacío', () => {
    render(<PdfEmailButton templateCode="" recordId="wo-123" />);

    const button = screen.getByRole('button', { name: /enviar por email/i });
    expect(isDisabled(button)).toBe(true);
  });

  // ───── 3. Botón deshabilitado cuando faltan recordId y data ─────
  it('botón deshabilitado cuando no hay recordId ni data', () => {
    render(<PdfEmailButton templateCode="ot-default" />);

    const button = screen.getByRole('button', { name: /enviar por email/i });
    expect(isDisabled(button)).toBe(true);
  });

  // ───── 4. Botón deshabilitado durante loading ─────
  it('botón deshabilitado durante loading del hook', () => {
    mockUsePdfEmail.mockReturnValue(
      createMockHook({ loading: true, state: 'loading' }),
    );

    render(<PdfEmailButton {...defaultProps} />);

    const button = screen.getByRole('button', { name: /enviar por email/i });
    expect(isDisabled(button)).toBe(true);
  });

  // ───── 5. Click abre el diálogo ─────
  it('click en botón abre el diálogo con campos', async () => {
    const user = userEvent.setup();
    render(<PdfEmailButton {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: /enviar por email/i }));

    // Diálogo debe estar presente
    expect(screen.getByRole('dialog')).toBeDefined();

    // Debe tener campo de email (to) — usa label text
    expect(screen.getByLabelText('Destinatario')).toBeDefined();

    // Debe tener campo de asunto (subject)
    expect(screen.getByLabelText('Asunto')).toBeDefined();

    // Debe tener campo de mensaje opcional
    expect(screen.getByLabelText('Mensaje (opcional)')).toBeDefined();

    // Botón Enviar en el diálogo
    expect(screen.getByRole('button', { name: /enviar/i })).toBeDefined();
  });

  // ───── 6. Diálogo se cierra con botón Cancelar ─────
  it('click en Cancelar cierra el diálogo', async () => {
    const user = userEvent.setup();
    render(<PdfEmailButton {...defaultProps} />);

    // Abrir diálogo
    await user.click(screen.getByRole('button', { name: /enviar por email/i }));
    expect(screen.getByRole('dialog')).toBeDefined();

    // Cerrar con Cancelar
    await user.click(screen.getByRole('button', { name: /cancelar/i }));

    // Esperar a que el diálogo desaparezca
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  // ───── 7. Loading spinner en botón Send durante envío ─────
  it('botón Send muestra CircularProgress durante loading', async () => {
    mockUsePdfEmail.mockReturnValue(
      createMockHook({ loading: false, state: 'idle' }),
    );

    const { rerender } = render(<PdfEmailButton {...defaultProps} />);

    // Open dialog with idle state
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /enviar por email/i }));
    });

    // Wait for dialog to render
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeDefined();
    });

    // Now switch to loading state
    mockUsePdfEmail.mockReturnValue(
      createMockHook({ loading: true, state: 'loading' }),
    );

    await act(async () => {
      rerender(<PdfEmailButton {...defaultProps} />);
    });

    // Botón Send debe mostrar spinner y estar deshabilitado
    await waitFor(() => {
      const sendButton = screen.getByRole('button', { name: /enviando|enviar/i });
      expect(isDisabled(sendButton)).toBe(true);
      expect(screen.getByRole('progressbar')).toBeDefined();
    });
  });

  // ───── 8. Submit llama a sendEmail con los valores del formulario ─────
  it('submit llama a sendEmail con to, subject, message', { timeout: 15000 }, async () => {
    const mockSendEmail = vi.fn().mockResolvedValue(undefined);
    mockUsePdfEmail.mockReturnValue(
      createMockHook({ sendEmail: mockSendEmail }),
    );

    const user = userEvent.setup();
    render(<PdfEmailButton {...defaultProps} />);

    // Abrir diálogo
    await user.click(screen.getByRole('button', { name: /enviar por email/i }));

    // Llenar campos
    await user.type(screen.getByLabelText('Destinatario'), 'test@example.com');
    await user.type(screen.getByLabelText('Asunto'), 'Reporte mensual');
    await user.type(screen.getByLabelText('Mensaje (opcional)'), 'Adjunto el reporte.');

    // Enviar
    await user.click(screen.getByRole('button', { name: /enviar/i }));

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith({
      to: 'test@example.com',
      subject: 'Reporte mensual',
      message: 'Adjunto el reporte.',
      templateCode: 'ot-default',
      recordId: 'wo-123',
      recordType: 'work_order',
    });
  });

  // ───── 9. Success snackbar "Reporte enviado" ─────
  it('success state: muestra snackbar "Reporte enviado"', () => {
    mockUsePdfEmail.mockReturnValue(
      createMockHook({ state: 'success', messageId: 'msg-123' }),
    );

    render(<PdfEmailButton {...defaultProps} />);

    expect(screen.getByText('Reporte enviado')).toBeDefined();
  });

  // ───── 10. Error snackbar ─────
  it('error state: muestra snackbar con mensaje de error', () => {
    const errorMsg = 'Destinatario inválido';
    mockUsePdfEmail.mockReturnValue(
      createMockHook({ state: 'error', error: errorMsg }),
    );

    render(<PdfEmailButton {...defaultProps} />);

    expect(screen.getByText(errorMsg)).toBeDefined();
  });

  // ───── 11. Se cierra el diálogo tras envío exitoso ─────
  it('diálogo se cierra automáticamente tras success', async () => {
    const { rerender } = render(
      <PdfEmailButton {...defaultProps} />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /enviar por email/i }));
    expect(screen.getByRole('dialog')).toBeDefined();

    // Cambiar a success — el diálogo debe cerrarse
    mockUsePdfEmail.mockReturnValue(
      createMockHook({ state: 'success', messageId: 'msg-123' }),
    );

    rerender(<PdfEmailButton {...defaultProps} />);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  // ───── 12. Auto-reset después de success ─────
  it('llama a reset() después de 3s en success', async () => {
    vi.useFakeTimers();
    const mockReset = vi.fn();
    mockUsePdfEmail.mockReturnValue(
      createMockHook({ state: 'success', reset: mockReset }),
    );

    render(<PdfEmailButton {...defaultProps} />);

    // Avanzar 3s
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(mockReset).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  // ───── 13. Inline validation: error debajo del campo email ─────
  it('muestra inline validation error debajo del campo to', async () => {
    const mockSendEmail = vi.fn().mockResolvedValue(undefined);
    mockUsePdfEmail.mockReturnValue(
      createMockHook({ sendEmail: mockSendEmail }),
    );

    const user = userEvent.setup();
    render(<PdfEmailButton {...defaultProps} />);

    // Abrir diálogo
    await user.click(screen.getByRole('button', { name: /enviar por email/i }));
    expect(screen.getByRole('dialog')).toBeDefined();

    // Dejar email vacío y tratar de enviar
    await user.click(screen.getByRole('button', { name: /enviar/i }));

    // Debe mostrar error inline
    await waitFor(() => {
      expect(screen.getByText('Destinatario requerido')).toBeDefined();
    });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
