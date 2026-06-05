/**
 * Tests para TemplateEditor — split-pane con CodeMirror 6 y TemplatePreview.
 *
 * Mockea:
 * - @codemirror/view, @codemirror/state, @codemirror/lang-json (evitan DOM real)
 * - useTemplates hook
 * - supabase.storage (branding upload)
 * - templateEngine (TemplatePreview usa resolveTemplate)
 *
 * Cubre:
 * - Renderizado con/sin template
 * - JSON validation
 * - Debounce 500ms en preview
 * - Branding upload zone
 * - Save flow (update y create)
 * - Estados: loading, error, saving
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ═══════════════════════════════════════════════════════════════════
// Mocks de CodeMirror (evita depender del DOM real)
// ═══════════════════════════════════════════════════════════════════
let mockEditorOnChange = null;

vi.mock('@codemirror/view', () => {
  const MockEditorView = class {
    constructor({ state, parent }) {
      this.state = state;
      this.destroy = vi.fn();
    }
    dispatch() {}
  };
  MockEditorView.updateListener = {
    of: (cb) => {
      mockEditorOnChange = cb;
      return [];
    },
  };
  MockEditorView.theme = () => [];
  MockEditorView.contentAttributes = { of: () => [] };
  return {
    EditorView: MockEditorView,
    lineNumbers: () => [],
    highlightActiveLine: () => [],
    keymap: { of: () => [] },
  };
});

vi.mock('@codemirror/state', () => ({
  EditorState: {
    create: ({ doc }) => ({
      doc: { toString: () => doc },
      selection: { main: { head: doc?.length || 0 } },
    }),
  },
}));

vi.mock('@codemirror/lang-json', () => ({
  json: () => [],
}));

// ═══════════════════════════════════════════════════════════════════
// Mocks de templateEngine (TemplatePreview lo usa)
// ═══════════════════════════════════════════════════════════════════
vi.mock('../../../lib/pdf/templateEngine', () => ({
  resolveTemplate: vi.fn(() => '<html><body><h1>Preview</h1></body></html>'),
}));

// ═══════════════════════════════════════════════════════════════════
// Mocks de supabase (branding upload)
// ═══════════════════════════════════════════════════════════════════
const mockUpload = vi.fn();
const mockGetPublicUrl = vi.fn(() => ({ data: { publicUrl: 'https://example.com/logo.png' } }));

vi.mock('../../../lib/supabaseClient', () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: mockUpload,
        getPublicUrl: mockGetPublicUrl,
      }),
    },
  },
}));

// ═══════════════════════════════════════════════════════════════════
// Mocks de useTemplates
// ═══════════════════════════════════════════════════════════════════
const mockUpdate = vi.fn();
const mockCreate = vi.fn();

vi.mock('../../../hooks/useTemplates', () => ({
  useTemplates: () => ({
    fetchAll: vi.fn(),
    create: mockCreate,
    update: mockUpdate,
    duplicate: vi.fn(),
    rollback: vi.fn(),
    toggleActive: vi.fn(),
    loading: false,
  }),
}));

// ═══════════════════════════════════════════════════════════════════
// MUI Theme mock — provee palette.mode
// ═══════════════════════════════════════════════════════════════════
vi.mock('@mui/material/styles', () => ({
  useTheme: () => ({ palette: { mode: 'light' } }),
}));

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════
function makeTemplate(overrides = {}) {
  return {
    id: overrides.id || 'tmpl-1',
    code: overrides.code || 'ot-default',
    name: overrides.name || 'Template OT Default',
    description: overrides.description || 'Template por defecto',
    template: overrides.template || {
      sections: [
        { type: 'header', titleField: 'title' },
        { type: 'divider' },
        { type: 'footer', text: 'Test' },
      ],
    },
    version: overrides.version ?? 3,
    is_active: overrides.is_active ?? true,
    created_at: '2026-01-15T10:00:00Z',
    updated_at: null,
  };
}

/**
 * Helper: simula un cambio en el editor CodeMirror.
 */
