/**
 * Tests para ScheduleManagementPanel — panel de administración de schedules.
 *
 * Mockea:
 * - useReportSchedules hook completo
 *
 * Cubre:
 * - Load: skeleton mientras loading
 * - Error: Alert con retry
 * - Empty: mensaje sin schedules + CTA
 * - List: tabla con datos
 * - Create dialog: apertura, llenado de campos, submit
 * - Delete confirmation: apertura, confirmar, cancelar
 * - Toggle active: Switch actualiza estado
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ═══════════════════════════════════════════════════════════════════
// Mocks hoisteados
// ═══════════════════════════════════════════════════════════════════
const { mockUseReportSchedules } = vi.hoisted(() => {
  return { mockUseReportSchedules: vi.fn() };
});

vi.mock('../../../hooks/useReportSchedules', () => ({
  default: () => mockUseReportSchedules(),
  useReportSchedules: () => mockUseReportSchedules(),
}));

import ScheduleManagementPanel from '../ScheduleManagementPanel';

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function createSchedule(overrides = {}) {
  return {
    id: overrides.id || 'sched-001',
    name: overrides.name || 'Reporte Diario',
    template_code: overrides.template_code || 'ot-default',
    cron_expression: overrides.cron_expression || '0 9 * * *',
    recipients: overrides.recipients || ['admin@planta.com'],
    subject: overrides.subject || 'Reporte Diario',
    params: overrides.params || {},
    is_active: overrides.is_active ?? true,
    last_run_at: overrides.last_run_at || null,
    next_run_at: overrides.next_run_at || '2026-06-06T09:00:00Z',
    created_at: overrides.created_at || '2026-06-05T10:00:00Z',
    updated_at: overrides.updated_at || null,
  };
}

function createMockHook(overrides = {}) {
  return {
    schedules: overrides.schedules || [],
    loading: overrides.loading ?? false,
    error: overrides.error || null,
    fetchSchedules: vi.fn().mockResolvedValue(),
    createSchedule: vi.fn().mockResolvedValue(),
    updateSchedule: vi.fn().mockResolvedValue(),
    deleteSchedule: vi.fn().mockResolvedValue(),
    toggleActive: vi.fn().mockResolvedValue(),
    ...overrides,
  };
}

function renderPanel(hookOverrides = {}) {
  const mockHook = createMockHook(hookOverrides);
  mockUseReportSchedules.mockReturnValue(mockHook);
  const utils = render(<ScheduleManagementPanel />);
  return { ...utils, mockHook };
}

describe('ScheduleManagementPanel', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────
  // Loading state
  // ─────────────────────────────────────────────
  describe('loading state', () => {
    it('muestra CircularProgress mientras loading es true', () => {
      renderPanel({ loading: true, schedules: [] });

      const circularProgress = document.querySelector('.MuiCircularProgress-root');
      expect(circularProgress).toBeTruthy();
    });

    it('NO muestra tabla ni botones mientras loading', () => {
      renderPanel({ loading: true, schedules: [] });

      expect(screen.queryByText('Reportes Programados')).toBeNull();
      expect(screen.queryByText(/Nuevo Schedule/)).toBeNull();
    });
  });

  // ─────────────────────────────────────────────
  // Error state
  // ─────────────────────────────────────────────
  describe('error state', () => {
    it('muestra Alert con mensaje de error', () => {
      renderPanel({ error: 'Error de conexión a la base de datos' });

      expect(screen.getByText(/Error al cargar schedules/)).toBeTruthy();
      expect(screen.getByText(/Error de conexión a la base de datos/)).toBeTruthy();
    });

    it('llama fetchSchedules al hacer clic en retry', async () => {
      const mockFetch = vi.fn().mockResolvedValue();
      renderPanel({
        error: 'Error de conexión',
        fetchSchedules: mockFetch,
      });

      const retryButton = screen.getByRole('button', { name: /Reintentar/i });
      expect(retryButton).toBeTruthy();

      fireEvent.click(retryButton);
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────
  // Empty state
  // ─────────────────────────────────────────────
  describe('empty state', () => {
    it('muestra mensaje vacío cuando no hay schedules', () => {
      renderPanel({ schedules: [] });

      expect(screen.getByText(/No hay schedules configurados/)).toBeTruthy();
    });

    it('muestra botón para crear primer schedule', () => {
      renderPanel({ schedules: [] });

      expect(screen.getByText(/Crear primer schedule/)).toBeTruthy();
    });
  });

  // ─────────────────────────────────────────────
  // List state — con datos
  // ─────────────────────────────────────────────
  describe('list view', () => {
    it('renderiza tabla con schedules', () => {
      const schedules = [
        createSchedule({ id: 'sched-001', name: 'Reporte Diario' }),
        createSchedule({ id: 'sched-002', name: 'Reporte Semanal' }),
      ];
      renderPanel({ schedules });

      expect(screen.getByText('Reporte Diario')).toBeTruthy();
      expect(screen.getByText('Reporte Semanal')).toBeTruthy();
    });

    it('muestra columnas de la tabla', () => {
      const schedules = [createSchedule()];
      renderPanel({ schedules });

      expect(screen.getByText('Nombre')).toBeTruthy();
      expect(screen.getByText('Template')).toBeTruthy();
      expect(screen.getByText('Cron')).toBeTruthy();
      expect(screen.getByText('Activo')).toBeTruthy();
    });

    it('renderiza Switch para is_active', () => {
      const schedules = [createSchedule({ is_active: true })];
      renderPanel({ schedules });

      const switches = document.querySelectorAll('.MuiSwitch-root');
      expect(switches.length).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────
  // Toggle active
  // ─────────────────────────────────────────────
  describe('toggle active', () => {
    it('llama toggleActive al cambiar Switch', async () => {
      const mockToggle = vi.fn().mockResolvedValue();
      const schedules = [createSchedule({ id: 'sched-001', is_active: true })];
      renderPanel({ schedules, toggleActive: mockToggle });

      const switches = document.querySelectorAll('.MuiSwitch-root input[type="checkbox"]');
      expect(switches.length).toBeGreaterThan(0);

      fireEvent.click(switches[0]);
      expect(mockToggle).toHaveBeenCalledWith('sched-001', false);
    });
  });

  // ─────────────────────────────────────────────
  // Create dialog
  // ─────────────────────────────────────────────
  describe('create dialog', () => {
    it('abre el diálogo al hacer clic en Nuevo Schedule', async () => {
      renderPanel({ schedules: [] });

      const createBtn = screen.getByText(/Nuevo Schedule/);
      fireEvent.click(createBtn);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeTruthy();
      });
    });

    it('contiene campos del formulario en el diálogo', async () => {
      renderPanel({ schedules: [] });

      fireEvent.click(screen.getByText(/Nuevo Schedule/));

      await waitFor(() => {
        expect(screen.getByLabelText(/Nombre/i)).toBeTruthy();
        expect(screen.getByLabelText(/Expresión Cron/i)).toBeTruthy();
        expect(screen.getByLabelText(/Destinatarios/i)).toBeTruthy();
        expect(screen.getByLabelText(/Asunto/i)).toBeTruthy();
      });
    });

    it('llama createSchedule al hacer submit con datos válidos', async () => {
      const mockCreate = vi.fn().mockResolvedValue();
      renderPanel({ schedules: [], createSchedule: mockCreate });

      fireEvent.click(screen.getByText(/Nuevo Schedule/));

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeTruthy();
      });

      const nameInput = screen.getByLabelText(/Nombre/i);
      fireEvent.change(nameInput, { target: { value: 'Test Schedule' } });

      const templateInput = screen.getByLabelText(/Template/i);
      fireEvent.change(templateInput, { target: { value: 'ot-default' } });

      const cronInput = screen.getByLabelText(/Expresión Cron/i);
      fireEvent.change(cronInput, { target: { value: '0 9 * * *' } });

      const recipientsInput = screen.getByLabelText(/Destinatarios/i);
      fireEvent.change(recipientsInput, { target: { value: 'admin@test.com' } });

      const subjectInput = screen.getByLabelText(/Asunto/i);
      fireEvent.change(subjectInput, { target: { value: 'Test Subject' } });

      const createButton = screen.getByText('Crear');
      fireEvent.click(createButton);

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalled();
      });
    });
  });

  // ─────────────────────────────────────────────
  // Delete confirmation
  // ─────────────────────────────────────────────
  describe('delete confirmation', () => {
    it('abre diálogo de confirmación al hacer clic en eliminar', async () => {
      const schedules = [createSchedule({ id: 'sched-001' })];
      renderPanel({ schedules });

      const deleteBtn = screen.getByRole('button', { name: /eliminar/i });
      fireEvent.click(deleteBtn);

      await waitFor(() => {
        expect(screen.getByText(/¿Estás seguro/i)).toBeTruthy();
      });
    });

    it('llama deleteSchedule al confirmar eliminación', async () => {
      const mockDelete = vi.fn().mockResolvedValue();
      const schedules = [createSchedule({ id: 'sched-001' })];
      renderPanel({ schedules, deleteSchedule: mockDelete });

      fireEvent.click(screen.getByRole('button', { name: /eliminar/i }));

      await waitFor(() => {
        expect(screen.getByText(/¿Estás seguro/i)).toBeTruthy();
      });

      const confirmBtn = screen.getByRole('button', { name: /Eliminar/i });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(mockDelete).toHaveBeenCalledWith('sched-001');
      });
    });
  });

  // ─────────────────────────────────────────────
  // Refresh
  // ─────────────────────────────────────────────
  describe('refresh', () => {
    it('llama fetchSchedules al hacer clic en Actualizar', () => {
      const mockFetch = vi.fn().mockResolvedValue();
      const schedules = [createSchedule()];
      renderPanel({ schedules, fetchSchedules: mockFetch });

      const refreshBtn = screen.getByRole('button', { name: /actualizar/i });
      fireEvent.click(refreshBtn);
      expect(mockFetch).toHaveBeenCalled();
    });

    it('llama fetchSchedules al montar el componente', () => {
      const mockFetch = vi.fn().mockResolvedValue();
      renderPanel({ schedules: [], fetchSchedules: mockFetch, loading: false });

      expect(mockFetch).toHaveBeenCalled();
    });
  });
});
