/**
 * Tests para TemplatePreview — iframe de previsualización de templates.
 *
 * Cubre los 4 estados:
 * - loading: durante renderizado (solo visible si resolveTemplate es async)
 * - empty: template es null
 * - error: template inválido (sin sections)
 * - success: template válido, iframe srcdoc con HTML renderizado
 *
 * Mockea resolveTemplate de templateEngine.
 *
 * Nota: resolveTemplate() real es síncrono. React 19 bachea los state updates
 * síncronos, por lo que el estado 'loading' nunca es visible en condiciones
 * normales. Solo se prueba si el mock es explícitamente asíncrono.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';

import TemplatePreview from '../TemplatePreview';

// ═══════════════════════════════════════════════════════════════════
// Mocks
// ═══════════════════════════════════════════════════════════════════
const mockResolveTemplate = vi.fn((_template, _data) => {
  return '<!DOCTYPE html><html><body><h1>Preview Renderizado</h1></body></html>';
});

vi.mock('../../../lib/pdf/templateEngine', () => ({
  resolveTemplate: (...args) => mockResolveTemplate(...args),
}));

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

/**
 * Template válido mínimo para pruebas.
 */
const VALID_TEMPLATE = {
  id: 'test-template',
  name: 'Template de prueba',
  sections: [
    { type: 'header', titleField: 'title', badgeField: 'badge' },
    { type: 'divider' },
    { type: 'footer', text: 'Test footer' },
  ],
};

/**
 * Template inválido (sin sections array).
 */
