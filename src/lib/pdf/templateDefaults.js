/**
 * templateDefaults.js
 *
 * Constantes y funciones por defecto para el motor de templates PDF.
 * JS puro, 0 dependencias externas. Corre idéntico en browser y Deno.
 *
 * Exporta:
 * - DEFAULT_PIPES:          15 pipes para transformar valores
 * - SECTION_RENDERERS:      13 renderers por tipo de sección
 * - DEFAULT_CSS:            CSS @media print completo para reportes A4
 * - DEFAULT_TEMPLATE_OT:    Template offline de respaldo (6 secciones)
 *
 * Helpers internos (exportados para uso de templateEngine.js):
 * - resolveFieldInContext:  reemplaza placeholders {{...}} en un string
 * - resolveRawFromPath:     obtiene valor crudo de una ruta en el contexto
 * - resolveExpression:      resuelve expresión con pipes opcionales
 * - parsePipeCall:          parsea llamada a pipe (nombre + args)
 * - evaluateConditionExpr:  evalúa condición booleana contra contexto
 * - escapeHtml:             escapa caracteres HTML
 */

// ============================================
// DEFAULT_PIPES — 15 transformadores
// ============================================

/**
 * Formatea una fecha según el formato dado.
 * @param {Date|string|number} val
 * @param {string} fmt — formato como 'DD/MM/YYYY', 'YYYY-MM-DD', 'HH:mm'
 * @returns {string}
 */
function pipeDate(val, fmt) {
  if (val == null || val === '') return '';
  const d = val instanceof Date ? val : new Date(val);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  const map = {
    YYYY: d.getUTCFullYear(),
    MM: pad(d.getUTCMonth() + 1),
    DD: pad(d.getUTCDate()),
    HH: pad(d.getUTCHours()),
    mm: pad(d.getUTCMinutes()),
    ss: pad(d.getUTCSeconds()),
  };
  return fmt.replace(/YYYY|MM|DD|HH|mm|ss/g, (m) => map[m]);
}

/**
 * Trunca un string a N caracteres agregando "...".
 * @param {*} val
 * @param {number} n
 * @returns {string}
 */
function pipeTruncate(val, n) {
  const s = val == null ? '' : String(val);
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n)) + '...';
}

/**
 * Redondea un número a N decimales.
 * @param {*} val
 * @param {number} decimals
 * @returns {number|*}
 */
