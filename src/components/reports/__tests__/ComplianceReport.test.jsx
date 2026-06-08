/**
 * Tests for ComplianceReport — 3-section dashboard with MetricCards + MUI Tables.
 * Covers 4 states (loading, error, empty, success), partial errors, section empty states,
 * and data-widget-id attributes.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

// Mock Recharts (for consistency with other report tests)
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

import ComplianceReport from '../ComplianceReport';

const theme = createTheme();

function renderWithTheme(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
}

const defaultProps = {
  permits: [],
  lotoRecords: [],
  certs: [],
  loading: false,
  error: null,
  sectionErrors: { permits: null, loto: null, certs: null },
  onRetry: vi.fn(),
};

// ─── Mock Data ────────────────────────────────────────────────────

const mockPermits = [
  {
    id: 1,
    description: 'Corte y soldadura en línea 3',
    location: 'Planta A - Sección 3',
    expires_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    permit_status: 'ACTIVE',
  },
  {
    id: 2,
    description: 'Trabajo en altura tanque 7',
    location: 'Tanque 7 - Nivel 2',
    expires_at: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
    permit_status: 'ACTIVE',
  },
  {
    id: 3,
    description: 'Espacio confinado bomba 4',
    location: 'Sótano bomba 4',
    expires_at: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(),
    permit_status: 'ACTIVE',
  },
];

const mockLotoRecords = [
  {
    id: 1,
    asset_id: 'MOTOR-001',
    loto_status: 'LOCKED',
    locked_at: '2026-06-01T08:00:00Z',
  },
  {
    id: 2,
    asset_id: 'BOMBA-003',
    loto_status: 'VERIFIED',
    locked_at: '2026-06-02T10:30:00Z',
  },
];

const mockCerts = [
  {
    id: 1,
    technician_id: 't1',
    current_level: 3,
    user_profiles: { full_name: 'Carlos López' },
    technological_modules: { code: 'ELEC-01', name: 'Electricidad Industrial' },
  },
  {
    id: 2,
    technician_id: 't1',
    current_level: 2,
    user_profiles: { full_name: 'Carlos López' },
    technological_modules: { code: 'MEC-02', name: 'Mecánica de Precisión' },
  },
  {
    id: 3,
    technician_id: 't2',
    current_level: 1,
    user_profiles: { full_name: 'Ana García' },
    technological_modules: { code: 'ELEC-01', name: 'Electricidad Industrial' },
  },
];

// ─── Tests ────────────────────────────────────────────────────────

describe('ComplianceReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // ───── 1. Loading state ─────
  it('muestra spinner cuando loading=true', () => {
    renderWithTheme(<ComplianceReport {...defaultProps} loading={true} />);

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.getByText('Cargando informe de cumplimiento…')).toBeInTheDocument();
  });

  // ───── 2. Error state (ALL sections fail) ─────
  it('muestra alerta con error global y botón reintentar', () => {
    const onRetry = vi.fn();
    renderWithTheme(
      <ComplianceReport
        {...defaultProps}
        error="No se pudieron cargar los datos de cumplimiento"
        onRetry={onRetry}
      />
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/No se pudieron cargar los datos de cumplimiento/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reintentar/i })).toBeInTheDocument();
  });

  // ───── 3. Empty state (all sections empty) ─────
  it('muestra mensaje vacío cuando no hay datos en ninguna sección', () => {
    renderWithTheme(<ComplianceReport {...defaultProps} />);

    expect(
      screen.getByText('No se encontraron datos de cumplimiento en el período seleccionado')
    ).toBeInTheDocument();
  });

  // ───── 4. Success state with all sections populated ─────
  it('renderiza metric cards y tablas cuando hay datos en todas las secciones', () => {
    renderWithTheme(
      <ComplianceReport
        {...defaultProps}
        permits={mockPermits}
        lotoRecords={mockLotoRecords}
        certs={mockCerts}
      />
    );

    // Section headings
    expect(screen.getByText('Permisos de Trabajo')).toBeInTheDocument();
    expect(screen.getByText('Bloqueos LOTO')).toBeInTheDocument();
    expect(screen.getByText('Certificaciones de Técnicos')).toBeInTheDocument();

    // Metric cards
    expect(screen.getByText('Permisos por vencer')).toBeInTheDocument();
    expect(screen.getByText('Bloqueos activos')).toBeInTheDocument();
    expect(screen.getByText('Técnicos certificados')).toBeInTheDocument();

    // Metric values: 2 permits expiring, 2 LOTO records, 2 distinct techs
    // "2" appears across MetricCards and the level table cell — verify count
    const twos = screen.getAllByText('2');
    expect(twos.length).toBeGreaterThanOrEqual(3);

    // Permit table data
    expect(screen.getByText('Corte y soldadura en línea 3')).toBeInTheDocument();
    expect(screen.getByText('Trabajo en altura tanque 7')).toBeInTheDocument();
    expect(screen.getByText('Espacio confinado bomba 4')).toBeInTheDocument();

    // LOTO table data
    expect(screen.getByText('MOTOR-001')).toBeInTheDocument();
    expect(screen.getByText('BOMBA-003')).toBeInTheDocument();
    expect(screen.getByText('LOCKED')).toBeInTheDocument();
    expect(screen.getByText('VERIFIED')).toBeInTheDocument();

    // Certs table data (Carlos appears in 2 rows, ELEC-01 in 2 rows)
    expect(screen.getAllByText('Carlos López').length).toBe(2);
    expect(screen.getByText('Ana García')).toBeInTheDocument();
    expect(screen.getAllByText('ELEC-01').length).toBe(2);
    expect(screen.getByText('MEC-02')).toBeInTheDocument();
    expect(screen.getAllByText('Electricidad Industrial').length).toBe(2);
    expect(screen.getByText('Mecánica de Precisión')).toBeInTheDocument();
  });

  // ───── 5. Partial error (one section fails inline) ─────
  it('muestra alerta inline en sección con error sin bloquear las demás', () => {
    renderWithTheme(
      <ComplianceReport
        {...defaultProps}
        permits={mockPermits}
        lotoRecords={[]}
        certs={mockCerts}
        sectionErrors={{
          permits: null,
          loto: 'Error al cargar bloqueos LOTO',
          certs: null,
        }}
      />
    );

    // Permits section should render normally
    expect(screen.getByText('Permisos de Trabajo')).toBeInTheDocument();
    expect(screen.getByText('Corte y soldadura en línea 3')).toBeInTheDocument();

    // LOTO section should show inline alert
    expect(screen.getByText('Error al cargar bloqueos LOTO')).toBeInTheDocument();

    // Certs section should render normally
    expect(screen.getByText('Certificaciones de Técnicos')).toBeInTheDocument();
    expect(screen.getAllByText('Carlos López').length).toBeGreaterThanOrEqual(1);
  });

  // ───── 6. Section empty state (one section empty, others have data) ─────
  it('muestra mensaje de sección vacía para LOTO cuando no hay datos pero otras secciones sí', () => {
    renderWithTheme(
      <ComplianceReport
        {...defaultProps}
        permits={mockPermits}
        lotoRecords={[]}
        certs={mockCerts}
      />
    );

    // Permits and certs should show data
    expect(screen.getByText('Corte y soldadura en línea 3')).toBeInTheDocument();
    expect(screen.getAllByText('Carlos López').length).toBeGreaterThanOrEqual(1);

    // LOTO section should show empty message
    expect(screen.getByText('No se encontraron bloqueos LOTO activos')).toBeInTheDocument();
  });

  // ───── 7. data-widget-id attributes ─────
  it('tiene data-widget-id en cada contenedor de sección', () => {
    renderWithTheme(
      <ComplianceReport
        {...defaultProps}
        permits={mockPermits}
        lotoRecords={mockLotoRecords}
        certs={mockCerts}
      />
    );

    expect(document.querySelector('[data-widget-id="compliance-permits"]')).toBeInTheDocument();
    expect(document.querySelector('[data-widget-id="compliance-loto"]')).toBeInTheDocument();
    expect(document.querySelector('[data-widget-id="compliance-certs"]')).toBeInTheDocument();
  });

  // ───── 8. Metric cards show 0 when section has no data ─────
  it('muestra 0 en metric cards cuando no hay datos en una sección', () => {
    renderWithTheme(
      <ComplianceReport
        {...defaultProps}
        permits={[]}
        lotoRecords={mockLotoRecords}
        certs={[]}
      />
    );

    // Permits section: 0 expiring
    const zeroValues = screen.getAllByText('0');
    expect(zeroValues.length).toBeGreaterThanOrEqual(1);
  });

  // ───── 9. Muestra "--" cuando no hay onRetry ─────
  it('no muestra botón reintentar cuando onRetry no está definido', () => {
    renderWithTheme(
      <ComplianceReport
        {...defaultProps}
        error="Error de prueba"
        onRetry={undefined}
      />
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reintentar/i })).not.toBeInTheDocument();
  });
});
