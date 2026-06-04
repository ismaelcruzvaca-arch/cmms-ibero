/**
 * Tests de integración para templateEngine.js
 *
 * Ejercita el flujo completo: template + data → render HTML.
 * NO duplica los tests unitarios de templateEngine.test.js (60 tests).
 */
import { describe, it, expect } from 'vitest';
import {
  resolveTemplate,
  resolveField,
  validateTemplate,
} from '../templateEngine.js';
import { DEFAULT_TEMPLATE_OT } from '../templateDefaults.js';

// ═══════════════════════════════════════════════════════════════════
// Datos fake de workOrder
// ═══════════════════════════════════════════════════════════════════
const fakeWorkOrder = {
  // badge y title a nivel raíz para DEFAULT_TEMPLATE_OT header
  title: 'OT WO-001 — Cambio de bomba centrífuga',
  badge: 'COMP',
  work_order: {
    id: 'WO-001',
    equipment_id: 'EQ-045',
    description: 'Cambio de bomba centrífuga',
    priority: 'Alta',
    lifecycle_phase: 'COMP',
    planned_hours: 4,
    actual_hours: 3.5,
    asset_id: 'AST-012',
    wo_type: 'corrective',
    scheduled_date: '2026-06-01',
    assigned_to: 'Carlos Martínez',
  },
  asset: {
    id: 'AST-012',
    name: 'Bomba Centrífuga 7.5 HP',
    location: 'Planta Baja - Sala 3',
  },
  labor_records: [
    { technician: 'Carlos M.', hours: 2, work: 'Desmontaje de bomba' },
    { technician: 'Lucía R.', hours: 1.5, work: 'Instalación de repuesto' },
  ],
  material_requests: [
    { part: 'BOM-001', qty: 1, cost: 15000 },
    { part: 'SELLO-02', qty: 2, cost: 3200 },
  ],
};

