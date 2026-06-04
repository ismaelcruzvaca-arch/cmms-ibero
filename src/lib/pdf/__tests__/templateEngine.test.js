/**
 * Tests unitarios para templateEngine.js
 *
 * Cubre:
 * - resolveField: placeholders, nested, pipes, chained pipes
 * - evaluateCondition: notEmpty, comparaciones, truthiness
 * - renderSection: 12 tipos de sección (header, title, section-title,
 *   details-grid, text-block, label-value, table, badge, image,
 *   divider, condition-block, footer, spacer)
 * - resolveTemplate: flujo completo
 * - validateTemplate: estructura, pipes, tipos inválidos
 */
import { describe, it, expect } from 'vitest';
import {
  resolveField,
  evaluateCondition,
  renderSection,
  resolveTemplate,
  validateTemplate,
} from '../templateEngine.js';

// ═══════════════════════════════════════════
// resolveField
// ═══════════════════════════════════════════

describe('resolveField', () => {
  const ctx = {
    name: 'Juan Pérez',
    task: { title: 'Cambio de bomba', code: 'OT-001' },
    cost: 1500.5,
    items: ['filtro', 'aceite'],
    empty: null,
    date: new Date(2026, 5, 4),
  };

  it('resuelve placeholder simple {{name}}', () => {
    expect(resolveField('{{name}}', ctx)).toBe('Juan Pérez');
  });

  it('resuelve placeholder anidado {{task.title}}', () => {
    expect(resolveField('{{task.title}}', ctx)).toBe('Cambio de bomba');
  });

  it('resuelve pipe uppercase: {{name | uppercase}}', () => {
    expect(resolveField('{{name | uppercase}}', ctx)).toBe('JUAN PÉREZ');
  });

  it('resuelve pipe lowercase: {{name | lowercase}}', () => {
    expect(resolveField('{{name | lowercase}}', ctx)).toBe('juan pérez');
  });

  it('resuelve pipe date con formato: {{date | date("DD/MM/YYYY")}}', () => {
    expect(resolveField('{{date | date("DD/MM/YYYY")}}', ctx)).toBe('04/06/2026');
  });

  it('resuelve pipe truncate: {{task.title | truncate(6)}}', () => {
    expect(resolveField('{{task.title | truncate(6)}}', ctx)).toBe('Cambio...');
  });

  it('resuelve pipe round: {{cost | round(0)}}', () => {
    // 1500.5 rounds to 1501 with Math.round
    expect(resolveField('{{cost | round(0)}}', ctx)).toBe('1501');
  });

  it('resuelve pipe default: {{empty | default("N/A")}}', () => {
    expect(resolveField('{{empty | default("N/A")}}', ctx)).toBe('N/A');
  });

  it('resuelve pipe notEmpty: {{name | notEmpty}}', () => {
    expect(resolveField('{{name | notEmpty}}', ctx)).toBe('true');
  });

  it('resuelve pipe json: {{items | json}}', () => {
    expect(resolveField('{{items | json}}', ctx)).toBe('["filtro","aceite"]');
  });

  it('resuelve pipe number: {{cost | number}}', () => {
    expect(resolveField('{{cost | number}}', ctx)).toBe('1,500.5');
  });

  it('resuelve pipe first: {{items | first}}', () => {
    expect(resolveField('{{items | first}}', ctx)).toBe('filtro');
  });

  it('resuelve pipes encadenados: {{task.title | uppercase | truncate(8)}}', () => {
    expect(resolveField('{{task.title | uppercase | truncate(8)}}', ctx)).toBe('CAMBIO D...');
  });

  it('resuelve múltiples placeholders en un string', () => {
    expect(resolveField('{{name}} - {{task.code}}', ctx)).toBe('Juan Pérez - OT-001');
  });

  it('retorna string vacío para campo inexistente', () => {
    expect(resolveField('{{noexiste}}', ctx)).toBe('');
  });

  it('retorna string vacío para campo null/undefined', () => {
    expect(resolveField('{{empty}}', ctx)).toBe('');
  });

  it('deja intacto texto sin placeholders', () => {
    expect(resolveField('texto plano', ctx)).toBe('texto plano');
  });
});

// ═══════════════════════════════════════════
// evaluateCondition
// ═══════════════════════════════════════════

