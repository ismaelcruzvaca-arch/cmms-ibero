/**
 * templateEngine.js
 * Motor de templates PDF. JS puro, 0 dependencias externas.
 * Corre idéntico en browser y Deno.
 *
 * Exporta: resolveField, evaluateCondition, renderSection,
 *          resolveTemplate, validateTemplate
 */
import {
  SECTION_RENDERERS,
  DEFAULT_CSS,
  resolveFieldInContext,
  evaluateConditionExpr,
  parsePipeCall,
  escapeHtml,
} from './templateDefaults.js';

export function resolveField(value, context) {
  return resolveFieldInContext(value, context);
}

export function evaluateCondition(expr, context) {
  return evaluateConditionExpr(expr, context);
}

export function renderSection(section, data, options) {
  const renderer = SECTION_RENDERERS[section.type];
  if (!renderer) return '';
  return renderer(section, data, options);
}

export function resolveTemplate(template, data, options = {}) {
  const sections = template?.sections || [];
  const css = options.css ? `${DEFAULT_CSS}\n${options.css}` : DEFAULT_CSS;
  const bodyHtml = sections
    .map((section) => renderSection(section, data, options))
    .filter(Boolean)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(template?.name || 'Reporte')}</title>
  <style>${css}</style>
</head>
<body>
  <div class="report-container">
    ${bodyHtml}
  </div>
</body>
</html>`;
}

const VALID_SECTION_TYPES = new Set([
  'header', 'title', 'section-title', 'details-grid', 'text-block',
  'label-value', 'table', 'badge', 'image', 'divider',
  'condition-block', 'footer', 'spacer',
]);

const VALID_PIPE_NAMES = new Set([
  'uppercase', 'lowercase', 'date', 'truncate', 'round',
  'default', 'notEmpty', 'json', 'number', 'first',
]);

export function validateTemplate(template) {
  const errors = [];
  if (!template || typeof template !== 'object') {
    return { valid: false, errors: ['Template debe ser un objeto'] };
  }
  if (!template.id) errors.push('Template debe tener un id');
  if (!template.name) errors.push('Template debe tener un name');
  if (!Array.isArray(template.sections)) {
    errors.push('Template.sections debe ser un array');
    return { valid: false, errors };
  }
  if (template.sections.length === 0) {
    errors.push('Template debe tener al menos una sección');
  }

  template.sections.forEach((section, i) => {
    if (!section.type) {
      errors.push(`Sección [${i}]: falta type`);
      return;
    }
    if (!VALID_SECTION_TYPES.has(section.type)) {
      errors.push(`Sección [${i}]: tipo "${section.type}" no es válido`);
    }
    Object.entries(section).forEach(([key, val]) => {
      if (typeof val !== 'string') return;
      const placeholders = val.match(/\{\{(.+?)\}\}/g);
      if (!placeholders) return;
      placeholders.forEach((ph) => {
        const inner = ph.slice(2, -2).trim();
        const parts = inner.split('|').map((p) => p.trim());
        for (let p = 1; p < parts.length; p++) {
          const parsed = parsePipeCall(parts[p]);
          if (!parsed) {
            errors.push(`Sección [${i}] key="${key}": pipe syntax inválido "${parts[p]}"`);
          } else if (!VALID_PIPE_NAMES.has(parsed.name)) {
            errors.push(`Sección [${i}] key="${key}": pipe "${parsed.name}" no es válido`);
          }
        }
      });
    });
  });

  const allText = JSON.stringify(template);
  const openCount = (allText.match(/\{\{/g) || []).length;
  const closeCount = (allText.match(/\}\}/g) || []).length;
  if (openCount !== closeCount) {
    errors.push(`Hay ${openCount} {{ pero ${closeCount} }} — placeholders sin cerrar`);
  }

  return { valid: errors.length === 0, errors };
}