// ═══════════════════════════════════════════════════════════════════
// 1. Template OT default → render completo
// ═══════════════════════════════════════════════════════════════════
describe('Integración — DEFAULT_TEMPLATE_OT render completo', () => {
  it('genera HTML completo con DOCTYPE y estructura básica', () => {
    const html = resolveTemplate(DEFAULT_TEMPLATE_OT, fakeWorkOrder);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="es">');
    expect(html).toContain('<meta charset="UTF-8" />');
    expect(html).toContain('</html>');
  });

  it('incluye DEFAULT_CSS con @media print', () => {
    const html = resolveTemplate(DEFAULT_TEMPLATE_OT, fakeWorkOrder);
    expect(html).toContain('@media print');
    expect(html).toContain('A4');
    expect(html).toContain('.report-container');
  });

  it('renderiza secciones que tienen renderer (header, divider, footer)', () => {
    const html = resolveTemplate(DEFAULT_TEMPLATE_OT, fakeWorkOrder);
    // header
    expect(html).toContain('class="report-header"');
    // divider
    expect(html).toContain('class="report-divider"');
    // footer
    expect(html).toContain('class="report-footer"');
  });

  it('asigna nombre del template como title del HTML', () => {
    const html = resolveTemplate(DEFAULT_TEMPLATE_OT, fakeWorkOrder);
    expect(html).toContain('<title>Orden de Trabajo (fallback offline)</title>');
  });

  it('el header muestra el badge del lifecycle_phase', () => {
    const html = resolveTemplate(DEFAULT_TEMPLATE_OT, fakeWorkOrder);
    expect(html).toContain('class="badge badge-comp"');
    expect(html).toContain('COMP');
  });

  it('el footer incluye fecha renderizada con pipe date', () => {
    const html = resolveTemplate(DEFAULT_TEMPLATE_OT, fakeWorkOrder);
    // El footer usa {{date("DD/MM/YYYY HH:mm")}} — debe resolverse
    expect(html).toContain('Generado por CMMS Ibero');
    // No debe quedar el placeholder sin resolver
    expect(html).not.toContain('{{date(');
    expect(html).not.toContain('DD/MM/YYYY');
  });

  it('pasa options.css extra y lo inyecta después de DEFAULT_CSS', () => {
    const extraCss = '.custom-rule { color: red; }';
    const html = resolveTemplate(DEFAULT_TEMPLATE_OT, fakeWorkOrder, { css: extraCss });
    // DEFAULT_CSS aparece primero
    const defaultPos = html.indexOf('@media print');
    const extraPos = html.indexOf(extraCss);
    expect(defaultPos).toBeGreaterThanOrEqual(0);
    expect(extraPos).toBeGreaterThan(defaultPos);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Template con datos reales → placeholders resueltos
// ═══════════════════════════════════════════════════════════════════
describe('Integración — placeholders resueltos con datos reales', () => {
  const customTemplate = {
    id: 'test-template',
    name: 'Test Template',
    sections: [
      { type: 'title', text: 'OT: {{work_order.id}}' },
      { type: 'section-title', text: 'Equipo: {{asset.name}}' },
      {
        type: 'label-value',
        label: 'Descripción',
        value: '{{work_order.description}}',
      },
      {
        type: 'label-value',
        label: 'Prioridad',
        value: '{{work_order.priority}}',
      },
      {
        type: 'text-block',
        text: 'Asignado a: {{work_order.assigned_to}}',
      },
    ],
  };

  it('resuelve {{work_order.id}} → WO-001', () => {
    const html = resolveTemplate(customTemplate, fakeWorkOrder);
    expect(html).toContain('OT: WO-001');
  });

  it('resuelve {{asset.name}} → Bomba Centrífuga 7.5 HP', () => {
    const html = resolveTemplate(customTemplate, fakeWorkOrder);
    expect(html).toContain('Equipo: Bomba Centrífuga 7.5 HP');
  });

  it('resuelve {{work_order.description}} y label-value', () => {
    const html = resolveTemplate(customTemplate, fakeWorkOrder);
    expect(html).toContain('Descripción');
    expect(html).toContain('Cambio de bomba centrífuga');
  });

  it('resuelve {{work_order.priority}} en valor label-value', () => {
    const html = resolveTemplate(customTemplate, fakeWorkOrder);
    expect(html).toContain('Prioridad');
    expect(html).toContain('Alta');
  });

  it('resuelve {{work_order.assigned_to}} en text-block', () => {
    const html = resolveTemplate(customTemplate, fakeWorkOrder);
    expect(html).toContain('Asignado a: Carlos Martínez');
  });

  it('no deja placeholders sin resolver en el HTML final', () => {
    const html = resolveTemplate(customTemplate, fakeWorkOrder);
    expect(html).not.toMatch(/\{\{.*?\}\}/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Pipes encadenados
// ═══════════════════════════════════════════════════════════════════
describe('Integración — pipes encadenados en template', () => {
  const templateWithPipes = {
    id: 'pipe-test',
    name: 'Pipe Test',
    sections: [
      {
        type: 'label-value',
        label: 'Upper',
        value: '{{work_order.description | uppercase}}',
      },
      {
        type: 'label-value',
        label: 'Upper + Truncate',
        value: '{{work_order.description | uppercase | truncate(10)}}',
      },
      {
        type: 'label-value',
        label: 'Número',
        value: '{{work_order.planned_hours | number}}',
      },
      {
        type: 'label-value',
        label: 'Default',
        value: '{{inexistente | default("N/D")}}',
      },
    ],
  };

  it('uppercase convierte descripción a mayúsculas', () => {
    const html = resolveTemplate(templateWithPipes, fakeWorkOrder);
    expect(html).toContain('CAMBIO DE BOMBA CENTRÍFUGA');
    expect(html).not.toContain('Cambio de bomba centrífuga');
  });

  it('uppercase | truncate(10) encadena ambos pipes', () => {
    const html = resolveTemplate(templateWithPipes, fakeWorkOrder);
    // "Cambio de bomba centrífuga" uppercase → "CAMBIO DE BOMBA CENTRÍFUGA"
    // truncate(10) → slice(0,10) = "CAMBIO DE " + "..."
    expect(html).toContain('CAMBIO DE ...');
  });

  it('number pipe formatea planned_hours', () => {
    const html = resolveTemplate(templateWithPipes, fakeWorkOrder);
    expect(html).toContain('4');
  });

  it('default pipe muestra valor por defecto para campo inexistente', () => {
    const html = resolveTemplate(templateWithPipes, fakeWorkOrder);
    expect(html).toContain('N/D');
  });

  it('no deja pipes sin evaluar en el output', () => {
    const html = resolveTemplate(templateWithPipes, fakeWorkOrder);
    expect(html).not.toMatch(/\{\{.*?\}\}/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Condicionales (condition-block)
// ═══════════════════════════════════════════════════════════════════
describe('Integración — condicionales (condition-block)', () => {
  const tmplWithCondition = {
    id: 'cond-test',
    name: 'Condition Test',
    sections: [
      {
        type: 'condition-block',
        condition: 'work_order.priority | notEmpty',
        sections: [
          {
            type: 'label-value',
            label: 'Prioridad',
            value: '{{work_order.priority}}',
          },
        ],
      },
      {
        type: 'condition-block',
        condition: 'inexistente | notEmpty',
        sections: [
          { type: 'text-block', text: 'NUNCA DEBE APARECER' },
        ],
      },
      {
        type: 'condition-block',
        condition: 'work_order.priority == "Alta"',
        sections: [
          { type: 'text-block', text: 'Prioridad ALTA activa' },
        ],
      },
      {
        type: 'condition-block',
        condition: 'work_order.priority == "Baja"',
        sections: [
          { type: 'text-block', text: 'NUNCA DEBE APARECER (Baja)' },
        ],
      },
    ],
  };

  it('condition-block con campo existente renderiza contenido', () => {
    const html = resolveTemplate(tmplWithCondition, fakeWorkOrder);
    expect(html).toContain('Alta');
  });

  it('condition-block con campo vacío NO renderiza contenido', () => {
    const html = resolveTemplate(tmplWithCondition, fakeWorkOrder);
    expect(html).not.toContain('NUNCA DEBE APARECER');
  });

  it('condition-block con == verdadero muestra contenido', () => {
    const html = resolveTemplate(tmplWithCondition, fakeWorkOrder);
    expect(html).toContain('Prioridad ALTA activa');
  });

  it('condition-block con == falso NO muestra contenido', () => {
    const html = resolveTemplate(tmplWithCondition, fakeWorkOrder);
    expect(html).not.toContain('NUNCA DEBE APARECER (Baja)');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Tabla con source data
// ═══════════════════════════════════════════════════════════════════
describe('Integración — tabla con source data', () => {
  const tmplWithTable = {
    id: 'table-test',
    name: 'Table Test',
    sections: [
      {
        type: 'table',
        dataField: 'labor_records',
        columns: [
          { key: 'technician', header: 'Técnico' },
          { key: 'hours', header: 'Horas' },
          { key: 'work', header: 'Trabajo' },
        ],
      },
    ],
  };

  it('renderiza filas de labor_records en la tabla', () => {
    const html = resolveTemplate(tmplWithTable, fakeWorkOrder);
    expect(html).toContain('<table');
    expect(html).toContain('Carlos M.');
    expect(html).toContain('Lucía R.');
    expect(html).toContain('Desmontaje de bomba');
    expect(html).toContain('Instalación de repuesto');
  });

  it('incluye headers de columna en la tabla', () => {
    const html = resolveTemplate(tmplWithTable, fakeWorkOrder);
    expect(html).toContain('Técnico');
    expect(html).toContain('Horas');
    expect(html).toContain('Trabajo');
  });

  it('renderiza tabla vacía si dataField no existe', () => {
    const tmplNoData = {
      id: 'empty-table',
      name: 'Empty',
      sections: [
        {
          type: 'table',
          dataField: 'no_existe',
          columns: [{ key: 'x', header: 'X' }],
        },
      ],
    };
    const html = resolveTemplate(tmplNoData, fakeWorkOrder);
    // La tabla se renderiza con thead pero sin filas en tbody
    expect(html).toContain('<table');
    expect(html).toContain('<tbody></tbody>');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Details-grid con N columnas
// ═══════════════════════════════════════════════════════════════════
describe('Integración — details-grid con N columnas', () => {
  it('renderiza details-grid con 2 columnas default', () => {
    const tmpl = {
      id: 'grid-2col',
      name: 'Grid 2',
      sections: [
        {
          type: 'details-grid',
          items: [
            { label: 'OT', value: '{{work_order.id}}' },
            { label: 'Equipo', value: '{{work_order.equipment_id}}' },
          ],
        },
      ],
    };
    const html = resolveTemplate(tmpl, fakeWorkOrder);
    expect(html).toContain('grid-template-columns:repeat(2,1fr)');
    expect(html).toContain('WO-001');
    expect(html).toContain('EQ-045');
  });

  it('renderiza details-grid con 3 columnas explícitas', () => {
    const tmpl = {
      id: 'grid-3col',
      name: 'Grid 3',
      sections: [
        {
          type: 'details-grid',
          columns: 3,
          items: [
            { label: 'A', value: '1' },
            { label: 'B', value: '2' },
            { label: 'C', value: '3' },
          ],
        },
      ],
    };
    const html = resolveTemplate(tmpl, fakeWorkOrder);
    expect(html).toContain('grid-template-columns:repeat(3,1fr)');
  });

  it('details-grid con items vacíos se renderiza sin contenido', () => {
    const tmpl = {
      id: 'grid-empty',
      name: 'Empty Grid',
      sections: [
        {
          type: 'details-grid',
          items: [],
        },
      ],
    };
    const html = resolveTemplate(tmpl, fakeWorkOrder);
    // El contenedor grid existe pero no tiene detail-item (el div está vacío)
    expect(html).toMatch(/<div class="details-grid"[^>]*><\/div>/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. validateTemplate con template inválido
// ═══════════════════════════════════════════════════════════════════
describe('Integración — validateTemplate con errores', () => {
  it('detecta template sin id', () => {
    const result = validateTemplate({ name: 'x', sections: [] });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/id/i)]),
    );
  });

  it('detecta template sin name', () => {
    const result = validateTemplate({ id: 'x', sections: [{ type: 'title', text: 'x' }] });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/name/i)]),
    );
  });

  it('detecta tipo de sección inválido', () => {
    const result = validateTemplate({
      id: 'x',
      name: 'x',
      sections: [{ type: 'invalid-type' }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('invalid-type');
  });

  it('detecta placeholder sin cerrar', () => {
    const result = validateTemplate({
      id: 'x',
      name: 'x',
      sections: [{ type: 'title', text: 'Hola {{nombre' }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('{{');
    expect(result.errors[0]).toContain('}}');
  });

  it('detecta pipe name inválido en placeholder', () => {
    const result = validateTemplate({
      id: 'x',
      name: 'x',
      sections: [{ type: 'title', text: '{{name | inexistente}}' }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('inexistente');
  });

  it('detecta tipos de sección no estándar en DEFAULT_TEMPLATE_OT (field_table, labor-table, materials-conditional)', () => {
    // NOTA: DEFAULT_TEMPLATE_OT contiene tipos legacy (field_table, labor-table,
    // materials-conditional) que NO están en VALID_SECTION_TYPES del validador.
    // El motor renderiza solo las secciones con renderer registrado e ignora el resto.
    const result = validateTemplate(DEFAULT_TEMPLATE_OT);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0]).toContain('field_table');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. resolveField con caracteres especiales
// ═══════════════════════════════════════════════════════════════════
describe('Integración — resolveField caracteres especiales', () => {
  it('resuelve campo con pipe literal en el valor (no debe confundir con pipe de transformación)', () => {
    const ctx = { command: 'echo | grep error' };
    // El pipe dentro del VALOR no debe parsearse como pipe de transformación
    const result = resolveField('{{command}}', ctx);
    expect(result).toBe('echo | grep error');
  });

  it('resuelve campo con comillas simples', () => {
    const ctx = { note: "O'Brian — valor con comilla simple" };
    const result = resolveField('{{note}}', ctx);
    expect(result).toBe("O'Brian — valor con comilla simple");
  });

  it('resuelve campo con comillas dobles en el valor', () => {
    const ctx = { label: 'Medida "exacta" de 10"' };
    const result = resolveField('{{label}}', ctx);
    expect(result).toBe('Medida "exacta" de 10"');
  });

  it('resuelve campo con saltos de línea', () => {
    const ctx = { multiline: 'Línea 1\nLínea 2\nLínea 3' };
    const result = resolveField('{{multiline}}', ctx);
    expect(result).toBe('Línea 1\nLínea 2\nLínea 3');
  });

  it('resuelve campo con HTML peligroso (XSS) — resolveField devuelve el valor RAW', () => {
    const ctx = { malicious: '<script>alert("xss")</script>' };
    const result = resolveField('{{malicious}}', ctx);
    // NOTA: resolveField no escapa — devuelve el valor crudo.
    // El escape HTML ocurre en cada SECTION_RENDERER individual.
    expect(result).toBe('<script>alert("xss")</script>');
  });

  it('resuelve campo vacío como string vacío', () => {
    const ctx = { empty: '' };
    const result = resolveField('{{empty}}', ctx);
    expect(result).toBe('');
  });

  it('resuelve campo numérico en contexto', () => {
    const ctx = { amount: 42 };
    const result = resolveField('{{amount}}', ctx);
    expect(result).toBe('42');
  });
});
