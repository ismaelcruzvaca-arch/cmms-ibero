/**
 * pdf/index.js — Barrel export
 *
 * Importa desde @cmms/pdf-engine (JSR) cuando está disponible,
 * con fallback local para desarrollo antes de publicar.
 *
 * Una vez publicado el paquete, esta carga dinámica puede reemplazarse
 * por una importación estática:
 *   export { resolveTemplate, validateTemplate, renderSection, evaluateCondition }
 *     from '@cmms/pdf-engine';
 */

let resolveTemplate, validateTemplate, renderSection, evaluateCondition;

try {
  // Intentar importar desde JSR (funciona tras publicar)
  const engine = await import('@cmms/pdf-engine');
  resolveTemplate = engine.resolveTemplate;
  validateTemplate = engine.validateTemplate;
  renderSection = engine.renderSection;
  evaluateCondition = engine.evaluateCondition;
} catch {
  // Fallback local durante desarrollo (antes de publicar)
  const local = await import('./templateEngine.js');
  resolveTemplate = local.resolveTemplate;
  validateTemplate = local.validateTemplate;
  renderSection = local.renderSection;
  evaluateCondition = local.evaluateCondition;
}

export { resolveTemplate, validateTemplate, renderSection, evaluateCondition };
