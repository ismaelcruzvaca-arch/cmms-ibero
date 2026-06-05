/**
 * RecommendationList — Lista de recomendaciones de mantenimiento
 *
 * Muestra una tabla filtrable de recomendaciones con acciones
 * según el estado: Approve, Dismiss, Supersede, Convertir a OT.
 *
 * Props:
 *  - assetId (opcional): filtra recomendaciones para un activo específico
 *
 * Lenguaje: español. Todos los textos de UI en español.
 * Estados: carga (Skeleton), vacío, error.
 */

import { useState, useCallback } from 'react';
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
  Button,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  TextField,
  Skeleton,
  Alert,
  IconButton,
  Snackbar,
  Tooltip,
} from '@mui/material';
import {
  CheckCircle,
  CancelOutlined,
  SwapHoriz,
  Build,
  Refresh,
} from '@mui/icons-material';
import useRecommendationList from '../../hooks/useRecommendationList';

// ─── Constantes ─────────────────────────────────────────────────

const PRIORITY_CONFIG = {
  critical: { label: 'Crítica', color: 'error' },
  high:     { label: 'Alta',    color: 'warning' },
  medium:   { label: 'Media',   color: 'warning' },
  low:      { label: 'Baja',    color: 'default' },
};

const STATUS_CONFIG = {
  suggested:        { label: 'Sugerida',       color: 'default' },
  review_required:  { label: 'Revisión Req.',   color: 'warning' },
  approved:         { label: 'Aprobada',        color: 'success' },
  converted_to_wo:  { label: 'Convertida a OT', color: 'info' },
  dismissed:        { label: 'Descartada',      color: 'default' },
  superseded:       { label: 'Reemplazada',     color: 'default' },
  expired:          { label: 'Expirada',        color: 'default' },
};

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pendientes' },
  { value: 'suggested', label: 'Sugerida' },
  { value: 'review_required', label: 'Revisión Requerida' },
  { value: 'approved', label: 'Aprobada' },
  { value: 'converted_to_wo', label: 'Convertida a OT' },
  { value: 'dismissed', label: 'Descartada' },
  { value: 'superseded', label: 'Reemplazada' },
  { value: 'expired', label: 'Expirada' },
  { value: 'all', label: 'Todas' },
];

const PRIORITY_OPTIONS = [
  { value: '', label: 'Todas' },
  { value: 'critical', label: 'Crítica' },
  { value: 'high', label: 'Alta' },
  { value: 'medium', label: 'Media' },
  { value: 'low', label: 'Baja' },
];

// ─── Helpers ────────────────────────────────────────────────────

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

function mapStatusFilter(value) {
  if (value === 'all' || value === '') return null;
  if (value === 'pending') return ['suggested', 'review_required'];
  return value;
}

// ─── Row Actions ────────────────────────────────────────────────

function ActionButtons({ rec, onApprove, onDismiss, onSupersede, onConvert }) {
  const { status } = rec;

  if (status === 'suggested' || status === 'review_required') {
    return (
      <Box sx={{ display: 'flex', gap: 0.5 }}>
        <Tooltip title="Aprobar recomendación">
          <Button
            variant="contained"
            size="small"
            color="success"
            startIcon={<CheckCircle fontSize="small" />}
            onClick={() => onApprove(rec.id)}
            sx={{ minWidth: 0, px: 1.5, whiteSpace: 'nowrap' }}
          >
            Aprobar
          </Button>
        </Tooltip>
        <Tooltip title="Descartar recomendación">
          <Button
            variant="outlined"
            size="small"
            color="error"
            startIcon={<CancelOutlined fontSize="small" />}
            onClick={() => onDismiss(rec.id)}
            sx={{ minWidth: 0, px: 1.5, whiteSpace: 'nowrap' }}
          >
            Descartar
          </Button>
        </Tooltip>
      </Box>
    );
  }

  if (status === 'approved') {
    return (
      <Box sx={{ display: 'flex', gap: 0.5 }}>
        <Tooltip title="Convertir a orden de trabajo">
          <Button
            variant="contained"
            size="small"
            color="primary"
            startIcon={<Build fontSize="small" />}
            onClick={() => onConvert(rec.id)}
            sx={{ minWidth: 0, px: 1.5, whiteSpace: 'nowrap' }}
          >
            Convertir a OT
          </Button>
        </Tooltip>
        <Tooltip title="Reemplazar con otra recomendación">
          <Button
            variant="outlined"
            size="small"
            startIcon={<SwapHoriz fontSize="small" />}
            onClick={() => onSupersede(rec.id)}
            sx={{ minWidth: 0, px: 1.5, whiteSpace: 'nowrap' }}
          >
            Superseder
          </Button>
        </Tooltip>
      </Box>
    );
  }

  return (
    <Typography variant="caption" color="text.disabled">
      —
    </Typography>
  );
}