const INVALID_TEMPLATE = {
  id: 'bad-template',
  name: 'Template inválido',
};

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════
describe('TemplatePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ───── 1. Empty state (template null) ─────
  describe('estado empty', () => {
    it('muestra mensaje informativo cuando template es null', async () => {
      render(<TemplatePreview template={null} />);

      await waitFor(() => {
        expect(
          screen.getByText('Selecciona un template para ver la vista previa.'),
        ).toBeDefined();
      });

      // No debe llamar a resolveTemplate
      expect(mockResolveTemplate).not.toHaveBeenCalled();
    });

    it('muestra mensaje cuando template es undefined', async () => {
      render(<TemplatePreview />);

      await waitFor(() => {
        expect(
          screen.getByText('Selecciona un template para ver la vista previa.'),
        ).toBeDefined();
      });
    });

    it('no renderiza iframe en estado empty', async () => {
      render(<TemplatePreview template={null} />);

      await waitFor(() => {
        expect(screen.queryByTitle('Vista previa del template')).toBeNull();
      });
    });
  });

  // ───── 2. Error state (template inválido) ─────
  describe('estado error', () => {
    it('muestra error cuando template no tiene sections array', async () => {
      render(<TemplatePreview template={INVALID_TEMPLATE} />);

      await waitFor(() => {
        expect(screen.getByText('Error de sintaxis JSON')).toBeDefined();
      });

      expect(screen.getByText(/Estructura de template inválida/)).toBeDefined();
    });

    it('no llama a resolveTemplate en estado error', async () => {
      render(<TemplatePreview template={INVALID_TEMPLATE} />);

      await waitFor(() => {
        expect(screen.getByText('Error de sintaxis JSON')).toBeDefined();
      });

      expect(mockResolveTemplate).not.toHaveBeenCalled();
    });

    it('muestra error para template que no es objeto', async () => {
      render(<TemplatePreview template="string-no-valido" />);

      await waitFor(() => {
        expect(screen.getByText('Error de sintaxis JSON')).toBeDefined();
      });
    });

    it('muestra error para objeto sin sections', async () => {
      render(<TemplatePreview template={{ id: 'x', name: 'y' }} />);

      await waitFor(() => {
        expect(screen.getByText('Error de sintaxis JSON')).toBeDefined();
      });
    });
  });

  // ───── 3. Success state (template válido) ─────
  describe('estado success', () => {
    it('renderiza iframe srcdoc cuando template es válido', async () => {
      render(<TemplatePreview template={VALID_TEMPLATE} />);

      // Esperar a que el iframe aparezca
      await waitFor(() => {
        const iframe = screen.queryByTitle('Vista previa del template');
        expect(iframe).not.toBeNull();
      });

      const iframe = screen.getByTitle('Vista previa del template');
      expect(iframe.getAttribute('srcDoc')).toContain('Preview Renderizado');
    });

    it('llama a resolveTemplate con template y mock data por defecto', async () => {
      render(<TemplatePreview template={VALID_TEMPLATE} />);

      await waitFor(() => {
        expect(mockResolveTemplate).toHaveBeenCalled();
      });

      const callArgs = mockResolveTemplate.mock.calls[0];
      expect(callArgs[0]).toBe(VALID_TEMPLATE);
      expect(callArgs[1]).toBeDefined();
      // Debe incluir datos mock por defecto
      expect(callArgs[1].work_order).toBeDefined();
      expect(callArgs[1].labor_records).toBeDefined();
      expect(callArgs[1].material_requests).toBeDefined();
      expect(callArgs[1].asset).toBeDefined();
    });

    it('usa mockData personalizado si se proporciona', async () => {
      const customMockData = {
        title: 'Custom Title',
        work_order: { id: 'CUSTOM-001' },
      };

      render(<TemplatePreview template={VALID_TEMPLATE} mockData={customMockData} />);

      await waitFor(() => {
        expect(mockResolveTemplate).toHaveBeenCalled();
      });

      const callArgs = mockResolveTemplate.mock.calls[0];
      expect(callArgs[1]).toBe(customMockData);
    });

    it('el iframe tiene sandbox="allow-scripts"', async () => {
      render(<TemplatePreview template={VALID_TEMPLATE} />);

      await waitFor(() => {
        const iframe = screen.queryByTitle('Vista previa del template');
        expect(iframe).not.toBeNull();
      });

      const iframe = screen.getByTitle('Vista previa del template');
      expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
    });
  });

  // ───── 4. Re-render con template diferente ─────
  describe('re-render con template cambiado', () => {
    it('re-renderiza cuando template cambia', async () => {
      const { rerender } = render(<TemplatePreview template={VALID_TEMPLATE} />);

      await waitFor(() => {
        expect(mockResolveTemplate).toHaveBeenCalledTimes(1);
      });

      // Cambiar template
      const otroTemplate = {
        id: 'otro-template',
        name: 'Otro Template',
        sections: [{ type: 'title', text: 'Otro' }],
      };

      rerender(<TemplatePreview template={otroTemplate} />);

      await waitFor(() => {
        expect(mockResolveTemplate).toHaveBeenCalledTimes(2);
      });

      // El último llamado debe ser con el nuevo template
      const lastCall = mockResolveTemplate.mock.calls[1];
      expect(lastCall[0]).toBe(otroTemplate);
    });

    it('no re-renderiza si el template no cambió (misma referencia)', async () => {
      const { rerender } = render(<TemplatePreview template={VALID_TEMPLATE} />);

      await waitFor(() => {
        expect(mockResolveTemplate).toHaveBeenCalledTimes(1);
      });

      rerender(<TemplatePreview template={VALID_TEMPLATE} />);

      // Esperar microtask para confirmar que no se llamó de nuevo
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      expect(mockResolveTemplate).toHaveBeenCalledTimes(1);
    });
  });

  // ───── 5. Error en resolveTemplate ─────
  describe('error en resolveTemplate', () => {
    it('captura error de resolveTemplate y muestra mensaje', async () => {
      mockResolveTemplate.mockImplementationOnce(() => {
        throw new Error('Error de renderizado interno');
      });

      render(<TemplatePreview template={VALID_TEMPLATE} />);

      await waitFor(() => {
        expect(screen.getByText('Error de sintaxis JSON')).toBeDefined();
      });

      expect(screen.getByText('Error de renderizado interno')).toBeDefined();
    });
  });
});
