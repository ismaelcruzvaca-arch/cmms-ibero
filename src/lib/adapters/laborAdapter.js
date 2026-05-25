/**
 * LaborRecord Adapter
 * Mapea documentos RxDB de labor_records a ViewModel (camelCase)
 * Sigue el mismo patrón que workOrderAdapter.js
 */

/**
 * Convierte un documento RxDB de labor_record a ViewModel.
 * @param {Object|null} doc - Documento plano de RxDB (snake_case)
 * @returns {Object|null} ViewModel con claves camelCase
 */
export function toViewModel(doc) {
  if (!doc) return null;

  let durationHours = null;
  if (doc.end_time && doc.start_time) {
    const start = new Date(doc.start_time).getTime();
    const end = new Date(doc.end_time).getTime();
    durationHours = (end - start) / 3600000;
  }

  return {
    id: doc.id,
    workOrderId: doc.work_order_id || '',
    technicianId: doc.technician_id || '',
    startTime: doc.start_time || '',
    endTime: doc.end_time || null,
    activityCode: doc.activity_code || '',
    notes: doc.notes || '',
    deviceTimestamp: doc.device_timestamp || '',
    durationHours,
    createdAt: doc.created_at || '',
    updatedAt: doc.updated_at
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