// ─── RecommendationList ─────────────────────────────────────────

export default function RecommendationList({ assetId }) {
  const {
    recommendations,
    loading,
    error,
    filter,
    setFilter,
    approveRec,
    dismissRec,
    supersedeRec,
    convertToWO,
    refresh,
  } = useRecommendationList({ assetId });

  // ─── Estado local para diálogos ───────────────────────────────
  const [approveDialog, setApproveDialog] = useState({ open: false, id: null });
  const [dismissDialog, setDismissDialog] = useState({ open: false, id: null });
  const [dismissReason, setDismissReason] = useState('');
  const [dismissError, setDismissError] = useState('');
  const [supersedeDialog, setSupersedeDialog] = useState({ open: false, id: null, newRecId: '' });
  const [convertDialog, setConvertDialog] = useState({ open: false, id: null });
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [actionLoading, setActionLoading] = useState(false);

  // ─── Mapeo del filtro interno a UI ────────────────────────────
  const statusValue = Array.isArray(filter.status)
    ? 'pending'
    : filter.status || 'all';
  const priorityValue = filter.priority || '';

  const handleStatusChange = useCallback((value) => {
    setFilter({ status: mapStatusFilter(value) });
  }, [setFilter]);

  const handlePriorityChange = useCallback((value) => {
    setFilter({ priority: value || null });
  }, [setFilter]);

  // ─── Handlers de acciones ─────────────────────────────────────
  const handleApprove = useCallback(async (id) => {
    setActionLoading(true);
    try {
      await approveRec(id);
      setSnackbar({ open: true, message: 'Recomendación aprobada', severity: 'success' });
    } catch (err) {
      setSnackbar({ open: true, message: `Error: ${err.message}`, severity: 'error' });
    } finally {
      setActionLoading(false);
      setApproveDialog({ open: false, id: null });
    }
  }, [approveRec]);

  const handleDismiss = useCallback(async () => {
    if (!dismissReason.trim()) {
      setDismissError('El motivo es obligatorio');
      return;
    }
    setActionLoading(true);
    try {
      await dismissRec(dismissDialog.id, dismissReason);
      setSnackbar({ open: true, message: 'Recomendación descartada', severity: 'success' });
      setDismissDialog({ open: false, id: null });
      setDismissReason('');
      setDismissError('');
    } catch (err) {
      setSnackbar({ open: true, message: `Error: ${err.message}`, severity: 'error' });
    } finally {
      setActionLoading(false);
    }
  }, [dismissDialog, dismissReason, dismissRec]);

  const handleSupersede = useCallback(async () => {
    if (!supersedeDialog.newRecId.trim()) {
      setSnackbar({ open: true, message: 'Ingresá el ID de la nueva recomendación', severity: 'warning' });
      return;
    }
    setActionLoading(true);
    try {
      await supersedeRec(supersedeDialog.id, supersedeDialog.newRecId);
      setSnackbar({ open: true, message: 'Recomendación reemplazada', severity: 'success' });
      setSupersedeDialog({ open: false, id: null, newRecId: '' });
    } catch (err) {
      setSnackbar({ open: true, message: `Error: ${err.message}`, severity: 'error' });
    } finally {
      setActionLoading(false);
    }
  }, [supersedeDialog, supersedeRec]);

  const handleConvert = useCallback(async (id) => {
    setActionLoading(true);
    try {
      const woId = await convertToWO(id);
      setSnackbar({
        open: true,
        message: `OT creada exitosamente (ID: ${woId})`,
        severity: 'success',
      });
      setConvertDialog({ open: false, id: null });
    } catch (err) {
      setSnackbar({ open: true, message: `Error: ${err.message}`, severity: 'error' });
    } finally {
      setActionLoading(false);
    }
  }, [convertToWO]);

  // ─── Loading ──────────────────────────────────────────────────
  if (loading) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
          <Skeleton variant="rounded" width={200} height={40} />
          <Skeleton variant="rounded" width={150} height={40} />
        </Box>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} variant="rounded" height={52} sx={{ mb: 1 }} />
        ))}
      </Paper>
    );
  }

  // ─── Error ────────────────────────────────────────────────────
  if (error) {
    return (
      <Alert
        severity="error"
        variant="outlined"
        action={
          <IconButton color="inherit" size="small" onClick={refresh}>
            <Refresh />
          </IconButton>
        }
      >
        Error al cargar recomendaciones: {error}
      </Alert>
    );
  }

  // ─── Empty state ──────────────────────────────────────────────
  const hasActiveFilters = filter.status || filter.priority;
  const isEmpty = !loading && recommendations.length === 0;

  if (isEmpty) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Estado</InputLabel>
            <Select
              value={statusValue}
              label="Estado"
              onChange={(e) => handleStatusChange(e.target.value)}
            >
              {STATUS_OPTIONS.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel>Prioridad</InputLabel>
            <Select
              value={priorityValue}
              label="Prioridad"
              onChange={(e) => handlePriorityChange(e.target.value)}
            >
              {PRIORITY_OPTIONS.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <Typography variant="h6" color="text.secondary" gutterBottom>
            {hasActiveFilters ? 'Sin recomendaciones' : 'Sin recomendaciones pendientes'}
          </Typography>
          <Typography variant="body2" color="text.disabled" sx={{ mb: 2 }}>
            {hasActiveFilters
              ? 'No hay recomendaciones que coincidan con los filtros actuales.'
              : 'No se detectaron recomendaciones de mantenimiento.'}
          </Typography>
          {hasActiveFilters && (
            <Button
              variant="outlined"
              size="small"
              onClick={() => setFilter({ status: ['suggested', 'review_required'], priority: null })}
            >
              Limpiar filtros
            </Button>
          )}
        </Box>
      </Paper>
    );
  }

  // ─── Render: Filter bar + Table ───────────────────────────────
  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
      {/* ── Filter bar ── */}
      <Box sx={{ p: 2, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>Estado</InputLabel>
          <Select
            value={statusValue}
            label="Estado"
            onChange={(e) => handleStatusChange(e.target.value)}
          >
            {STATUS_OPTIONS.map((opt) => (
              <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 130 }}>
          <InputLabel>Prioridad</InputLabel>
          <Select
            value={priorityValue}
            label="Prioridad"
            onChange={(e) => handlePriorityChange(e.target.value)}
          >
            {PRIORITY_OPTIONS.map((opt) => (
              <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          startIcon={<Refresh />}
          onClick={refresh}
          disabled={actionLoading}
        >
          Actualizar
        </Button>
      </Box>

      {/* ── Table ── */}
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700 }}>Modo de Falla</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Acción Recomendada</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Prioridad</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Ventana (días)</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Estado</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Creado</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Acciones</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {recommendations.map((rec) => {
              const priorityCfg = PRIORITY_CONFIG[rec.priority] || { label: rec.priority, color: 'default' };
              const statusCfg = STATUS_CONFIG[rec.status] || { label: rec.status, color: 'default' };

              return (
                <TableRow key={rec.id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {rec.failure_mode_name || '—'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {rec.failure_mode_key || ''}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ maxWidth: 280 }}>
                      {rec.recommended_action || '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={priorityCfg.label}
                      color={priorityCfg.color}
                      size="small"
                      variant="filled"
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {rec.due_window_days != null ? `${rec.due_window_days} d` : '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={statusCfg.label}
                      color={statusCfg.color}
                      size="small"
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {formatDate(rec.created_at)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <ActionButtons
                      rec={rec}
                      onApprove={(id) => setApproveDialog({ open: true, id })}
                      onDismiss={(id) => { setDismissReason(''); setDismissError(''); setDismissDialog({ open: true, id }); }}
                      onSupersede={(id) => setSupersedeDialog({ open: true, id, newRecId: '' })}
                      onConvert={(id) => setConvertDialog({ open: true, id })}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {/* ── Approve Dialog ── */}
      <Dialog open={approveDialog.open} onClose={() => setApproveDialog({ open: false, id: null })}>
        <DialogTitle>Aprobar recomendación</DialogTitle>
        <DialogContent>
          <DialogContentText>
            ¿Estás seguro de aprobar esta recomendación? La recomendación podrá luego convertirse en una orden de trabajo.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setApproveDialog({ open: false, id: null })} disabled={actionLoading}>
            Cancelar
          </Button>
          <Button
            variant="contained"
            color="success"
            onClick={() => handleApprove(approveDialog.id)}
            disabled={actionLoading}
          >
            Aprobar
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Dismiss Dialog ── */}
      <Dialog
        open={dismissDialog.open}
        onClose={() => { setDismissDialog({ open: false, id: null }); setDismissError(''); }}
      >
        <DialogTitle>Descartar recomendación</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Indicá el motivo por el cual se descarta esta recomendación.
          </DialogContentText>
          <TextField
            autoFocus
            fullWidth
            multiline
            rows={3}
            label="Motivo de descarte"
            value={dismissReason}
            onChange={(e) => { setDismissReason(e.target.value); setDismissError(''); }}
            error={!!dismissError}
            helperText={dismissError}
            required
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => { setDismissDialog({ open: false, id: null }); setDismissError(''); }}
            disabled={actionLoading}
          >
            Cancelar
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleDismiss}
            disabled={actionLoading}
          >
            Descartar
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Supersede Dialog ── */}
      <Dialog
        open={supersedeDialog.open}
        onClose={() => setSupersedeDialog({ open: false, id: null, newRecId: '' })}
      >
        <DialogTitle>Reemplazar recomendación</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Ingresá el ID de la nueva recomendación que reemplaza a la actual.
          </DialogContentText>
          <TextField
            autoFocus
            fullWidth
            label="ID de nueva recomendación"
            value={supersedeDialog.newRecId}
            onChange={(e) => setSupersedeDialog((prev) => ({ ...prev, newRecId: e.target.value }))}
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setSupersedeDialog({ open: false, id: null, newRecId: '' })}
            disabled={actionLoading}
          >
            Cancelar
          </Button>
          <Button
            variant="contained"
            onClick={handleSupersede}
            disabled={actionLoading}
          >
            Reemplazar
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Convert Dialog ── */}
      <Dialog open={convertDialog.open} onClose={() => setConvertDialog({ open: false, id: null })}>
        <DialogTitle>Convertir a Orden de Trabajo</DialogTitle>
        <DialogContent>
          <DialogContentText>
            ¿Estás seguro de generar una orden de trabajo a partir de esta recomendación?
            Se creará automáticamente con los datos de la recomendación.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConvertDialog({ open: false, id: null })} disabled={actionLoading}>
            Cancelar
          </Button>
          <Button
            variant="contained"
            color="primary"
            onClick={() => handleConvert(convertDialog.id)}
            disabled={actionLoading}
          >
            Convertir a OT
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Snackbar ── */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={5000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackbar.severity} variant="filled" sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Paper>
  );
}
