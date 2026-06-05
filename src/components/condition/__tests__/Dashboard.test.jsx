/**
 * Tests para Dashboard — panel de métricas de monitoreo
 *
 * Cubre:
 *  - Componente exportado correctamente
 *  - Estado loading (skeleton)
 *  - Estado error
 *  - Estado sin datos
 *  - Cantidad correcta de skeletons durante carga
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// ─── Stub env vars + mock supabase ──────────────────────────────
const { mockUseDashboardMetrics } = vi.hoisted(() => {
  process.env.VITE_SUPABASE_URL = 'http://localhost:54321';
  process.env.VITE_SUPABASE_ANON_KEY = 'test-anon-key';
  return { mockUseDashboardMetrics: vi.fn() };
});

vi.mock('../../../hooks/useDashboardMetrics', () => ({
  default: (...args) => mockUseDashboardMetrics(...args),
  useDashboardMetrics: (...args) => mockUseDashboardMetrics(...args),
}));

import Dashboard from '../Dashboard';

// ─── Helpers ────────────────────────────────────────────────────
function createBaseMetrics() {
  return {
    criticalAssets: 0,
    openDiagnoses: 0,
    openDiagnosesByFM: [],
    topLowestRul: [],
    pendingRecs: 0,
    pendingRecsByPriority: [],
    sourcesQuality: [],
    staleSources: [],
    deadLetterCount: 0,
    feedbackPending: 0,
    cbmWoOpen: 0,
  };
}

describe('Dashboard', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('es un componente exportado como función', () => {
    expect(typeof Dashboard).toBe('function');
  });

  it('muestra skeleton tiles mientras loading es true', () => {
    mockUseDashboardMetrics.mockReturnValue({
      metrics: createBaseMetrics(),
      loading: true,
      error: null,
      refetch: vi.fn(),
    });
    render(<Dashboard />);

    const skeletons = document.querySelectorAll('.MuiSkeleton-root');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('muestra 9 grupos de skeletons durante loading', () => {
    mockUseDashboardMetrics.mockReturnValue({
      metrics: createBaseMetrics(),
      loading: true,
      error: null,
      refetch: vi.fn(),
    });
    render(<Dashboard />);

    // Verify 9 Grid items are rendered (each with skeleton)
    const gridItems = document.querySelectorAll('[class*="MuiGrid-grid"]');
    expect(gridItems.length).toBe(9);
  });

  it('muestra alerta de error cuando hay error', () => {
    mockUseDashboardMetrics.mockReturnValue({
      metrics: createBaseMetrics(),
      loading: false,
      error: 'Error de conexión a la base de datos',
      refetch: vi.fn(),
    });
    render(<Dashboard />);

    expect(screen.getByText(/Error al cargar métricas/)).toBeTruthy();
  });

  it('muestra mensaje sin datos cuando todas las métricas son 0', () => {
    mockUseDashboardMetrics.mockReturnValue({
      metrics: createBaseMetrics(),
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<Dashboard />);

    // Empty data state shows the no-data message
    expect(screen.getByText('No hay datos de monitoreo disponibles')).toBeTruthy();
  });
});
