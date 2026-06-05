/**
 * Tests para TemplateManager — tabla de administración de templates.
 *
 * Mockea:
 * - useTemplates hook (todo via vi.hoisted() para vi.mock)
 *
 * Cubre:
 * - Renderizado de tabla con datos
 * - Búsqueda con debounce
 * - Paginación
 * - Acciones: Editar, Duplicar, Toggle Active
 * - Estados: loading, empty, error
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ═══════════════════════════════════════════════════════════════════
// Mocks hoisteados (requerido por vi.mock)
// ═══════════════════════════════════════════════════════════════════
const { mockFetchAll, mockDuplicate, mockToggleActive, mockRollback } = vi.hoisted(() => ({
  mockFetchAll: vi.fn(),
  mockDuplicate: vi.fn(),
  mockToggleActive: vi.fn(),
  mockRollback: vi.fn(),
}));

vi.mock('../../../hooks/useTemplates', () => ({
  useTemplates: () => ({
    fetchAll: mockFetchAll,
    create: vi.fn(),
    update: vi.fn(),
    duplicate: mockDuplicate,
    rollback: mockRollback,
    toggleActive: mockToggleActive,
    loading: false,
  }),
}));

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════
function makeTemplate(overrides = {}) {
  return {
    id: overrides.id || `tmpl-${Math.random().toString(36).slice(2, 8)}`,
    code: overrides.code || 'ot-default',
    name: overrides.name || 'Template OT Default',
    description: overrides.description || null,
    template: { sections: [] },
    version: overrides.version ?? 3,
    is_active: overrides.is_active ?? true,
    created_at: overrides.created_at || '2026-01-15T10:00:00Z',
    updated_at: null,
  };
}

function makeTemplates(count) {
  return Array.from({ length: count }, (_, i) =>
    makeTemplate({
      id: `tmpl-${i}`,
      code: i === 0 ? 'ot-default' : `template-${i}`,
      name: i === 0 ? 'Template OT Default' : `Template ${i}`,
      version: (i % 5) + 1,
      is_active: i % 3 !== 0,
      created_at: new Date(2026, 0, 15 + i).toISOString(),
    }),
  );
}

function renderManager(onEdit) {
  return render(<TemplateManager onEdit={onEdit || vi.fn()} />);
}

// ═══════════════════════════════════════════════════════════════════
// Import
// ═══════════════════════════════════════════════════════════════════
import TemplateManager from '../TemplateManager';

describe('TemplateManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockFetchAll.mockResolvedValue({
      data: makeTemplates(5),
      total: 5,
      error: null,
    });

    mockDuplicate.mockResolvedValue({
      data: makeTemplate({ id: 'tmpl-duplicated', code: 'ot-default (copy)', version: 1 }),
      error: null,
    });

    mockToggleActive.mockResolvedValue({
      data: makeTemplate({ is_active: false }),
      error: null,
    });

    mockRollback.mockResolvedValue({
      data: makeTemplate({ version: 2, is_active: true }),
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ───── 1. Renderizado con datos ─────
  describe('renderizado', () => {
    it('renderiza tabla con templates', async () => {
      const templates = makeTemplates(3);
      mockFetchAll.mockResolvedValue({ data: templates, total: 3, error: null });

      renderManager();

      await waitFor(() => {
        expect(screen.getByText('ot-default')).toBeDefined();
      });

      expect(screen.getByText('Código')).toBeDefined();
      expect(screen.getByText('Nombre')).toBeDefined();
      expect(screen.getByText('Versión')).toBeDefined();
      expect(screen.getByText('Estado')).toBeDefined();
      expect(screen.getByText('Creado')).toBeDefined();
      expect(screen.getByText('Acciones')).toBeDefined();
    });

    it('muestra loading mientras carga', () => {
      mockFetchAll.mockImplementation(() => new Promise(() => {}));
      renderManager();

      expect(screen.getByRole('progressbar')).toBeDefined();
    });

    it('muestra mensaje empty cuando no hay templates', async () => {
      mockFetchAll.mockResolvedValue({ data: [], total: 0, error: null });

      renderManager();

      await waitFor(() => {
        expect(screen.getByText('No hay templates disponibles.')).toBeDefined();
      });
    });

    it('muestra error alert cuando fetchAll falla', async () => {
      mockFetchAll.mockResolvedValue({ data: [], total: 0, error: 'Database error' });

      renderManager();

      await waitFor(() => {
        expect(screen.getByText('Database error')).toBeDefined();
      });
    });

    it('llama a fetchAll al montar el componente', async () => {
      renderManager();

      await waitFor(() => {
        expect(mockFetchAll).toHaveBeenCalledTimes(1);
      });

      expect(mockFetchAll).toHaveBeenCalledWith({
        search: undefined,
        page: 1,
        pageSize: 10,
      });
    });

    it('muestra version chip y estado chip por cada fila', async () => {
      const templates = [makeTemplate({ version: 3, is_active: true })];
      mockFetchAll.mockResolvedValue({ data: templates, total: 1, error: null });

      renderManager();

      await waitFor(() => {
        expect(screen.getByText('v3')).toBeDefined();
        expect(screen.getByText('Activo')).toBeDefined();
      });
    });
  });

  // ───── 2. Búsqueda ─────
  describe('búsqueda', () => {
    it('renderiza campo de búsqueda', async () => {
      renderManager();

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Buscar por código o nombre...')).toBeDefined();
      });
    });
  });

  // ───── 3. Paginación ─────
  describe('paginación', () => {
    it('renderiza TablePagination con total correcto', async () => {
      mockFetchAll.mockResolvedValue({
        data: makeTemplates(10),
        total: 25,
        error: null,
      });

      renderManager();

      await waitFor(() => {
        expect(screen.getByText(/1.*10.*de.*25/)).toBeDefined();
      });
    });
  });

  // ───── 4. Acciones: Editar ─────
  describe('acción Editar', () => {
    it('llama onEdit con el template al hacer clic en Editar', async () => {
      const onEdit = vi.fn();
      const templates = [makeTemplate({ code: 'ot-default', is_active: true })];
      mockFetchAll.mockResolvedValue({ data: templates, total: 1, error: null });

      renderManager(onEdit);

      await waitFor(() => {
        expect(screen.getByText('ot-default')).toBeDefined();
      });

      const editButton = screen.getByLabelText('Editar template');
      await userEvent.setup().click(editButton);

      await waitFor(() => {
        expect(onEdit).toHaveBeenCalled();
      });
    });
  });

  // ───── 5. Acción: Duplicar ─────
  describe('acción Duplicar', () => {
    it('llama duplicate al hacer clic en Duplicar', async () => {
      const templates = [makeTemplate({ code: 'ot-default' })];
      mockFetchAll.mockResolvedValue({ data: templates, total: 1, error: null });

      renderManager();

      await waitFor(() => {
        expect(screen.getByText('ot-default')).toBeDefined();
      });

      const duplicateButton = screen.getByLabelText('Duplicar template');
      await userEvent.setup().click(duplicateButton);

      await waitFor(() => {
        expect(mockDuplicate).toHaveBeenCalled();
      });
    });

    it('recarga la lista después de duplicar exitosamente', async () => {
      const templates = [makeTemplate({ code: 'ot-default' })];
      mockFetchAll.mockResolvedValue({ data: templates, total: 1, error: null });
      mockDuplicate.mockResolvedValue({
        data: makeTemplate({ id: 'new-copy', code: 'ot-default (copy)', version: 1 }),
        error: null,
      });

      renderManager();

      await waitFor(() => {
        expect(screen.getByText('ot-default')).toBeDefined();
      });

      mockFetchAll.mockClear();

      const duplicateButton = screen.getByLabelText('Duplicar template');
      await userEvent.setup().click(duplicateButton);

      await waitFor(() => {
        expect(mockFetchAll).toHaveBeenCalled();
      });
    });

    it('muestra error si duplicate falla', async () => {
      const templates = [makeTemplate({ code: 'ot-default' })];
      mockFetchAll.mockResolvedValue({ data: templates, total: 1, error: null });
      mockDuplicate.mockResolvedValue({ data: null, error: 'Error al duplicar' });

      renderManager();

      await waitFor(() => {
        expect(screen.getByText('ot-default')).toBeDefined();
      });

      const duplicateButton = screen.getByLabelText('Duplicar template');
      await userEvent.setup().click(duplicateButton);

      await waitFor(() => {
        expect(screen.getByText('Error al duplicar')).toBeDefined();
      });
    });
  });

  // ───── 6. Acción: Toggle Active ─────
  describe('acción Toggle Active', () => {
    it('llama toggleActive al cambiar el switch', async () => {
      const templates = [makeTemplate({ code: 'ot-default', is_active: true })];
      mockFetchAll.mockResolvedValue({ data: templates, total: 1, error: null });

      renderManager();

      await waitFor(() => {
        expect(screen.getByText('ot-default')).toBeDefined();
      });

      const switches = document.querySelectorAll('input[type="checkbox"]');
      expect(switches.length).toBeGreaterThan(0);
      await userEvent.setup().click(switches[0]);

      await waitFor(() => {
        expect(mockToggleActive).toHaveBeenCalled();
      });
    });
  });

  // ───── 7. Acción: Rollback ─────
  describe('acción Rollback', () => {
    it('muestra botón Rollback para version > 1', async () => {
      const templates = [makeTemplate({ code: 'ot-default', version: 3, is_active: true })];
      mockFetchAll.mockResolvedValue({ data: templates, total: 1, error: null });

      renderManager();

      await waitFor(() => {
        expect(screen.getByText('ot-default')).toBeDefined();
      });

      expect(screen.getByLabelText('Revertir template')).toBeDefined();
    });

    it('NO muestra botón Rollback para version 1', async () => {
      const templates = [makeTemplate({ code: 'ot-default', version: 1, is_active: true })];
      mockFetchAll.mockResolvedValue({ data: templates, total: 1, error: null });

      renderManager();

      await waitFor(() => {
        expect(screen.getByText('ot-default')).toBeDefined();
      });

      expect(screen.queryByLabelText('Revertir template')).toBeNull();
    });
  });
});