describe('evaluateCondition', () => {
  const ctx = {
    status: 'COMP',
    value: 42,
    empty: null,
    items: ['a'],
    name: 'Juan',
  };

  it('evalúa field | notEmpty como true cuando hay valor', () => {
    expect(evaluateCondition('name | notEmpty', ctx)).toBe(true);
  });

  it('evalúa field | notEmpty como false cuando es null', () => {
    expect(evaluateCondition('empty | notEmpty', ctx)).toBe(false);
  });

  it('evalúa field == "value"', () => {
    expect(evaluateCondition("status == 'COMP'", ctx)).toBe(true);
    expect(evaluateCondition("status == 'OPEN'", ctx)).toBe(false);
  });

  it('evalúa field != "value"', () => {
    expect(evaluateCondition("status != 'OPEN'", ctx)).toBe(true);
    expect(evaluateCondition("status != 'COMP'", ctx)).toBe(false);
  });

  it('evalúa field > number', () => {
    expect(evaluateCondition('value > 10', ctx)).toBe(true);
    expect(evaluateCondition('value > 100', ctx)).toBe(false);
  });

  it('evalúa field < number', () => {
    expect(evaluateCondition('value < 100', ctx)).toBe(true);
    expect(evaluateCondition('value < 10', ctx)).toBe(false);
  });

  it('evalúa field >= number', () => {
    expect(evaluateCondition('value >= 42', ctx)).toBe(true);
    expect(evaluateCondition('value >= 43', ctx)).toBe(false);
  });

  it('evalúa field <= number', () => {
    expect(evaluateCondition('value <= 42', ctx)).toBe(true);
    expect(evaluateCondition('value <= 41', ctx)).toBe(false);
  });

  it('evalúa truthiness simple de campo', () => {
    expect(evaluateCondition('name', ctx)).toBe(true);
    expect(evaluateCondition('empty', ctx)).toBe(false);
  });

  it('evalúa array no vacío como truthy', () => {
    expect(evaluateCondition('items', ctx)).toBe(true);
  });
});

// ═══════════════════════════════════════════
// renderSection
// ═══════════════════════════════════════════

describe('renderSection', () => {
  const data = {
    title: 'Reporte de Mantenimiento',
    subtitle: 'Orden de Trabajo',
    logo: 'https://example.com/logo.png',
    description: 'Este es un texto de prueba para el reporte.',
    label: 'Estado',
    value: 'Completado',
    badge: 'COMP',
    imageUrl: 'https://example.com/photo.jpg',
    rows: [
      { col1: 'A', col2: 'B' },
      { col1: 'C', col2: 'D' },
    ],
    fields: [
      { label: 'Equipo', value: 'Bomba 01' },
      { label: 'Ubicación', value: 'Planta A' },
    ],
  };

  it('renderiza sección header con logo y título', () => {
    const section = {
      type: 'header',
      logoField: 'logo',
      titleField: 'title',
      badgeField: 'badge',
    };
    const html = renderSection(section, data, {});
    expect(html).toContain('report-header');
    expect(html).toContain('src="https://example.com/logo.png"');
    expect(html).toContain('Reporte de Mantenimiento');
    expect(html).toContain('COMP');
  });

  it('renderiza sección title', () => {
    const section = { type: 'title', text: '{{title}}' };
    const html = renderSection(section, data, {});
    expect(html).toContain('report-title');
    expect(html).toContain('Reporte de Mantenimiento');
  });

  it('renderiza sección section-title', () => {
    const section = { type: 'section-title', text: '{{subtitle}}' };
    const html = renderSection(section, data, {});
    expect(html).toContain('report-section-title');
    expect(html).toContain('Orden de Trabajo');
  });

  it('renderiza sección details-grid', () => {
    const section = {
      type: 'details-grid',
      columns: 2,
      items: [
        { label: 'Equipo', value: '{{fields[0].value}}' },
        { label: 'Ubicación', value: '{{fields[1].value}}' },
      ],
    };
    const html = renderSection(section, data, {});
    expect(html).toContain('details-grid');
    expect(html).toContain('grid-template-columns:repeat(2,1fr)');
    expect(html).toContain('Bomba 01');
    expect(html).toContain('Planta A');
  });

  it('renderiza sección text-block', () => {
    const section = { type: 'text-block', text: '{{description}}' };
    const html = renderSection(section, data, {});
    expect(html).toContain('report-text-block');
    expect(html).toContain('texto de prueba');
  });

  it('renderiza sección label-value', () => {
    const section = { type: 'label-value', label: '{{label}}', value: '{{value}}' };
    const html = renderSection(section, data, {});
    expect(html).toContain('report-label-value');
    expect(html).toContain('Estado');
    expect(html).toContain('Completado');
  });

  it('renderiza sección table con headers y filas', () => {
    const section = {
      type: 'table',
      columns: [
        { key: 'col1', header: 'Columna 1' },
        { key: 'col2', header: 'Columna 2' },
      ],
      dataField: 'rows',
    };
    const html = renderSection(section, data, {});
    expect(html).toContain('<table');
    expect(html).toContain('<thead');
    expect(html).toContain('<th>Columna 1</th>');
    expect(html).toContain('<th>Columna 2</th>');
    expect(html).toContain('<tbody');
    expect(html).toContain('<td>A</td>');
    expect(html).toContain('<td>B</td>');
    expect(html).toContain('<td>C</td>');
    expect(html).toContain('<td>D</td>');
  });

  it('renderiza sección badge', () => {
    const section = { type: 'badge', value: '{{badge}}' };
    const html = renderSection(section, data, {});
    expect(html).toContain('badge');
    expect(html).toContain('COMP');
  });

  it('renderiza sección image', () => {
    const section = { type: 'image', src: '{{imageUrl}}' };
    const html = renderSection(section, data, {});
    expect(html).toContain('<img');
    expect(html).toContain('src="https://example.com/photo.jpg"');
  });

  it('renderiza sección divider', () => {
    const section = { type: 'divider' };
    const html = renderSection(section, data, {});
    expect(html).toContain('<hr');
  });

  it('renderiza sección footer', () => {
    const section = { type: 'footer', text: 'Generado el {{date("DD/MM/YYYY")}}' };
    const html = renderSection(section, data, {});
    expect(html).toContain('report-footer');
  });

  it('renderiza sección spacer', () => {
    const section = { type: 'spacer', height: 20 };
    const html = renderSection(section, data, {});
    expect(html).toContain('spacer');
  });

  it('renderiza condition-block cuando la condición es true', () => {
    const section = {
      type: 'condition-block',
      condition: 'badge | notEmpty',
      sections: [
        { type: 'text-block', text: 'Contenido condicional visible' },
      ],
    };
    const html = renderSection(section, data, {});
    expect(html).toContain('Contenido condicional visible');
  });

  it('NO renderiza condition-block cuando la condición es false', () => {
    const section = {
      type: 'condition-block',
      condition: 'noexiste | notEmpty',
      sections: [
        { type: 'text-block', text: 'No debería verse' },
      ],
    };
    const html = renderSection(section, data, {});
    expect(html).not.toContain('No debería verse');
  });

  it('retorna string vacío para tipo de sección desconocido', () => {
    const section = { type: 'unknown-type' };
    const html = renderSection(section, data, {});
    expect(html).toBe('');
  });
});

