/**
 * LevelQuick — Wizard Nivel 1 (Rápido).
 *
 * Versión simplificada para mecánicos y supervisores.
 * Usa escalas S/O/D categóricas en lugar de valores 1–10.
 *
 * Props:
 *  - assetId  : string — ID del activo
 *  - repo     : object — objeto retornado por useFmeaRepository()
 *  - formData : object — estado compartido del formulario
 *  - onChange : (key: string, value: any) => void
 *  - onSave   : (data: object) => Promise<void>
 */
import React, { useState, useEffect, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import SaveIcon from '@mui/icons-material/Save';
import {
  SEVERITY_SIMPLIFIED,
  OCCURRENCE_SIMPLIFIED,
  DETECTION_SIMPLIFIED,
  computeSimplifiedSOD,
  fn_determine_rcm_strategy,
  RCM_STRATEGIES,
  formatRPN,
  getSeverityColor,
} from './fmeaConstants';
import { RcmQuestions } from './RcmQuestions';

/**
 * Opciones de los mapas simplificados para renderizar radios.
 */
function simplifiedRadios(map, value, onChange) {
  return (
    <RadioGroup
      value={value ?? ''}
      onChange={(e) => onChange(Number(e.target.value))}
      sx={{ flexDirection: 'row', gap: 1 }}
    >
      {Object.entries(map).map(([key, opt]) => (
        <FormControlLabel
          key={key}
          value={opt.value}
          control={<Radio size="small" />}
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box
                sx={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  bgcolor: getSeverityColor(opt.value),
                }}
              />
              <Typography variant="body2" fontWeight={500}>
                {opt.label}
              </Typography>
              <Typography variant="caption" color="text.disabled">
                ({opt.range[0]}–{opt.range[1]})
              </Typography>
            </Box>
          }
          sx={{ m: 0, border: 1, borderColor: 'divider', borderRadius: 1, px: 1.5, py: 0.5 }}
        />
      ))}
    </RadioGroup>
  );
}

/**
 * Nivel Rápido del wizard FMEA.
 * Formulario simplificado con escalas categóricas.
 */
export const LevelQuick = ({ assetId, repo, formData, onChange, onSave }) => {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Datos reactivos del hook
  const components = repo.useAssetComponents(assetId);
  const failureModes = repo.useFailureModes(formData.componentTypeId || null);

  // Cuando se selecciona un componente, extraer su componentTypeId
  const handleComponentChange = (componentId) => {
    onChange('componentId', componentId);
    const comp = components.find((c) => c.id === componentId);
    onChange('componentTypeId', comp?.componentTypeId || '');
    // Resetear failure mode al cambiar componente
    onChange('failureModeId', '');
  };

  // RPN computado
  const rpn = useMemo(() => {
    if (formData.severity && formData.occurrence && formData.detection) {
      const sod = computeSimplifiedSOD('quick', formData.severity, formData.occurrence, formData.detection);
      return sod.severity * sod.occurrence * sod.detection;
    }
    return null;
  }, [formData.severity, formData.occurrence, formData.detection]);

  // Estrategia RCM
  const strategy = useMemo(() => {
    return fn_determine_rcm_strategy({
      q1: formData.q1,
      q2: formData.q2,
      q3: formData.q3,
      q4: formData.q4,
      q5: formData.q5,
    });
  }, [formData.q1, formData.q2, formData.q3, formData.q4, formData.q5]);

  const strategyInfo = RCM_STRATEGIES[strategy];
  const hasAnswers = [formData.q1, formData.q2, formData.q3, formData.q4, formData.q5].some((v) => v != null);

  // Manejar guardado
  const handleSave = async () => {
    if (!formData.componentId || !formData.failureModeId) {
      setSaveError('Seleccioná un componente y un modo de falla antes de guardar.');
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const sod = computeSimplifiedSOD('quick', formData.severity, formData.occurrence, formData.detection);
      const result = await onSave({
        assetId,
        componentId: formData.componentId,
        failureModeId: formData.failureModeId,
        severity: sod.severity,
        occurrence: sod.occurrence,
        detection: sod.detection,
        // Solo rcm values si hay al menos una respuesta
        ...(hasAnswers && {
          q1: formData.q1 ?? null,
          q2: formData.q2 ?? null,
          q3: formData.q3 ?? null,
          q4: formData.q4 ?? null,
          q5: formData.q5 ?? null,
        }),
      });

      if (result?.error) {
        setSaveError(result.error);
      } else {
        setSaveSuccess(true);
        // Resetear formulario después de guardar exitosamente
        onChange('reset', true);
      }
    } catch (err) {
      setSaveError(err.message || 'Error al guardar el análisis');
    } finally {
      setSaving(false);
    }
  };

  // --- Render ---
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

      {/* Severidad Simplificada */}
      <FormControl component="fieldset" sx={{ mb: 2 }}>
        <FormLabel component="legend" sx={{ fontWeight: 600, mb: 1, color: 'text.primary' }}>
          Severidad
        </FormLabel>
        {simplifiedRadios(SEVERITY_SIMPLIFIED, formData.severity, (v) => onChange('severity', v))}
      </FormControl>

      {/* Ocurrencia Simplificada */}
      <FormControl component="fieldset" sx={{ mb: 2 }}>
        <FormLabel component="legend" sx={{ fontWeight: 600, mb: 1, color: 'text.primary' }}>
          Ocurrencia
        </FormLabel>
        {simplifiedRadios(OCCURRENCE_SIMPLIFIED, formData.occurrence, (v) => onChange('occurrence', v))}
      </FormControl>

      {/* Detección Simplificada */}
      <FormControl component="fieldset" sx={{ mb: 2 }}>
        <FormLabel component="legend" sx={{ fontWeight: 600, mb: 1, color: 'text.primary' }}>
          Detección
        </FormLabel>
        {simplifiedRadios(DETECTION_SIMPLIFIED, formData.detection, (v) => onChange('detection', v))}
      </FormControl>

      <Divider sx={{ my: 2 }} />

      {/* RCM Questions — modo compacto, wording taller */}
      <RcmQuestions
        values={{ q1: formData.q1, q2: formData.q2, q3: formData.q3, q4: formData.q4, q5: formData.q5 }}
        onChange={(qId, value) => onChange(qId, value)}
        readOnly={false}
        compact
        level="quick"
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

      {/* Mensajes de error / éxito */}
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
        sx={{ mt: 1 }}
      >
        {saving ? 'Guardando...' : 'Guardar Análisis'}
      </Button>
    </Box>
  );
};

export default LevelQuick;
