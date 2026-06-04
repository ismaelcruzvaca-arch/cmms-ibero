/**
 * PolicyManagementPanel — Panel de administración de políticas de automatización
 *
 * CRUD para condition_automation_policies. Solo visible para PLANNER/ADMIN.
 * Verifica el rol del usuario al montar el componente.
 *
 * Props: none (role-gated internamente)
 *
 * Lenguaje: español. Tabla con políticas, diálogo de creación/edición.
 * Estados: carga, error, vacío, sin permisos.
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
  Skeleton,
  Snackbar,
} from '@mui/material';
import {
  Add,
  Edit,
  Delete,
  Refresh,
  GppMaybe,
} from '@mui/icons-material';
import { supabase } from '../../lib/supabaseClient';

// ─── Constantes ─────────────────────────────────────────────────

const POLICY_FIELDS = [
  { key: 'policy_key',        label: 'Clave',          required: true,  readOnlyOnEdit: true },
  { key: 'policy_name',       label: 'Nombre',         required: true,  readOnlyOnEdit: false },
  { key: 'description',       label: 'Descripción',    required: false, readOnlyOnEdit: false, multiline: true },
  { key: 'evaluation_order',  label: 'Orden Evaluación', required: true, readOnlyOnEdit: false, type: 'number' },
];

const CONDITIONS_FIELDS = [
  { key: 'min_confidence',          label: 'Confianza Mínima',       type: 'number', step: 0.01 },
  { key: 'max_contradictory_count', label: 'Máx. Contradicciones',   type: 'number' },
  { key: 'min_completeness',        label: 'Completez Mínima',       type: 'number', step: 0.01 },
  { key: 'min_quality_flag',        label: 'Flag Calidad Mínimo',    type: 'text' },
  { key: 'requires_approval',       label: 'Requiere Aprobación',    type: 'boolean' },
  { key: 'failure_mode_categories', label: 'Categorías FM (JSON)',   type: 'json' },
  { key: 'asset_criticality_allowed', label: 'Criticidades (JSON)',  type: 'json' },
  { key: 'late_data_policy',        label: 'Política Datos Tardíos', type: 'text' },
];

// ─── Helper ─────────────────────────────────────────────────────

function formatJsonSafe(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function parseJsonSafe(value) {
  if (!value || value.trim() === '') return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function conditionsToForm(conditions) {
  if (!conditions) return {};
  const form = {};
  for (const field of CONDITIONS_FIELDS) {
    const val = conditions[field.key];
    if (field.type === 'json') {
      form[field.key] = formatJsonSafe(val);
    } else if (field.type === 'boolean') {
      form[field.key] = val != null ? val : true;
    } else {
      form[field.key] = val != null ? String(val) : '';
    }
  }
  return form;
}

function formToConditions(form) {
  const conditions = {};
  for (const field of CONDITIONS_FIELDS) {
    const val = form[field.key];
    if (field.type === 'boolean') {
      conditions[field.key] = val === true || val === 'true';
    } else if (field.type === 'json') {
      conditions[field.key] = parseJsonSafe(val);
    } else if (field.type === 'number') {
      conditions[field.key] = val !== '' ? Number(val) : null;
    } else {
      conditions[field.key] = val || null;
    }
  }
  return conditions;
}

function getDefaultConditionsForm() {
  const form = {};
  for (const field of CONDITIONS_FIELDS) {
    if (field.type === 'boolean') {
      form[field.key] = true;
    } else if (field.type === 'json') {
      form[field.key] = '[]';
    } else {
      form[field.key] = '';
    }
  }
  return form;
}

function getEmptyPolicyForm() {
  const form = {};
  for (const field of POLICY_FIELDS) {
    form[field.key] = '';
  }
  return { ...form, ...getDefaultConditionsForm(), is_active: true };
}

function policyToForm(policy) {
  const form = {};
  for (const field of POLICY_FIELDS) {
    form[field.key] = policy[field.key] ?? '';
  }
  return {
    ...form,
    ...conditionsToForm(policy.conditions || {}),
    is_active: policy.is_active ?? true,
  };
}

// ─── PolicyManagementPanel ──────────────────────────────────────

export default function PolicyManagementPanel() {
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const [roleError, setRoleError] = useState(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState(null); // null = create
  const [formData, setFormData] = useState(getEmptyPolicyForm());
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  // Delete confirm
  const [deleteDialog, setDeleteDialog] = useState({ open: false, policy: null });

  // ─── Verificar rol ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const checkRole = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user?.id) {
          if (!cancelled) { setUserRole(null); setRoleLoading(false); }
          return;
        }
        // Intentar RPC get_user_role, fallback a user_profiles
        let role = null;
        const { data: rpcData } = await supabase.rpc('get_user_role');
        if (rpcData) {
          role = rpcData;
        } else {
          const { data: profile } = await supabase
            .from('user_profiles')
            .select('role')
            .eq('id', session.user.id)
            .single();
          role = profile?.role || null;
        }
        if (!cancelled) setUserRole(role);
      } catch (err) {
        console.warn('[PolicyManagementPanel] Error checking role:', err);
        if (!cancelled) setRoleError(err.message);
      } finally {
        if (!cancelled) setRoleLoading(false);
      }
    };
    checkRole();
    return () => { cancelled = true; };
  }, []);

  // ─── Fetch policies ───────────────────────────────────────────
  const fetchPolicies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: dbError } = await supabase
        .from('condition_automation_policies')
        .select('*')
        .order('evaluation_order', { ascending: true });

      if (dbError) throw new Error(dbError.message);
      setPolicies(data || []);
    } catch (err) {
      setError(err.message);
      console.warn('[PolicyManagementPanel] Error fetching:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (userRole && !roleLoading) {
      fetchPolicies();
    }
  }, [userRole, roleLoading, fetchPolicies]);

  // ─── Toggle active ────────────────────────────────────────────
  const handleToggleActive = useCallback(async (policy, newValue) => {
    try {
      const { error: dbError } = await supabase
        .from('condition_automation_policies')
        .update({ is_active: newValue })
        .eq('id', policy.id);

      if (dbError) throw new Error(dbError.message);

      setPolicies((prev) =>
        prev.map((p) => (p.id === policy.id ? { ...p, is_active: newValue } : p))
      );
      setSnackbar({
        open: true,
        message: `Política ${newValue ? 'activada' : 'desactivada'}`,
        severity: 'success',
      });
    } catch (err) {
      setSnackbar({ open: true, message: `Error: ${err.message}`, severity: 'error' });
    }
  }, []);

  // ─── Open create dialog ───────────────────────────────────────
  const handleOpenCreate = useCallback(() => {
    setEditingPolicy(null);
    setFormData(getEmptyPolicyForm());
    setDialogOpen(true);
  }, []);

  // ─── Open edit dialog ─────────────────────────────────────────
  const handleOpenEdit = useCallback((policy) => {
    setEditingPolicy(policy);
    setFormData(policyToForm(policy));
    setDialogOpen(true);
  }, []);

  // ─── Save (create or update) ──────────────────────────────────
  const handleSave = useCallback(async () => {
    // Validate required fields
    for (const field of POLICY_FIELDS) {
      if (field.required && !formData[field.key]?.toString().trim()) {
        setSnackbar({ open: true, message: `"${field.label}" es obligatorio`, severity: 'warning' });
        return;
      }
    }

    setSaving(true);
    try {
      const conditions = formToConditions(formData);

      if (editingPolicy) {
        // UPDATE
        const updateData = {};
        for (const field of POLICY_FIELDS) {
          if (!field.readOnlyOnEdit) {
            updateData[field.key] = field.type === 'number'
              ? Number(formData[field.key])
              : formData[field.key];
          }
        }
        updateData.conditions = conditions;
        updateData.is_active = formData.is_active === true || formData.is_active === 'true';

        const { error: dbError } = await supabase
          .from('condition_automation_policies')
          .update(updateData)
          .eq('id', editingPolicy.id);

        if (dbError) throw new Error(dbError.message);
        setSnackbar({ open: true, message: 'Política actualizada', severity: 'success' });
      } else {
        // INSERT
        const insertData = {
          policy_key: formData.policy_key.trim(),
          policy_name: formData.policy_name.trim(),
          description: formData.description?.trim() || null,
          evaluation_order: Number(formData.evaluation_order),
          conditions,
          is_active: formData.is_active === true || formData.is_active === 'true',
        };

        const { error: dbError } = await supabase
          .from('condition_automation_policies')
          .insert(insertData);

        if (dbError) throw new Error(dbError.message);
        setSnackbar({ open: true, message: 'Política creada', severity: 'success' });
      }

      setDialogOpen(false);
      await fetchPolicies();
    } catch (err) {
      setSnackbar({ open: true, message: `Error: ${err.message}`, severity: 'error' });
    } finally {
      setSaving(false);
    }
  }, [formData, editingPolicy, fetchPolicies]);

  // ─── Delete ───────────────────────────────────────────────────
  const handleDelete = useCallback(async () => {
    if (!deleteDialog.policy) return;
    setSaving(true);
    try {
      const { error: dbError } = await supabase
        .from('condition_automation_policies')
        .delete()
        .eq('id', deleteDialog.policy.id);

      if (dbError) throw new Error(dbError.message);
      setSnackbar({ open: true, message: 'Política eliminada', severity: 'success' });
      setDeleteDialog({ open: false, policy: null });
      await fetchPolicies();
    } catch (err) {
      setSnackbar({ open: true, message: `Error: ${err.message}`, severity: 'error' });
    } finally {
      setSaving(false);
    }
  }, [deleteDialog, fetchPolicies]);

  // ─── Field change handler ─────────────────────────────────────
  const handleFieldChange = useCallback((key, value) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }, []);

  // ─── Role gating ──────────────────────────────────────────────
  if (roleLoading) {
    return (
      <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
        <Skeleton variant="text" width="60%" sx={{ mx: 'auto' }} />
        <Skeleton variant="text" width="40%" sx={{ mx: 'auto', mt: 1 }} />
      </Paper>
    );
  }

  const isAuthorized = userRole === 'PLANNER' || userRole === 'ADMIN';

  if (!isAuthorized) {
    return (
      <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
        <GppMaybe sx={{ fontSize: 48, color: 'warning.main', mb: 1 }} />
        <Typography variant="h6" color="text.secondary" gutterBottom>
          Acceso restringido
        </Typography>
        <Typography variant="body2" color="text.disabled">
          Solo usuarios con rol PLANNER o ADMIN pueden administrar políticas de automatización.
        </Typography>
        {roleError && (
          <Alert severity="warning" sx={{ mt: 2, mx: 'auto', maxWidth: 400 }}>
            {roleError}
          </Alert>
        )}
      </Paper>
    );
  }

  // ─── Loading ──────────────────────────────────────────────────
  if (loading) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
          <Skeleton variant="rounded" width={200} height={40} />
          <Skeleton variant="rounded" width={140} height={40} />
        </Box>
        {Array.from({ length: 3 }).map((_, i) => (
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
          <IconButton color="inherit" size="small" onClick={fetchPolicies}>
            <Refresh />
          </IconButton>
        }
      >
        Error al cargar políticas: {error}
      </Alert>
    );
  }

  // ─── Render ───────────────────────────────────────────────────
  return (
    <Box>
      {/* ── Header ── */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={700}>
          Políticas de Automatización
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            size="small"
            startIcon={<Refresh />}
            onClick={fetchPolicies}
          >
            Actualizar
          </Button>
          <Button
            variant="contained"
            size="small"
            startIcon={<Add />}
            onClick={handleOpenCreate}
          >
            Nueva Política
          </Button>
        </Box>
      </Box>

      {/* ── Empty state ── */}
      {policies.length === 0 && (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary" gutterBottom>
            Sin políticas configuradas
          </Typography>
          <Typography variant="caption" color="text.disabled" display="block" sx={{ mb: 2 }}>
            Creá políticas de automatización para controlar cómo se generan las recomendaciones.
          </Typography>
          <Button variant="outlined" startIcon={<Add />} onClick={handleOpenCreate}>
            Crear primera política
          </Button>
        </Paper>
      )}

      {/* ── Table ── */}
      {policies.length > 0 && (
        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Clave</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Nombre</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Orden</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Condiciones</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Activa</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Creada</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Acciones</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {policies.map((policy) => {
                  const condCount = policy.conditions
                    ? Object.keys(policy.conditions).filter(
                        (k) => policy.conditions[k] != null && policy.conditions[k] !== ''
                      ).length
                    : 0;

                  return (
                    <TableRow key={policy.id} hover sx={{ cursor: 'pointer' }} onClick={() => handleOpenEdit(policy)}>
                      <TableCell>
                        <Typography variant="body2" fontWeight={600} fontFamily="monospace">
                          {policy.policy_key}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{policy.policy_name}</Typography>
                        {policy.description && (
                          <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 250, display: 'block' }}>
                            {policy.description}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{policy.evaluation_order}</Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={`${condCount} condición(es)`}
                          size="small"
                          variant="outlined"
                          color={condCount > 0 ? 'info' : 'default'}
                        />
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Switch
                          size="small"
                          checked={policy.is_active}
                          onChange={(e) => handleToggleActive(policy, e.target.checked)}
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" color="text.secondary">
                          {new Date(policy.created_at).toLocaleDateString('es-MX')}
                        </Typography>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          <Tooltip title="Editar">
                            <IconButton size="small" onClick={() => handleOpenEdit(policy)}>
                              <Edit fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          {userRole === 'ADMIN' && (
                            <Tooltip title="Eliminar">
                              <IconButton
                                size="small"
                                color="error"
                                onClick={() => setDeleteDialog({ open: true, policy })}
                              >
                                <Delete fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                        </Box>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* ── Create/Edit Dialog ── */}
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {editingPolicy ? 'Editar Política' : 'Nueva Política'}
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            {/* ── Basic fields ── */}
            {POLICY_FIELDS.map((field) => (
              <TextField
                key={field.key}
                label={field.label}
                required={field.required}
                value={formData[field.key] ?? ''}
                onChange={(e) => handleFieldChange(field.key, e.target.value)}
                size="small"
                fullWidth
                multiline={field.multiline}
                rows={field.multiline ? 2 : 1}
                type={field.type || 'text'}
                inputProps={field.type === 'number' ? { min: 0 } : undefined}
                disabled={editingPolicy && field.readOnlyOnEdit}
                helperText={editingPolicy && field.readOnlyOnEdit ? 'No se puede modificar en edición' : ''}
              />
            ))}

            <Typography variant="subtitle2" fontWeight={700} sx={{ mt: 1 }}>
              Condiciones (JSONB)
            </Typography>

            {/* ── Conditions fields ── */}
            {CONDITIONS_FIELDS.map((field) => {
              if (field.type === 'boolean') {
                return (
                  <FormControlLabel
                    key={field.key}
                    control={
                      <Switch
                        checked={formData[field.key] === true || formData[field.key] === 'true'}
                        onChange={(e) => handleFieldChange(field.key, e.target.checked)}
                      />
                    }
                    label={field.label}
                  />
                );
              }

              if (field.type === 'json') {
                return (
                  <TextField
                    key={field.key}
                    label={field.label}
                    value={formData[field.key] ?? ''}
                    onChange={(e) => handleFieldChange(field.key, e.target.value)}
                    size="small"
                    fullWidth
                    multiline
                    rows={2}
                    placeholder="[]"
                    helperText="Formato JSON array, ej: [&quot;critical&quot;, &quot;high&quot;]"
                  />
                );
              }

              return (
                <TextField
                  key={field.key}
                  label={field.label}
                  value={formData[field.key] ?? ''}
                  onChange={(e) => handleFieldChange(field.key, e.target.value)}
                  size="small"
                  fullWidth
                  type={field.type === 'number' ? 'number' : 'text'}
                  inputProps={field.step ? { step: field.step } : undefined}
                />
              );
            })}

            {/* ── is_active ── */}
            <FormControlLabel
              control={
                <Switch
                  checked={formData.is_active === true || formData.is_active === 'true'}
                  onChange={(e) => handleFieldChange('is_active', e.target.checked)}
                />
              }
              label="Política activa"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Guardando…' : editingPolicy ? 'Actualizar' : 'Crear'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Delete Confirm Dialog ── */}
      <Dialog
        open={deleteDialog.open}
        onClose={() => setDeleteDialog({ open: false, policy: null })}
      >
        <DialogTitle>Eliminar Política</DialogTitle>
        <DialogContent>
          <Typography>
            ¿Estás seguro de eliminar la política{' '}
            <strong>{deleteDialog.policy?.policy_key}</strong>?
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            Esta acción no se puede deshacer.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialog({ open: false, policy: null })} disabled={saving}>
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
