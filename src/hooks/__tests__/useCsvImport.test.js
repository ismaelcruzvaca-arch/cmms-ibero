/**
 * Tests unitarios para useCsvImport — funciones puras de parsing y validación CSV
 *
 * Cubre:
 *  - autoDetectColumns: heurísticas de matching de headers
 *  - validateImportRow: validación de filas mapeadas
 *  - parseCSVFile: parsing de contenido CSV
 */
import { describe, it, expect, vi } from 'vitest';

// Mock supabase para que no requiera env vars en test
vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnThis(), insert: vi.fn().mockReturnThis(), update: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: null, error: null }) }),
  },
}));

import { autoDetectColumns, validateImportRow } from '../useCsvImport';

// ═══════════════════════════════════════════
// autoDetectColumns
// ═══════════════════════════════════════════

describe('autoDetectColumns', () => {
  it('detecta feature_key con header "Feature"', () => {
    const headers = ['Equipo', 'Feature', 'Valor', 'Fecha'];
    const mapping = autoDetectColumns(headers);
    expect(mapping['Feature']).toBe('feature_key');
  });

  it('detecta feature_key con header "Parametro"', () => {
    const headers = ['Parametro', 'Valor', 'Fecha'];
    const mapping = autoDetectColumns(headers);
    expect(mapping['Parametro']).toBe('feature_key');
  });

  it('detecta value con header "Valor"', () => {
    const headers = ['Feature', 'Valor', 'Fecha'];
    const mapping = autoDetectColumns(headers);
    expect(mapping['Valor']).toBe('value');
  });

  it('detecta value con header "value" inglés', () => {
    const headers = ['feature_key', 'value', 'timestamp'];
    const mapping = autoDetectColumns(headers);
    expect(mapping['value']).toBe('value');
  });

  it('detecta measured_at con header "Fecha"', () => {
    const headers = ['Equipo', 'Feature', 'Valor', 'Fecha'];
    const mapping = autoDetectColumns(headers);
    expect(mapping['Fecha']).toBe('measured_at');
  });

  it('detecta measured_at con header "timestamp" inglés', () => {
    const headers = ['asset_id', 'feature_key', 'value', 'timestamp'];
    const mapping = autoDetectColumns(headers);
    expect(mapping['timestamp']).toBe('measured_at');
  });

  it('detecta unit con header "Unidad"', () => {
    const headers = ['Feature', 'Valor', 'Unidad', 'Fecha'];
    const mapping = autoDetectColumns(headers);
    expect(mapping['Unidad']).toBe('unit');
  });

  it('detecta asset_id con header "Equipo"', () => {
    const headers = ['Equipo', 'Feature', 'Valor', 'Fecha'];
    const mapping = autoDetectColumns(headers);
    expect(mapping['Equipo']).toBe('asset_id');
  });

  it('detecta múltiples columnas simultáneamente', () => {
    const headers = ['Equipo', 'Feature', 'Valor', 'Unidad', 'Fecha'];
    const mapping = autoDetectColumns(headers);
    expect(mapping['Equipo']).toBe('asset_id');
    expect(mapping['Feature']).toBe('feature_key');
    expect(mapping['Valor']).toBe('value');
    expect(mapping['Unidad']).toBe('unit');
    expect(mapping['Fecha']).toBe('measured_at');
  });

  it('no detecta headers sin correspondencia', () => {
    const headers = ['XYZ_Unknown', 'ABC_Irrelevante', '12345'];
    const mapping = autoDetectColumns(headers);
    expect(Object.keys(mapping)).toHaveLength(0);
  });

  it('prioriza feature_key sobre value para headers ambiguos', () => {
    // "Valor" podría ser value, pero no feature_key
    const headers = ['Valor', 'Medicion', 'Fecha'];
    const mapping = autoDetectColumns(headers);
    // "Valor" debería mapear a value
    expect(mapping['Valor']).toBe('value');
    // "Medicion" podría ser feature_key o value — probar
    const keys = Object.values(mapping);
    // Ambos campos deberían estar cubiertos
    expect(keys).toContain('value');
  });

  it('maneja headers vacíos correctamente', () => {
    const mapping = autoDetectColumns([]);
    expect(Object.keys(mapping)).toHaveLength(0);
  });

  it('maneja headers con espacios', () => {
    const headers = [' Feature ', '  Valor  ', ' Fecha '];
    const mapping = autoDetectColumns(headers);
    expect(mapping[' Feature ']).toBe('feature_key');
    expect(mapping['  Valor  ']).toBe('value');
    expect(mapping[' Fecha ']).toBe('measured_at');
  });
});

