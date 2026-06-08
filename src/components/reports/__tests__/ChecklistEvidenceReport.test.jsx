/**
 * Tests for ChecklistEvidenceReport — MetricCards + instance detail table
 * with photo gallery, PASS/FAIL/NA badges.
 * Covers 4 states (loading, error, empty, success), with/without photos,
 * and data-widget-id attributes.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import ChecklistEvidenceReport from '../ChecklistEvidenceReport';

const theme = createTheme();

function renderWithTheme(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
}

const defaultProps = {
  instances: [],
  summary: { totalInstances: 0, passCount: 0, failCount: 0, naCount: 0, withPhotoCount: 0 },
  loading: false,
  error: null,
  onRetry: vi.fn(),
};

// ─── Mock Data ────────────────────────────────────────────────────

const mockSummaryMixed = {
  totalInstances: 2,
  passCount: 4,
  failCount: 2,
  naCount: 1,
  withPhotoCount: 2,
};

const mockInstancesMixed = [
  {
    id: 1,
    completed_at: '2026-06-05T10:30:00Z',
    work_order_id: 'WO-101',
    user_profiles: { full_name: 'Juan Pérez' },
    checklist_item_responses: [
      { id: 101, status: 'PASS', comment: 'Funciona correctamente', photo_url: null },
      { id: 102, status: 'PASS', comment: 'Lubricación OK', photo_url: null },
      { id: 103, status: 'FAIL', comment: 'Fuga detectada', photo_url: 'https://storage.example.com/fuga.jpg' },
    ],
  },
  {
    id: 2,
    completed_at: '2026-06-06T14:00:00Z',
    work_order_id: 'WO-102',
    user_profiles: { full_name: 'María García' },
    checklist_item_responses: [
      { id: 201, status: 'PASS', comment: 'Filtro limpio', photo_url: null },
      { id: 202, status: 'FAIL', comment: 'Correa desgastada', photo_url: 'https://storage.example.com/correa.jpg' },
      { id: 203, status: 'NA', comment: 'No aplica', photo_url: null },
    ],
  },
];

const mockSummaryWithPhotos = {
  totalInstances: 1,
  passCount: 1,
  failCount: 1,
  naCount: 0,
  withPhotoCount: 2,
};

const mockInstancesWithPhotos = [
  {
    id: 3,
    completed_at: '2026-06-07T09:00:00Z',
    work_order_id: 'WO-201',
    user_profiles: { full_name: 'Carlos Ruiz' },
    checklist_item_responses: [
      { id: 301, status: 'PASS', comment: 'Todo en orden', photo_url: 'https://storage.example.com/foto1.jpg' },
      { id: 302, status: 'FAIL', comment: 'Fuga de aceite', photo_url: 'https://storage.example.com/foto2.jpg' },
    ],
  },
];

const mockSummaryWithoutPhotos = {
  totalInstances: 1,
  passCount: 1,
  failCount: 0,
  naCount: 1,
  withPhotoCount: 0,
};

const mockInstancesWithoutPhotos = [
  {
    id: 4,
    completed_at: '2026-06-08T11:00:00Z',
    work_order_id: 'WO-301',
    user_profiles: { full_name: 'Ana Martínez' },
    checklist_item_responses: [
      { id: 401, status: 'PASS', comment: 'Correcto', photo_url: null },
      { id: 402, status: 'NA', comment: 'Sin evidencia', photo_url: null },
    ],
  },
];

describe('ChecklistEvidenceReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // ───── 1. Loading state ─────
  it('muestra spinner cuando loading=true', () => {
    renderWithTheme(<ChecklistEvidenceReport {...defaultProps} loading={true} />);

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.getByText('Cargando evidencia de checklists…')).toBeInTheDocument();
  });

  // ───── 2. Error state ─────
  it('muestra alerta con error y botón reintentar', () => {
    const onRetry = vi.fn();
    renderWithTheme(
      <ChecklistEvidenceReport
        {...defaultProps}
        error="Error al cargar checklists"
        onRetry={onRetry}
      />
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Error al cargar checklists/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reintentar/i })).toBeInTheDocument();
  });

  // ───── 3. Empty state ─────
  it('muestra mensaje vacío cuando no hay instancias', () => {
    renderWithTheme(<ChecklistEvidenceReport {...defaultProps} />);

    expect(
      screen.getByText('No se encontraron instancias de checklist en el período seleccionado')
    ).toBeInTheDocument();
  });

  // ───── 4. Success with mixed data (PASS, FAIL, NA) ─────
  it('renderiza summary cards y tabla de detalle con datos mixtos', () => {
    renderWithTheme(
      <ChecklistEvidenceReport
        {...defaultProps}
        summary={mockSummaryMixed}
        instances={mockInstancesMixed}
      />
    );

    // Summary cards should show the aggregations
    expect(screen.getByText('Total instancias')).toBeInTheDocument();
    expect(screen.getByText('Tasa PASS')).toBeInTheDocument();
    expect(screen.getByText('Tasa FAIL')).toBeInTheDocument();
    expect(screen.getByText('Con fotos')).toBeInTheDocument();

    // Values from summary: 2 instances, pass rate 4/7 ≈ 57%, fail rate 2/7 ≈ 29%, 2 with photos
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('57%')).toBeInTheDocument();
    expect(screen.getByText('29%')).toBeInTheDocument();

    // Instance detail shows labels with colon (inline captions)
    expect(screen.getAllByText('Completado:').length).toBe(2);
    expect(screen.getAllByText('Orden de Trabajo:').length).toBe(2);

    // Technician names rendered
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument();
    expect(screen.getByText('María García')).toBeInTheDocument();

    // Work orders
    expect(screen.getByText('WO-101')).toBeInTheDocument();
    expect(screen.getByText('WO-102')).toBeInTheDocument();

    // Item response table headers (one per instance = 2)
    expect(screen.getAllByText('Estado').length).toBe(2);
    expect(screen.getAllByText('Comentario').length).toBe(2);
    expect(screen.getAllByText('Foto').length).toBe(2);

    // Status badges
    expect(screen.getAllByText('PASS').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('FAIL').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('NA')).toBeInTheDocument();

    // Comments
    expect(screen.getByText('Funciona correctamente')).toBeInTheDocument();
    expect(screen.getByText('Fuga detectada')).toBeInTheDocument();
    expect(screen.getByText('Correa desgastada')).toBeInTheDocument();
    expect(screen.getByText('No aplica')).toBeInTheDocument();

    // Photo placeholders — instances without photo_url should show "Sin foto"
    const sinFotoElements = screen.getAllByText('Sin foto');
    expect(sinFotoElements.length).toBeGreaterThanOrEqual(1);
  });

  // ───── 5. Success with photos ─────
  it('renderiza imágenes cuando photo_url está presente', () => {
    renderWithTheme(
      <ChecklistEvidenceReport
        {...defaultProps}
        summary={mockSummaryWithPhotos}
        instances={mockInstancesWithPhotos}
      />
    );

    // Should render img elements with crossOrigin="anonymous"
    const images = screen.getAllByRole('img');
    expect(images.length).toBe(2);

    images.forEach((img) => {
      expect(img).toHaveAttribute('crossOrigin', 'anonymous');
      expect(img).toHaveAttribute('src');
      expect(img).toHaveAttribute('alt', 'Evidencia');
    });

    expect(images[0]).toHaveAttribute('src', 'https://storage.example.com/foto1.jpg');
    expect(images[1]).toHaveAttribute('src', 'https://storage.example.com/foto2.jpg');

    // No "Sin foto" placeholders when all responses have photos
    expect(screen.queryByText('Sin foto')).not.toBeInTheDocument();
  });

  // ───── 6. Success without photos ─────
  it('muestra placeholder "Sin foto" cuando photo_url es null', () => {
    renderWithTheme(
      <ChecklistEvidenceReport
        {...defaultProps}
        summary={mockSummaryWithoutPhotos}
        instances={mockInstancesWithoutPhotos}
      />
    );

    // Should show "Sin foto" placeholders
    const sinFotoElements = screen.getAllByText('Sin foto');
    expect(sinFotoElements.length).toBe(2);

    // No img elements should be rendered
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  // ───── 7. data-widget-id attributes ─────
  it('tiene data-widget-id en contenedores de summary y detalle', () => {
    renderWithTheme(
      <ChecklistEvidenceReport
        {...defaultProps}
        summary={mockSummaryMixed}
        instances={mockInstancesMixed}
      />
    );

    expect(document.querySelector('[data-widget-id="checklist-summary"]')).toBeInTheDocument();
    expect(document.querySelector('[data-widget-id="checklist-detail"]')).toBeInTheDocument();
  });

  // ───── 8. No muestra botón reintentar cuando onRetry no está definido ─────
  it('no muestra botón reintentar cuando onRetry está ausente', () => {
    renderWithTheme(
      <ChecklistEvidenceReport
        {...defaultProps}
        error="Error de prueba"
        onRetry={undefined}
      />
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reintentar/i })).not.toBeInTheDocument();
  });
});