// ═══════════════════════════════════════════
// resolveTemplate
// ═══════════════════════════════════════════

describe('resolveTemplate', () => {
  const template = {
    id: 'test-template',
    name: 'Test',
    sections: [
      { type: 'title', text: '{{title}}' },
      { type: 'divider' },
      { type: 'text-block', text: 'Cliente: {{client}}' },
    ],
  };

  const data = {
    title: 'Reporte de Prueba',
    client: 'CMMS Ibero',
  };

  it('resuelve un template completo a HTML', () => {
    const html = resolveTemplate(template, data, {});
    expect(html).toContain('Reporte de Prueba');
    expect(html).toContain('Cliente: CMMS Ibero');
    expect(html).toContain('<hr');
    expect(html).toContain('report-container');
  });

  it('acepta options con branding y css custom', () => {
    const options = {
      branding: { logo: 'https://example.com/logo.png' },
      css: '.custom { color: red; }',
    };
    const html = resolveTemplate(template, data, options);
    expect(html).toContain('.custom');
  });

  it('envuelve el resultado en report-container con meta viewport', () => {
    const html = resolveTemplate(template, data, {});
    expect(html).toContain('<meta name="viewport"');
    expect(html).toContain('class="report-container"');
  });
});

// ═══════════════════════════════════════════
// validateTemplate
// ═══════════════════════════════════════════

describe('validateTemplate', () => {
  it('retorna valid: true para template correcto', () => {
    const template = {
      id: 'test',
      name: 'Test',
      sections: [
        { type: 'header', titleField: 'title' },
      ],
    };
    const result = validateTemplate(template);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('retorna valid: false si falta id', () => {
    const template = { name: 'Test', sections: [] };
    const result = validateTemplate(template);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('retorna valid: false si falta name', () => {
    const template = { id: 'test', sections: [] };
    const result = validateTemplate(template);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('retorna valid: false si sections no es array', () => {
    const template = { id: 'test', name: 'Test', sections: 'not-array' };
    const result = validateTemplate(template);
    expect(result.valid).toBe(false);
  });

  it('retorna valid: false si una sección tiene tipo inválido', () => {
    const template = {
      id: 'test',
      name: 'Test',
      sections: [
        { type: 'no-valido' },
      ],
    };
    const result = validateTemplate(template);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('no-valido'))).toBe(true);
  });

  it('detecta placeholders sin cerrar en el texto', () => {
    const template = {
      id: 'test',
      name: 'Test',
      sections: [
        { type: 'text-block', text: 'Hola {{nombre' },
      ],
    };
    const result = validateTemplate(template);
    expect(result.valid).toBe(false);
  });

  it('detecta pipes inválidos', () => {
    const template = {
      id: 'test',
      name: 'Test',
      sections: [
        { type: 'text-block', text: '{{valor | inexistente}}' },
      ],
    };
    const result = validateTemplate(template);
    expect(result.valid).toBe(false);
  });
});
