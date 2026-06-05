/**
 * Tests para RecommendationList — tabla de recomendaciones
 *
 * Cubre:
 *  - Renderizado de tabla con headers
 *  - Estado vacío (con y sin filtros activos)
 *  - Chips de prioridad correctos
 *  - Estado loading con skeleton
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// ─── Mock useRecommendationList ─────────────────────────────────
const { mockUseRecommendationList } = vi.hoisted(() => {
  return { mockUseRecommendationList: vi.fn() };
});

vi.mock('../../../hooks/useRecommendationList', () => ({
  default: (...args) => mockUseRecommendationList(...args),
  useRecommendationList: (...args) => mockUseRecommendationList(...args),
}));

import RecommendationList from '../RecommendationList';

// ─── Helpers ────────────────────────────────────────────────────
function createMockData(overrides = {}) {
  return {
    recommendations: [],
    loading: false,
    error: null,
    filter: { status: ['suggested', 'review_required'], priority: null, assetId: null },
    setFilter: vi.fn(),
    approveRec: vi.fn(),
    dismissRec: vi.fn(),
    supersedeRec: vi.fn(),
    convertToWO: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  };
}

function makeRec(overrides = {}) {
  return {
    id: 'rec-001',
    asset_id: 'ASSET-001',
    diagnosis_id: 'diag-001',
    recommended_action: 'Inspeccionar bomba centrífuga por posible cavitación',
    priority: 'critical',
    due_window_days: 7,
    work_order_type: 'CBM',
    requires_confirmation: true,
    status: 'suggested',
    created_at: '2026-06-01T10:00:00Z',
    failure_mode_key: 'pump.cavitation',
    failure_mode_name: 'Cavitación de Bomba',
    diagnosis_confidence: 0.85,
    diagnosis_status: 'active',
    ...overrides,
  };
}

describe('RecommendationList', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renderiza headers de tabla cuando hay recomendaciones', () => {
    const recs = [makeRec()];
    mockUseRecommendationList.mockReturnValue(
      createMockData({ recommendations: recs })
    );
    render(<RecommendationList />);

    expect(screen.getByText('Modo de Falla')).toBeTruthy();
    expect(screen.getByText('Acción Recomendada')).toBeTruthy();
    expect(screen.getByText('Ventana (días)')).toBeTruthy();
    expect(screen.getByText('Creado')).toBeTruthy();
    expect(screen.getByText('Acciones')).toBeTruthy();

    // Some headers ("Estado", "Prioridad") appear both as Select labels and table headers
    const estadoElements = screen.getAllByText('Estado');
    expect(estadoElements.length).toBeGreaterThanOrEqual(1);

    const prioridadElements = screen.getAllByText('Prioridad');
    expect(prioridadElements.length).toBeGreaterThanOrEqual(1);
  });

  it('muestra estado vacío cuando no hay recomendaciones (sin filtros activos)', () => {
    mockUseRecommendationList.mockReturnValue(
      createMockData({
        recommendations: [],
        filter: { status: null, priority: null, assetId: null },
      })
    );
    render(<RecommendationList />);

    // Default empty state: no active filters → "Sin recomendaciones pendientes"
    // But the filter logic: hasActiveFilters = filter.status || filter.priority
    // null || null = null → hasActiveFilters = false → "Sin recomendaciones pendientes"
    expect(screen.getByText('Sin recomendaciones pendientes')).toBeTruthy();
    expect(
      screen.getByText('No se detectaron recomendaciones de mantenimiento.')
    ).toBeTruthy();
  });

  it('muestra estado vacío cuando no hay recomendaciones con filtros activos', () => {
    mockUseRecommendationList.mockReturnValue(
      createMockData({
        recommendations: [],
        filter: { status: 'approved', priority: null, assetId: null },
      })
    );
    render(<RecommendationList />);

    expect(screen.getByText('Sin recomendaciones')).toBeTruthy();
    expect(
      screen.getByText('No hay recomendaciones que coincidan con los filtros actuales.')
    ).toBeTruthy();
  });

  it('renderiza chips de prioridad correctamente según nivel', () => {
    const recs = [
      makeRec({ id: 'rec-1', priority: 'critical', recommended_action: 'Acción crítica' }),
      makeRec({ id: 'rec-2', priority: 'high', recommended_action: 'Acción alta' }),
      makeRec({ id: 'rec-3', priority: 'medium', recommended_action: 'Acción media' }),
      makeRec({ id: 'rec-4', priority: 'low', recommended_action: 'Acción baja' }),
    ];
    mockUseRecommendationList.mockReturnValue(
      createMockData({ recommendations: recs })
    );
    render(<RecommendationList />);

    expect(screen.getByText('Crítica')).toBeTruthy();
    expect(screen.getByText('Alta')).toBeTruthy();
    expect(screen.getByText('Media')).toBeTruthy();
    expect(screen.getByText('Baja')).toBeTruthy();
  });

  it('muestra skeleton durante loading', () => {
    mockUseRecommendationList.mockReturnValue(createMockData({ loading: true }));
    render(<RecommendationList />);

    const skeletons = document.querySelectorAll('.MuiSkeleton-root');
    expect(skeletons.length).toBeGreaterThan(0);
  });
});
