/**
 * DiagnosisPanel — Panel de diagnósticos de condición
 *
 * Muestra una tabla de diagnósticos activos para un activo con:
 *  - Modo de falla (nombre desde catálogo)
 *  - Confianza con gauge de color y tooltip de desglose
 *  - Badge de estado del diagnóstico
 *  - Conteo de eventos vinculados
 *  - Fecha de creación
 *  - Botón "Generar OT" (solo si active + confianza >= 0.7)
 *
 * Props:
 *  - assetId: ID del activo (obligatorio)
 *
 * Lenguaje: "probable/posible" en lugar de certeza absoluta.
 * Colores de confianza: rojo < 0.5, amarillo < 0.7, verde >= 0.7.
 * Estados de diagnóstico: candidate (gris), field_trial (azul),
 * active (verde), confirmed (verde oscuro), rejected (rojo).
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Tooltip,
  IconButton,
  Collapse,
  Button,
  LinearProgress,
  CircularProgress,
} from '@mui/material';
import {
  KeyboardArrowDown,
  KeyboardArrowUp,
  Send,
} from '@mui/icons-material';
import useDiagnoses from '../../hooks/useDiagnoses';
import FeedbackForm from './FeedbackForm';
import { supabase } from '../../lib/supabaseClient';

// ─── Constantes ─────────────────────────────────────────────────
const CONFIDENCE_COLORS = {
  low: '#f44336',    // < 0.5
  medium: '#ff9800', // 0.5 – 0.7
  high: '#4caf50',   // >= 0.7
};

const STATUS_CONFIG = {
  candidate:  { label: 'Candidato',  color: 'default' },
  field_trial: { label: 'Prueba Campo', color: 'info' },
  active:     { label: 'Activo',     color: 'success' },
  confirmed:  { label: 'Confirmado', color: 'success' },
  rejected:   { label: 'Rechazado',  color: 'error' },
};

// ─── Helpers ────────────────────────────────────────────────────

function getConfidenceColor(value) {
  if (value == null) return '#bdbdbd';
  if (value >= 0.7) return CONFIDENCE_COLORS.high;
  if (value >= 0.5) return CONFIDENCE_COLORS.medium;
  return CONFIDENCE_COLORS.low;
}

function getConfidenceLabel(value) {
  if (value == null) return 'Sin evaluar';
  if (value >= 0.7) return 'Probable';
  if (value >= 0.5) return 'Posible';
  return 'Poco probable';
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Fila expandible ────────────────────────────────────────────

function DiagnosisRow({ diagnosis, existingFeedback = [], onFeedbackSubmitted }) {
  const [open, setOpen] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [existingRec, setExistingRec] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const fm = diagnosis.failure_mode || {};
  const confidence = diagnosis.confidence;
  const breakdown = diagnosis.confidence_breakdown?.breakdown;

  const canGenerateWO =
    diagnosis.diagnosis_status === 'active' &&
    confidence != null &&
    confidence >= 0.7;

  const latestFeedback = existingFeedback.length > 0 ? existingFeedback[0] : null;

  // Fetch existing recommendation for this diagnosis
  useEffect(() => {
    if (!diagnosis.id) return;
    supabase
      .from('maintenance_recommendations')
      .select('id, status')
      .eq('diagnosis_id', diagnosis.id)
      .maybeSingle()
      .then(({ data }) => setExistingRec(data || null))
      .catch(() => setExistingRec(null));
  }, [diagnosis.id]);

  // RPC handlers
  const handleGenerateRec = useCallback(async () => {
    setActionLoading(true);
    try {
      const { error: rpcError } = await supabase
        .rpc('generate_recommendation_v2', { p_diagnosis_id: diagnosis.id });
      if (rpcError) throw new Error(rpcError.message);
      // Refresh existing rec
      const { data: recData } = await supabase
        .from('maintenance_recommendations')
        .select('id, status')
        .eq('diagnosis_id', diagnosis.id)
        .maybeSingle();
      setExistingRec(recData || null);
    } catch (err) {
      console.error('[DiagnosisPanel] Error generando recomendación:', err.message);
    } finally {
      setActionLoading(false);
    }
  }, [diagnosis.id]);

  const handleConvertToWO = useCallback(async () => {
    if (!existingRec) return;
    setActionLoading(true);
    try {
      const { data, error: rpcError } = await supabase
        .rpc('convert_recommendation_to_wo', { p_recommendation_id: existingRec.id });
      if (rpcError) throw new Error(rpcError.message);
      console.log('[DiagnosisPanel] OT creada:', data);
    } catch (err) {
      console.error('[DiagnosisPanel] Error convirtiendo a OT:', err.message);
    } finally {
      setActionLoading(false);
    }
  }, [existingRec]);

  // Tooltip de desglose de confianza
  const tooltipContent = breakdown ? (
    <Box sx={{ fontSize: '0.8rem', lineHeight: 1.6 }}>
      <Typography variant="caption" display="block" fontWeight="bold" gutterBottom>
        Desglose de confianza
      </Typography>
      <div>Evidencia: {breakdown.evidence_present ?? '—'} / {breakdown.evidence_total ?? '—'} presente</div>
      <div>Requerida: {breakdown.required_met ?? '—'} / {breakdown.required_total ?? '—'} cumplida</div>
      <div>Contradictoria: {breakdown.contradictory_count ?? 0} encontrada</div>
      <div>Calidad: {breakdown.quality_modifier != null ? (breakdown.quality_modifier * 100).toFixed(0) + '%' : '—'}</div>
      <div>Completez: {breakdown.completeness != null ? (breakdown.completeness * 100).toFixed(0) + '%' : '—'}</div>
    </Box>
  ) : (
    'Sin desglose disponible'
  );

  const FEEDBACK_STATUS_CHIP_COLOR = {
    confirmed: 'success',
    partial: 'info',
    rejected: 'error',
  };

  return (
    <>
      <TableRow sx={{ '&:last-child td, &:last-child th': { border: 0 } }}>
        <TableCell sx={{ p: '6px 8px', width: 40 }}>
          <IconButton size="small" onClick={() => setOpen(!open)}>
            {open ? <KeyboardArrowUp fontSize="small" /> : <KeyboardArrowDown fontSize="small" />}
          </IconButton>
        </TableCell>
        <TableCell>
          <Typography variant="body2" fontWeight={600}>
            {fm.name || '—'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {fm.failure_mode_key || ''}
          </Typography>
        </TableCell>
        <TableCell>
          <Tooltip title={tooltipContent} arrow placement="left">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer' }}>
              <Box sx={{ flex: 1, minWidth: 80 }}>
                <LinearProgress
                  variant="determinate"
                  value={(confidence ?? 0) * 100}
                  sx={{
                    height: 8,
                    borderRadius: 4,
                    bgcolor: '#e0e0e0',
                    '& .MuiLinearProgress-bar': {
                      bgcolor: getConfidenceColor(confidence),
                    },
                  }}
                />
              </Box>
              <Typography variant="caption" fontWeight={600} sx={{ color: getConfidenceColor(confidence), minWidth: 30 }}>
                {confidence != null ? (confidence * 100).toFixed(0) + '%' : '—'}
              </Typography>
            </Box>
          </Tooltip>
        </TableCell>
        <TableCell>
          <Chip
            label={STATUS_CONFIG[diagnosis.diagnosis_status]?.label || diagnosis.diagnosis_status}
            color={STATUS_CONFIG[diagnosis.diagnosis_status]?.color || 'default'}
            size="small"
            variant="outlined"
          />
        </TableCell>
        <TableCell align="center">
          <Typography variant="body2">{diagnosis.linked_event_count ?? 0}</Typography>
        </TableCell>
        <TableCell>
          {latestFeedback ? (
            <Chip
              label={latestFeedback.feedback_status}
              size="small"
              color={FEEDBACK_STATUS_CHIP_COLOR[latestFeedback.feedback_status] || 'default'}
              variant="outlined"
            />
          ) : (
            <Typography variant="caption" color="text.disabled">—</Typography>
          )}
        </TableCell>
        <TableCell>
          <Typography variant="caption" color="text.secondary">
            {formatDate(diagnosis.created_at)}
          </Typography>
        </TableCell>
        <TableCell>
          <Box sx={{ display: 'flex', gap: 0.5, flexDirection: 'column', alignItems: 'flex-start' }}>
            <Button
              variant="contained"
              size="small"
              disabled={!canGenerateWO || actionLoading}
              onClick={handleGenerateRec}
            >
              {actionLoading ? <CircularProgress size={14} /> : 'Generar Recomendación'}
            </Button>
            {existingRec?.status === 'approved' && (
              <Button
                variant="outlined"
                size="small"
                color="primary"
                disabled={actionLoading}
                onClick={handleConvertToWO}
              >
                Convertir a OT
              </Button>
            )}
          </Box>
        </TableCell>
      </TableRow>

      {/* ── Fila expandida: evidencia + feedback ── */}
      <TableRow>
        <TableCell colSpan={8} sx={{ p: 0, border: 0 }}>
          <Collapse in={open} timeout="auto" unmountOnExit>
            <Box sx={{ px: 3, py: 2, bgcolor: 'action.hover' }}>
              <Typography variant="subtitle2" gutterBottom fontWeight={600}>
                Resumen de evidencia
              </Typography>
              <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Confianza
                  </Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {getConfidenceLabel(confidence)} ({confidence != null ? (confidence * 100).toFixed(1) + '%' : '—'})
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Regla
                  </Typography>
                  <Typography variant="body2">
                    {diagnosis.evidence_summary?.rule_name || '—'}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Feature
                  </Typography>
                  <Typography variant="body2">
                    {diagnosis.evidence_summary?.feature_key || '—'}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Eventos vinculados
                  </Typography>
                  <Typography variant="body2">
                    {diagnosis.linked_event_count}
                  </Typography>
                </Box>
              </Box>

              {/* ── Feedback Section ── */}
              <Box sx={{ mt: 3, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
                <Typography variant="subtitle2" gutterBottom fontWeight={600}>
                  Feedback Técnico
                </Typography>
                {latestFeedback ? (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Chip
                        label={latestFeedback.feedback_status}
                        size="small"
                        color={FEEDBACK_STATUS_CHIP_COLOR[latestFeedback.feedback_status] || 'default'}
                      />
                      <Typography variant="caption" color="text.secondary">
                        por {latestFeedback.reviewed_by || '—'} el{' '}
                        {formatDate(latestFeedback.reviewed_at)}
                      </Typography>
                    </Box>
                    {latestFeedback.technician_observation && (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {latestFeedback.technician_observation}
                      </Typography>
                    )}
                    <Button
                      variant="text"
                      size="small"
                      onClick={() => setShowFeedback(!showFeedback)}
                      sx={{ alignSelf: 'flex-start', mt: 0.5 }}
                    >
                      {showFeedback ? 'Ocultar feedback' : 'Agregar otro feedback'}
                    </Button>
                  </Box>
                ) : (
                  !showFeedback && (
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<Send fontSize="small" />}
                      onClick={() => setShowFeedback(true)}
                    >
                      Enviar Feedback
                    </Button>
                  )
                )}
                {showFeedback && (
                  <Box sx={{ mt: 2 }}>
                    <FeedbackForm
                      diagnosisId={diagnosis.id}
                      onSubmit={() => {
                        setShowFeedback(false);
                        onFeedbackSubmitted?.();
                      }}
                    />
                  </Box>
                )}
              </Box>
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}

