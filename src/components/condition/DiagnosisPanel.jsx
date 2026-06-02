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

import { useState } from 'react';
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
} from '@mui/material';
import {
  KeyboardArrowDown,
  KeyboardArrowUp,
} from '@mui/icons-material';
import useDiagnoses from '../../hooks/useDiagnoses';

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

function DiagnosisRow({ diagnosis }) {
  const [open, setOpen] = useState(false);
  const fm = diagnosis.failure_mode || {};
  const confidence = diagnosis.confidence;
  const breakdown = diagnosis.confidence_breakdown?.breakdown;

  const canGenerateWO =
    diagnosis.diagnosis_status === 'active' &&
    confidence != null &&
    confidence >= 0.7;

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
          <Typography variant="caption" color="text.secondary">
            {formatDate(diagnosis.created_at)}
          </Typography>
        </TableCell>
        <TableCell>
          <Button
            variant="contained"
            size="small"
            disabled={!canGenerateWO}
            onClick={() => {
              console.log('[DiagnosisPanel] Generar OT para diagnóstico:', diagnosis.id);
            }}
          >
            Generar OT
          </Button>
        </TableCell>
      </TableRow>

      {/* ── Fila expandida: evidencia ── */}
      <TableRow>
        <TableCell colSpan={7} sx={{ p: 0, border: 0 }}>
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
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}

// ─── DiagnosisPanel ─────────────────────────────────────────────

export default function DiagnosisPanel({ assetId }) {
  const { diagnoses, isLoading, error, refresh } = useDiagnoses({ assetId });

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
              <TableCell sx={{ fontWeight: 700 }}>Creado</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Acción</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {diagnoses.map((d) => (
              <DiagnosisRow key={d.id} diagnosis={d} />
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}
