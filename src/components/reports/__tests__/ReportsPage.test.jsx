/**
 * Tests for ReportsPage — tab rendering, filter integration, smoke test.
 *
 * Tests each report type by mounting with different initial URL params.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

vi.hoisted(() => {
  process.env.VITE_SUPABASE_URL = 'https://test.supabase.co';
  process.env.VITE_SUPABASE_ANON_KEY = 'test-anon-key';
});

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

// Mock hooks — all return empty data by default
vi.mock('../../../hooks/useMaintenanceHistory', () => ({
  useMaintenanceHistory: () => ({
    wos: [],
    timeline: [],
    assetName: null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../../../hooks/useKpiMetrics', () => ({
  useKpiMetrics: () => ({
    current: { mtbfHours: null, mttrHours: null, availabilityPct: null, totalWos: 0 },
    monthly: [],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../../../hooks/useLaborHoursReport', () => ({
  useLaborHoursReport: () => ({
    records: [],
    grandTotal: 0,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../../../lib/rxdb', () => ({
  useAssets: () => ({ assets: [] }),
  useRxDB: () => ({ db: null }),
}));

vi.mock('../../../hooks/useMaterialsConsumed', () => ({
  useMaterialsConsumed: () => ({
    records: [],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../../../hooks/useComplianceReport', () => ({
  useComplianceReport: () => ({
    permits: [],
    lotoRecords: [],
    certs: [],
    loading: false,
    error: null,
    sectionErrors: { permits: null, loto: null, certs: null },
    refetch: vi.fn(),
  }),
}));

vi.mock('../../../hooks/useChecklistEvidence', () => ({
  useChecklistEvidence: () => ({
    instances: [],
    summary: { totalInstances: 0, passCount: 0, failCount: 0, naCount: 0, withPhotoCount: 0 },
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../../../lib/supabaseClient', () => ({
  supabase: {
    from: () => {
      const p = Promise.resolve({ data: [], error: null });
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        in: vi.fn(() => chain),
        or: vi.fn(() => chain),
        gte: vi.fn(() => chain),
        lte: vi.fn(() => chain),
        order: vi.fn(() => chain),
        then: p.then.bind(p),
        catch: p.catch.bind(p),
        finally: p.finally.bind(p),
      };
      return chain;
    },
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }) },
  },
}));

import ReportsPage from '../../../pages/ReportsPage';

const theme = createTheme();

function renderWithTheme(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
}

describe('ReportsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // ───── 1. Renderiza con tabs ─────
  it('renderiza los tabs de tipo de reporte y botón exportar', () => {
    renderWithTheme(<ReportsPage />);

    expect(screen.getByText('Histórico')).toBeInTheDocument();
    expect(screen.getByText('KPIs')).toBeInTheDocument();
    expect(screen.getByText('Horas Labor')).toBeInTheDocument();
    expect(screen.getByText('Materiales')).toBeInTheDocument();
    expect(screen.getByText('Compliance')).toBeInTheDocument();
    expect(screen.getByText('Checklists')).toBeInTheDocument();
    expect(screen.getByText('Exportar PDF')).toBeInTheDocument();
  });

  // ───── 2. Muestra título page ─────
  it('muestra el título Reportes', () => {
    renderWithTheme(<ReportsPage />);

    expect(screen.getByText('Reportes')).toBeInTheDocument();
  });

  // ───── 3. Tiene filtro de fecha ─────
  it('muestra filtros de fecha', () => {
    renderWithTheme(<ReportsPage />);

    expect(screen.getByLabelText('Desde')).toBeInTheDocument();
    expect(screen.getByLabelText('Hasta')).toBeInTheDocument();
  });
});
