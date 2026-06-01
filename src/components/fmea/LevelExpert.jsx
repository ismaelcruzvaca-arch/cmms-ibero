/**
 * LevelExpert — Wizard Nivel 2 (Experto).
 *
 * Versión estándar para planners con escalas 1–10 mediante Sliders,
 * acceso a tablas de definición AIAG/VDA y campo de notas.
 *
 * Props:
 *  - assetId  : string — ID del activo
 *  - repo     : object — objeto retornado por useFmeaRepository()
 *  - formData : object — estado compartido del formulario
 *  - onChange : (key: string, value: any) => void
 *  - onSave   : (data: object) => Promise<void>
 */
import React, { useState, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Slider from '@mui/material/Slider';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import Link from '@mui/material/Link';
import SaveIcon from '@mui/icons-material/Save';
import TableChartIcon from '@mui/icons-material/TableChart';
import {
  fn_determine_rcm_strategy,
  RCM_STRATEGIES,
  formatRPN,
  getSeverityColor,
} from './fmeaConstants';
import { RcmQuestions } from './RcmQuestions';
import { SodDefinitionTables } from './SodDefinitionTables';

// Marcas para los sliders S/O/D (1-10)
const SLIDER_MARKS = [
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
  { value: 5, label: '5' },
  { value: 6, label: '6' },
  { value: 7, label: '7' },
  { value: 8, label: '8' },
  { value: 9, label: '9' },
  { value: 10, label: '10' },
];

/**
 * Slider con etiqueta, acceso a tabla de definiciones y color personalizado.
 */
const SodSlider = ({ label, type, value, onChange, onOpenTable }) => {
  const color = type === 'severity' ? getSeverityColor(value) : undefined;

  return (
    <Box sx={{ mb: 2.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography variant="body2" fontWeight={600} color="text.primary">
          {label}: <strong>{value}</strong>
        </Typography>
        <Link
          component="button"
          variant="caption"
          onClick={() => onOpenTable(type)}
          sx={{ display: 'flex', alignItems: 'center', gap: 0.25, cursor: 'pointer' }}
        >
          <TableChartIcon sx={{ fontSize: 14 }} />
          Ver tabla de definiciones
        </Link>
      </Box>
      <Slider
        value={value}
        onChange={(_e, newValue) => onChange(newValue)}
        min={1}
        max={10}
        step={1}
        marks={SLIDER_MARKS}
        valueLabelDisplay="auto"
        sx={{
          ...(color && {
            '& .MuiSlider-track': { bgcolor: color },
            '& .MuiSlider-thumb': { bgcolor: color },
          }),
        }}
      />
    </Box>
  );
};

/**
 * Nivel Experto del wizard FMEA.
 * Formulario estándar con sliders 1–10 y tablas de referencia.
 */
export const LevelExpert = ({ assetId, repo, formData, onChange, onSave }) => {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [tableOpen, setTableOpen] = useState(null); // 'severity' | 'occurrence' | 'detection' | null

  // Datos reactivos del hook
  const components = repo.useAssetComponents(assetId);
  const failureModes = repo.useFailureModes(formData.componentTypeId || null);

  // Cuando se selecciona un componente, extraer su componentTypeId
  const handleComponentChange = (componentId) => {
    onChange('componentId', componentId);
    const comp = components.find((c) => c.id === componentId);
    onChange('componentTypeId', comp?.componentTypeId || '');
    onChange('failureModeId', '');
  };

  // RPN computado
  const rpn = useMemo(() => {
    if (formData.severity && formData.occurrence && formData.detection) {
      return formData.severity * formData.occurrence * formData.detection;
    }
    return null;
  }, [formData.severity, formData.occurrence, formData.detection]);

  // Estrategia RCM
  const strategy = useMemo(() => {
    return fn_determine_rcm_strategy({
      q1: formData.q1, q2: formData.q2, q3: formData.q3,
      q4: formData.q4, q5: formData.q5,
    });
  }, [formData.q1, formData.q2, formData.q3, formData.q4, formData.q5]);

  const strategyInfo = RCM_STRATEGIES[strategy];
  const hasAnswers = [formData.q1, formData.q2, formData.q3, formData.q4, formData.q5].some((v) => v != null);

  // Guardar
  const handleSave = async () => {
    if (!formData.componentId || !formData.failureModeId) {
      setSaveError('Seleccioná un componente y un modo de falla antes de guardar.');
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const result = await onSave({
        assetId,
        componentId: formData.componentId,
        failureModeId: formData.failureModeId,
        severity: formData.severity,
        occurrence: formData.occurrence,
        detection: formData.detection,
        notes: formData.notes || '',
        ...(hasAnswers && {
          q1: formData.q1 ?? null, q2: formData.q2 ?? null, q3: formData.q3 ?? null,
          q4: formData.q4 ?? null, q5: formData.q5 ?? null,
        }),
      });

      if (result?.error) {
        setSaveError(result.error);
      } else {
        setSaveSuccess(true);
        onChange('reset', true);
      }
    } catch (err) {
      setSaveError(err.message || 'Error al guardar el análisis');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      {/* Selector de Componente */}
      <FormControl fullWidth size="small" sx={{ mb: 2 }}>
        <InputLabel>Componente del activo</InputLabel>
        <Select
          value={formData.componentId || ''}
          label="Componente del activo"
          onChange={(e) => handleComponentChange(e.target.value)}
        >
          {components.length === 0 && (
            <MenuItem disabled value="">
              {repo.loading ? 'Cargando componentes...' : 'No hay componentes disponibles'}
            </MenuItem>
          )}
          {components.map((comp) => (
            <MenuItem key={comp.id} value={comp.id}>
              {comp.serialNumber || comp.positionReference || comp.id}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {/* Selector de Modo de Falla */}
      <FormControl fullWidth size="small" sx={{ mb: 3 }}>
        <InputLabel>Modo de falla</InputLabel>
        <Select
          value={formData.failureModeId || ''}
          label="Modo de falla"
          onChange={(e) => onChange('failureModeId', e.target.value)}
          disabled={!formData.componentTypeId}
        >
          {!formData.componentTypeId && (
            <MenuItem disabled value="">
              Seleccioná un componente primero
            </MenuItem>
          )}
          {formData.componentTypeId && failureModes.length === 0 && (
            <MenuItem disabled value="">
              No hay modos de falla para este componente
            </MenuItem>
          )}
          {failureModes.map((fm) => (
            <MenuItem key={fm.id} value={fm.id}>
              {fm.modeName || fm.modeCode}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <Divider sx={{ mb: 2 }} />

      {/* S/O/D Sliders */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>
          Evaluación S/O/D
        </Typography>

        <SodSlider
          label="Severidad"
          type="severity"
          value={formData.severity}
          onChange={(v) => onChange('severity', v)}
          onOpenTable={setTableOpen}
        />
        <SodSlider
          label="Ocurrencia"
          type="occurrence"
          value={formData.occurrence}
          onChange={(v) => onChange('occurrence', v)}
          onOpenTable={setTableOpen}
        />
        <SodSlider
          label="Detección"
          type="detection"
          value={formData.detection}
          onChange={(v) => onChange('detection', v)}
          onOpenTable={setTableOpen}
        />

        {/* RPN */}
        {rpn !== null && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
            <Typography variant="body2" color="text.secondary" fontWeight={600}>
              RPN (S × O × D):
            </Typography>
            <Chip
              label={formatRPN(rpn)}
              size="small"
              color={rpn >= 200 ? 'error' : rpn >= 100 ? 'warning' : 'success'}
              variant="outlined"
              sx={{ fontWeight: 700 }}
            />
          </Box>
        )}
      </Paper>

      <Divider sx={{ my: 2 }} />

      {/* RCM Questions — modo estándar, wording confiabilidad */}
      <RcmQuestions
        values={{ q1: formData.q1, q2: formData.q2, q3: formData.q3, q4: formData.q4, q5: formData.q5 }}
        onChange={(qId, value) => onChange(qId, value)}
        readOnly={false}
        compact={false}
        level="expert"
        rpn={rpn}
      />

      {/* Badge de estrategia RCM */}
      {hasAnswers && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Estrategia determinada:
          </Typography>
          <Tooltip title={strategyInfo?.description || ''}>
            <Chip
              label={strategyInfo?.label || strategy}
              size="small"
              sx={{ backgroundColor: strategyInfo?.color || '#9e9e9e', color: '#fff', fontWeight: 700 }}
            />
          </Tooltip>
        </Box>
      )}

      <Divider sx={{ my: 2 }} />

      {/* Notas */}
      <TextField
        fullWidth
        multiline
        rows={3}
        label="Notas del análisis"
        placeholder="Observaciones adicionales..."
        value={formData.notes || ''}
        onChange={(e) => onChange('notes', e.target.value)}
        sx={{ mb: 2 }}
      />

      {/* Mensajes */}
      {saveError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setSaveError(null)}>
          {saveError}
        </Alert>
      )}
      {saveSuccess && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSaveSuccess(false)}>
          Análisis guardado correctamente
        </Alert>
      )}

      {/* Botón Guardar */}
      <Button
        variant="contained"
        color="primary"
        fullWidth
        startIcon={saving ? <CircularProgress size={20} color="inherit" /> : <SaveIcon />}
        onClick={handleSave}
        disabled={saving || !formData.componentId || !formData.failureModeId}
      >
        {saving ? 'Guardando...' : 'Guardar Análisis'}
      </Button>

      {/* Tabla de Definiciones S/O/D - Dialog */}
      <SodDefinitionTables
        type={tableOpen}
        open={tableOpen !== null}
        onClose={() => setTableOpen(null)}
        selectedValue={
          tableOpen === 'severity' ? formData.severity
          : tableOpen === 'occurrence' ? formData.occurrence
          : tableOpen === 'detection' ? formData.detection
          : undefined
        }
      />
    </Box>
  );
};

export default LevelExpert;
