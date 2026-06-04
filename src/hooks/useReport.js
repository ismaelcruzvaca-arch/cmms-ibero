/**
 * useReport.js
 * Hook React para generar reportes PDF usando el motor de templates.
 *
 * Props: { templateCode, context }
 * - templateCode: string (ej: "work_order")
 * - context: { workOrder, asset, laborRecords, materialRequests }
 *
 * Retorna: { html, loading, error, empty, templateName, print, regenerate }
 *
 * Flujo:
 * 1. Buscar template activo en RxDB (report_templates)
 * 2. Si no está en RxDB, fetch de Supabase
 * 3. Renderizar con resolveTemplate() del templateEngine
 * 4. Si no hay template activo, usar DEFAULT_TEMPLATE_OT + empty: true
 * 5. Insertar en report_history vía RxDB (push para auditoría)
 * 6. print(): abrir ventana con HTML + window.print()
 * 7. regenerate(): re-ejecutar render
 */
import { useState, useEffect, useCallback, useRef, startTransition } from 'react';
import { initRxDB } from '../lib/rxdb';
import { supabase } from '../lib/supabaseClient';
import { resolveTemplate } from '../lib/pdf/templateEngine';
import { DEFAULT_TEMPLATE_OT } from '../lib/pdf/templateDefaults';

/**
 * @param {Object} params
 * @param {string} params.templateCode - Código del template (ej: "work_order")
 * @param {Object} [params.context] - Datos para el template { workOrder, asset, laborRecords, materialRequests }
 * @returns {{ html: string|null, loading: boolean, error: string|null, empty: boolean, templateName: string|null, print: () => void, regenerate: () => void }}
 */
export function useReport({ templateCode, context }) {
  const [html, setHtml] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [empty, setEmpty] = useState(false);
  const [templateName, setTemplateName] = useState(null);

  // Refs para evitar re-renders y manejar stale closures
  const templateRef = useRef(null);
  const contextRef = useRef(context);
  const renderCountRef = useRef(0);
  const loadingRef = useRef(false);

  // Mantener contextRef sincronizado con el context actual
  useEffect(() => {
    contextRef.current = context;
  }, [context]);

  const doRender = useCallback(async (tpl, data) => {
    const result = resolveTemplate(tpl, data);
    setHtml(result);
    return result;
  }, []);

  const generate = useCallback(async () => {
    // Evitar carreras si regenerate() se llama mientras ya está generando
    if (loadingRef.current) return;

    setLoading(true);
    setError(null);
    loadingRef.current = true;

    const renderId = ++renderCountRef.current;

    try {
      const db = await initRxDB();
      const currentContext = contextRef.current || {};

      // ── Paso 1: buscar template activo en RxDB ──
      let template = null;

      if (db.report_templates) {
        try {
          const rxDoc = await db.report_templates
            .findOne({ selector: { code: templateCode, is_active: true } })
            .exec();
          if (rxDoc) {
            template = rxDoc.toJSON();
          }
        } catch (rxErr) {
          console.warn('[useReport] RxDB query error:', rxErr);
        }
      }

      // ── Paso 2: si no está en RxDB, fetch de Supabase ──
      if (!template) {
        try {
          const { data: supabaseTemplate, error: supabaseError } = await supabase
            .from('report_templates')
            .select('*')
            .eq('code', templateCode)
            .eq('is_active', true)
            .single();

          if (supabaseError && supabaseError.code !== 'PGRST116') {
            // PGRST116 = no rows (no es error real)
            console.warn('[useReport] Supabase query error:', supabaseError);
          } else if (supabaseTemplate) {
            template = supabaseTemplate;
          }
        } catch (sbErr) {
          console.warn('[useReport] Supabase fetch error:', sbErr);
        }
      }

      // ── Paso 3: construir data del contexto ──
      const renderData = buildRenderData(currentContext);

      // ── Paso 4: renderizar ──
      let renderedHtml = '';
      let isEmpty = false;

      if (template) {
        templateRef.current = template;
        setTemplateName(template.name || templateCode);

        // El template JSONB puede estar en template.template (RxDB) o ser el objeto mismo (Supabase)
        const templateDef = template.template || template;
        renderedHtml = await doRender(templateDef, renderData);
      } else {
        // Fallback: DEFAULT_TEMPLATE_OT
        templateRef.current = DEFAULT_TEMPLATE_OT;
        setTemplateName(DEFAULT_TEMPLATE_OT.name);
        isEmpty = true;
        renderedHtml = await doRender(DEFAULT_TEMPLATE_OT, renderData);
      }

      // Prevenir stale updates
      if (renderId !== renderCountRef.current) return;

      setHtml(renderedHtml);
      setEmpty(isEmpty);

      // ── Paso 5: insertar en report_history ──
      if (db.report_history) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const userId = session?.user?.id || '';

          const historyId = crypto.randomUUID
            ? crypto.randomUUID()
            : 'rh-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

          const templateRecord = template || DEFAULT_TEMPLATE_OT;

          await db.report_history.insert({
            id: historyId,
            template_id: templateRecord.id || '',
            template_code: templateCode,
            template_version: templateRecord.version || 1,
            report_data: {
              context_snapshot: sanitizeContext(currentContext),
              generated_at: new Date().toISOString(),
            },
            generated_by: userId,
            generated_at: new Date().toISOString(),
            _deleted: false,
          });
        } catch (historyErr) {
          // No crítico — no fallar el reporte si falla la auditoría
          console.warn('[useReport] Error guardando report_history:', historyErr);
        }
      }
    } catch (err) {
      if (renderId === renderCountRef.current) {
        setError(err?.message || 'Error al generar el reporte');
      }
    } finally {
      if (renderId === renderCountRef.current) {
        setLoading(false);
        loadingRef.current = false;
      } else {
        loadingRef.current = false;
      }
    }
  }, [templateCode, doRender]);

  // ── regenerate: forzar re-render ──
  const regenerate = useCallback(() => {
    generate();
  }, [generate]);

  // ── print: ventana de impresión ──
  const print = useCallback(() => {
    const currentHtml = html;
    if (!currentHtml) return;

    try {
      const printWindow = window.open('', '_blank', 'width=800,height=600,menubar=0,toolbar=0');

      if (!printWindow) {
        setError(
          'No se pudo abrir la ventana de impresión. ' +
          'Verifica que los pop-ups estén permitidos para este sitio.',
        );
        return;
      }

      printWindow.document.write(currentHtml);
      printWindow.document.close();
      printWindow.focus();

      // Esperar carga antes de imprimir
      const doPrint = () => {
        try {
          printWindow.print();
        } catch (e) {
          console.warn('[useReport] print error:', e);
        }
      };

      printWindow.onload = doPrint;

      // Fallback: si el onload ya ocurrió o nunca se dispara
      setTimeout(() => {
        try {
          if (printWindow.document.readyState === 'complete') {
            doPrint();
          }
        } catch {
          // Ventana cerrada por el usuario
        }
      }, 1000);
    } catch {
      setError('Error al abrir ventana de impresión');
    }
  }, [html]);

  // ── Efecto inicial: generar al montar o cambiar templateCode ──
  useEffect(() => {
    startTransition(() => {
      generate();
    });
  }, [templateCode, generate]); // generate es estable via useCallback; context se lee via ref

  return {
    html,
    loading,
    error,
    empty,
    templateName,
    print,
    regenerate,
  };
}

