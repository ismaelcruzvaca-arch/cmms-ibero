/**
 * Tests para DiagnosisPanel — tabla de diagnósticos y estados
 *
 * Cubre:
 *  - Renderizado con datos: tabla con filas, gauges de confianza, badges
 *  - Estado vacío: "Sin diagnósticos activos"
 *  - Estado loading: "Cargando diagnósticos…"
 *  - Estado error
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// ─── Mock useDiagnoses ──────────────────────────────────────────
const { mockUseDiagnoses } = vi.hoisted(() => {
  return { mockUseDiagnoses: vi.fn() };
});

vi.mock('../../../hooks/useDiagnoses', () => ({
  default: (...args) => mockUseDiagnoses(...args),
  useDiagnoses: (...args) => mockUseDiagnoses(...args),
}));

import DiagnosisPanel from '../DiagnosisPanel';

// ─── Helpers ────────────────────────────────────────────────────
function createMockData(overrides = {}) {
  return {
    diagnoses: [],
    isLoading: false,
    error: null,
    refresh: vi.fn(),
    ...overrides,
  };
}

function makeDiagnosis(overrides = {}) {
  return {
    id: 'diag-001',
    asset_id: 'ASSET-001',
    failure_mode_id: 'fm-001',
    diagnosis_status: 'active',
    confidence: 0.82,
    evidence_summary: {
      rule_name: 'Diagnóstico: Cavitación Bomba',
      feature_key: 'vibration.rms',
      evaluation_type: 'diagnostic',
      min_confidence_threshold: 0.5,
    },
    supporting_result_ids: [],
    contradictory_result_ids: [],
    linked_event_count: 2,
    created_at: '2026-06-01T10:00:00Z',
    failure_mode: {
      name: 'Cavitación de Bomba',
      severity_default: 'critical',
      detectability: 'medium',
      failure_mode_key: 'pump.cavitation',
    },
    confidence_breakdown: {
      confidence: 0.82,
      breakdown: {
        evidence_present: 3,
        evidence_total: 4,
        required_met: 2,
        required_total: 2,
        contradictory_count: 0,
        quality_modifier: 0.85,
        completeness: 1.0,
        final_confidence: 0.82,
      },
    },
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('DiagnosisPanel', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('muestra "Cargando diagnósticos…" mientras isLoading es true', () => {
    mockUseDiagnoses.mockReturnValue(createMockData({ isLoading: true }));
    render(<DiagnosisPanel assetId="ASSET-001" />);

    expect(screen.getByText('Cargando diagnósticos…')).toBeTruthy();
  });

  it('muestra mensaje de error cuando hay error', () => {
    mockUseDiagnoses.mockReturnValue(
      createMockData({ error: 'Error de conexión' })
    );
    render(<DiagnosisPanel assetId="ASSET-001" />);

    expect(screen.getByText(/Error de conexión/)).toBeTruthy();
  });

  it('muestra "Sin diagnósticos activos" cuando no hay datos', () => {
    mockUseDiagnoses.mockReturnValue(createMockData());
    render(<DiagnosisPanel assetId="ASSET-001" />);

    expect(screen.getByText('Sin diagnósticos activos')).toBeTruthy();
  });

  it('muestra "Sin diagnósticos activos" cuando assetId es null', () => {
    mockUseDiagnoses.mockReturnValue(createMockData());
    render(<DiagnosisPanel assetId={null} />);

    expect(screen.getByText('Sin diagnósticos activos')).toBeTruthy();
  });

  it('renderiza tabla con diagnóstico activo', () => {
    const diagnosis = makeDiagnosis();
    mockUseDiagnoses.mockReturnValue(createMockData({ diagnoses: [diagnosis] }));
    render(<DiagnosisPanel assetId="ASSET-001" />);

    expect(screen.getByText('Cavitación de Bomba')).toBeTruthy();
    expect(screen.getByText('Activo')).toBeTruthy();
    expect(screen.getByText('Generar OT')).toBeTruthy();
  });

  it('deshabilita botón Generar OT cuando confianza < 0.7', () => {
    const diagnosis = makeDiagnosis({ confidence: 0.45 });
    mockUseDiagnoses.mockReturnValue(createMockData({ diagnoses: [diagnosis] }));
    render(<DiagnosisPanel assetId="ASSET-001" />);

    const btn = screen.getByText('Generar OT');
    expect(btn.closest('button').disabled).toBe(true);
  });
});
