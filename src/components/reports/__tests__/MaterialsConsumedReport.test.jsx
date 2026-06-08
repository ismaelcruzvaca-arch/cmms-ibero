/**
 * Tests for MaterialsConsumedReport — BarChart + MUI Table with 4 states.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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
}));

import MaterialsConsumedReport from '../MaterialsConsumedReport';

const theme = createTheme();

function renderWithTheme(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
}

const defaultProps = {
  records: [],
  loading: false,
  error: null,
  onRetry: vi.fn(),
};

const mockRecords = [
  {
    part_num: 'ROD-6205',
    description: 'Rodamiento 6205 2RS',
    uom: 'PZA',
    total_qty: 4,
    work_order_id: 'WO-001',
    wo_description: 'Cambio de rodamiento bomba',
    last_transaction_at: '2026-05-15T10:00:00Z',
  },
  {
    part_num: 'SELLO-MEC',
    description: 'Sello mecánico 25mm',
    uom: 'PZA',
    total_qty: 2,
    work_order_id: 'WO-001',
    wo_description: 'Cambio de rodamiento bomba',
    last_transaction_at: '2026-05-15T11:00:00Z',
  },
  {
    part_num: 'ROD-6205',
    description: 'Rodamiento 6205 2RS',
    uom: 'PZA',
    total_qty: 2,
    work_order_id: 'WO-003',
    wo_description: 'Mantenimiento preventivo bomba B',
    last_transaction_at: '2026-05-20T09:00:00Z',
  },
];

describe('MaterialsConsumedReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // ───── 1. Loading state ─────
  it('muestra spinner cuando loading=true', () => {
    renderWithTheme(<MaterialsConsumedReport {...defaultProps} loading={true} />);

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.getByText('Cargando informe…')).toBeInTheDocument();
  });

  // ───── 2. Error state ─────
  it('muestra alerta con error y botón reintentar', () => {
    const onRetry = vi.fn();
    renderWithTheme(
      <MaterialsConsumedReport {...defaultProps} error="Error de conexión" onRetry={onRetry} />
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Error de conexión/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reintentar/i })).toBeInTheDocument();
  });

  // ───── 3. Empty state ─────
  it('muestra mensaje vacío cuando no hay registros', () => {
    renderWithTheme(<MaterialsConsumedReport {...defaultProps} />);

    expect(
      screen.getByText('No se encontraron materiales consumidos en el período seleccionado')
    ).toBeInTheDocument();
  });

  // ───── 4. Success state with data ─────
  it('renderiza chart y tabla cuando hay datos', () => {
    renderWithTheme(
      <MaterialsConsumedReport {...defaultProps} records={mockRecords} />
    );

    // Chart area should be visible
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();

    // Table should show record data (ROD-6205 and WO-001 appear multiple times)
    expect(screen.getAllByText('ROD-6205').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('SELLO-MEC')).toBeInTheDocument();
    expect(screen.getAllByText('Rodamiento 6205 2RS').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Sello mecánico 25mm')).toBeInTheDocument();
    expect(screen.getAllByText('WO-001').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('WO-003')).toBeInTheDocument();
    expect(screen.getAllByText('Cambio de rodamiento bomba').length).toBeGreaterThanOrEqual(2);
  });

  // ───── 5. Muestra "--" cuando no hay valor ─────
  it('muestra "--" en celdas cuando faltan valores opcionales', () => {
    const recordsWithNulls = [
      {
        part_num: 'ROD-6205',
        description: null,
        uom: null,
        total_qty: null,
        work_order_id: 'WO-001',
        wo_description: null,
        last_transaction_at: null,
      },
    ];

    renderWithTheme(
      <MaterialsConsumedReport {...defaultProps} records={recordsWithNulls} />
    );

    // Should show "--" for missing values
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(3);
  });

  // ───── 6. Widget data attributes ─────
  it('tiene data-widget-id en contenedores de chart y tabla', () => {
    renderWithTheme(
      <MaterialsConsumedReport {...defaultProps} records={mockRecords} />
    );

    const chartWidgets = screen.getAllByTestId('bar-chart');
    expect(chartWidgets.length).toBeGreaterThan(0);
    const chartWidget = chartWidgets[0].closest('[data-widget-id="materials-chart"]');
    expect(chartWidget).toBeInTheDocument();

    // The table widget container should have the data attribute
    const tables = document.querySelectorAll('[data-widget-id="materials-table"]');
    expect(tables.length).toBe(1);
  });
});
