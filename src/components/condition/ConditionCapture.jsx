/**
 * ConditionCapture.jsx — Formulario de Captura Manual de Condición
 *
 * UI para que técnicos capturen datos de condición manualmente.
 * Construye FeatureSet v0.2 client-side y envía a ingest-condition EF.
 *
 * Campos:
 *   - Asset selector (autocomplete desde RxDB)
 *   - Feature selector (filtrado por capabilities del source manual_route_001)
 *   - Method auto-seleccionado según feature
 *   - Value numérico con indicador de unidad
 *   - Quality flag (default G2 manual)
 *   - Operational context (regime, rpm, load_pct — opcionales)
 *   - Instrument ref, Notes
 *   - Measured at (datetime picker, default now)
 *   - Submit
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box, Paper, TextField, Button, Typography, MenuItem,
  Alert, AlertTitle, CircularProgress, Grid, InputAdornment,
  FormControl, InputLabel, Select, Divider,
  Snackbar, Chip,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFnsV3';
import { es } from 'date-fns/locale/es';
import { useAssets } from '../../lib/rxdb';
import { supabase } from '../../lib/supabaseClient';
import { useConditionCapture, validateCaptureForm } from '../../hooks/useConditionCapture';

// ─── Constantes ──────────────────────────────────────────────────
const DEFAULT_SOURCE_ID = 'manual_route_001';
const QUALITY_OPTIONS = [
  { value: 'G0', label: 'G0 — Excelente (instrumento calibrado, trazable)' },
  { value: 'G1', label: 'G1 — Buena (instrumento verificado)' },
  { value: 'G2', label: 'G2 — Aceptable (manual / sin calibración estricta)' },
  { value: 'G3', label: 'G3 — No confiable (solo referencia)' },
];
const REGIME_OPTIONS = [
  { value: 'steady', label: 'Régimen estable' },
  { value: 'transient', label: 'Transitorio (arranque/parada)' },
  { value: 'variable', label: 'Carga variable' },
  { value: 'idle', label: 'Ralentí / sin carga' },
];

export default function ConditionCapture() {
  const { assets } = useAssets();
  const { submitCapture, loading, result, error, reset } = useConditionCapture();

  // ─── Catálogos desde Supabase ──────────────────────────────────
  const [features, setFeatures] = useState([]);
  const [capabilities, setCapabilities] = useState([]);
  const [catalogsLoading, setCatalogsLoading] = useState(true);

  // ─── Estados del formulario ────────────────────────────────────
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [assetInput, setAssetInput] = useState('');
  const [featureKey, setFeatureKey] = useState('');
  const [value, setValue] = useState('');
  const [qualityFlag, setQualityFlag] = useState('G2');
  const [regime, setRegime] = useState('');
  const [rpm, setRpm] = useState('');
  const [loadPct, setLoadPct] = useState('');
  const [instrumentRef, setInstrumentRef] = useState('');
  const [notes, setNotes] = useState('');
  const [measuredAt, setMeasuredAt] = useState(new Date());
  const [validationErrors, setValidationErrors] = useState([]);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });

  // ─── Cargar catálogos ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function loadCatalogs() {
      try {
        const [featRes, capRes] = await Promise.all([
          supabase.from('condition_feature_definitions').select('feature_key,unit,category,description').order('feature_key'),
          supabase.from('condition_source_capabilities')
            .select('source_id,can_produce,method_key,unit,quality_expected')
            .eq('source_id', DEFAULT_SOURCE_ID)
            .order('can_produce'),
        ]);

        if (!cancelled) {
          if (featRes.data) setFeatures(featRes.data);
          if (capRes.data) setCapabilities(capRes.data);
        }
      } catch (err) {
        console.warn('[ConditionCapture] Error cargando catálogos:', err);
      } finally {
        if (!cancelled) setCatalogsLoading(false);
      }
    }

    loadCatalogs();
    return () => { cancelled = true; };
  }, []);

  // ─── Features disponibles para este source ─────────────────────
  const availableFeatures = useMemo(() => {
    if (!capabilities.length) return [];
    const capFeatures = capabilities.map((c) => c.can_produce);
    return features.filter((f) => capFeatures.includes(f.feature_key));
  }, [features, capabilities]);

  // ─── Feature seleccionado ──────────────────────────────────────
  const selectedFeature = useMemo(() => {
    return features.find((f) => f.feature_key === featureKey) || null;
  }, [features, featureKey]);

  // ─── Método auto-determinado ────────────────────────────────────
  const autoMethodKey = useMemo(() => {
    if (!featureKey) return '';
    const cap = capabilities.find((c) => c.can_produce === featureKey);
    return cap?.method_key || '';
  }, [featureKey, capabilities]);

  // ─── Unidad de la capability ───────────────────────────────────
  const capabilityUnit = useMemo(() => {
    if (!featureKey) return '';
    const cap = capabilities.find((c) => c.can_produce === featureKey);
    return cap?.unit || selectedFeature?.unit || '';
  }, [featureKey, capabilities, selectedFeature]);

  // ─── Assets filtrados para autocomplete ────────────────────────
  const filteredAssets = useMemo(() => {
    if (!assetInput) return assets.slice(0, 20);
    const q = assetInput.toLowerCase();
    return assets
      .filter(
        (a) =>
          a.equipment_id?.toLowerCase().includes(q) ||
          a.description?.toLowerCase().includes(q) ||
          a.id?.toLowerCase().includes(q)
      )
      .slice(0, 20);
  }, [assets, assetInput]);

  // ─── Handlers ───────────────────────────────────────────────────
  const handleAssetSelect = useCallback((asset) => {
    setSelectedAsset(asset);
    setAssetInput(asset.equipment_id || asset.id);
  }, []);

  const handleValueChange = useCallback((e) => {
    const val = e.target.value;
    // Permitir decimales, vacío, y punto flotante parcial
    if (val === '' || /^-?\d*\.?\d*$/.test(val)) {
      setValue(val);
    }
  }, []);

  const clearForm = useCallback(() => {
    setSelectedAsset(null);
    setAssetInput('');
    setFeatureKey('');
    setValue('');
    setQualityFlag('G2');
    setRegime('');
    setRpm('');
    setLoadPct('');
    setInstrumentRef('');
    setNotes('');
    setMeasuredAt(new Date());
    setValidationErrors([]);
    reset();
  }, [reset]);

  // ─── Submit ─────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    setValidationErrors([]);

    // Validación client-side
    const formData = {
      assetId: selectedAsset?.equipment_id || selectedAsset?.id || '',
      featureKey,
      value,
      unit: capabilityUnit,
      qualityFlag,
      methodKey: autoMethodKey,
      measuredAt: measuredAt.toISOString(),
      instrumentRef,
      notes,
      operationalContext: {
        ...(regime && { regime }),
        ...(rpm && { rpm: Number(rpm) }),
        ...(loadPct && { load_pct: Number(loadPct) }),
      },
      sourceId: DEFAULT_SOURCE_ID,
    };

    const featureKeys = availableFeatures.map((f) => f.feature_key);
    const { valid, errors } = validateCaptureForm(formData, featureKeys);

    if (!valid) {
      setValidationErrors(errors);
      return;
    }

    // Construir FeatureSet v0.2
    const { buildFeatureSetV2 } = await import('../../hooks/useConditionCapture');
    const payload = buildFeatureSetV2(formData);

    // Enviar a ingest-condition
    const result = await submitCapture(payload);

    if (result.success) {
      setSnackbar({
        open: true,
        message: `Captura exitosa — ${result.features_ingested ?? 1} feature(s) ingerido(s). Window: ${result.data?.window_id?.slice(0, 8) ?? 'ok'}`,
        severity: 'success',
      });
      clearForm();
    } else {
      setSnackbar({
        open: true,
        message: `Error: ${result.error || 'Error desconocido'}`,
        severity: 'error',
      });
    }
  }, [
    selectedAsset, featureKey, value, capabilityUnit, qualityFlag,
    autoMethodKey, measuredAt, instrumentRef, notes, regime, rpm,
    loadPct, availableFeatures, submitCapture, clearForm,
  ]);

  // ─── Loading state ──────────────────────────────────────────────
  if (catalogsLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  // ─── Render ─────────────────────────────────────────────────────
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
      <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>
        Captura Manual de Condición
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Ingrese datos de inspección manual. Los datos se envían directamente al sistema de monitoreo de condición.
      </Typography>

      {/* ── Validación client-side errors ── */}
      {validationErrors.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setValidationErrors([])}>
          <AlertTitle>Corrija los siguientes errores</AlertTitle>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {validationErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </Alert>
      )}

      {/* ── Error del servidor ── */}
      {error && !validationErrors.length && (
        <Alert severity="error" sx={{ mb: 2 }} icon={<ErrorIcon />}>
          {error}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* ── Columna 1: Selección ── */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1.5 }}>
            Activo y Medición
          </Typography>

          {/* Asset Selector */}
          <Box sx={{ position: 'relative', mb: 2 }}>
            <TextField
              fullWidth
              label="Buscar Activo"
              placeholder="Escriba ID o descripción del equipo..."
              value={assetInput}
              onChange={(e) => {
                setAssetInput(e.target.value);
                setSelectedAsset(null);
              }}
              size="small"
              autoComplete="off"
            />
            {assetInput && !selectedAsset && filteredAssets.length > 0 && (
              <Paper
                elevation={8}
                sx={{
                  position: 'absolute',
                  zIndex: 1300,
                  width: '100%',
                  maxHeight: 200,
                  overflow: 'auto',
                  mt: 0.5,
                }}
              >
                {filteredAssets.map((asset) => (
                  <Box
                    key={asset.id}
                    onClick={() => handleAssetSelect(asset)}
                    sx={{
                      px: 2, py: 1, cursor: 'pointer',
                      '&:hover': { bgcolor: 'action.hover' },
                    }}
                  >
                    <Typography variant="body2" fontWeight={600}>
                      {asset.equipment_id || asset.id}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {asset.description}
                    </Typography>
                  </Box>
                ))}
              </Paper>
            )}
          </Box>

          {selectedAsset && (
            <Chip
              label={`${selectedAsset.equipment_id || selectedAsset.id} — ${selectedAsset.description || ''}`}
              onDelete={() => { setSelectedAsset(null); setAssetInput(''); }}
              color="primary"
              variant="outlined"
              size="small"
              sx={{ mb: 2 }}
            />
          )}

          {/* Feature Selector */}
          <FormControl fullWidth size="small" sx={{ mb: 2 }}>
            <InputLabel>Feature de Condición</InputLabel>
            <Select
              value={featureKey}
              label="Feature de Condición"
              onChange={(e) => setFeatureKey(e.target.value)}
            >
              <MenuItem value="">
                <em>Seleccione un feature...</em>
              </MenuItem>
              {availableFeatures.map((f) => (
                <MenuItem key={f.feature_key} value={f.feature_key}>
                  {f.feature_key} ({f.unit}) — {f.category}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Método auto (read-only) */}
          {autoMethodKey && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Método de análisis:
              </Typography>
              <Chip label={autoMethodKey} size="small" variant="outlined" sx={{ ml: 1 }} />
            </Box>
          )}

          {/* Value + Unit */}
          <TextField
            fullWidth
            label="Valor medido"
            type="text"
            inputMode="decimal"
            value={value}
            onChange={handleValueChange}
            size="small"
            sx={{ mb: 2 }}
            slotProps={{
              input: {
                endAdornment: capabilityUnit ? (
                  <InputAdornment position="end">{capabilityUnit}</InputAdornment>
                ) : null,
              },
            }}
          />

          {/* Quality Flag */}
          <FormControl fullWidth size="small" sx={{ mb: 2 }}>
            <InputLabel>Calidad del dato</InputLabel>
            <Select
              value={qualityFlag}
              label="Calidad del dato"
              onChange={(e) => setQualityFlag(e.target.value)}
            >
              {QUALITY_OPTIONS.map((q) => (
                <MenuItem key={q.value} value={q.value}>
                  {q.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>

        {/* ── Columna 2: Contexto y trazabilidad ── */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1.5 }}>
            Contexto Operacional y Trazabilidad
          </Typography>

          {/* Operational Context */}
          <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
            Contexto operacional (opcional)
          </Typography>

          <Grid container spacing={1.5} sx={{ mb: 1.5 }}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Régimen</InputLabel>
                <Select
                  value={regime}
                  label="Régimen"
                  onChange={(e) => setRegime(e.target.value)}
                >
                  <MenuItem value=""><em>—</em></MenuItem>
                  {REGIME_OPTIONS.map((r) => (
                    <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, sm: 4 }}>
              <TextField
                fullWidth
                label="RPM"
                type="number"
                value={rpm}
                onChange={(e) => setRpm(e.target.value)}
                size="small"
                slotProps={{ htmlInput: { min: 0 } }}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 4 }}>
              <TextField
                fullWidth
                label="Carga %"
                type="number"
                value={loadPct}
                onChange={(e) => setLoadPct(e.target.value)}
                size="small"
                slotProps={{
                  htmlInput: { min: 0, max: 100 },
                  input: {
                    endAdornment: <InputAdornment position="end">%</InputAdornment>,
                  },
                }}
              />
            </Grid>
          </Grid>

          <Divider sx={{ my: 2 }} />

          {/* Instrument Ref */}
          <TextField
            fullWidth
            label="Referencia del instrumento"
            placeholder="Ej: vib-01, termo-IR-03"
            value={instrumentRef}
            onChange={(e) => setInstrumentRef(e.target.value)}
            size="small"
            sx={{ mb: 2 }}
          />

          {/* Notes */}
          <TextField
            fullWidth
            label="Notas"
            placeholder="Observaciones de la medición..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            size="small"
            multiline
            rows={3}
            sx={{ mb: 2 }}
          />

          {/* Measured At DateTime Picker */}
          <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={es}>
            <DateTimePicker
              label="Fecha y hora de medición"
              value={measuredAt}
              onChange={(newVal) => setMeasuredAt(newVal || new Date())}
              slotProps={{
                textField: {
                  fullWidth: true,
                  size: 'small',
                  sx: { mb: 2 },
                },
              }}
            />
          </LocalizationProvider>
        </Grid>
      </Grid>

      {/* ── Acciones ── */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2, mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
        <Button variant="outlined" onClick={clearForm} disabled={loading}>
          Limpiar
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={loading}
          startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <SendIcon />}
        >
          {loading ? 'Enviando...' : 'Enviar Captura'}
        </Button>
      </Box>

      {/* ── Resultado exitoso ── */}
      {result?.success && !snackbar.open && (
        <Alert severity="success" icon={<CheckCircleIcon />} sx={{ mt: 2 }}>
          Datos enviados correctamente al sistema de monitoreo.
        </Alert>
      )}

      {/* ── Snackbar para feedback ── */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
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
