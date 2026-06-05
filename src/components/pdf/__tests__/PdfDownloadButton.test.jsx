/**
 * Tests para PdfDownloadButton — botón MUI de descarga PDF.
 *
 * Mockea el hook usePdfDownload para controlar estados:
 * - idle: botón normal habilitado
 * - loading: CircularProgress + deshabilitado
 * - success: CheckCircleIcon por 3s
 * - error: Snackbar con mensaje
 *
 * Verifica comportamiento visual y de interacción.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ═══════════════════════════════════════════════════════════════════
// Mocks hoisteados
// ═══════════════════════════════════════════════════════════════════
const mockUsePdfDownload = vi.hoisted(() => vi.fn());

vi.mock('../../../hooks/usePdfDownload', () => ({
  usePdfDownload: (...args) => mockUsePdfDownload(...args),
}));

// ═══════════════════════════════════════════════════════════════════
// Import del componente bajo test
// ═══════════════════════════════════════════════════════════════════
import PdfDownloadButton from '../PdfDownloadButton';

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════
function createMockHook(stateOverrides = {}) {
  const defaults = {
    download: vi.fn(),
    loading: false,
    error: null,
    pdfUrl: null,
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

/**
 * Busca el botón por role, evitando duplicados de MUI Tooltip span.
 */
function getButton() {
  return screen.getByRole('button', { name: /descargar pdf/i });
}

function isDisabled(element) {
  return element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true';
}

