/**
 * @cmms/pdf-engine — Motor de templates PDF
 *
 * Punto de entrada del paquete JSR. Re-exporta todas las funciones
 * públicas del motor de templates para uso desde Edge Functions (Deno)
 * y frontend (Vite/browser).
 *
 * @module
 */

// Funciones principales del motor de templates
export {
  resolveTemplate,
  validateTemplate,
  renderSection,
  evaluateCondition,
  resolveField,
} from './templateEngine.js';

// Pipes, renderers y defaults
export { DEFAULT_PIPES } from './templateDefaults.js';
export { SECTION_RENDERERS } from './templateDefaults.js';
export { DEFAULT_CSS } from './templateDefaults.js';
export { DEFAULT_TEMPLATE_OT } from './templateDefaults.js';

// Helpers internos (útiles para integraciones avanzadas)
export { escapeHtml } from './templateDefaults.js';
export { resolveFieldInContext } from './templateDefaults.js';
export { resolveRawFromPath } from './templateDefaults.js';
export { resolveExpression } from './templateDefaults.js';
export { parsePipeCall } from './templateDefaults.js';
export { evaluateConditionExpr } from './templateDefaults.js';
