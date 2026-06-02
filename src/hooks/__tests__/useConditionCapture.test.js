/**
 * Tests unitarios para useConditionCapture — funciones puras
 *
 * Cubre:
 *  - buildFeatureSetV2: construcción del payload FeatureSet v0.2
 *  - validateCaptureForm: validación client-side del formulario
 */
import { describe, it, expect, vi } from 'vitest';

// Mock supabase para que no requiera env vars en test
vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnThis(), insert: vi.fn().mockReturnThis(), update: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: null, error: null }) }),
  },
}));

import { buildFeatureSetV2, validateCaptureForm } from '../useConditionCapture';

// ═══════════════════════════════════════════
// buildFeatureSetV2
// ═══════════════════════════════════════════

describe('buildFeatureSetV2', () => {
  const baseFormData = {
    assetId: 'BANDA-TR-01',
    featureKey: 'vibration.rms',
    value: 4.2,
    unit: 'mm/s',
    qualityFlag: 'G2',
    methodKey: 'rms',
    measuredAt: '2026-06-01T10:00:00.000Z',
    sourceId: 'manual_route_001',
  };

  it('construye un payload FeatureSet v0.2 con los campos obligatorios', () => {
    const payload = buildFeatureSetV2(baseFormData);

    expect(payload.asset_id).toBe('BANDA-TR-01');
    expect(payload.source_id).toBe('manual_route_001');
    expect(payload.source_type).toBe('manual');
    expect(payload.pipeline_version).toBe('manual-capture-v1');
    expect(payload.window_start).toBe('2026-06-01T10:00:00.000Z');
    expect(payload.window_end).toBe('2026-06-01T10:00:00.000Z');
  });

  it('incluye la feature con los campos correctos', () => {
    const payload = buildFeatureSetV2(baseFormData);
    const feature = payload.features[0];

    expect(feature.feature_key).toBe('vibration.rms');
    expect(feature.value).toBe(4.2);
    expect(feature.unit).toBe('mm/s');
    expect(feature.quality_flag).toBe('G2');
    expect(feature.method_key).toBe('rms');
    expect(feature.method_version).toBe('1.0');
    expect(feature.measured_at).toBe('2026-06-01T10:00:00.000Z');
  });

  it('genera un external_window_id único', () => {
    const payload1 = buildFeatureSetV2(baseFormData);
    const payload2 = buildFeatureSetV2(baseFormData);

    expect(payload1.external_window_id).toBeTruthy();
    expect(payload2.external_window_id).toBeTruthy();
    // Deberían ser diferentes (timestamp + random)
    expect(payload1.external_window_id).not.toBe(payload2.external_window_id);
  });

  it('usa el source_id por defecto cuando no se provee', () => {
    const data = { ...baseFormData };
    delete data.sourceId;
    const payload = buildFeatureSetV2(data);

    expect(payload.source_id).toBe('manual_route_001');
  });

  it('usa G2 como quality_flag por defecto', () => {
    const data = { ...baseFormData };
    delete data.qualityFlag;
    const payload = buildFeatureSetV2(data);

    expect(payload.features[0].quality_flag).toBe('G2');
  });

  it('incluye instrument_ref y notes cuando se proveen', () => {
    const data = {
      ...baseFormData,
      instrumentRef: 'vib-01',
      notes: 'Medición en régimen estable',
    };
    const payload = buildFeatureSetV2(data);

    expect(payload.features[0].instrument_ref).toBe('vib-01');
    expect(payload.features[0].notes).toBe('Medición en régimen estable');
  });

  it('incluye operational_context cuando se provee', () => {
    const data = {
      ...baseFormData,
      operationalContext: { regime: 'steady', rpm: 1500, load_pct: 75 },
    };
    const payload = buildFeatureSetV2(data);

    expect(payload.operational_context).toEqual({
      regime: 'steady',
      rpm: 1500,
      load_pct: 75,
    });
  });

  it('opcional_context vacío es un objeto vacío', () => {
    const payload = buildFeatureSetV2(baseFormData);
    expect(payload.operational_context).toEqual({});
  });

  it('convierte value a número', () => {
    const data = { ...baseFormData, value: '4.2' };
    const payload = buildFeatureSetV2(data);

    expect(payload.features[0].value).toBe(4.2);
    expect(typeof payload.features[0].value).toBe('number');
  });

  it('genera entered_at en el momento de construcción', () => {
    const before = new Date().toISOString();
    const payload = buildFeatureSetV2(baseFormData);
    const after = new Date().toISOString();

    expect(payload.features[0].entered_at).toBeTruthy();
    expect(payload.features[0].entered_at >= before).toBe(true);
    expect(payload.features[0].entered_at <= after).toBe(true);
  });
});

