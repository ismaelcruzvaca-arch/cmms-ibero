/**
 * Tests for LaborHoursReport — BarChart + grouped MUI Table with 4 states.
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
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  Legend: () => <div data-testid="legend" />,
}));

import LaborHoursReport from '../LaborHoursReport';

const theme = createTheme();

function renderWithTheme(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
}

const defaultProps = {
  records: [],
  grandTotal: 0,
  loading: false,
  error: null,
  onRetry: vi.fn(),
};

describe('LaborHoursReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ───── 1. Loading state ─────
  it('muestra spinner cuando loading=true', () => {
    renderWithTheme(<LaborHoursReport {...defaultProps} loading={true} />);

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.getByText('Cargando informe…')).toBeInTheDocument();
  });

  // ───── 2. Error state ─────
  it('muestra alerta con error y botón reintentar', () => {
    const onRetry = vi.fn();
    renderWithTheme(
      <LaborHoursReport {...defaultProps} error="Error de conexión" onRetry={onRetry} />
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Error de conexión/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reintentar/i })).toBeInTheDocument();
  });

  // ───── 3. Empty state ─────
  it('muestra mensaje vacío cuando no hay registros', () => {
    renderWithTheme(<LaborHoursReport {...defaultProps} />);

    expect(
      screen.getByText('No hay registros de labor en el período seleccionado')
    ).toBeInTheDocument();
  });

  // ───── 4. Success state with data ─────
  it('renderiza chart y tabla cuando hay datos', () => {
    const mockRecords = [
      {
        technicianId: 'tech-001',
        technicianName: 'Carlos Pérez',
        activityBreakdown: { REP: 7, INS: 2 },
        totalHours: 9,
      },
      {
        technicianId: 'tech-002',
        technicianName: 'María Gómez',
        activityBreakdown: { REP: 5 },
        totalHours: 5,
      },
    ];

    renderWithTheme(
      <LaborHoursReport {...defaultProps} records={mockRecords} grandTotal={14} />
    );

    // Chart should render
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();

    // Technician names should be visible
    expect(screen.getByText('Carlos Pérez')).toBeInTheDocument();
    expect(screen.getByText('María Gómez')).toBeInTheDocument();

    // Total hours should be shown in the summary
    expect(screen.getByText(/Total de horas/)).toBeInTheDocument();
  });

  // ───── 5. Activity breakdown in table ─────
  it('muestra desglose por activity_code', () => {
    const mockRecords = [
      {
        technicianId: 'tech-001',
        technicianName: 'Carlos Pérez',
        activityBreakdown: { REP: 7, INS: 2 },
        totalHours: 9,
      },
    ];

    renderWithTheme(
      <LaborHoursReport {...defaultProps} records={mockRecords} grandTotal={9} />
    );

    // Activity codes appear in table headers
    const repCells = screen.getAllByText('REP');
    expect(repCells.length).toBeGreaterThanOrEqual(1);
    const insCells = screen.getAllByText('INS');
    expect(insCells.length).toBeGreaterThanOrEqual(1);
  });
});
