/**
 * AddAssetForm - Formulario de creación de activos con validación offline
 * 
 * - Validación asíncrona de equipment_id contra colección local RxDB (equipment_ids)
 * - Campos dinámicos según asset_type_id → se guardan en technical_specs (JSONB)
 * - Inserción local con auditoría automática (created_at, updated_at, is_deleted)
 */
import React, { useState, useEffect } from 'react';
import {
  Box, TextField, Button, Typography, MenuItem,
  Select, FormControl, InputLabel, FormHelperText,
  CircularProgress, Alert, Snackbar, Divider
} from '@mui/material';
import { useRxDB } from '../lib/rxdb';

// ─── Tipos de equipo y sus campos dinámicos ────────────────────────────
const ASSET_TYPES = {
  'M-MOT': {
    label: 'Motor (M-MOT)',
    specs: [
      { key: 'hp', label: 'HP (Potencia)', type: 'number' },
      { key: 'rpm', label: 'RPM', type: 'number' },
      { key: 'voltage', label: 'Voltaje (V)', type: 'number' }
    ]
  },
  'M-BOM': {
    label: 'Bomba (M-BOM)',
    specs: [
      { key: 'flow_rate', label: 'Caudal (m³/h)', type: 'number' },
      { key: 'head', label: 'Altura (m)', type: 'number' },
      { key: 'fluid_type', label: 'Tipo de fluido', type: 'text' }
    ]
  },
  'M-TAN': {
    label: 'Tanque (M-TAN)',
    specs: [
      { key: 'capacity', label: 'Capacidad (L)', type: 'number' },
      { key: 'material', label: 'Material', type: 'text' },
      { key: 'pressure_rating', label: 'Presión nominal (bar)', type: 'number' }
    ]
  },
  'M-CAL': {
    label: 'Caldera (M-CAL)',
    specs: [
      { key: 'capacity', label: 'Capacidad (BTU/h)', type: 'number' },
      { key: 'fuel_type', label: 'Tipo de combustible', type: 'text' },
      { key: 'max_pressure', label: 'Presión máxima (psi)', type: 'number' }
    ]
  }
};

const CRITICALITIES = ['A', 'B', 'C'];
const STATUSES = ['Active', 'Inactive'];

// ─── Estado inicial del formulario ─────────────────────────────────────
const INITIAL_FORM = {
  equipment_id: '',
  description: '',
  asset_type_id: '',
  parent_id: '',
  criticality: 'C',
  location_id: '',
  status: 'Active'
};

const INITIAL_SPECS = {};