// ─── DiagnosisPanel ─────────────────────────────────────────────

export default function DiagnosisPanel({ assetId }) {
  const { diagnoses, isLoading, error } = useDiagnoses({ assetId });
  const [feedbackMap, setFeedbackMap] = useState({});

  const fetchFeedback = useCallback(async () => {
    if (diagnoses.length === 0) {
      setFeedbackMap({});
      return;
    }

    try {
      const ids = diagnoses.map((d) => d.id);
      const { data, error: fbError } = await supabase
        .from('condition_diagnosis_feedback')
        .select('*')
        .in('diagnosis_id', ids)
        .order('created_at', { ascending: false });

      if (fbError) throw new Error(fbError.message);

      const map = {};
      (data || []).forEach((fb) => {
        if (!map[fb.diagnosis_id]) map[fb.diagnosis_id] = [];
        map[fb.diagnosis_id].push(fb);
      });
      setFeedbackMap(map);
    } catch (err) {
      console.warn('[DiagnosisPanel] Error fetching feedback:', err);
    }
  }, [diagnoses]);

  useEffect(() => {
    fetchFeedback();
  }, [fetchFeedback]);

  const handleFeedbackSubmitted = useCallback(() => {
    fetchFeedback();
  }, [fetchFeedback]);

  // ─── Estados ──────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
        <Typography color="text.secondary">Cargando diagnósticos…</Typography>
      </Paper>
    );
  }

  if (error) {
    return (
      <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
        <Typography color="error">Error al cargar: {error}</Typography>
      </Paper>
    );
  }

  if (!assetId || diagnoses.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
        <Typography color="text.secondary">
          Sin diagnósticos activos
        </Typography>
        <Typography variant="caption" color="text.disabled" sx={{ mt: 1, display: 'block' }}>
          No se detectaron modos de falla probables para este activo.
        </Typography>
      </Paper>
    );
  }

  // ─── Tabla ────────────────────────────────────────────────────
  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 40 }} />
              <TableCell sx={{ fontWeight: 700 }}>Modo de Falla</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Confianza</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Estado</TableCell>
              <TableCell sx={{ fontWeight: 700 }} align="center">
                Eventos
              </TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Feedback</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Creado</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Acción</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {diagnoses.map((d) => (
              <DiagnosisRow
                key={d.id}
                diagnosis={d}
                existingFeedback={feedbackMap[d.id] || []}
                onFeedbackSubmitted={handleFeedbackSubmitted}
              />
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}
