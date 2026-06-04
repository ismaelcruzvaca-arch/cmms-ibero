/**
 * ReportTemplate Adapter
 * Mapea documentos RxDB de report_templates a ViewModel (camelCase)
 * Sigue el mismo patrón que laborAdapter.js y fmeaAdapter.js
 */

/**
 * Convierte un documento RxDB de report_template a ViewModel.
 * @param {Object|null} doc - Documento plano de RxDB (snake_case)
 * @returns {Object|null} ViewModel con claves camelCase
 */
export function toViewModel(doc) {
  if (!doc) return null;

  return {
    id: doc.id,
    code: doc.code || '',
    version: doc.version || 1,
    name: doc.name || '',
    description: doc.description || '',
    template: doc.template || null,
    isActive: doc.is_active ?? true,
    createdBy: doc.created_by || '',
    createdAt: doc.created_at || '',
    updatedAt: doc.updated_at || null
  };
}

/**
 * Convierte un array de documentos RxDB a ViewModels.
 * @param {Array} docs
 * @returns {Array} ViewModels
 */
export function toViewModelList(docs) {
  if (!Array.isArray(docs)) return [];
  return docs.map(toViewModel);
}

export default toViewModel;
