/**
 * visual-preview-pdf.mjs
 * Genera el HTML del reporte OT usando el template engine real
 * y lo guarda en dist/ para abrir en el navegador.
 *
 * Uso: node scripts/visual-preview-pdf.mjs
 */
import { resolveTemplate } from '../src/lib/pdf/templateEngine.js';
import { DEFAULT_TEMPLATE_OT } from '../src/lib/pdf/templateDefaults.js';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Mismo renderData que usa el test de integración
const renderData = {
  title: 'Orden de Trabajo SEED-WO-001',
  badge: 'COMPLETED',
  work_order: {
    equipment_id: 'EQ-PUMP-001',
    description: 'Reparación de bomba centrífuga — reemplazo de sello mecánico',
    wo_type: 'CM',
    priority: 'HIGH',
    lifecycle_phase: 'COMPLETED',
    actual_start_at: '2026-06-08T08:00:00Z',
    completed_at: '2026-06-08T16:30:00Z',
    actual_hours: 8.5,
  },
  labor_records: [
    {
      technician_name: 'Carlos Méndez',
      start_time: '2026-06-08T08:00:00Z',
      end_time: '2026-06-08T12:00:00Z',
      activity_code: 'REPAIR',
    },
    {
      technician_name: 'Carlos Méndez',
      start_time: '2026-06-08T13:00:00Z',
      end_time: '2026-06-08T16:30:00Z',
      activity_code: 'INSP',
    },
  ],
  material_requests: [
    {
      part_num: 'MECH-SEAL-001',
      line_desc: 'Sello mecánico 25mm — Viton/Carburo Silicio',
      requested_qty: 2,
    },
  ],
  generated_at: '2026-06-09T14:30:00Z',
  generated_by: 'system',
};

// Template OT corregido (versión que coincide con el seed de Supabase)
const templateOt = {
  id: 'ot-default',
  name: 'Orden de Trabajo',
  sections: [
    {
      type: 'header',
      titleField: 'title',
      badgeField: 'badge',
    },
    {
      type: 'details-grid',
      columns: 2,
      items: [
        { label: 'Equipo', value: '{{work_order.equipment_id}}' },
        { label: 'Descripción', value: '{{work_order.description}}' },
        { label: 'Tipo', value: '{{work_order.wo_type | wo_type_label}}' },
        { label: 'Prioridad', value: '{{work_order.priority | priority_label}}' },
        { label: 'Estado', value: '{{work_order.lifecycle_phase | status_label}}' },
        { label: 'Inicio real', value: '{{work_order.actual_start_at | datetime}}' },
        { label: 'Completado', value: '{{work_order.completed_at | datetime}}' },
        { label: 'Horas reales', value: '{{work_order.actual_hours | number}}' },
      ],
    },
    { type: 'divider' },
    {
      type: 'table',
      dataField: 'labor_records',
      columns: [
        { header: 'Técnico', key: 'technician_name' },
        { header: 'Inicio', key: 'start_time', pipe: 'datetime' },
        { header: 'Fin', key: 'end_time', pipe: 'datetime' },
        { header: 'Actividad', key: 'activity_code', pipe: 'activity_label' },
      ],
    },
    {
      type: 'condition-block',
      condition: 'material_requests | notEmpty',
      sections: [
        {
          type: 'table',
          dataField: 'material_requests',
          columns: [
            { header: 'Código', key: 'part_num' },
            { header: 'Descripción', key: 'line_desc' },
            { header: 'Cant.', key: 'requested_qty', pipe: 'number' },
          ],
        },
      ],
    },
    {
      type: 'footer',
      text: 'Generado por CMMS Ibero — {{generated_at | datetime}}',
    },
  ],
};

// Renderizar
const html = resolveTemplate(templateOt, renderData);

// Guardar
const outputPath = resolve(__dirname, '..', 'dist', 'reporte-preview.html');
writeFileSync(outputPath, html, 'utf-8');

console.log('✅ Reporte generado en:');
console.log(`   file://${outputPath.replace(/\\/g, '/')}`);
console.log('');
console.log('Abrí ese archivo en tu navegador y apretá Ctrl+P para ver la vista previa de impresión.');
