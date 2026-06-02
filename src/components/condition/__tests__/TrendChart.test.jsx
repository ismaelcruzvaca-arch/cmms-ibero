/**
 * Tests para TrendChart — renderizado y estados
 *
 * Cubre:
 *  - Renderizado con datos: bandas de baseline, línea de feature, eventos
 *  - Estado sin baseline: "Sin línea base disponible"
 *  - Estado sin datos: "Sin datos de condición para este activo"
 *  - Estado loading: "Cargando tendencias…"
 *  - Estado error
 *  - HI mode (featureKey=null)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// ─── Mock useFeatureTrends ─────────────────────────────────────
const { mockUseFeatureTrends } = vi.hoisted(() => {
  return { mockUseFeatureTrends: vi.fn() };
});

vi.mock('../../../hooks/useFeatureTrends', () => ({
  default: (...args) => mockUseFeatureTrends(...args),
  useFeatureTrends: (...args) => mockUseFeatureTrends(...args),
}));

// ─── Componente bajo test ──────────────────────────────────────
import TrendChart from '../charts/TrendChart';

// ─── Data factory ───────────────────────────────────────────────
function createMockData(overrides = {}) {
  return {
    hiData: [],
    featureData: [],
    baseline: null,
    events: [],
    isLoading: false,
    error: null,
    refresh: vi.fn(),
    ...overrides,
  };
}

describe('TrendChart', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ═══════════════════════════════════════
  // Estados de carga
  // ═══════════════════════════════════════

  it('muestra "Cargando tendencias…" mientras isLoading es true', () => {
    mockUseFeatureTrends.mockReturnValue(createMockData({ isLoading: true }));
    render(<TrendChart assetId="ASSET-001" />);

    expect(screen.getByText('Cargando tendencias…')).toBeTruthy();
  });

  it('muestra mensaje de error cuando hay error', () => {
    mockUseFeatureTrends.mockReturnValue(
      createMockData({ error: 'Error de conexión' })
    );
    render(<TrendChart assetId="ASSET-001" />);

    expect(screen.getByText(/Error de conexión/)).toBeTruthy();
  });

  // ═══════════════════════════════════════
  // Estados vacíos
  // ═══════════════════════════════════════

  it('muestra "Sin datos de condición" cuando no hay data', () => {
    mockUseFeatureTrends.mockReturnValue(createMockData());
    render(<TrendChart assetId="ASSET-001" />);

    expect(screen.getByText('Sin datos de condición para este activo')).toBeTruthy();
  });

  it('muestra "Sin línea base disponible" cuando hay featureData pero no baseline', () => {
    mockUseFeatureTrends.mockReturnValue(
      createMockData({
        featureData: [
          {
            timestamp: '2026-06-01T10:00:00Z',
            value: 2.5,
            quality_flag: 'G0',
            regime: 'FULL_LOAD',
          },
        ],
        baseline: null,
      })
    );
    render(<TrendChart assetId="ASSET-001" featureKey="vibration.rms" />);

    expect(screen.getByText('Sin línea base disponible')).toBeTruthy();
  });

  // ═══════════════════════════════════════
  // Renderizado con datos (feature mode)
  // ═══════════════════════════════════════

  it('renderiza título del feature cuando featureKey está presente', () => {
    mockUseFeatureTrends.mockReturnValue(
      createMockData({
        featureData: [
          {
            timestamp: '2026-06-01T10:00:00Z',
            value: 2.5,
            quality_flag: 'G0',
            regime: 'FULL_LOAD',
          },
        ],
        baseline: { mean: 2.3, stddev: 0.4, baseline_version: 2 },
      })
    );
    render(<TrendChart assetId="ASSET-001" featureKey="vibration.rms" />);

    expect(screen.getByText(/Tendencia: vibration\.rms/)).toBeTruthy();
  });

  it('renderiza "Índice de Salud (HI)" cuando featureKey es null', () => {
    mockUseFeatureTrends.mockReturnValue(
      createMockData({
        hiData: [
          { result_value: 85.5, window_end: '2026-06-01T10:00:00Z' },
        ],
      })
    );
    render(<TrendChart assetId="ASSET-001" featureKey={null} />);

    expect(screen.getByText('Índice de Salud (HI)')).toBeTruthy();
  });

  it('renderiza el selector de rango de fechas', () => {
    mockUseFeatureTrends.mockReturnValue(
      createMockData({
        featureData: [
          { timestamp: '2026-06-01T10:00:00Z', value: 2.5, quality_flag: 'G0' },
        ],
      })
    );
    render(<TrendChart assetId="ASSET-001" featureKey="vibration.rms" />);

    const buttons = screen.getAllByRole('button');
    const labels = buttons.map((b) => b.textContent);
    expect(labels).toContain('7d');
    expect(labels).toContain('30d');
    expect(labels).toContain('90d');
  });

  it('renderiza el contenedor del chart cuando hay featureData', () => {
    mockUseFeatureTrends.mockReturnValue(
      createMockData({
        featureData: Array.from({ length: 5 }, (_, i) => ({
          timestamp: new Date(2026, 5, 1 + i).toISOString(),
          value: 2.0 + Math.random() * 0.5,
          quality_flag: 'G0',
          regime: 'FULL_LOAD',
        })),
        baseline: { mean: 2.3, stddev: 0.4, baseline_version: 2 },
      })
    );
    const { container } = render(
      <TrendChart assetId="ASSET-001" featureKey="vibration.rms" />
    );

    const chartContainer = container.querySelector('.recharts-responsive-container');
    expect(chartContainer).toBeTruthy();
  });

  it('renderiza marcadores de eventos cuando hay eventos', () => {
    mockUseFeatureTrends.mockReturnValue(
      createMockData({
        featureData: [
          {
            timestamp: '2026-06-01T10:00:00Z',
            value: 3.5,
            quality_flag: 'G2',
            regime: 'FULL_LOAD',
          },
        ],
        baseline: { mean: 2.3, stddev: 0.4, baseline_version: 1 },
        events: [
          {
            id: 'ev-1',
            created_at: '2026-06-01T12:00:00Z',
            severity: 'warning',
            message: '{"feature_key":"vibration.rms"}',
          },
        ],
      })
    );
    const { container } = render(
      <TrendChart assetId="ASSET-001" featureKey="vibration.rms" />
    );

    const chartContainer = container.querySelector('.recharts-responsive-container');
    expect(chartContainer).toBeTruthy();
  });

  // ═══════════════════════════════════════
  // Modo HI
  // ═══════════════════════════════════════

  it('renderiza en modo HI con health_index data', () => {
    mockUseFeatureTrends.mockReturnValue(
      createMockData({
        hiData: Array.from({ length: 10 }, (_, i) => ({
          result_value: 80 + Math.random() * 20,
          window_end: new Date(2026, 5, 1 + i).toISOString(),
        })),
      })
    );
    const { container } = render(<TrendChart assetId="ASSET-001" />);

    const chartContainer = container.querySelector('.recharts-responsive-container');
    expect(chartContainer).toBeTruthy();
  });

  // ═══════════════════════════════════════
  // Sin assetId
  // ═══════════════════════════════════════

  it('muestra "Sin datos" cuando assetId es null', () => {
    mockUseFeatureTrends.mockReturnValue(createMockData());
    render(<TrendChart assetId={null} />);

    expect(screen.getByText('Sin datos de condición para este activo')).toBeTruthy();
  });
});
