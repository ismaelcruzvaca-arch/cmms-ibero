/**
 * pdf/index.js — Barrel export
 *
 * Exporta las funciones públicas del motor de templates PDF.
 */
export {
  resolveTemplate,
  validateTemplate,
  renderSection,
  evaluateCondition,
} from './templateEngine.js';
