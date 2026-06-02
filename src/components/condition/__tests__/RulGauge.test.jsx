/**
 * Tests para RulGauge — indicador visual de RUL
 *
 * Cubre:
 *  - Renderizado con RUL >30d (zona verde)
 *  - Renderizado con RUL <7d (zona roja)
 *  - Estado sin RUL: "Sin estimación RUL disponible"
 *  - Estado loading
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// ─── Mock useRul ────────────────────────────────────────────────
const { mockUseRul } = vi.hoisted(() => {
  return { mockUseRul: vi.fn() };
});

vi.mock('../../../hooks/useRul', () => ({
  default: (...args) => mockUseRul(...args),
  useRul: (...args) => mockUseRul(...args),
}));

import RulGauge from '../RulGauge';

// ─── Helpers ────────────────────────────────────────────────────
function createMockRul(overrides = {}) {
  return {
    rulData: null,
    isLoading: false,
    error: null,
    refresh: vi.fn(),
    ...overrides,
  };
}

function makeRulData(overrides = {}) {
  return {
    rulDays: 45,
    confidence: 0.75,
    rulLow: 36,
    rulHigh: 54,
    failureModeKey: 'pump.cavitation',
    assumptions: ['degradation is linear', 'operating regime constant'],
    unit: 'days',
    windowEnd: '2026-06-01T10:00:00Z',
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('RulGauge', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('muestra "Cargando estimación…" mientras isLoading es true', () => {
    mockUseRul.mockReturnValue(createMockRul({ isLoading: true }));
    render(<RulGauge assetId="ASSET-001" />);

    expect(screen.getByText('Cargando estimación…')).toBeTruthy();
  });

  it('muestra "Sin estimación RUL disponible" cuando no hay datos', () => {
    mockUseRul.mockReturnValue(createMockRul());
    render(<RulGauge assetId="ASSET-001" />);

    expect(screen.getByText('Sin estimación RUL disponible')).toBeTruthy();
  });

  it('muestra "Sin estimación RUL disponible" cuando assetId es null', () => {
    mockUseRul.mockReturnValue(createMockRul());
    render(<RulGauge assetId={null} />);

    expect(screen.getByText('Sin estimación RUL disponible')).toBeTruthy();
  });

  it('renderiza intervalo de texto cuando hay RUL en zona verde (>30d)', () => {
    const rulData = makeRulData({ rulDays: 45, rulLow: 36, rulHigh: 54 });
    mockUseRul.mockReturnValue(createMockRul({ rulData }));
    render(<RulGauge assetId="ASSET-001" />);

    // Debe mostrar el intervalo "36–54 días"
    expect(screen.getByText(/36.*54.*días/)).toBeTruthy();
    // Debe mostrar la confianza
    expect(screen.getByText(/75%/)).toBeTruthy();
  });

  it('renderiza RUL en zona roja (<7d) con texto de intervalo', () => {
    const rulData = makeRulData({ rulDays: 3, rulLow: 2.4, rulHigh: 3.6 });
    mockUseRul.mockReturnValue(createMockRul({ rulData }));
    render(<RulGauge assetId="ASSET-001" />);

    expect(screen.getByText(/2–4 días/)).toBeTruthy();
  });
});