// ============================================================
// Helpers
// ============================================================

/**
 * Convierte los datos del contexto a snake_case para los templates
 * y también construye los campos planos que espera DEFAULT_TEMPLATE_OT.
 */
function buildRenderData(context) {
  if (!context) return {};

  const { workOrder, asset, laborRecords, materialRequests } = context;

  // Convertir ViewModel camelCase a snake_case para compatibilidad
  // con templates de Supabase que referencian work_order.id, etc.
  const woSnake = workOrder
    ? {
        id: workOrder.id,
        equipment_id: workOrder.equipmentId || workOrder.equipment_id || '',
        description: workOrder.description || '',
        asset_id: workOrder.assetId || workOrder.asset_id || '',
        lifecycle_phase:
          workOrder.lifecyclePhase || workOrder.lifecycle_phase || '',
        priority: workOrder.priority || '',
        criticality: workOrder.criticality || '',
        wo_type: workOrder.woType || workOrder.wo_type || '',
        planned_hours:
          workOrder.plannedHours ?? workOrder.planned_hours ?? 0,
        actual_hours: workOrder.actualHours ?? workOrder.actual_hours ?? 0,
        scheduled_date:
          workOrder.scheduledDate || workOrder.scheduled_date || '',
        actual_start_at:
          workOrder.actualStartAt ||
          workOrder.actual_start_at ||
          '',
        completed_at:
          workOrder.completedAt || workOrder.completed_at || '',
        assigned_to:
          workOrder.assignedTo || workOrder.assigned_to || '',
        woTypeLabel: workOrder.woTypeLabel || '',
        criticalityColor: workOrder.criticalityColor || '',
        lifecycleLabel: workOrder.lifecycleLabel || '',
      }
    : {};

  // ── Formato DEFAULT_TEMPLATE_OT ──
  return {
    // Título y badge para el header del fallback
    title: workOrder?.description || `OT ${workOrder?.id || ''}`,
    badge: woSnake.lifecycle_phase || '',

    // fields planos para el fallback (field_table, que no tiene renderer pero se incluye)
    fields: workOrder
      ? [
          { label: 'Código', value: woSnake.id || '' },
          { label: 'Equipo', value: woSnake.equipment_id || '' },
          { label: 'Descripción', value: woSnake.description || '' },
          { label: 'Prioridad', value: woSnake.priority || '' },
          { label: 'Estado', value: woSnake.lifecycle_phase || '' },
          { label: 'Horas Plan.', value: String(woSnake.planned_hours ?? 0) },
          { label: 'Horas Reales', value: String(woSnake.actual_hours ?? 0) },
        ]
      : [],

    // labor records para el fallback
    labor: (laborRecords || []).map((lr) => ({
      technician:
        lr.technicianName ||
        lr.technician_name ||
        lr.technicianId ||
        lr.technician_id ||
        '',
      hours: String(lr.hours || lr.totalHours || lr.total_hours || ''),
      work: lr.work || lr.notes || lr.description || '',
    })),

    // materials para el fallback
    materials: (materialRequests || []).map((mr) => ({
      part: mr.partNum || mr.part_num || '',
      qty: mr.requestedQty || mr.requested_qty || 0,
      cost: mr.cost || mr.cost_estimate || '',
    })),

    // ── Formato Supabase template (referencia por paths como work_order.id) ──
    work_order: woSnake,
    asset: asset || {},
    labor_records: laborRecords || [],
    material_requests: materialRequests || [],
    generated_at: new Date().toISOString(),
    generated_by: '',
  };
}

/**
 * Sanitiza el contexto para guardar en report_history (evita datos muy grandes).
 */
function sanitizeContext(ctx) {
  if (!ctx) return {};
  const { workOrder, asset } = ctx;
  return {
    workOrder: workOrder
      ? { id: workOrder.id, description: workOrder.description }
      : null,
    asset: asset ? { id: asset.id, description: asset.description } : null,
  };
}

export default useReport;
