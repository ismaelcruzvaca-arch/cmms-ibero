/**
 * Integration test: PDF Engine + Supabase seed template
 *
 * Verifica el pipeline completo:
 *   Supabase (template 'ot-default') → resolveTemplate() → HTML sin placeholders
 *
 * Requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY en el entorno.
 * Se salta automáticamente si no están configurados.
 */
import { describe, it, expect } from 'vitest';
import { resolveTemplate } from '../templateEngine.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Dynamically import createClient only when needed
async function getSupabase() {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
}

/**
 * Construye renderData que coincide con la estructura del template
 * corregido (details-grid items, table dataField, etc.)
 */
function buildRenderData() {
  return {
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
  };
}

describe.skipIf(!SUPABASE_URL || !SERVICE_ROLE_KEY)(
  'pdfEngine Supabase Integration',
  () => {
    it('fetch template ot-default, render, verify no {{...}} placeholders + pipe outputs', async () => {
      const supabase = await getSupabase();

      // Fetch template from Supabase
      const { data: row, error } = await supabase
        .from('report_templates')
        .select('template')
        .eq('code', 'ot-default')
        .eq('version', 1)
        .maybeSingle();

      expect(error).toBeNull();
      expect(row).not.toBeNull();
      expect(row.template).toBeDefined();

      const templateBody =
        typeof row.template === 'object' && row.template !== null
          ? row.template
          : {};

      const renderData = buildRenderData();

      // Render HTML
      const html = resolveTemplate(templateBody, renderData);

      // Verify NO unresolved {{...}} placeholders remain
      expect(html).not.toMatch(/\{\{.+?\}\}/);

      // Verify seed WO description (via details-grid)
      expect(html).toContain('Reparación de bomba centrífuga');

      // Verify asset equipment_id (via details-grid)
      expect(html).toContain('EQ-PUMP-001');

      // Verify pipe output: wo_type_label('CM') = 'Correctivo'
      expect(html).toContain('Correctivo');

      // Verify pipe output: priority_label('HIGH') = 'Alta'
      expect(html).toContain('Alta');

      // Verify pipe output: datetime format (e.g., '08/06/2026 08:00')
      expect(html).toMatch(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);

      // Verify pipe output: number format (e.g., '8.5')
      expect(html).toContain('8.5');

      // Verify footer with datetime
      expect(html).toContain('Generado por CMMS Ibero');
      expect(html).toContain('09/06/2026 14:30');

      // Verify header renders title
      expect(html).toContain('SEED-WO-001');

      // Verify condition-block rendered (material_requests is not empty)
      expect(html).toContain('MECH-SEAL-001');
    });
  },
);
