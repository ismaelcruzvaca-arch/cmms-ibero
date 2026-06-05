/**
 * ScheduleManagementPanel — Panel de administración de reportes programados
 *
 * CRUD para report_schedules vía useReportSchedules hook.
 * Visible en Admin > Reportes Programados.
 *
 * Lenguaje: español. Tabla con schedules, diálogo de creación/edición.
 * Estados: carga, error, vacío.
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
  IconButton,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Switch,
  FormControlLabel,
  Tooltip,
  Alert,
  CircularProgress,
  Snackbar,
} from '@mui/material';
import {
  Add,
  Edit,
  Delete,
  Refresh,
} from '@mui/icons-material';
import { CronExpressionParser } from 'cron-parser';
import { useReportSchedules } from '../../hooks/useReportSchedules';

// ─── Constantes ─────────────────────────────────────────────────
const DEFAULT_FORM = {
  name: '',
  template_code: '',
  cron_expression: '',
  recipients: '',
  subject: '',
  params: '{}',
  is_active: true,
};

// ─── Helpers ────────────────────────────────────────────────────
function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('es-MX', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

/**
 * Intenta parsear una expresión cron y devuelve el próximo run como string.
 * @param {string} expr — expresión cron de 5 campos
 * @returns {string|null} — fecha formateada o null si es inválida
 */
function getCronPreview(expr) {
  if (!expr || !expr.trim()) return null;
  try {
    const interval = CronExpressionParser.parse(expr.trim());
    return interval.next().toISOString();
  } catch {
    return null;
  }
}

function parseRecipients(value) {
  if (!value || !value.trim()) return [];
  return value
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
}

function scheduleToForm(schedule) {
  return {
    name: schedule.name || '',
    template_code: schedule.template_code || '',
    cron_expression: schedule.cron_expression || '',
    recipients: Array.isArray(schedule.recipients)
      ? schedule.recipients.join(', ')
      : schedule.recipients || '',
    subject: schedule.subject || '',
    params: schedule.params ? JSON.stringify(schedule.params, null, 2) : '{}',
    is_active: schedule.is_active ?? true,
  };
}

// ─── ScheduleManagementPanel ─────────────────────────────────────