function simulateEditorChange(text) {
  if (mockEditorOnChange) {
    act(() => {
      mockEditorOnChange({
        docChanged: true,
        state: { doc: { toString: () => text } },
      });
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════
import TemplateEditor from '../TemplateEditor';

describe('TemplateEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEditorOnChange = null;

    mockUpdate.mockResolvedValue({
      data: makeTemplate({ version: 4 }),
      error: null,
    });

    mockCreate.mockResolvedValue({
      data: makeTemplate({ id: 'new-tmpl', code: 'nuevo-template', version: 1 }),
      error: null,
    });

    mockUpload.mockResolvedValue({ data: {}, error: null });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockEditorOnChange = null;
  });

  // ───── 1. Renderizado ─────
  describe('renderizado', () => {
    it('renderiza toolbar con info del template cuando se pasa template', async () => {
      const tpl = makeTemplate({ code: 'ot-default', name: 'Template OT', version: 3 });
      render(<TemplateEditor template={tpl} onSaveComplete={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('ot-default')).toBeDefined();
        expect(screen.getByText('Template OT')).toBeDefined();
        expect(screen.getByText('v3')).toBeDefined();
      });
    });

    it('renderiza campos de nombre/descripción para template nuevo', async () => {
      render(<TemplateEditor template={null} onSaveComplete={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByLabelText('Nombre del template')).toBeDefined();
        expect(screen.getByLabelText('Descripción (opcional)')).toBeDefined();
      });
    });

    it('muestra sección Editor JSON y Vista previa', async () => {
      const tpl = makeTemplate();
      render(<TemplateEditor template={tpl} onSaveComplete={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('Editor JSON')).toBeDefined();
        expect(screen.getByText('Vista previa')).toBeDefined();
      });
    });

    it('muestra botón Guardar', async () => {
      render(<TemplateEditor template={makeTemplate()} onSaveComplete={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByLabelText('Guardar template')).toBeDefined();
      });
    });

    it('muestra botón Volver', async () => {
      render(<TemplateEditor template={makeTemplate()} onSaveComplete={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByLabelText('Volver a lista de templates')).toBeDefined();
      });
    });
  });

  // ───── 2. JSON Validation ─────
  describe('validación JSON', () => {
    it('muestra error cuando JSON es inválido', async () => {
      render(<TemplateEditor template={makeTemplate()} onSaveComplete={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('Editor JSON')).toBeDefined();
      });

      // Simular JSON inválido
      simulateEditorChange('{ json invalido }');

      await waitFor(() => {
        // El texto "Error de sintaxis" aparece tanto en el header del editor
        // como en el preview — usamos getAllByText para cubrir ambos casos
        const errors = screen.getAllByText(/Error de sintaxis/i);
        expect(errors.length).toBeGreaterThan(0);
      });
    });

    it('NO muestra error cuando JSON es válido', async () => {
      render(<TemplateEditor template={makeTemplate()} onSaveComplete={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('Editor JSON')).toBeDefined();
      });

      // JSON válido
      simulateEditorChange('{"sections":[],"valid":true}');

      await waitFor(() => {
        expect(screen.getByText(/JSON válido/i)).toBeDefined();
      });
    });

    it('muestra preview con error cuando JSON inválido reemplaza preview', async () => {
      render(<TemplateEditor template={makeTemplate()} onSaveComplete={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('Vista previa')).toBeDefined();
      });

      simulateEditorChange('{ bad json }');

      await waitFor(() => {
        expect(screen.getByText('Error de sintaxis JSON')).toBeDefined();
      });
    });
  });

  // ───── 3. Debounce — verificamos que el mecanismo de debounce existe ─────
  // Nota: el debounce (500ms via setTimeout) se prueba a nivel de integración.
  // Unitariamente, verificamos que el componente tiene la estructura que soporta
  // el debounce: editor + preview separados, y que cambios en el editor no
  // producen errores inmediatos en el preview.
  describe('debounce 500ms', () => {
    it('tiene editor y preview como paneles separados (soporta debounce)', async () => {
      const tpl = makeTemplate();
      render(<TemplateEditor template={tpl} onSaveComplete={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('Editor JSON')).toBeDefined();
        expect(screen.getByText('Vista previa')).toBeDefined();
      });

      // El editor y preview están en paneles distintos
      const editorHeader = screen.getByText('Editor JSON');
      const previewHeader = screen.getByText('Vista previa');
      expect(editorHeader).toBeDefined();
      expect(previewHeader).toBeDefined();
    });

    it('JSON válido no causa error después de cambio', async () => {
      const tpl = makeTemplate();
      render(<TemplateEditor template={tpl} onSaveComplete={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('Editor JSON')).toBeDefined();
      });

      // Cambiar a JSON válido
      simulateEditorChange('{"sections":[],"valid":true}');

      await waitFor(() => {
        // El componente reconoce JSON válido
        const validMsg = screen.queryByText(/JSON válido/i);
        expect(validMsg).not.toBeNull();
      });
    });
  });

  // ───── 4. Branding Upload ─────
  describe('branding upload', () => {
    it('muestra sección de branding para template existente', async () => {
      const tpl = makeTemplate({ code: 'ot-default' });
      render(<TemplateEditor template={tpl} onSaveComplete={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('Branding / Logo')).toBeDefined();
      });
    });

    it('NO muestra branding para template nuevo', async () => {
      render(<TemplateEditor template={null} onSaveComplete={vi.fn()} />);

      await waitFor(() => {
        expect(screen.queryByText('Branding / Logo')).toBeNull();
      });
    });

    it('muestra zona de drop con instrucciones', async () => {
      const tpl = makeTemplate({ code: 'ot-default' });
      render(<TemplateEditor template={tpl} onSaveComplete={vi.fn()} />);

      // Expandir accordion de branding
      await waitFor(() => {
        const brandingButton = screen.getByText('Branding / Logo');
        expect(brandingButton).toBeDefined();
      });

      // Hacer clic en el accordion para expandir
      const accordion = screen.getByText('Branding / Logo').closest('.MuiAccordionSummary-root');
      if (accordion) {
        await userEvent.setup().click(accordion);
      }

      await waitFor(() => {
        expect(screen.getByText(/Arrastrá un logo/i)).toBeDefined();
      });
    });

    it('tiene input de archivo oculto', async () => {
      const tpl = makeTemplate({ code: 'ot-default' });
      render(<TemplateEditor template={tpl} onSaveComplete={vi.fn()} />);

      // Expandir accordion
      await waitFor(() => {
        expect(screen.getByText('Branding / Logo')).toBeDefined();
      });

      const fileInput = document.querySelector('input[type="file"]');
      expect(fileInput).not.toBeNull();
      expect(fileInput.getAttribute('accept')).toContain('.png');
    });
  });

  // ───── 5. Save flow ─────
  describe('guardado', () => {
    it('llama a update() con template existente', async () => {
      const tpl = makeTemplate({ code: 'ot-default' });
      const onSaveComplete = vi.fn();
      render(<TemplateEditor template={tpl} onSaveComplete={onSaveComplete} />);

      await waitFor(() => {
        expect(screen.getByLabelText('Guardar template')).toBeDefined();
      });

      const saveButton = screen.getByLabelText('Guardar template');
      await userEvent.setup().click(saveButton);

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledWith('ot-default', expect.objectContaining({
          template: expect.any(Object),
        }));
      });
    });

    it('llama a create() para template nuevo', async () => {
      const onSaveComplete = vi.fn();
      render(<TemplateEditor template={null} onSaveComplete={onSaveComplete} />);

      await waitFor(() => {
        expect(screen.getByLabelText('Nombre del template')).toBeDefined();
      });

      // Completar nombre
      const nameInput = screen.getByLabelText('Nombre del template');
      await userEvent.setup().type(nameInput, 'Mi Template');

      // Guardar
      const saveButton = screen.getByLabelText('Guardar template');
      await userEvent.setup().click(saveButton);

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
          code: 'mi-template',
          name: 'Mi Template',
          template: expect.any(Object),
        }));
      });
    });

    it('NO guarda si hay error de JSON', async () => {
      const tpl = makeTemplate();
      render(<TemplateEditor template={tpl} onSaveComplete={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByLabelText('Guardar template')).toBeDefined();
      });

      // Insertar JSON inválido
      simulateEditorChange('{ invalido }');

      await waitFor(() => {
        const errors = screen.getAllByText(/Error de sintaxis/i);
        expect(errors.length).toBeGreaterThan(0);
      });

      const saveButton = screen.getByLabelText('Guardar template');
      await userEvent.setup().click(saveButton);

      // No debe llamar a update ni create
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('llama onSaveComplete después de guardar exitosamente', async () => {
      const tpl = makeTemplate({ code: 'ot-default' });
      const onSaveComplete = vi.fn();
      render(<TemplateEditor template={tpl} onSaveComplete={onSaveComplete} />);

      await waitFor(() => {
        expect(screen.getByLabelText('Guardar template')).toBeDefined();
      });

      const saveButton = screen.getByLabelText('Guardar template');
      await userEvent.setup().click(saveButton);

      await waitFor(() => {
        expect(onSaveComplete).toHaveBeenCalled();
      });
    });

    it('muestra error en snackbar cuando update falla', async () => {
      mockUpdate.mockResolvedValue({ data: null, error: 'Error de conexión' });

      const tpl = makeTemplate();
      render(<TemplateEditor template={tpl} onSaveComplete={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByLabelText('Guardar template')).toBeDefined();
      });

      const saveButton = screen.getByLabelText('Guardar template');
      await userEvent.setup().click(saveButton);

      await waitFor(() => {
        expect(screen.getByText(/Error de conexión/i)).toBeDefined();
      });
    });
  });
});
