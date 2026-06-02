/**
 * DeadLetterPanel.jsx — Panel de Dead-Letter de Ingesta
 *
 * Lista los condition_ingest_failures (payloads que agotaron reintentos).
 * Acciones disponibles:
 *  - Ver payload → Dialog con JSON formateado
 *  - Reprocesar → PATCH status='pending_retry', re-ingest vía EF
 *  - Descartar → PATCH status='ignored'
 *
 * Visible solo para PLANNER/ADMIN (RBAC).
 * Máximo 100 registros cargados.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Box, Paper, Typography, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Chip, Button,
  Dialog, DialogTitle, DialogContent, DialogActions,
  CircularProgress, Alert, IconButton, Tooltip, Snackbar,
  TextField, MenuItem, Grid,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import VisibilityIcon from '@mui/icons-material/Visibility';
import ReplayIcon from '@mui/icons-material/Replay';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import { supabase } from '../../lib/supabaseClient';

// ─── Constantes ──────────────────────────────────────────────────
const INGEST_EF_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ingest-condition`;
const MAX_RECORDS = 100;

// ─── Status colors ───────────────────────────────────────────────
const STATUS_COLORS = {
  dead_letter: { bg: '#fce4ec', color: '#c62828', label: 'Dead Letter' },
  pending_retry: { bg: '#fff3e0', color: '#ef6c00', label: 'Reintento pendiente' },
  resolved: { bg: '#e8f5e9', color: '#2e7d32', label: 'Resuelto' },
  ignored: { bg: '#f5f5f5', color: '#616161', label: 'Descartado' },
  reprocessed: { bg: '#e3f2fd', color: '#1565c0', label: 'Reprocesado' },
};

export default function DeadLetterPanel() {
  const [failures, setFailures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSourceId, setFilterSourceId] = useState('');

  // Payload dialog
  const [payloadDialog, setPayloadDialog] = useState({ open: false, payload: null, title: '' });

  // Snackbar feedback
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });

  // ─── Fetch dead-letters ─────────────────────────────────────────
  const fetchFailures = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from('condition_ingest_failures')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(MAX_RECORDS);

      if (filterStatus) {
        query = query.eq('status', filterStatus);
      }
      if (filterSourceId) {
        query = query.eq('source_id', filterSourceId);
      }

      const { data, error: queryError } = await query;

      if (queryError) throw new Error(`Error consultando dead-letters: ${queryError.message}`);

      setFailures(data || []);
    } catch (err) {
      setError(err.message);
      console.warn('[DeadLetterPanel] Error:', err);
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterSourceId]);

  useEffect(() => {
    fetchFailures();
  }, [fetchFailures]);

  // ─── View payload ──────────────────────────────────────────────
  const handleViewPayload = useCallback((failure) => {
    setPayloadDialog({
      open: true,
      payload: failure.payload,
      title: `Payload: ${failure.idempotency_key || failure.source_id}`,
    });
  }, []);

  const handleCloseDialog = useCallback(() => {
    setPayloadDialog({ open: false, payload: null, title: '' });
  }, []);

  // ─── Reprocess dead-letter ─────────────────────────────────────
  const handleReprocess = useCallback(async (failure) => {
    try {
      // Marcar como pending_retry
      const { error: updateError } = await supabase
        .from('condition_ingest_failures')
        .update({
          status: 'pending_retry',
          notes: 'Reintento manual iniciado',
        })
        .eq('id', failure.id);

      if (updateError) throw new Error(`Error actualizando: ${updateError.message}`);

      // Reintentar ingesta vía EF
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('No hay sesión activa');

      const payload = {
        ...failure.payload,
        idempotency_key: `${failure.idempotency_key}:retry:${Date.now()}`,
        skip_validation: false,
      };

      const response = await fetch(INGEST_EF_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const respData = await response.json().catch(() => ({}));
        throw new Error(respData.error || `HTTP ${response.status}`);
      }

      // Actualizar como reprocessed
      await supabase
        .from('condition_ingest_failures')
        .update({
          status: 'reprocessed',
          resolved_by: session.user?.id || 'user',
          resolved_at: new Date().toISOString(),
          notes: 'Reprocesado exitosamente',
        })
        .eq('id', failure.id);

      setSnackbar({
        open: true,
        message: 'Payload reprocesado exitosamente.',
        severity: 'success',
      });
      fetchFailures();
    } catch (err) {
      setSnackbar({
        open: true,
        message: `Error al reprocesar: ${err.message}`,
        severity: 'error',
      });
    }
  }, [fetchFailures]);

  // ─── Dismiss dead-letter ───────────────────────────────────────
  const handleDismiss = useCallback(async (failure) => {
    try {
      const { error: updateError } = await supabase
        .from('condition_ingest_failures')
        .update({
          status: 'ignored',
          resolved_by: (await supabase.auth.getSession()).data?.session?.user?.id || 'user',
          resolved_at: new Date().toISOString(),
          notes: 'Descartado manualmente',
        })
        .eq('id', failure.id);

      if (updateError) throw new Error(`Error: ${updateError.message}`);

      setSnackbar({
        open: true,
        message: 'Dead-letter descartado.',
        severity: 'info',
      });
      fetchFailures();
    } catch (err) {
      setSnackbar({
        open: true,
        message: `Error al descartar: ${err.message}`,
        severity: 'error',
      });
    }
  }, [fetchFailures]);

  // ─── Formatear fecha ───────────────────────────────────────────
  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // ─── RENDER ─────────────────────────────────────────────────────
  if (loading && failures.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
      {/* ── Header ── */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box>
          <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>
            Dead Letter — Ingestas Fallidas
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Payloads que agotaron reintentos automáticos. Requieren revisión manual.
          </Typography>
        </Box>
        <Tooltip title="Actualizar">
          <IconButton onClick={fetchFailures} size="small" disabled={loading}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* ── Filtros ── */}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 6, sm: 3 }}>
          <TextField
            select
            fullWidth
            size="small"
            label="Estado"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <MenuItem value="">Todos</MenuItem>
            <MenuItem value="dead_letter">Dead Letter</MenuItem>
            <MenuItem value="pending_retry">Reintento pendiente</MenuItem>
            <MenuItem value="resolved">Resuelto</MenuItem>
            <MenuItem value="ignored">Descartado</MenuItem>
            <MenuItem value="reprocessed">Reprocesado</MenuItem>
          </TextField>
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <TextField
            fullWidth
            size="small"
            label="Source ID"
            value={filterSourceId}
            onChange={(e) => setFilterSourceId(e.target.value)}
            placeholder="Ej: csv_import"
          />
        </Grid>
      </Grid>

      {/* ── Tabla ── */}
      <TableContainer sx={{ maxHeight: 500 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell><strong>Fuente</strong></TableCell>
              <TableCell><strong>Error</strong></TableCell>
              <TableCell><strong>Reintentos</strong></TableCell>
              <TableCell><strong>Estado</strong></TableCell>
              <TableCell><strong>Fecha</strong></TableCell>
              <TableCell><strong>Acciones</strong></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {failures.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <Typography variant="body2" color="text.secondary" sx={{ py: 4 }}>
                    No hay dead-letters registrados
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              failures.map((failure) => (
                <TableRow key={failure.id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {failure.source_id || '—'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {failure.source_type}
                    </Typography>
                  </TableCell>

                  <TableCell>
                    {failure.error_code && (
                      <Chip
                        label={failure.error_code}
                        size="small"
                        color="error"
                        variant="outlined"
                        sx={{ mb: 0.5 }}
                      />
                    )}
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{
                        display: 'block',
                        maxWidth: 250,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={failure.error_message}
                    >
                      {failure.error_message || '—'}
                    </Typography>
                  </TableCell>

                  <TableCell>
                    <Typography variant="body2">
                      {failure.retry_count ?? 0}/3
                    </Typography>
                  </TableCell>

                  <TableCell>
                    {failure.status && STATUS_COLORS[failure.status] ? (
                      <Chip
                        label={STATUS_COLORS[failure.status].label}
                        size="small"
                        sx={{
                          bgcolor: STATUS_COLORS[failure.status].bg,
                          color: STATUS_COLORS[failure.status].color,
                          fontWeight: 600,
                        }}
                      />
                    ) : (
                      <Typography variant="body2">{failure.status}</Typography>
                    )}
                  </TableCell>

                  <TableCell>
                    <Typography variant="body2">
                      {formatDate(failure.created_at)}
                    </Typography>
                  </TableCell>

                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      <Tooltip title="Ver payload">
                        <IconButton
                          size="small"
                          onClick={() => handleViewPayload(failure)}
                        >
                          <VisibilityIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>

                      {(failure.status === 'dead_letter' || failure.status === 'pending_retry') && (
                        <Tooltip title="Reprocesar">
                          <IconButton
                            size="small"
                            color="primary"
                            onClick={() => handleReprocess(failure)}
                          >
                            <ReplayIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}

                      {(failure.status === 'dead_letter' || failure.status === 'pending_retry') && (
                        <Tooltip title="Descartar">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleDismiss(failure)}
                          >
                            <DeleteOutlineOutlinedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Box>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* ── Payload Dialog ── */}
      <Dialog open={payloadDialog.open} onClose={handleCloseDialog} maxWidth="md" fullWidth>
        <DialogTitle>
          {payloadDialog.title}
        </DialogTitle>
        <DialogContent dividers>
          <Box
            component="pre"
            sx={{
              p: 2,
              bgcolor: 'grey.100',
              borderRadius: 1,
              fontSize: '0.8rem',
              overflow: 'auto',
              maxHeight: 400,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {payloadDialog.payload
              ? JSON.stringify(payloadDialog.payload, null, 2)
              : 'Sin payload disponible'}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cerrar</Button>
        </DialogActions>
      </Dialog>

      {/* ── Snackbar ── */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={5000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={snackbar.severity}
          variant="filled"
          onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Paper>
  );
}