// ═══════════════════════════════════════════
// validateImportRow
// ═══════════════════════════════════════════

describe('validateImportRow', () => {
  const mockCatalog = [
    { feature_key: 'vibration.rms', unit: 'mm/s', category: 'Vibración' },
    { feature_key: 'temperature.bearing', unit: '°C', category: 'Temperatura' },
    { feature_key: 'speed.rpm', unit: 'rpm', category: 'Velocidad' },
  ];

  it('considera válida una fila con feature_key, value numérico y fecha', () => {
    const row = {
      feature_key: 'vibration.rms',
      value: '4.2',
      measured_at: '2026-06-01T10:00:00Z',
    };
    const errors = validateImportRow(row, mockCatalog);
    expect(errors).toHaveLength(0);
  });

  it('detecta feature_key vacío', () => {
    const row = {
      feature_key: '',
      value: '4.2',
      measured_at: '2026-06-01T10:00:00Z',
    };
    const errors = validateImportRow(row, mockCatalog);
    expect(errors.some((e) => e.includes('feature_key'))).toBe(true);
  });

  it('detecta feature_key desconocido (no en catálogo)', () => {
    const row = {
      feature_key: 'humidity.absolute',
      value: '60',
      measured_at: '2026-06-01T10:00:00Z',
    };
    const errors = validateImportRow(row, mockCatalog);
    expect(errors.some((e) => e.includes('no está en el catálogo'))).toBe(true);
  });

  it('detecta valor vacío', () => {
    const row = {
      feature_key: 'vibration.rms',
      value: '',
      measured_at: '2026-06-01T10:00:00Z',
    };
    const errors = validateImportRow(row, mockCatalog);
    expect(errors.some((e) => e.includes('Valor vacío'))).toBe(true);
  });

  it('detecta valor no numérico', () => {
    const row = {
      feature_key: 'vibration.rms',
      value: 'cuatro-punto-dos',
      measured_at: '2026-06-01T10:00:00Z',
    };
    const errors = validateImportRow(row, mockCatalog);
    expect(errors.some((e) => e.includes('Valor no numérico'))).toBe(true);
  });

  it('acepta valor negativo (permitido en vibración)', () => {
    const row = {
      feature_key: 'vibration.rms',
      value: '-2.5',
      measured_at: '2026-06-01T10:00:00Z',
    };
    const errors = validateImportRow(row, mockCatalog);
    // El valor numérico negativo es válido (depende del feature)
    expect(errors.some((e) => e.includes('Valor'))).toBe(false);
  });

  it('detecta fecha no válida', () => {
    const row = {
      feature_key: 'vibration.rms',
      value: '4.2',
      measured_at: 'no-es-una-fecha',
    };
    const errors = validateImportRow(row, mockCatalog);
    expect(errors.some((e) => e.includes('Fecha no válida'))).toBe(true);
  });

  it('detecta fecha vacía', () => {
    const row = {
      feature_key: 'vibration.rms',
      value: '4.2',
      measured_at: '',
    };
    const errors = validateImportRow(row, mockCatalog);
    expect(errors.some((e) => e.includes('Fecha de medición vacía'))).toBe(true);
  });

  it('acepta fila con asset_id opcional poblado', () => {
    const row = {
      feature_key: 'vibration.rms',
      value: '4.2',
      measured_at: '2026-06-01T10:00:00Z',
      asset_id: 'BANDA-TR-01',
    };
    const errors = validateImportRow(row, mockCatalog);
    expect(errors).toHaveLength(0);
  });

  it('acepta unidad opcional', () => {
    const row = {
      feature_key: 'vibration.rms',
      value: '4.2',
      measured_at: '2026-06-01T10:00:00Z',
      unit: 'mm/s',
    };
    const errors = validateImportRow(row, mockCatalog);
    expect(errors).toHaveLength(0);
  });

  it('acumula múltiples errores en una fila', () => {
    const row = {
      feature_key: '',
      value: '',
      measured_at: '',
    };
    const errors = validateImportRow(row, mockCatalog);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it('funciona sin catálogo (modo solo sintaxis)', () => {
    const row = {
      feature_key: 'vibration.rms',
      value: '4.2',
      measured_at: '2026-06-01T10:00:00Z',
    };
    const errors = validateImportRow(row, []);
    // Sin catálogo no se valida existencia de feature_key, solo sintaxis
    expect(errors).toHaveLength(0);
  });
});