describe('PdfDownloadButton', () => {
  beforeEach(() => {
    mockUsePdfDownload.mockReturnValue(createMockHook());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ───── 1. Renderiza habilitado con props válidas ─────
  it('renderiza enabled cuando tiene templateCode y recordId', () => {
    render(<PdfDownloadButton {...defaultProps} />);

    const button = getButton();
    expect(button).toBeDefined();
    expect(isDisabled(button)).toBe(false);
  });

  // ───── 2. Deshabilitado cuando falta templateCode ─────
  it('deshabilitado cuando templateCode está vacío', () => {
    render(<PdfDownloadButton templateCode="" recordId="wo-123" />);

    const button = getButton();
    expect(isDisabled(button)).toBe(true);
  });

  // ───── 3. Deshabilitado cuando falta recordId y data ─────
  it('deshabilitado cuando no hay recordId ni data', () => {
    render(<PdfDownloadButton templateCode="ot-default" />);

    const button = getButton();
    expect(isDisabled(button)).toBe(true);
  });

  // ───── 4. Habilitado con data presente ─────
  it('habilitado cuando tiene data en lugar de recordId', () => {
    render(
      <PdfDownloadButton templateCode="ot-default" data={{ work_order_id: 'wo-123' }} />,
    );

    const button = getButton();
    expect(isDisabled(button)).toBe(false);
  });

  // ───── 5. Loading: muestra CircularProgress y deshabilitado ─────
  it('muestra CircularProgress y deshabilitado cuando loading=true', () => {
    mockUsePdfDownload.mockReturnValue(
      createMockHook({ loading: true, state: 'loading' }),
    );

    render(<PdfDownloadButton {...defaultProps} />);

    // El botón debe estar deshabilitado
    const button = getButton();
    expect(isDisabled(button)).toBe(true);

    // Debe haber un CircularProgress (role="progressbar")
    expect(screen.getByRole('progressbar')).toBeDefined();
  });

  // ───── 6. Success: muestra CheckCircleIcon ─────
  it('muestra icono de éxito cuando state=success', () => {
    mockUsePdfDownload.mockReturnValue(
      createMockHook({ state: 'success', pdfUrl: 'https://example.com/test.pdf' }),
    );

    render(<PdfDownloadButton {...defaultProps} />);

    // Debe mostrar el CheckCircleIcon (data-testid="CheckCircleIcon")
    expect(screen.getByTestId('CheckCircleIcon')).toBeDefined();

    // El botón debe estar enabled (success no lo deshabilita)
    const button = getButton();
    expect(isDisabled(button)).toBe(false);
  });

  // ───── 7. Error: muestra Snackbar con mensaje ─────
  it('muestra Snackbar con mensaje de error cuando state=error', () => {
    const errorMsg = 'Template no disponible';
    mockUsePdfDownload.mockReturnValue(
      createMockHook({ state: 'error', error: errorMsg }),
    );

    render(<PdfDownloadButton {...defaultProps} />);

    // Debe mostrar el Alert con el mensaje de error
    expect(screen.getByText(errorMsg)).toBeDefined();

    // El botón debe estar habilitado (puede reintentar)
    const button = getButton();
    expect(isDisabled(button)).toBe(false);
  });

  // ───── 8. Click → llama a download() ─────
  it('llama a download() con las props al hacer click', async () => {
    const mockDownload = vi.fn();
    mockUsePdfDownload.mockReturnValue(
      createMockHook({ download: mockDownload }),
    );

    render(<PdfDownloadButton {...defaultProps} />);

    const user = userEvent.setup();
    await user.click(getButton());

    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(mockDownload).toHaveBeenCalledWith({
      templateCode: 'ot-default',
      recordId: 'wo-123',
      recordType: 'work_order',
      data: undefined,
    });
  });

  // ───── 9. Click no llama a download() si disabled ─────
  it('no descarga cuando el botón está deshabilitado', async () => {
    const mockDownload = vi.fn();
    mockUsePdfDownload.mockReturnValue(
      createMockHook({ download: mockDownload, loading: true, state: 'loading' }),
    );

    render(<PdfDownloadButton templateCode="" recordId="wo-123" />);

    const button = getButton();
    expect(isDisabled(button)).toBe(true);

    // Con disabled, userEvent.click lanza error por pointer-events:none
    // Usamos fireEvent como alternativa
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.click(button);

    expect(mockDownload).not.toHaveBeenCalled();
  });

  // ───── 10. Variante text: botón con label ─────
  it('variante text: muestra botón con label "Descargar PDF"', () => {
    render(<PdfDownloadButton {...defaultProps} variant="text" />);

    expect(screen.getByText('Descargar PDF')).toBeDefined();
  });

  // ───── 11. Variante text: label cambia durante loading ─────
  it('variante text: label cambia a "Generando…" durante loading', () => {
    mockUsePdfDownload.mockReturnValue(
      createMockHook({ loading: true, state: 'loading' }),
    );

    render(<PdfDownloadButton {...defaultProps} variant="text" />);

    expect(screen.getByText('Generando…')).toBeDefined();
  });

  // ───── 12. Variante text: label cambia a "Descargado" en success ─────
  it('variante text: label cambia a "Descargado" en success', () => {
    mockUsePdfDownload.mockReturnValue(
      createMockHook({ state: 'success' }),
    );

    render(<PdfDownloadButton {...defaultProps} variant="text" />);

    expect(screen.getByText('Descargado')).toBeDefined();
  });

  // ───── 13. Auto-reset después de success ─────
  it('llama a reset() después de 3s en success', async () => {
    vi.useFakeTimers();
    const mockReset = vi.fn();
    mockUsePdfDownload.mockReturnValue(
      createMockHook({ state: 'success', reset: mockReset }),
    );

    render(<PdfDownloadButton {...defaultProps} />);

    // Avanzar 3s
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(mockReset).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  // ───── 14. onComplete se pasa al hook ─────
  it('pasa onComplete al hook usePdfDownload', () => {
    const onComplete = vi.fn();

    render(
      <PdfDownloadButton {...defaultProps} onComplete={onComplete} />,
    );

    expect(mockUsePdfDownload).toHaveBeenCalledWith(
      expect.objectContaining({ onComplete }),
    );
  });

  // ───── 15. Icono DownloadIcon en estado idle ─────
  it('muestra DownloadIcon en estado idle', () => {
    render(<PdfDownloadButton {...defaultProps} />);

    expect(screen.getByTestId('DownloadIcon')).toBeDefined();
  });
});
