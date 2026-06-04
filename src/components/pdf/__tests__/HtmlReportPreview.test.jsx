/**
 * Tests para HtmlReportPreview — modal de previsualización de reportes PDF.
 *
 * Cubre los 4 estados visuales: loading, error, empty, success.
 * Verifica botones Imprimir y Cerrar.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import HtmlReportPreview from '../HtmlReportPreview';

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════
function renderWithDefaults(overrides = {}) {
  const defaults = {
    html: null,
    loading: false,
    error: null,
    empty: false,
    templateName: null,
    onPrint: vi.fn(),
    onClose: vi.fn(),
  };
  return render(<HtmlReportPreview {...defaults} {...overrides} />);
}

describe('HtmlReportPreview', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ───── 1. Loading → muestra CircularProgress ─────
  describe('estado loading', () => {
    it('muestra CircularProgress cuando loading=true', () => {
      renderWithDefaults({ loading: true });

      // MUI CircularProgress tiene role="progressbar" por defecto
      expect(screen.getByRole('progressbar')).toBeDefined();
    });

    it('no muestra iframe mientras loading', () => {
      renderWithDefaults({ loading: true, html: '<h1>test</h1>' });

      // No debe haber iframe cuando loading (aunque html tenga valor)
      expect(screen.queryByTitle('Vista previa del reporte')).toBeNull();
    });

    it('no muestra botones de acción mientras loading', () => {
      renderWithDefaults({ loading: true });

      // Los botones solo aparecen cuando hasContent=true (loading debe ser false y error null)
      expect(screen.queryByText('Cerrar')).toBeNull();
      expect(screen.queryByText('Imprimir')).toBeNull();
    });
  });

  // ───── 2. Error → muestra Alert con mensaje de error ─────
  describe('estado error', () => {
    it('muestra mensaje de error en Alert cuando error tiene valor', () => {
      renderWithDefaults({ error: 'Error al generar el reporte' });

      expect(screen.getByText('Error al generar el reporte')).toBeDefined();
    });

    it('no muestra CircularProgress cuando hay error', () => {
      renderWithDefaults({ loading: true, error: 'Algo salió mal' });

      // error tiene prioridad visual (error && !loading se corta antes)
      // Pero el componente muestra loading PRIMERO en el DOM
      // Veamos: loading=true → muestra loading. Si error también está, loading gana.
      // La condición es: {error && !loading && ( ... )} — así que con loading=true no muestra error
      // El test correcto es: si loading=false y error=true, no hay progressbar
      cleanup();
      renderWithDefaults({ loading: false, error: 'Algo salió mal' });

      expect(screen.queryByRole('progressbar')).toBeNull();
    });
  });

  // ───── 3. Empty → muestra Alert de "formato por defecto" ─────
  describe('estado empty', () => {
    it('muestra alerta de "formato por defecto" cuando empty=true', () => {
      renderWithDefaults({ empty: true, html: '<h1>test</h1>' });

      expect(screen.getByText('No hay template activo. Usando formato por defecto.')).toBeDefined();
    });

    it('no muestra alerta empty si loading es true', () => {
      renderWithDefaults({ empty: true, loading: true });

      expect(screen.queryByText('No hay template activo. Usando formato por defecto.')).toBeNull();
    });

    it('no muestra alerta empty si hay error', () => {
      renderWithDefaults({ empty: true, error: 'Error' });

      expect(screen.queryByText('No hay template activo. Usando formato por defecto.')).toBeNull();
    });
  });

  // ───── 4. Success con html → muestra iframe con srcdoc ─────
  describe('estado success', () => {
    it('renderiza iframe con srcdoc cuando hay html', () => {
      renderWithDefaults({ html: '<h1>Reporte</h1>' });

      const iframe = screen.getByTitle('Vista previa del reporte');
      expect(iframe).toBeDefined();
      expect(iframe.getAttribute('srcDoc')).toBe('<h1>Reporte</h1>');
    });

    it('muestra el nombre del template en el título', () => {
      renderWithDefaults({
        html: '<h1>Reporte</h1>',
        templateName: 'Template OT',
      });

      expect(screen.getByText('Vista previa — Template OT')).toBeDefined();
    });

    it('no muestra iframe si html es null aunque no haya loading/error', () => {
      renderWithDefaults({ html: null });

      expect(screen.queryByTitle('Vista previa del reporte')).toBeNull();
    });
  });

  // ───── 5. Botón "Imprimir" → llama onPrint ─────
  describe('botón Imprimir', () => {
    it('llama onPrint al hacer click en Imprimir', async () => {
      const onPrint = vi.fn();
      renderWithDefaults({ html: '<h1>Reporte</h1>', onPrint });

      const user = userEvent.setup();
      await user.click(screen.getByText('Imprimir'));

      expect(onPrint).toHaveBeenCalledTimes(1);
    });

    it('no muestra botón Imprimir cuando loading=true', () => {
      renderWithDefaults({ loading: true, html: '<h1>test</h1>' });

      expect(screen.queryByText('Imprimir')).toBeNull();
    });

    it('no muestra botón Imprimir cuando hay error', () => {
      renderWithDefaults({ error: 'Error', html: '<h1>test</h1>' });

      expect(screen.queryByText('Imprimir')).toBeNull();
    });
  });

  // ───── 6. Botón "Cerrar" → llama onClose ─────
  describe('botón Cerrar', () => {
    it('llama onClose al hacer click en Cerrar', async () => {
      const onClose = vi.fn();
      renderWithDefaults({ html: '<h1>Reporte</h1>', onClose });

      const user = userEvent.setup();
      await user.click(screen.getByText('Cerrar'));

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('llama onClose al hacer click en el icono X', async () => {
      const onClose = vi.fn();
      renderWithDefaults({ html: '<h1>Reporte</h1>', onClose });

      const user = userEvent.setup();
      // El botón Cerrar con aria-label="Cerrar" (IconButton con CloseIcon)
      const closeButton = screen.getByLabelText('Cerrar');
      await user.click(closeButton);

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  // ───── Combinaciones de estados ─────
  describe('combinaciones de estados', () => {
    it('loading tiene prioridad sobre error', () => {
      renderWithDefaults({ loading: true, error: 'Error de carga' });

      // loading muestra progressbar
      expect(screen.getByRole('progressbar')).toBeDefined();
      // error no se muestra porque loading=true
      expect(screen.queryByText('Error de carga')).toBeNull();
    });

    it('cuando empty=true y html presente, muestra alerta + iframe + botones', () => {
      renderWithDefaults({ empty: true, html: '<h1>Reporte</h1>' });

      expect(screen.getByText('No hay template activo. Usando formato por defecto.')).toBeDefined();
      expect(screen.getByTitle('Vista previa del reporte')).toBeDefined();
      expect(screen.getByText('Cerrar')).toBeDefined();
      expect(screen.getByText('Imprimir')).toBeDefined();
    });
  });
});