export default function ScheduleManagementPanel() {
  const {
    schedules,
    loading,
    error,
    fetchSchedules,
    createSchedule,
    updateSchedule,
    deleteSchedule,
    toggleActive,
  } = useReportSchedules();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(null); // null = create
  const [formData, setFormData] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [deleteDialog, setDeleteDialog] = useState({ open: false, schedule: null });

  // Cargar schedules al montar
  useEffect(() => {
    fetchSchedules();
  }, [fetchSchedules]);

  // ─── Toggle active ────────────────────────────────────────────
  const handleToggleActive = useCallback(async (schedule, newValue) => {
    try {
      await toggleActive(schedule.id, newValue);
      setSnackbar({
        open: true,
        message: `Schedule ${newValue ? 'activado' : 'desactivado'}`,
        severity: 'success',
      });
    } catch (err) {
      setSnackbar({ open: true, message: `Error: ${err.message}`, severity: 'error' });
    }
  }, [toggleActive]);

  // ─── Open create dialog ───────────────────────────────────────
  const handleOpenCreate = useCallback(() => {
    setEditingSchedule(null);
    setFormData(DEFAULT_FORM);
    setDialogOpen(true);
  }, []);

  // ─── Open edit dialog ─────────────────────────────────────────
  const handleOpenEdit = useCallback((schedule) => {
    setEditingSchedule(schedule);
    setFormData(scheduleToForm(schedule));
    setDialogOpen(true);
  }, []);

  // ─── Save (create or update) ──────────────────────────────────
  const handleSave = useCallback(async () => {
    // Validate required fields
    if (!formData.name.trim()) {
      setSnackbar({ open: true, message: 'El nombre es obligatorio', severity: 'warning' });
      return;
    }
    if (!formData.template_code.trim()) {
      setSnackbar({ open: true, message: 'El template es obligatorio', severity: 'warning' });
      return;
    }
    if (!formData.cron_expression.trim()) {
      setSnackbar({ open: true, message: 'La expresión cron es obligatoria', severity: 'warning' });
      return;
    }
    if (!formData.recipients.trim()) {
      setSnackbar({ open: true, message: 'Al menos un destinatario es obligatorio', severity: 'warning' });
      return;
    }
    if (!formData.subject.trim()) {
      setSnackbar({ open: true, message: 'El asunto es obligatorio', severity: 'warning' });
      return;
    }

    // Parse recipients
    const recipients = parseRecipients(formData.recipients);
    if (recipients.length === 0) {
      setSnackbar({ open: true, message: 'Debe especificar al menos un destinatario válido', severity: 'warning' });
      return;
    }

    // Parse params
    let params = {};
    try {
      params = JSON.parse(formData.params || '{}');
    } catch {
      setSnackbar({ open: true, message: 'El campo Params debe ser JSON válido', severity: 'warning' });
      return;
    }

    setSaving(true);
    try {
      const data = {
        name: formData.name.trim(),
        template_code: formData.template_code.trim(),
        cron_expression: formData.cron_expression.trim(),
        recipients,
        subject: formData.subject.trim(),
        params,
        is_active: formData.is_active,
      };

      if (editingSchedule) {
        await updateSchedule(editingSchedule.id, data);
        setSnackbar({ open: true, message: 'Schedule actualizado', severity: 'success' });
      } else {
        await createSchedule(data);
        setSnackbar({ open: true, message: 'Schedule creado', severity: 'success' });
      }

      setDialogOpen(false);
    } catch (err) {
      setSnackbar({ open: true, message: `Error: ${err.message}`, severity: 'error' });
    } finally {
      setSaving(false);
    }
  }, [formData, editingSchedule, createSchedule, updateSchedule]);

  // ─── Delete ───────────────────────────────────────────────────
  const handleDelete = useCallback(async () => {
    if (!deleteDialog.schedule) return;
    setSaving(true);
    try {
      await deleteSchedule(deleteDialog.schedule.id);
      setSnackbar({ open: true, message: 'Schedule eliminado', severity: 'success' });
      setDeleteDialog({ open: false, schedule: null });
    } catch (err) {
      setSnackbar({ open: true, message: `Error: ${err.message}`, severity: 'error' });
    } finally {
      setSaving(false);
    }
  }, [deleteDialog, deleteSchedule]);

  // ─── Field change handler ─────────────────────────────────────
  const handleFieldChange = useCallback((key, value) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }, []);

  // ─── Loading ──────────────────────────────────────────────────
  if (loading && schedules.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  // ─── Error ────────────────────────────────────────────────────
  if (error) {
    return (
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Alert
          severity="error"
          variant="outlined"
          action={
            <IconButton color="inherit" size="small" onClick={fetchSchedules} aria-label="Reintentar">
              <Refresh />
            </IconButton>
          }
        >
          Error al cargar schedules: {error}
        </Alert>
      </Paper>
    );
  }

  // ─── Render ───────────────────────────────────────────────────
  return (
    <Box>
      {/* ── Header ── */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={700}>
          Reportes Programados
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button size="small" startIcon={<Refresh />} onClick={fetchSchedules}>
            Actualizar
          </Button>
          <Button variant="contained" size="small" startIcon={<Add />} onClick={handleOpenCreate}>
            Nuevo Schedule
          </Button>
        </Box>
      </Box>

      {/* ── Empty state ── */}
      {schedules.length === 0 && (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary" gutterBottom>
            No hay schedules configurados
          </Typography>
          <Typography variant="caption" color="text.disabled" display="block" sx={{ mb: 2 }}>
            Creá schedules para generar y enviar reportes PDF automáticamente.
          </Typography>
          <Button variant="outlined" startIcon={<Add />} onClick={handleOpenCreate}>
            Crear primer schedule
          </Button>
        </Paper>
      )}

      {/* ── Table ── */}
      {schedules.length > 0 && (
        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Nombre</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Template</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Cron</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Destinatarios</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Activo</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Última Ejec.</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Próxima Ejec.</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Acciones</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {schedules.map((schedule) => (
                  <TableRow key={schedule.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {schedule.name}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontFamily="monospace">
                        {schedule.template_code}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontFamily="monospace">
                        {schedule.cron_expression}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ maxWidth: 200 }} noWrap>
                        {Array.isArray(schedule.recipients)
                          ? schedule.recipients.join(', ')
                          : schedule.recipients}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Switch
                        size="small"
                        checked={schedule.is_active}
                        onChange={(e) => handleToggleActive(schedule, e.target.checked)}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {formatDate(schedule.last_run_at)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {formatDate(schedule.next_run_at)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        <Tooltip title="Editar">
                          <IconButton size="small" onClick={() => handleOpenEdit(schedule)}>
                            <Edit fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Eliminar">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => setDeleteDialog({ open: true, schedule })}
                          >
                            <Delete fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* ── Create/Edit Dialog ── */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          {editingSchedule ? 'Editar Schedule' : 'Nuevo Schedule'}
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField
              label="Nombre"
              required
              value={formData.name}
              onChange={(e) => handleFieldChange('name', e.target.value)}
              size="small"
              fullWidth
              placeholder="Ej: Reporte Diario de Órdenes"
            />

            <TextField
              label="Template"
              required
              value={formData.template_code}
              onChange={(e) => handleFieldChange('template_code', e.target.value)}
              size="small"
              fullWidth
              placeholder="Ej: ot-default"
              helperText="Código del template de reporte (ej: ot-default, pm-compliance)"
            />

            <TextField
              label="Expresión Cron"
              required
              value={formData.cron_expression}
              onChange={(e) => handleFieldChange('cron_expression', e.target.value)}
              size="small"
              fullWidth
              placeholder="Ej: 0 9 * * *"
              helperText={
                formData.cron_expression
                  ? (() => {
                      const preview = getCronPreview(formData.cron_expression);
                      if (preview) {
                        return `Próxima ejecución: ${formatDate(preview)}`;
                      }
                      return 'Expresión cron inválida. Use 5 campos: minuto hora día-del-mes mes día-de-la-semana.';
                    })()
                  : 'Formato cron de 5 campos: minuto hora día-del-mes mes día-de-la-semana. Ej: 0 9 * * * = todos los días a las 9am'
              }
            />

            <TextField
              label="Destinatarios"
              required
              value={formData.recipients}
              onChange={(e) => handleFieldChange('recipients', e.target.value)}
              size="small"
              fullWidth
              placeholder="email1@dominio.com, email2@dominio.com"
              helperText="Emails separados por coma"
            />

            <TextField
              label="Asunto"
              required
              value={formData.subject}
              onChange={(e) => handleFieldChange('subject', e.target.value)}
              size="small"
              fullWidth
              placeholder="Ej: Reporte Diario - {{date}}"
            />

            <TextField
              label="Parámetros (JSON)"
              value={formData.params}
              onChange={(e) => handleFieldChange('params', e.target.value)}
              size="small"
              fullWidth
              multiline
              rows={3}
              placeholder='{ "scope": "all_active" }'
              helperText="JSON opcional con parámetros para el template"
            />

            <FormControlLabel
              control={
                <Switch
                  checked={formData.is_active}
                  onChange={(e) => handleFieldChange('is_active', e.target.checked)}
                />
              }
              label="Schedule activo"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? 'Guardando…' : editingSchedule ? 'Actualizar' : 'Crear'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Delete Confirm Dialog ── */}
      <Dialog
        open={deleteDialog.open}
        onClose={() => setDeleteDialog({ open: false, schedule: null })}
      >
        <DialogTitle>Eliminar Schedule</DialogTitle>
        <DialogContent>
          <Typography>
            ¿Estás seguro de eliminar el schedule{' '}
            <strong>{deleteDialog.schedule?.name}</strong>?
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            Esta acción no se puede deshacer.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialog({ open: false, schedule: null })} disabled={saving}>
            Cancelar
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleDelete}
            disabled={saving}
          >
            {saving ? 'Eliminando…' : 'Eliminar'}
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
    </Box>
  );
}
