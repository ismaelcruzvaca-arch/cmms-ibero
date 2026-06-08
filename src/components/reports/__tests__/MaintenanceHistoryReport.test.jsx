/**
 * Tests for MaintenanceHistoryReport — BarChart + MUI Table with 4 states.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

// Mock Recharts since it needs SVG/Canvas
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }) => <div data-testid="responsive-container">{children}</div>,
  BarChart: ({ children }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => <div data-testid="bar" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  Legend: () => <div data-testid="legend" />,
  LabelList: () => <div data-testid="label-list" />,
}));

import MaintenanceHistoryReport from '../MaintenanceHistoryReport';

const theme = createTheme();

function renderWithTheme(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
}

const defaultProps = {
  wos: [],
  timeline: [],
  assetName: null,
  loading: false,
  error: null,
  onRetry: vi.fn(),
};

describe('MaintenanceHistoryReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ───── 1. Loading state ─────
  it('muestra spinner cuando loading=true', () => {
    renderWithTheme(<MaintenanceHistoryReport {...defaultProps} loading={true} />);

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.getByText('Cargando informe…')).toBeInTheDocument();
  });

  // ───── 2. Error state ─────
  it('muestra alerta con error y botón reintentar', () => {
    const onRetry = vi.fn();
    renderWithTheme(
      <MaintenanceHistoryReport {...defaultProps} error="Error de conexión" onRetry={onRetry} />
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Error de conexión/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reintentar/i })).toBeInTheDocument();
  });

  // ───── 3. Empty state ─────
  it('muestra mensaje vacío cuando no hay datos', () => {
    renderWithTheme(<MaintenanceHistoryReport {...defaultProps} />);

    expect(
      screen.getByText('No se encontraron órdenes para este activo en el período seleccionado')
    ).toBeInTheDocument();
  });

  // ───── 4. Success state with data ─────
  it('renderiza chart y tabla cuando hay datos', () => {
    const mockWos = [
      {
        id: 'wo-001',
        wo_type: 'CM',
        lifecycle_phase: 'COMP',
        description: 'Cambio de rodamiento',
        created_at: '2026-01-15T10:00:00Z',
        completed_at: '2026-01-16T14:00:00Z',
        problem_code: 'BRK',
        cause_code: 'WEA',
        remedy_code: 'REP',
        actual_hours: 4,
        assets: { name: 'Bomba' },
      },
    ];

    const mockTimeline = [
      { month: '2026-01', count: 1 },
    ];

    renderWithTheme(
      <MaintenanceHistoryReport
        {...defaultProps}
        wos={mockWos}
        timeline={mockTimeline}
        assetName="Bomba Centrífuga"
      />
    );

    // Chart area should be visible
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();

    // Table should show WO data
    expect(screen.getByText('wo-001')).toBeInTheDocument();
    expect(screen.getByText('Cambio de rodamiento')).toBeInTheDocument();
    expect(screen.getByText('COMP')).toBeInTheDocument();
    expect(screen.getByText(/Bomba Centrífuga/)).toBeInTheDocument();
  });

  // ───── 5. Widget data attributes ─────
  it('tiene data-widget-id en contenedores', () => {
    const mockWos = [
      {
        id: 'wo-001',
        wo_type: 'CM',
        lifecycle_phase: 'COMP',
        description: 'WO Test',
        created_at: '2026-01-15T10:00:00Z',
        actual_hours: 2,
      },
    ];

    renderWithTheme(
      <MaintenanceHistoryReport
        {...defaultProps}
        wos={mockWos}
        timeline={[{ month: '2026-01', count: 1 }]}
      />
    );

    const charts = screen.getAllByTestId('bar-chart');
    expect(charts.length).toBeGreaterThan(0);
    const chartWidget = charts[0].closest('[data-widget-id]');
    expect(chartWidget).toBeInTheDocument();
  });
});