// ═══════════════════════════════════════════
// validateCaptureForm
// ═══════════════════════════════════════════

describe('validateCaptureForm', () => {
  const featureCatalog = [
    'vibration.rms',
    'vibration.peak',
    'temperature.bearing',
    'speed.rpm',
  ];

  const validFormData = {
    assetId: 'BANDA-TR-01',
    featureKey: 'vibration.rms',
    value: 4.2,
    unit: 'mm/s',
    qualityFlag: 'G2',
    methodKey: 'rms',
  };

  it('valida un formulario correcto', () => {
    const { valid, errors } = validateCaptureForm(validFormData, featureCatalog);
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('rechaza sin assetId', () => {
    const data = { ...validFormData, assetId: '' };
    const { valid, errors } = validateCaptureForm(data, featureCatalog);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('activo'))).toBe(true);
  });

  it('rechaza sin featureKey', () => {
    const data = { ...validFormData, featureKey: '' };
    const { valid, errors } = validateCaptureForm(data, featureCatalog);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('feature'))).toBe(true);
  });

  it('rechaza featureKey fuera del catálogo', () => {
    const data = { ...validFormData, featureKey: 'humidity.absolute' };
    const { valid, errors } = validateCaptureForm(data, featureCatalog);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('desconocido') || e.includes('catálogo'))).toBe(true);
  });

  it('rechaza sin valor', () => {
    const data = { ...validFormData, value: '' };
    const { valid, errors } = validateCaptureForm(data, featureCatalog);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('valor'))).toBe(true);
  });

  it('rechaza valor no numérico', () => {
    const data = { ...validFormData, value: 'no-soy-numero' };
    const { valid, errors } = validateCaptureForm(data, featureCatalog);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('numérico'))).toBe(true);
  });

  it('rechaza valor negativo', () => {
    const data = { ...validFormData, value: -5 };
    const { valid, errors } = validateCaptureForm(data, featureCatalog);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('positivo'))).toBe(true);
  });

  it('acepta valor cero', () => {
    const data = { ...validFormData, value: 0 };
    const { valid, errors } = validateCaptureForm(data, featureCatalog);
    expect(valid).toBe(true);
  });

  it('rechaza quality_flag inválido', () => {
    const data = { ...validFormData, qualityFlag: 'G99' };
    const { valid, errors } = validateCaptureForm(data, featureCatalog);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('Quality flag'))).toBe(true);
  });

  it('acepta quality_flag G0 válido', () => {
    const data = { ...validFormData, qualityFlag: 'G0' };
    const { valid, errors } = validateCaptureForm(data, featureCatalog);
    expect(valid).toBe(true);
  });

  it('acepta quality_flag G3 válido', () => {
    const data = { ...validFormData, qualityFlag: 'G3' };
    const { valid, errors } = validateCaptureForm(data, featureCatalog);
    expect(valid).toBe(true);
  });

  it('acumula múltiples errores', () => {
    const data = { assetId: '', featureKey: '', value: '' };
    const { valid, errors } = validateCaptureForm(data, featureCatalog);
    expect(valid).toBe(false);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it('funciona con catálogo vacío (skip validación de feature)', () => {
    const data = { ...validFormData, featureKey: 'cualquier.feature' };
    const { valid, errors } = validateCaptureForm(data, []);
    expect(valid).toBe(true);
  });
});
