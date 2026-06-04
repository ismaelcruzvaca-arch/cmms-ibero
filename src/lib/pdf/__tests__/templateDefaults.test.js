/**
 * Tests unitarios para templateDefaults.js
 *
 * Verifica:
 * - DEFAULT_PIPES: 10 pipes registradas
 * - SECTION_RENDERERS: 13 tipos de sección
 * - DEFAULT_CSS: contiene @media print y selectores clave
 * - DEFAULT_TEMPLATE_OT: estructura válida con 6 secciones
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PIPES,
  SECTION_RENDERERS,
  DEFAULT_CSS,
  DEFAULT_TEMPLATE_OT,
} from '../templateDefaults.js';

// ═══════════════════════════════════════════
// DEFAULT_PIPES
// ═══════════════════════════════════════════

describe('DEFAULT_PIPES', () => {
  it('contiene exactamente 10 pipes', () => {
    const pipeNames = Object.keys(DEFAULT_PIPES);
    expect(pipeNames).toHaveLength(10);
  });

  it('registra uppercase — convierte a mayúsculas', () => {
    const fn = DEFAULT_PIPES.uppercase;
    expect(fn('hola mundo')).toBe('HOLA MUNDO');
    expect(fn('123')).toBe('123');
    expect(fn('')).toBe('');
  });

  it('registra lowercase — convierte a minúsculas', () => {
    const fn = DEFAULT_PIPES.lowercase;
    expect(fn('HOLA MUNDO')).toBe('hola mundo');
    expect(fn('ABC123')).toBe('abc123');
  });

  it('registra date — formatea fechas con formato dado', () => {
    const fn = DEFAULT_PIPES.date;
    const d = new Date(2026, 5, 4, 14, 30, 0); // Jun 4, 2026 14:30
    expect(fn(d, 'DD/MM/YYYY')).toBe('04/06/2026');
    expect(fn(d, 'YYYY-MM-DD')).toBe('2026-06-04');
    expect(fn(d, 'HH:mm')).toBe('14:30');
  });

  it('date retorna string vacío para valores no-fecha', () => {
    const fn = DEFAULT_PIPES.date;
    expect(fn(null, 'DD/MM/YYYY')).toBe('');
    expect(fn(undefined, 'DD/MM/YYYY')).toBe('');
    expect(fn('no-date', 'DD/MM/YYYY')).toBe('');
  });

  it('registra truncate — trunca a N caracteres con sufijo', () => {
    const fn = DEFAULT_PIPES.truncate;
    expect(fn('texto muy largo para probar', 10)).toBe('texto muy ...');
    expect(fn('corto', 10)).toBe('corto');
    expect(fn('', 5)).toBe('');
  });

  it('truncate maneja valores no-string', () => {
    const fn = DEFAULT_PIPES.truncate;
    expect(fn(null, 3)).toBe('');
    expect(fn(12345, 3)).toBe('123...');
  });

  it('registra round — redondea decimales', () => {
    const fn = DEFAULT_PIPES.round;
    expect(fn(3.14159, 2)).toBe(3.14);
    expect(fn(3.14159, 0)).toBe(3);
    expect(fn(2.5, 0)).toBe(3);
  });

  it('round maneja inputs no numéricos', () => {
    const fn = DEFAULT_PIPES.round;
    expect(fn('abc', 2)).toBe('abc');
    expect(fn(null, 2)).toBe(0);
  });

  it('registra default — valor por defecto si null/undefined', () => {
    const fn = DEFAULT_PIPES.default;
    expect(fn(null, 'N/A')).toBe('N/A');
    expect(fn(undefined, 'N/A')).toBe('N/A');
    expect(fn('real', 'N/A')).toBe('real');
    expect(fn(0, 'N/A')).toBe(0);
    expect(fn('', 'N/A')).toBe('');
  });

  it('registra notEmpty — retorna booleano según el valor', () => {
    const fn = DEFAULT_PIPES.notEmpty;
    expect(fn('hola')).toBe(true);
    expect(fn(0)).toBe(true);
    expect(fn(false)).toBe(true);
    expect(fn(null)).toBe(false);
    expect(fn(undefined)).toBe(false);
    expect(fn('')).toBe(false);
  });

  it('registra json — serializa a JSON', () => {
    const fn = DEFAULT_PIPES.json;
    expect(fn({ a: 1 })).toBe('{"a":1}');
    expect(fn([1, 2, 3])).toBe('[1,2,3]');
    expect(fn('texto')).toBe('"texto"');
  });

  it('registra number — formatea números con separadores', () => {
    const fn = DEFAULT_PIPES.number;
    expect(fn(1000)).toBe('1,000');
    expect(fn(1234567.89)).toBe('1,234,567.89');
    expect(fn(42)).toBe('42');
  });

  it('number maneja valores no numéricos', () => {
    const fn = DEFAULT_PIPES.number;
    expect(fn(null)).toBe('');
    expect(fn('abc')).toBe('');
  });

  it('registra first — primer elemento de array', () => {
    const fn = DEFAULT_PIPES.first;
    expect(fn(['a', 'b', 'c'])).toBe('a');
    expect(fn([])).toBe(undefined);
    expect(fn('no-array')).toBe('no-array');
  });
});

// ═══════════════════════════════════════════
// SECTION_RENDERERS
// ═══════════════════════════════════════════

describe('SECTION_RENDERERS', () => {
  const expectedTypes = [
    'header',
    'title',
    'section-title',
    'details-grid',
    'text-block',
    'label-value',
    'table',
    'badge',
    'image',
    'divider',
    'condition-block',
    'footer',
    'spacer',
  ];

  it(`tiene exactamente ${expectedTypes.length} tipos de sección`, () => {
    expect(Object.keys(SECTION_RENDERERS)).toHaveLength(expectedTypes.length);
  });

  it.each(expectedTypes)('registra renderer para tipo "%s"', (type) => {
    expect(SECTION_RENDERERS[type]).toBeInstanceOf(Function);
  });

  it('cada renderer retorna un string HTML', () => {
    const section = { type: 'divider' };
    Object.entries(SECTION_RENDERERS).forEach(([type, renderer]) => {
      const html = renderer({ ...section, type }, {}, {});
      expect(typeof html).toBe('string');
    });
  });
});

// ═══════════════════════════════════════════
// DEFAULT_CSS
// ═══════════════════════════════════════════

describe('DEFAULT_CSS', () => {
  it('contiene @media print', () => {
    expect(DEFAULT_CSS).toContain('@media print');
  });

  it('contiene selectores fundamentales para reportes', () => {
    expect(DEFAULT_CSS).toContain('.report-container');
    expect(DEFAULT_CSS).toContain('.report-header');
    expect(DEFAULT_CSS).toContain('.details-grid');
    expect(DEFAULT_CSS).toContain('.badge');
  });

  it('contiene page-break para evitar cortes en tablas', () => {
    expect(DEFAULT_CSS).toContain('page-break');
  });
});

// ═══════════════════════════════════════════
// DEFAULT_TEMPLATE_OT
// ═══════════════════════════════════════════

describe('DEFAULT_TEMPLATE_OT', () => {
  it('tiene estructura de template válida', () => {
    expect(DEFAULT_TEMPLATE_OT).toHaveProperty('id');
    expect(DEFAULT_TEMPLATE_OT).toHaveProperty('name');
    expect(DEFAULT_TEMPLATE_OT).toHaveProperty('sections');
  });

  it('tiene exactamente 6 secciones', () => {
    expect(DEFAULT_TEMPLATE_OT.sections).toHaveLength(6);
  });

  it('tiene una sección de tipo header al inicio', () => {
    expect(DEFAULT_TEMPLATE_OT.sections[0].type).toBe('header');
  });

  it('tiene una sección de tipo footer al final', () => {
    const sections = DEFAULT_TEMPLATE_OT.sections;
    expect(sections[sections.length - 1].type).toBe('footer');
  });

  it('tiene secciones de tipo field_table, divider, labor-table, materials-conditional', () => {
    const types = DEFAULT_TEMPLATE_OT.sections.map(s => s.type);
    expect(types).toContain('field_table');
    expect(types).toContain('divider');
    expect(types).toContain('labor-table');
    expect(types).toContain('materials-conditional');
  });
});
