/**
 * TemplatePreview.jsx
 * Componente de previsualización de templates PDF.
 *
 * Renderiza un iframe con srcdoc usando resolveTemplate() con mock data.
 * Props: { template, mockData }
 *
 * Estados:
 * - template === null → mensaje "Selecciona un template"
 * - template inválido (sin sections) → mensaje "Template inválido"
 * - success → iframe srcdoc con HTML renderizado
 */
import { useState, useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import { resolveTemplate } from '../../lib/pdf/templateEngine';

// ─────────────────────────────────────────────────────────────
// Mock data representativa para la previsualización
// Sigue el mismo shape que buildRenderData() en useReport.js
// ─────────────────────────────────────────────────────────────
const DEFAULT_MOCK_DATA = {
  title: 'OT-2026-0042 — Cambio de bomba centrífuga',
  badge: 'En Progreso',
  fields: [
    { label: 'Código', value: 'OT-2026-0042' },
    { label: 'Equipo', value: 'BOM-001 - Bomba Centrífuga 25HP' },
    { label: 'Descripción', value: 'Cambio de bomba centrífuga por desgaste de sello mecánico' },
    { label: 'Prioridad', value: 'Alta' },
    { label: 'Estado', value: 'En Progreso' },
    { label: 'Horas Plan.', value: '8' },
    { label: 'Horas Reales', value: '6.5' },
  ],
  labor: [
    { technician: 'Juan Pérez', hours: '4', work: 'Desmontaje de bomba existente' },
    { technician: 'María García', hours: '2.5', work: 'Preparación de sello mecánico nuevo' },
  ],
  materials: [
    { part: 'SEL-100', qty: 1, cost: '4500' },
    { part: 'TORN-M8', qty: 8, cost: '120' },
  ],
  work_order: {
    id: 'OT-2026-0042',
    equipment_id: 'BOM-001',
    description: 'Cambio de bomba centrífuga por desgaste de sello mecánico',
    priority: 'Alta',
    lifecycle_phase: 'En Progreso',
    planned_hours: 8,
    actual_hours: 6.5,
    assigned_to: 'Juan Pérez',
    scheduled_date: '2026-06-01',
    actual_start_at: '2026-06-02T08:00:00',
    completed_at: '',
  },
  asset: {
    id: 'AST-012',
    name: 'Bomba Centrífuga 25HP',
    description: 'Bomba centrífuga marca Grundfos, modelo CR 32-3',
    location: 'Planta Baja - Sala de Máquinas',
  },
  labor_records: [
    { technician_name: 'Juan Pérez', hours: 4, work: 'Desmontaje de bomba existente' },
    { technician_name: 'María García', hours: 2.5, work: 'Preparación de sello mecánico nuevo' },
  ],
  material_requests: [
    { part_num: 'SEL-100', requested_qty: 1, cost: '4500' },
    { part_num: 'TORN-M8', requested_qty: 8, cost: '120' },
  ],
  generated_at: new Date().toISOString(),
  generated_by: 'preview',
};

/**
 * Valida que el template tenga la estructura mínima requerida.
 * @param {Object|null} tpl
 * @returns {boolean}
 */
function isValidTemplate(tpl) {
  if (!tpl || typeof tpl !== 'object') return false;
  return Array.isArray(tpl.sections);
}

/**
 * @param {Object} props
 * @param {Object|null} props.template — Objeto template con { sections, ... } o null
 * @param {Object} [props.mockData] — Mock data para la preview (opcional, por defecto DEFAULT_MOCK_DATA)
 */
export default function TemplatePreview({ template, mockData }) {
  const [html, setHtml] = useState(null);
  const [state, setState] = useState(template ? 'loading' : 'empty'); // loading | empty | error | success
  const [errorMsg, setErrorMsg] = useState(null);
  const iframeRef = useRef(null);
  const prevTemplateRef = useRef(null);

  useEffect(() => {
    // Si el template no cambió, no re-renderizar
    if (template === prevTemplateRef.current) return;
    prevTemplateRef.current = template;

    let cancelled = false;

    const render = async () => {
      // Estado: template null
      if (template === null || template === undefined) {
        setState('empty');
        setHtml(null);
        setErrorMsg(null);
        return;
      }

      // Estado: template inválido
      if (!isValidTemplate(template)) {
        setState('error');
        setErrorMsg('Estructura de template inválida. Debe contener un array "sections".');
        setHtml(null);
        return;
      }

      // Estado: render exitoso
      try {
        setState('loading');
        const data = mockData || DEFAULT_MOCK_DATA;
        const rendered = resolveTemplate(template, data);

        if (cancelled) return;

        setHtml(rendered);
        setState('success');
        setErrorMsg(null);
      } catch (err) {
        if (cancelled) return;

        setState('error');
        setErrorMsg(err?.message || 'Error al renderizar el template');
        setHtml(null);
      }
    };

    render();

    return () => {
      cancelled = true;
    };
  }, [template, mockData]);

  // ── Loading ──
  if (state === 'loading') {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100%',
          minHeight: 400,
          gap: 2,
        }}
      >
        <CircularProgress size={40} />
        <Typography variant="body2" color="text.secondary">
          Renderizando preview...
        </Typography>
      </Box>
    );
  }

  // ── Empty (no template selected) ──
  if (state === 'empty') {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100%',
          minHeight: 400,
          p: 4,
        }}
      >
        <Alert severity="info" sx={{ maxWidth: 400 }}>
          Selecciona un template para ver la vista previa.
        </Alert>
      </Box>
    );
  }

  // ── Error ──
  if (state === 'error') {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          <Typography variant="subtitle2" gutterBottom>
            Error de sintaxis JSON
          </Typography>
          <Typography variant="body2">
            {errorMsg}
          </Typography>
        </Alert>
      </Box>
    );
  }

  // ── Success — iframe con srcdoc ──
  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        minHeight: 400,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Box
        ref={iframeRef}
        component="iframe"
        title="Vista previa del template"
        srcDoc={html}
        sx={{
          width: '100%',
          flex: 1,
          border: 'none',
          backgroundColor: '#fff',
        }}
        sandbox="allow-scripts"
      />
    </Box>
  );
}