export default function AddAssetForm({ onSuccess }) {
  const { db, loading: dbLoading } = useRxDB();
  const [form, setForm] = useState(INITIAL_FORM);
  const [specs, setSpecs] = useState(INITIAL_SPECS);

  // ─── Estados de UI ──────────────────────────────────────────────────
  const [existingAssets, setExistingAssets] = useState([]);
  const [tagError, setTagError] = useState('');
  const [tagChecking, setTagChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  // ─── Cargar assets existentes para el selector parent_id ────────────
  useEffect(() => {
    if (!db) return;

    const sub = db.assets.find().$.subscribe({
      next: (docs) => {
        try {
          const active = docs
            .map(d => d.toJSON())
            .filter(d => !d.is_deleted)
            .sort((a, b) => (a.equipment_id || '').localeCompare(b.equipment_id || ''));
          setExistingAssets(active);
        } catch (e) {
          console.warn('[AddAssetForm] Error cargando parent options:', e);
        }
      },
      error: (err) => {
        console.error('[AddAssetForm] Suscripción assets error:', err);
      }
    });

    return () => {
      try { sub.unsubscribe(); } catch (e) { /* ignorado */ }
    };
  }, [db]);

  // ─── Handlers ────────────────────────────────────────────────────────
  const handleChange = (e) => {
    const { name, value } = e.target;

    // Si cambia asset_type_id, resetear specs
    if (name === 'asset_type_id' && value !== form.asset_type_id) {
      setSpecs(INITIAL_SPECS);
    }

    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleSpecChange = (key, value) => {
    setSpecs(prev => ({ ...prev, [key]: value }));
  };

  // ─── Validación offline de equipment_id ─────────────────────────────
  const handleEquipmentIdBlur = async () => {
    const tag = form.equipment_id.trim();
    if (!tag || !db) {
      setTagError('');
      return;
    }

    setTagChecking(true);
    setTagError('');

    try {
      // Consultar colección local equipment_ids (sincronizada desde la vista Supabase)
      const query = db.equipment_ids.findOne(tag);
      const doc = await query.exec();

      if (doc) {
        setTagError('Este Tag ya está registrado');
      }
    } catch (err) {
      // Si findOne falla (ej. documento no encontrado), no es error de duplicado
      if (!err.message?.includes('not found') && !err.message?.includes('missing')) {
        console.warn('[AddAssetForm] Error validando equipment_id:', err.message);
      }
    } finally {
      setTagChecking(false);
    }
  };

  // ─── Submit ──────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!db) {
      setSnackbar({ open: true, message: 'Base de datos no inicializada', severity: 'error' });
      return;
    }

    if (tagError) {
      setSnackbar({ open: true, message: 'Corrige el error en equipment_id antes de enviar', severity: 'error' });
      return;
    }

    setSubmitting(true);

    try {
      const now = new Date().toISOString();
      const ts = Date.now();

      // Construir technical_specs solo si hay datos dinámicos
      const hasSpecs = Object.values(specs).some(v => v !== '' && v !== undefined && v !== null);
      const technical_specs = hasSpecs ? { ...specs } : undefined;

      const doc = {
        id: `AST-${ts}`,
        equipment_id: form.equipment_id.trim(),
        description: form.description.trim(),
        asset_type_id: form.asset_type_id,
        status: form.status,
        location: form.location_id.trim() || null,
        criticality: form.criticality,
        created_at: now,
        updated_at: ts,
        is_deleted: false,
        ...(technical_specs && { technical_specs })
      };

      await db.assets.insert(doc);

      // Si seleccionó parent_id, crear relación en asset_hierarchy
      if (form.parent_id) {
        const hierarchyDoc = {
          id: `HRC-${ts}`,
          parent_id: form.parent_id,
          child_id: doc.id,
          hierarchy_level: 1,
          created_at: now,
          is_deleted: false
        };
        await db.asset_hierarchy.insert(hierarchyDoc);
        console.log('[AddAssetForm] Relación jerárquica creada:', form.parent_id, '->', doc.id);
      }

      // También insertar en equipment_ids local para validación futura inmediata
      try {
        await db.equipment_ids.upsert({ equipment_id: form.equipment_id.trim() });
      } catch (upsertErr) {
        console.warn('[AddAssetForm] Upsert equipment_ids falló (la replicación lo hará):', upsertErr.message);
      }

      setSnackbar({ open: true, message: `Activo "${doc.equipment_id}" creado exitosamente`, severity: 'success' });
      setForm(INITIAL_FORM);
      setSpecs(INITIAL_SPECS);
      setTagError('');

      // Cerrar el Dialog tras un breve delay para que el Snackbar sea visible
      if (onSuccess) {
        setTimeout(() => onSuccess(), 1200);
      }
    } catch (err) {
      console.error('[AddAssetForm] Error insertando:', err);
      setSnackbar({ open: true, message: `Error: ${err.message || 'No se pudo crear el activo'}`, severity: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Derivados ───────────────────────────────────────────────────────
  const isTagInvalid = !!tagError;
  const canSubmit = !isTagInvalid && !submitting && !dbLoading && form.equipment_id.trim() && form.description.trim() && form.asset_type_id;

  const selectedType = ASSET_TYPES[form.asset_type_id];

  if (dbLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <>
      <Box component="form" onSubmit={handleSubmit} noValidate>
        {/* ─── equipment_id ─────────────────────────────────────────── */}
        <TextField
          fullWidth
          label="Equipment ID (Tag)"
          name="equipment_id"
          value={form.equipment_id}
          onChange={(e) => {
            handleChange(e);
            setTagError('');
          }}
          onBlur={handleEquipmentIdBlur}
          required
          error={isTagInvalid}
          helperText={tagError || (tagChecking ? 'Verificando...' : 'Ej: MCAL001-QUE')}
          sx={{ mb: 2 }}
          slotProps={{
            input: {
              endAdornment: tagChecking ? <CircularProgress size={20} /> : null
            }
          }}
          disabled={submitting}
        />

        {/* ─── description ──────────────────────────────────────────── */}
        <TextField
          fullWidth
          label="Descripción"
          name="description"
          value={form.description}
          onChange={handleChange}
          required
          multiline
          rows={2}
          sx={{ mb: 2 }}
          disabled={submitting}
        />

        {/* ─── asset_type_id ─────────────────────────────────────────── */}
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>Tipo de Equipo</InputLabel>
          <Select
            name="asset_type_id"
            value={form.asset_type_id}
            onChange={handleChange}
            required
            label="Tipo de Equipo"
            disabled={submitting}
          >
            {Object.entries(ASSET_TYPES).map(([code, { label }]) => (
              <MenuItem key={code} value={code}>{label}</MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* ─── parent_id ────────────────────────────────────────────── */}
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>Activo Padre</InputLabel>
          <Select
            name="parent_id"
            value={form.parent_id}
            onChange={handleChange}
            label="Activo Padre"
            disabled={submitting || existingAssets.length === 0}
          >
            <MenuItem value="">
              <em>Ninguno (activo raíz)</em>
            </MenuItem>
            {existingAssets.map(asset => (
              <MenuItem key={asset.id} value={asset.id}>
                {asset.equipment_id} {asset.description ? `— ${asset.description}` : ''}
              </MenuItem>
            ))}
          </Select>
          <FormHelperText>Opcional: seleccioná un padre para la jerarquía</FormHelperText>
        </FormControl>

        {/* ─── criticality + status en row ──────────────────────────── */}
        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
          <FormControl sx={{ flex: 1 }}>
            <InputLabel>Criticidad</InputLabel>
            <Select
              name="criticality"
              value={form.criticality}
              onChange={handleChange}
              label="Criticidad"
              disabled={submitting}
            >
              {CRITICALITIES.map(c => (
                <MenuItem key={c} value={c}>{c} {c === 'A' ? '(Alta)' : c === 'B' ? '(Media)' : '(Baja)'}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl sx={{ flex: 1 }}>
            <InputLabel>Estado</InputLabel>
            <Select
              name="status"
              value={form.status}
              onChange={handleChange}
              label="Estado"
              disabled={submitting}
            >
              {STATUSES.map(s => (
                <MenuItem key={s} value={s}>{s === 'Active' ? 'Activo' : 'Inactivo'}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>

        {/* ─── location_id ──────────────────────────────────────────── */}
        <TextField
          fullWidth
          label="Ubicación"
          name="location_id"
          value={form.location_id}
          onChange={handleChange}
          placeholder="Ej: Planta Norte - Sector A"
          sx={{ mb: 2 }}
          disabled={submitting}
        />

        {/* ─── Campos dinámicos por tipo de equipo ───────────────────── */}
        {selectedType && (
          <>
            <Divider sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Especificaciones técnicas — {selectedType.label}
              </Typography>
            </Divider>

            {selectedType.specs.map(spec => (
              <TextField
                key={spec.key}
                name={spec.key}
                fullWidth
                label={spec.label}
                type={spec.type === 'number' ? 'number' : 'text'}
                value={specs[spec.key] || ''}
                onChange={(e) => handleSpecChange(spec.key, e.target.value)}
                sx={{ mb: 2 }}
                disabled={submitting}
                slotProps={spec.type === 'number' ? { inputLabel: { shrink: true } } : undefined}
              />
            ))}
          </>
        )}

        {/* ─── Acciones ─────────────────────────────────────────────── */}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2, mt: 3 }}>
          <Button
            variant="outlined"
            onClick={() => {
              setForm(INITIAL_FORM);
              setSpecs(INITIAL_SPECS);
              setTagError('');
            }}
            disabled={submitting}
          >
            Limpiar
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={!canSubmit}
            startIcon={submitting ? <CircularProgress size={18} color="inherit" /> : null}
          >
            {submitting ? 'Creando...' : 'Crear Activo'}
          </Button>
        </Box>
      </Box>

      {/* ─── Snackbar feedback ──────────────────────────────────────── */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={5000}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackbar.severity} variant="filled" sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </>
  );
}
