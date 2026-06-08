/**
 * Tests for KpiDashboardReport — MetricCards + BarChart + LineChart with 4 states.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

// Mock Recharts
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }) => <div data-testid="responsive-container">{children}</div>,
  BarChart: ({ children }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => <div data-testid="bar" />,
  LineChart: ({ children }) => <div data-testid="line-chart">{children}</div>,
  Line: () => <div data-testid="line" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  Legend: () => <div data-testid="legend" />,
}));

import KpiDashboardReport from '../KpiDashboardReport';

const theme = createTheme();

function renderWithTheme(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
}

const defaultProps = {
  current: { mtbfHours: null, mttrHours: null, availabilityPct: null, totalWos: 0 },
  monthly: [],
  loading: false,
  error: null,
  onRetry: vi.fn(),
};

describe('KpiDashboardReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ───── 1. Loading state ─────
  it('muestra spinner cuando loading=true', () => {
    renderWithTheme(<KpiDashboardReport {...defaultProps} loading={true} />);

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.getByText('Cargando informe…')).toBeInTheDocument();
  });

  // ───── 2. Error state ─────
  it('muestra alerta con error y botón reintentar', () => {
    const onRetry = vi.fn();
    renderWithTheme(
      <KpiDashboardReport {...defaultProps} error="Permission denied" onRetry={onRetry} />
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Permission denied/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reintentar/i })).toBeInTheDocument();
  });

  // ───── 3. Insufficient data state ─────
  it('muestra mensaje de datos insuficientes cuando no hay KPIs', () => {
    renderWithTheme(<KpiDashboardReport {...defaultProps} />);

    expect(screen.getByText('Datos insuficientes para calcular KPI')).toBeInTheDocument();
  });

  // ───── 4. Success state with data ─────
  it('renderiza metric cards y charts cuando hay datos', () => {
    renderWithTheme(
      <KpiDashboardReport
        {...defaultProps}
        current={{
          mtbfHours: 45.2,
          mttrHours: 3.5,
          availabilityPct: 97.8,
          totalWos: 10,
        }}
        monthly={[
          { periodMonth: '2026-01-01', mtbfHours: 45.2, mttrHours: 3.5, availabilityPct: 97.8, woCount: 5 },
          { periodMonth: '2026-02-01', mtbfHours: 32.1, mttrHours: 4.2, availabilityPct: 95.3, woCount: 5 },
        ]}
      />
    );

    // Metric cards should show values
    expect(screen.getByText('MTBF')).toBeInTheDocument();
    expect(screen.getByText('MTTR')).toBeInTheDocument();
    expect(screen.getByText('Disponibilidad')).toBeInTheDocument();

    // Chart should render
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
  });

  // ───── 5. Muestra "--" cuando no hay valor ─────
  it('muestra "--" en metric cards cuando current es null pero hay monthly', () => {
    renderWithTheme(
      <KpiDashboardReport
        {...defaultProps}
        current={{ mtbfHours: null, mttrHours: null, availabilityPct: null, totalWos: 0 }}
        monthly={[{ periodMonth: '2026-01-01', mtbfHours: null, mttrHours: null, availabilityPct: null, woCount: 0 }]}
      />
    );

    // Should show "--" for each metric
    const dashes = screen.getAllByText('--');
    expect(dashes.length).toBeGreaterThanOrEqual(3);
  });
});
