/**
 * Tests para WorkOrderDrawer — verifica que PdfEmailButton se renderice
 * junto a PdfDownloadButton cuando lifecyclePhase es COMP o CLOSED.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// ═══════════════════════════════════════════════════════════════════
// Mocks hoisteados
// ═══════════════════════════════════════════════════════════════════
const { mockSupabase } = vi.hoisted(() => {
  process.env.VITE_SUPABASE_URL = 'https://test.supabase.co';
  process.env.VITE_SUPABASE_ANON_KEY = 'test-anon-key';

  return {
    mockSupabase: {
      auth: { getSession: vi.fn() },
      from: vi.fn(),
      storage: { from: vi.fn() },
    },
  };
});

vi.mock('../../lib/supabaseClient', () => ({
  supabase: mockSupabase,
}));

vi.mock('../../lib/rxdb.js', () => ({
  initRxDB: () => Promise.resolve({
    material_requests: {
      find: () => ({ exec: () => Promise.resolve([]) }),
    },
  }),
}));

vi.mock('../../hooks/useReport.js', () => ({
  useReport: () => ({
    html: '', loading: false, error: null, empty: false,
    templateName: '', print: vi.fn(),
  }),
}));

vi.mock('../WorkOrderDetail.jsx', () => ({
  default: () => <div data-testid="wo-detail" />,
}));

vi.mock('../WorkOrderNotesForm.jsx', () => ({
  default: () => <div data-testid="wo-notes" />,
}));

vi.mock('../WorkOrderActions.jsx', () => ({
  default: () => <div data-testid="wo-actions" />,
}));

vi.mock('../LaborClockWidget.jsx', () => ({
  default: () => <div data-testid="clock-widget" />,
}));

vi.mock('../../pdf/HtmlReportPreview.jsx', () => ({
  default: () => <div data-testid="report-preview" />,
}));

vi.mock('../../pdf/PdfDownloadButton', () => ({
  default: ({ templateCode }) => (
    <div data-testid="pdf-download-button" data-template={templateCode}>PDF Download</div>
  ),
}));

vi.mock('../../pdf/PdfEmailButton', () => ({
  default: ({ templateCode }) => (
    <div data-testid="pdf-email-button" data-template={templateCode}>PDF Email</div>
  ),
}));

// ═══════════════════════════════════════════════════════════════════
// Import del componente bajo test
// ═══════════════════════════════════════════════════════════════════
import WorkOrderDrawer from '../WorkOrderDrawer';

const baseWorkOrder = {
  id: 'wo-123',
  title: 'Test WO',
  lifecyclePhase: 'COMP',
  woType: 'CORRECTIVE',
  woTypeLabel: 'Correctivo',
  woTypeColor: 'warning',
};

const defaultProps = {
  workOrder: baseWorkOrder,
  open: true,
  onClose: vi.fn(),
  onTransition: vi.fn(),
  laborState: null,
};

describe('WorkOrderDrawer — PdfEmailButton integration', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ───── 1. PdfEmailButton presente cuando lifecyclePhase es COMP ─────
  it('renderiza PdfEmailButton cuando lifecyclePhase es COMP', () => {
    render(<WorkOrderDrawer {...defaultProps} />);

    expect(screen.getByTestId('pdf-download-button')).toBeDefined();
    expect(screen.getByTestId('pdf-email-button')).toBeDefined();
  });

  // ───── 2. PdfEmailButton presente cuando lifecyclePhase es CLOSED ─────
  it('renderiza PdfEmailButton cuando lifecyclePhase es CLOSED', () => {
    render(
      <WorkOrderDrawer
        {...defaultProps}
        workOrder={{ ...baseWorkOrder, lifecyclePhase: 'CLOSED' }}
      />,
    );

    expect(screen.getByTestId('pdf-download-button')).toBeDefined();
    expect(screen.getByTestId('pdf-email-button')).toBeDefined();
  });

  // ───── 3. PdfEmailButton NO renderizado para otras fases ─────
  it('NO renderiza PdfEmailButton cuando lifecyclePhase no es COMP/CLOSED', () => {
    render(
      <WorkOrderDrawer
        {...defaultProps}
        workOrder={{ ...baseWorkOrder, lifecyclePhase: 'INPRG' }}
      />,
    );

    expect(screen.queryByTestId('pdf-download-button')).toBeNull();
    expect(screen.queryByTestId('pdf-email-button')).toBeNull();
  });
});