function pipeRound(val, decimals) {
  if (val == null) return 0;
  const n = Number(val);
  if (isNaN(n)) return val;
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

/**
 * Formatea un número con separadores de miles.
 * @param {*} val
 * @returns {string}
 */
function pipeNumber(val) {
  if (val == null) return '';
  const n = Number(val);
  if (isNaN(n)) return '';
  return n.toLocaleString('en-US');
}

export const DEFAULT_PIPES = {
  uppercase: (val) => String(val).toUpperCase(),

  lowercase: (val) => String(val).toLowerCase(),

  date: pipeDate,

  truncate: pipeTruncate,

  round: pipeRound,

  default: (val, def) => (val === null || val === undefined ? def : val),

  notEmpty: (val) => val !== null && val !== undefined && val !== '',

  json: (val) => JSON.stringify(val),

  number: pipeNumber,

  first: (val) => (Array.isArray(val) ? val[0] : val),

  // ── Lookup pipes (label maps) ──────────────

  /** Mapea lifecycle_phase / status a español */
  status_label: (val) =>
    ({ OPEN: 'Abierta', IN_PROGRESS: 'En Progreso', COMPLETED: 'Completada', CANCELLED: 'Cancelada' })[val] ?? val,

  /** Mapea WO type code a español */
  wo_type_label: (val) =>
    ({ CM: 'Correctivo', PM: 'Preventivo', EM: 'Emergencia', PROJECT: 'Proyecto' })[val] ?? val,

  /** Mapea priority code a español */
  priority_label: (val) =>
    ({ HIGH: 'Alta', MEDIUM: 'Media', LOW: 'Baja' })[val] ?? val,

  /** Mapea activity code a español */
  activity_label: (val) =>
    ({ INSP: 'Inspección', REPAIR: 'Reparación', INSTALL: 'Instalación', REMOVE: 'Retiro' })[val] ?? val,

  /** Alias de date() con formato fijo DD/MM/YYYY HH:mm */
  datetime: (val) => pipeDate(val, 'DD/MM/YYYY HH:mm'),
};

// ============================================
// SECTION_RENDERERS — 13 tipos de sección
// ============================================

/**
 * Renderiza una sección del template a HTML.
 * Cada renderer recibe (section, data, options) y retorna HTML string.
 */
export const SECTION_RENDERERS = {
  header(section, data, options) {
    const branding = options?.branding || {};
    // Logo: primero de branding, luego de logoField en datos
    const logo = branding.logo || (section.logoField ? data[section.logoField] : '') || '';
    const title = section.titleField ? data[section.titleField] : (section.title || '');
    const badge = section.badgeField ? data[section.badgeField] : (section.badge || '');
    return `
    <div class="report-header">
      ${logo ? `<img src="${escapeHtml(logo)}" class="report-logo" alt="Logo" />` : ''}
      <h1 class="report-header-title">${escapeHtml(title)}</h1>
      ${badge ? `<span class="badge badge-${escapeHtml(String(badge).toLowerCase())}">${escapeHtml(badge)}</span>` : ''}
    </div>`;
  },

  title(section, data) {
    const text = resolveFieldInContext(section.text, data);
    return `<h1 class="report-title">${text}</h1>`;
  },

  'section-title'(section, data) {
    const text = resolveFieldInContext(section.text, data);
    return `<h2 class="report-section-title">${text}</h2>`;
  },

  'details-grid'(section, data) {
    const cols = section.columns || 2;
    const items = section.items || [];
    const rendered = items
      .map((item) => {
        const label = resolveFieldInContext(item.label, data);
        const value = resolveFieldInContext(item.value, data);
        return `<div class="detail-item"><span class="detail-label">${label}</span><span class="detail-value">${value}</span></div>`;
      })
      .join('');
    return `<div class="details-grid" style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:8px;">${rendered}</div>`;
  },

  'text-block'(section, data) {
    const text = resolveFieldInContext(section.text, data);
    return `<p class="report-text-block">${text}</p>`;
  },

  'label-value'(section, data) {
    const label = resolveFieldInContext(section.label, data);
    const value = resolveFieldInContext(section.value, data);
    return `<div class="report-label-value"><span class="report-label">${label}:</span> <span class="report-value">${value}</span></div>`;
  },

  table(section, data) {
    const columns = section.columns || [];
    const rows = resolveRawFromPath(section.dataField, data) || [];
    const thead = columns
      .map((col) => `<th>${escapeHtml(col.header || col.key)}</th>`)
      .join('');
    const tbody = rows
      .map(
        (row) =>
          `<tr>${columns.map((col) => `<td>${escapeHtml(resolveRawFromPath(col.key, row) ?? '')}</td>`).join('')}</tr>`,
      )
      .join('');
    return `<table class="report-table"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
  },

  badge(section, data) {
    const value = resolveFieldInContext(section.value, data);
    return `<span class="badge badge-${escapeHtml(String(value).toLowerCase())}">${value}</span>`;
  },

  image(section, data) {
    const src = resolveFieldInContext(section.src, data);
    return `<div class="report-image-wrapper"><img src="${src}" class="report-image" alt="" /></div>`;
  },

  divider() {
    return '<hr class="report-divider" />';
  },

  'condition-block'(section, data) {
    const conditionMet = evaluateConditionExpr(section.condition, data);
    if (!conditionMet) return '';
    const innerSections = section.sections || [];
    return innerSections
      .map((s) => {
        const renderer = SECTION_RENDERERS[s.type];
        return renderer ? renderer(s, data, {}) : '';
      })
      .join('\n');
  },

  footer(section, data) {
    const text = resolveFieldInContext(section.text, data);
    return `<div class="report-footer">${text}</div>`;
  },

  spacer(section) {
    const height = section.height || 10;
    return `<div class="report-spacer" style="height:${height}px;"></div>`;
  },
};

// ============================================
// Helpers internos (exportados para templateEngine.js)
// ============================================

/**
 * Escapa caracteres HTML para evitar inyección en el reporte.
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Resuelve placeholders {{...}} en un string usando el contexto dado.
 * @param {string} value
 * @param {object} context
 * @returns {string}
 */
export function resolveFieldInContext(value, context) {
  if (typeof value !== 'string') return String(value ?? '');
  return value.replace(/\{\{(.+?)\}\}/g, (_match, expr) => {
    const resolved = resolveExpression(expr.trim(), context);
    return resolved != null ? String(resolved) : '';
  });
}

/**
 * Resuelve un valor crudo desde una ruta de datos (sin pipes).
 * @param {string} path
 * @param {object} context
 * @returns {*}
 */
export function resolveRawFromPath(path, context) {
  if (!context || !path) return undefined;
  // Soporta paths como "fields[0].value" y "items.0.name"
  const parts = path.split('.');
  let current = context;
  for (let part of parts) {
    if (current == null) return undefined;
    // Maneja bracket notation: "field[0]" o "items[1]"
    const bracketMatch = part.match(/^([^[]+)\[(\d+)\]$/);
    if (bracketMatch) {
      const key = bracketMatch[1];
      const index = Number(bracketMatch[2]);
      current = current[key];
      if (current == null) return undefined;
      current = Array.isArray(current) ? current[index] : current[String(index)];
    } else {
      current = current[part];
    }
  }
  return current;
}

/**
 * Resuelve una expresión completa (con pipes opcionales) contra el contexto.
 * @param {string} expression — ej: "task.title | uppercase | truncate(10)"
 * @param {object} context
 * @returns {*}
 */
export function resolveExpression(expression, context) {
  const parts = expression.split('|').map((p) => p.trim());
  const fieldPath = parts[0];
  const pipeExprs = parts.slice(1);

  // Buscar valor en contexto — resolveRawFromPath ya soporta bracket notation inline
  let value = resolveRawFromPath(fieldPath, context);

  if (pipeExprs.length === 0) return value;

  for (const pipeExpr of pipeExprs) {
    const parsed = parsePipeCall(pipeExpr);
    if (!parsed) continue;
    const { name, args } = parsed;
    const pipeFn = DEFAULT_PIPES[name];
    if (!pipeFn) continue;
    value = pipeFn(value, ...args);
  }

  return value;
}

/**
 * Parsea una llamada a pipe: "uppercase", "date('DD/MM/YYYY')", "truncate(20)"
 * @param {string} expr
 * @returns {{ name: string, args: array } | null}
 */
export function parsePipeCall(expr) {
  const match = expr.match(/^(\w+)(?:\(([^)]*)\))?$/);
  if (!match) return null;
  const name = match[1];
  const argsStr = match[2];
  const args = [];
  if (argsStr !== undefined) {
    // Parsea argumentos: strings con comillas simples/dobles y números
    const argRegex = /'([^']*)'|"([^"]*)"|(\d+(?:\.\d+)?)/g;
    let m;
    while ((m = argRegex.exec(argsStr)) !== null) {
      if (m[1] !== undefined) args.push(m[1]);
      else if (m[2] !== undefined) args.push(m[2]);
      else args.push(Number(m[3]));
    }
  }
  return { name, args };
}

/**
 * Evalúa una condición simple contra el contexto.
 * @param {string} condition — ej: "status | notEmpty", "status == 'COMP'", "value > 5"
 * @param {object} context
 * @returns {boolean}
 */
export function evaluateConditionExpr(condition, context) {
  if (!condition) return true;
  const expr = condition.trim();

  // notEmpty pipe
  const notEmptyMatch = expr.match(/^(.+?)\s*\|\s*notEmpty$/);
  if (notEmptyMatch) {
    const resolved = resolveExpression(notEmptyMatch[1].trim(), context);
    return resolved !== null && resolved !== undefined && resolved !== '';
  }

  // Operadores de comparación: ==, !=, >=, <=, >, <
  const compareMatch = expr.match(
    /^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/,
  );
  if (compareMatch) {
    const [, left, op, right] = compareMatch;
    const leftVal = resolveExpression(left.trim(), context);
    const rightRaw = right.trim();
    // Intenta parsear el valor derecho como número o string
    const rightVal =
      rightRaw.match(/^'[^']*'$/i) || rightRaw.match(/^"[^"]*"$/i)
        ? rightRaw.slice(1, -1)
        : !isNaN(Number(rightRaw))
          ? Number(rightRaw)
          : resolveExpression(rightRaw, context) ?? rightRaw;

    switch (op) {
      case '==':
        return leftVal == rightVal;
      case '!=':
        return leftVal != rightVal;
      case '>=':
        return Number(leftVal) >= Number(rightVal);
      case '<=':
        return Number(leftVal) <= Number(rightVal);
      case '>':
        return Number(leftVal) > Number(rightVal);
      case '<':
        return Number(leftVal) < Number(rightVal);
      default:
        return false;
    }
  }

  // Truthiness simple del campo
  const resolved = resolveRawFromPath(expr, context);
  return resolved !== null && resolved !== undefined && resolved !== '' && resolved !== false && resolved !== 0;
}

// ============================================
// DEFAULT_CSS — @media print completo
// ============================================

export const DEFAULT_CSS = `
@media print {
  @page {
    size: A4;
    margin: 15mm 20mm;
  }
  body {
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 11pt;
    color: #1a1a1a;
    line-height: 1.5;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .report-container {
    max-width: 190mm;
    margin: 0 auto;
    padding: 0;
  }
  .report-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 2px solid #1e3a5f;
    padding-bottom: 10px;
    margin-bottom: 16px;
  }
  .report-logo {
    max-height: 50px;
    max-width: 120px;
  }
  .report-header-title {
    font-size: 16pt;
    color: #1e3a5f;
    margin: 0;
    flex: 1;
    text-align: center;
  }
  .report-title {
    font-size: 18pt;
    text-align: center;
    color: #1e3a5f;
    margin: 20px 0;
  }
  .report-section-title {
    font-size: 13pt;
    color: #2c5f8a;
    border-bottom: 1px solid #b0c4de;
    padding-bottom: 4px;
    margin: 16px 0 8px;
  }
  .details-grid {
    margin-bottom: 12px;
  }
  .detail-item {
    padding: 4px 8px;
    border-bottom: 1px solid #e0e0e0;
  }
  .detail-label {
    font-weight: 600;
    color: #555;
    margin-right: 6px;
  }
  .detail-value {
    color: #1a1a1a;
  }
  .report-text-block {
    margin: 8px 0;
    text-align: justify;
  }
  .report-label-value {
    margin: 4px 0;
  }
  .report-label {
    font-weight: 600;
  }
  .report-table {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0;
    page-break-inside: avoid;
  }
  .report-table th {
    background-color: #1e3a5f;
    color: #fff;
    padding: 6px 10px;
    text-align: left;
    font-size: 10pt;
  }
  .report-table td {
    padding: 5px 10px;
    border-bottom: 1px solid #d0d0d0;
    font-size: 10pt;
  }
  .report-table tr:nth-child(even) td {
    background-color: #f5f8fc;
  }
  .badge {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 12px;
    font-size: 9pt;
    font-weight: 600;
    text-transform: uppercase;
    background-color: #e0e0e0;
    color: #333;
  }
  .badge-comp, .badge-completed { background-color: #4caf50; color: #fff; }
  .badge-inprg, .badge-in-progress { background-color: #2196f3; color: #fff; }
  .badge-waiting, .badge-wappr { background-color: #ff9800; color: #fff; }
  .badge-cancelled { background-color: #9e9e9e; color: #fff; }
  .badge-rejected { background-color: #f44336; color: #fff; }
  .report-image-wrapper {
    text-align: center;
    margin: 12px 0;
  }
  .report-image {
    max-width: 100%;
    max-height: 300px;
  }
  .report-divider {
    border: none;
    border-top: 1px solid #ccc;
    margin: 16px 0;
  }
  .report-footer {
    margin-top: 24px;
    padding-top: 8px;
    border-top: 1px solid #ccc;
    font-size: 9pt;
    color: #777;
    text-align: center;
  }
  .report-spacer {
    display: block;
  }
}
`;

// ============================================
// DEFAULT_TEMPLATE_OT — template offline de respaldo
// ============================================

export const DEFAULT_TEMPLATE_OT = {
  id: 'ot-default',
  name: 'Orden de Trabajo (fallback offline)',
  description: 'Template por defecto para impresión de Órdenes de Trabajo',
  sections: [
    {
      type: 'header',
      titleField: 'title',
      badgeField: 'badge',
    },
    {
      type: 'field_table',
      columns: [
        { key: 'label', header: 'Campo' },
        { key: 'value', header: 'Valor' },
      ],
      dataField: 'fields',
    },
    {
      type: 'divider',
    },
    {
      type: 'labor-table',
      columns: [
        { key: 'technician', header: 'Técnico' },
        { key: 'hours', header: 'Horas' },
        { key: 'work', header: 'Trabajo Realizado' },
      ],
      dataField: 'labor',
    },
    {
      type: 'materials-conditional',
      condition: 'materials | notEmpty',
      sections: [
        {
          type: 'table',
          columns: [
            { key: 'part', header: 'Parte' },
            { key: 'qty', header: 'Cant.' },
            { key: 'cost', header: 'Costo' },
          ],
          dataField: 'materials',
        },
      ],
    },
    {
      type: 'footer',
      text: 'Generado por CMMS Ibero — {{date("DD/MM/YYYY HH:mm")}}',
    },
  ],
};
