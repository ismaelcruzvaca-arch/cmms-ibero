/**
 * LevelEngineering — Wizard Nivel 3 (Ingeniería).
 *
 * Versión completa para analistas de confiabilidad.
 * Incluye todo lo del nivel Experto más: causas de falla (multi-select),
 * mitigaciones, frecuencia recomendada y badge de Prioridad de Acción (AP).
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
import Checkbox from '@mui/material/Checkbox';
import ListItemText from '@mui/material/ListItemText';
import OutlinedInput from '@mui/material/OutlinedInput';
import SaveIcon from '@mui/icons-material/Save';
import TableChartIcon from '@mui/icons-material/TableChart';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
  fn_determine_rcm_strategy,
  RCM_STRATEGIES,
  computeActionPriority,
  ACTION_PRIORITY,
  formatRPN,
  getSeverityColor,
  getAPColor,
} from './fmeaConstants';
import { RcmQuestions } from './RcmQuestions';
import { SodDefinitionTables } from './SodDefinitionTables';

// Marcas para sliders S/O/D
const SLIDER_MARKS = [
  { value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' },
  { value: 4, label: '4' }, { value: 5, label: '5' }, { value: 6, label: '6' },
  { value: 7, label: '7' }, { value: 8, label: '8' }, { value: 9, label: '9' },
  { value: 10, label: '10' },
];

/**
 * Causas de falla predefinidas para multi-select.
 */
const PREDEFINED_CAUSES = [
  'Desgaste por fatiga',
  'Corrosión',
  'Desalineación',
  'Lubricación inadecuada',
  'Sobrecalentamiento',
  'Vibración excesiva',
  'Fuga de fluido',
  'Falla eléctrica',
  'Error humano de operación',
  'Falta de mantenimiento programado',
  'Contaminación',
  'Envejecimiento del material',
  'Falla del sello',
  'Falla del rodamiento',
  'Falla del acoplamiento',
];

/**
 * Frecuencias recomendadas para mantenimiento.
 */
const FREQUENCIES = [
  { value: 'Unico', label: 'Único' },
  { value: 'Diaria', label: 'Diaria' },
  { value: 'Semanal', label: 'Semanal' },
  { value: 'Mensual', label: 'Mensual' },
  { value: 'Trimestral', label: 'Trimestral' },
  { value: 'Semestral', label: 'Semestral' },
  { value: 'Anual', label: 'Anual' },
  { value: 'Por_Parada', label: 'Por Parada' },
];

/**
 * Slider con etiqueta y acceso a tabla de definiciones.
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
 * Nivel Ingeniería del wizard FMEA — análisis completo para confiabilidad.
 */
export const LevelEngineering = ({ assetId, repo, formData, onChange, onSave }) => {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [tableOpen, setTableOpen] = useState(null);
  const [customCause, setCustomCause] = useState('');

  // Datos del hook
  const components = repo.useAssetComponents(assetId);
  const failureModes = repo.useFailureModes(formData.componentTypeId || null);

  // Manejar cambio de componente
  const handleComponentChange = (componentId) => {
    onChange('componentId', componentId);
    const comp = components.find((c) => c.id === componentId);
    onChange('componentTypeId', comp?.componentTypeId || '');
    onChange('failureModeId', '');
  };

  // RPN
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

  // Prioridad de Acción
  const actionPriority = useMemo(() => {
    if (formData.severity && formData.occurrence && formData.detection) {
      return computeActionPriority(formData.severity, formData.occurrence, formData.detection);
    }
    return null;
  }, [formData.severity, formData.occurrence, formData.detection]);

  const apInfo = actionPriority ? ACTION_PRIORITY[actionPriority] : null;

  // Causas de falla: combinación de seleccionadas + "otro" personalizada
  const failureCauses = formData.failureCauses || [];

  const handleCauseChange = (event) => {
    const { value } = event.target;
    onChange('failureCauses', typeof value === 'string' ? value.split(',') : value);
  };

  const handleAddCustomCause = () => {
    if (customCause.trim() && !failureCauses.includes(customCause.trim())) {
      onChange('failureCauses', [...failureCauses, customCause.trim()]);
      setCustomCause('');
    }
  };

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
        failureCause: failureCauses.join('; '),
        mitigation_actions: formData.mitigation_actions || '',
        recommended_frequency: formData.recommended_frequency || '',
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

        {/* RPN + Action Priority */}
        {rpn !== null && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1, flexWrap: 'wrap' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
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

            {actionPriority && apInfo && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <WarningAmberIcon sx={{ color: apInfo.color, fontSize: 20 }} />
                <Typography variant="body2" color="text.secondary" fontWeight={600}>
                  Prioridad de Acción (AP):
                </Typography>
                <Tooltip title={apInfo.description}>
                  <Chip
                    label={apInfo.label}
                    size="small"
                    sx={{
                      backgroundColor: apInfo.color,
                      color: '#fff',
                      fontWeight: 700,
                    }}
                  />
                </Tooltip>
              </Box>
            )}
          </Box>
        )}
      </Paper>

      <Divider sx={{ my: 2 }} />

      {/* RCM Questions — wording confiabilidad */}
      <RcmQuestions
        values={{ q1: formData.q1, q2: formData.q2, q3: formData.q3, q4: formData.q4, q5: formData.q5 }}
        onChange={(qId, value) => onChange(qId, value)}
        readOnly={false}
        compact={false}
        level="engineering"
        rpn={rpn}
      />

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

      {/* Causas de Falla — multi-select */}
      <FormControl fullWidth size="small" sx={{ mb: 2 }}>
        <InputLabel>Causas de falla</InputLabel>
        <Select
          multiple
          value={failureCauses}
          onChange={handleCauseChange}
          input={<OutlinedInput label="Causas de falla" />}
          renderValue={(selected) => (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {selected.map((val) => (
                <Chip key={val} label={val} size="small" />
              ))}
            </Box>
          )}
        >
          {PREDEFINED_CAUSES.map((cause) => (
            <MenuItem key={cause} value={cause}>
              <Checkbox checked={failureCauses.indexOf(cause) > -1} size="small" />
              <ListItemText primary={cause} />
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {/* Causa personalizada */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Otra causa..."
          value={customCause}
          onChange={(e) => setCustomCause(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAddCustomCause();
            }
          }}
        />
        <Button
          variant="outlined"
          size="small"
          onClick={handleAddCustomCause}
          disabled={!customCause.trim()}
          sx={{ minWidth: 100 }}
        >
          Agregar
        </Button>
      </Box>

      {/* Mitigaciones */}
      <TextField
        fullWidth
        multiline
        rows={3}
        label="Acciones de mitigación / recomendaciones"
        placeholder="Describí las acciones para mitigar o eliminar el modo de falla..."
        value={formData.mitigation_actions || ''}
        onChange={(e) => onChange('mitigation_actions', e.target.value)}
        sx={{ mb: 2 }}
      />

      {/* Frecuencia Recomendada */}
      <FormControl fullWidth size="small" sx={{ mb: 2 }}>
        <InputLabel>Frecuencia recomendada</InputLabel>
        <Select
          value={formData.recommended_frequency || ''}
          label="Frecuencia recomendada"
          onChange={(e) => onChange('recommended_frequency', e.target.value)}
        >
          {FREQUENCIES.map((freq) => (
            <MenuItem key={freq.value} value={freq.value}>
              {freq.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {/* Notas */}
      <TextField
        fullWidth
        multiline
        rows={2}
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

      {/* Tabla de Definiciones S/O/D */}
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

export default LevelEngineering;
