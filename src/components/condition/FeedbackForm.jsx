/**
 * FeedbackForm — Formulario de feedback para diagnósticos de condición
 *
 * Permite a técnicos y planificadores registrar feedback sobre un
 * diagnóstico, incluyendo el estado real de la falla, observaciones
 * y utilidad de la recomendación.
 *
 * Props:
 *  - diagnosisId: ID del diagnóstico (obligatorio)
 *  - workOrderId (opcional): ID de la OT asociada
 *  - onSubmit (opcional): callback al enviar feedback exitoso
 *
 * Lenguaje: español. Todos los textos en español.
 */

import { useState, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  RadioGroup,
  Radio,
  FormControlLabel,
  FormControl,
  FormLabel,
  FormHelperText,
  Alert,
  Snackbar,
  CircularProgress,
  Autocomplete,
} from '@mui/material';
import { Send } from '@mui/icons-material';
import { useDiagnosisFeedback } from '../../hooks/useDiagnosisFeedback';
import { supabase } from '../../lib/supabaseClient';

// ─── Constantes ─────────────────────────────────────────────────

const FEEDBACK_STATUS_OPTIONS = [
  { value: 'confirmed', label: 'Confirmado' },
  { value: 'partial',   label: 'Parcial' },
  { value: 'rejected',  label: 'Rechazado' },
];

const USEFULNESS_OPTIONS = [
  { value: 'useful',       label: 'Útil' },
  { value: 'not_useful',   label: 'No útil' },
  { value: 'not_executed', label: 'No ejecutada' },
  { value: 'superseded',   label: 'Reemplazada' },
];

// ─── Failure Mode Catalog Autocomplete ──────────────────────────

function useFailureModeOptions() {
  const [options, setOptions] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const loadOptions = useCallback(async () => {
    if (loaded) return;
    try {
      const { data } = await supabase
        .from('condition_failure_mode_catalog')
        .select('failure_mode_key, name')
        .order('name');
      setOptions(data || []);
      setLoaded(true);
    } catch {
      // fallback silencioso
    }
  }, [loaded]);

  return { options, loadOptions };
}

// ─── FeedbackForm ───────────────────────────────────────────────

export default function FeedbackForm({ diagnosisId, workOrderId, onSubmit }) {
  const { submitFeedback, error: hookError } = useDiagnosisFeedback({ diagnosisId });

  // ─── Form state ───────────────────────────────────────────────
  const [feedbackStatus, setFeedbackStatus] = useState('');
  const [actualFailureMode, setActualFailureMode] = useState(null);
  const [failureModeInput, setFailureModeInput] = useState('');
  const [actualComponent, setActualComponent] = useState('');
  const [actualCause, setActualCause] = useState('');
  const [technicianObservation, setTechnicianObservation] = useState('');
  const [usefulness, setUsefulness] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  const { options: fmOptions, loadOptions } = useFailureModeOptions();

  // ─── Validation ───────────────────────────────────────────────
  const validate = useCallback(() => {
    if (!feedbackStatus) {
      setValidationError('El estado del feedback es obligatorio');
      return false;
    }
    setValidationError('');
    return true;
  }, [feedbackStatus]);

  // ─── Submit ───────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!validate()) return;

    setSubmitting(true);
    try {
      await submitFeedback({
        diagnosis_id: diagnosisId,
        work_order_id: workOrderId || null,
        feedback_status: feedbackStatus,
        actual_failure_mode: actualFailureMode?.failure_mode_key || actualFailureMode || null,
        actual_component: actualComponent || null,
        actual_cause: actualCause || null,
        technician_observation: technicianObservation || null,
        recommendation_usefulness: usefulness || null,
      });

      setSubmitted(true);
      setSnackbar({ open: true, message: 'Feedback enviado correctamente', severity: 'success' });
      onSubmit?.();

      // Reset form
      setFeedbackStatus('');
      setActualFailureMode(null);
      setFailureModeInput('');
      setActualComponent('');
      setActualCause('');
      setTechnicianObservation('');
      setUsefulness('');
    } catch (err) {
      setSnackbar({ open: true, message: `Error al enviar feedback: ${err.message}`, severity: 'error' });
    } finally {
      setSubmitting(false);
    }
  }, [
    validate, diagnosisId, workOrderId, feedbackStatus,
    actualFailureMode, actualComponent, actualCause,
    technicianObservation, usefulness, submitFeedback, onSubmit,
  ]);

  // ─── No hay diagnosisId ───────────────────────────────────────
  if (!diagnosisId) {
    return (
      <Paper variant="outlined" sx={{ p: 3, bgcolor: 'action.hover' }}>
        <Typography variant="body2" color="text.secondary" textAlign="center">
          Seleccioná un diagnóstico para enviar feedback.
        </Typography>
      </Paper>
    );
  }

  // ─── Ya enviado ───────────────────────────────────────────────
  if (submitted) {
    return (
      <Paper variant="outlined" sx={{ p: 3, bgcolor: 'action.hover' }}>
        <Alert severity="success" sx={{ mb: 2 }}>
          Feedback registrado correctamente para este diagnóstico.
        </Alert>
        <Button
          variant="outlined"
          size="small"
          onClick={() => setSubmitted(false)}
        >
          Enviar otro feedback
        </Button>
      </Paper>
    );
  }

  // ─── Form ─────────────────────────────────────────────────────
  return (
    <Paper variant="outlined" sx={{ p: 3, bgcolor: 'action.hover' }}>
      <Typography variant="subtitle2" fontWeight={700} gutterBottom>
        Feedback Técnico
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
        Evaluá la precisión del diagnóstico y la utilidad de la recomendación.
      </Typography>

      {hookError && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {hookError}
        </Alert>
      )}

      {validationError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {validationError}
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        {/* ── Feedback Status ── */}
        <FormControl required error={validationError && !feedbackStatus}>
          <FormLabel>Estado del Feedback</FormLabel>
          <RadioGroup
            row
            value={feedbackStatus}
            onChange={(e) => { setFeedbackStatus(e.target.value); setValidationError(''); }}
          >
            {FEEDBACK_STATUS_OPTIONS.map((opt) => (
              <FormControlLabel
                key={opt.value}
                value={opt.value}
                control={<Radio size="small" />}
                label={opt.label}
              />
            ))}
          </RadioGroup>
          {validationError && !feedbackStatus && (
            <FormHelperText error>{validationError}</FormHelperText>
          )}
        </FormControl>

        {/* ── Modo de Falla Real ── */}
        <Autocomplete
          freeSolo
          options={fmOptions}
          getOptionLabel={(opt) => (opt?.name ? `${opt.name} (${opt.failure_mode_key})` : opt || '')}
          value={actualFailureMode}
          onChange={(e, newVal) => setActualFailureMode(newVal)}
          inputValue={failureModeInput}
          onInputChange={(e, newVal) => setFailureModeInput(newVal)}
          onOpen={loadOptions}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Modo de Falla Real"
              placeholder="Buscá en el catálogo o ingresá manualmente"
              size="small"
            />
          )}
        />

        {/* ── Componente Afectado ── */}
        <TextField
          label="Componente Afectado"
          value={actualComponent}
          onChange={(e) => setActualComponent(e.target.value)}
          size="small"
          fullWidth
          placeholder="Ej: Rodamiento lado acoplamiento"
        />

        {/* ── Causa Real ── */}
        <TextField
          label="Causa Real"
          value={actualCause}
          onChange={(e) => setActualCause(e.target.value)}
          size="small"
          fullWidth
          placeholder="Ej: Fatiga por desalineación"
        />

        {/* ── Observación Técnica ── */}
        <TextField
          label="Observación Técnica"
          value={technicianObservation}
          onChange={(e) => setTechnicianObservation(e.target.value)}
          multiline
          rows={3}
          size="small"
          fullWidth
          placeholder="Detalles adicionales sobre la falla observada…"
        />

        {/* ── ¿Recomendación Útil? ── */}
        <FormControl>
          <FormLabel>¿Recomendación Útil?</FormLabel>
          <RadioGroup
            row
            value={usefulness}
            onChange={(e) => setUsefulness(e.target.value)}
          >
            {USEFULNESS_OPTIONS.map((opt) => (
              <FormControlLabel
                key={opt.value}
                value={opt.value}
                control={<Radio size="small" />}
                label={opt.label}
              />
            ))}
          </RadioGroup>
        </FormControl>

        {/* ── Submit ── */}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="contained"
            color="primary"
            startIcon={submitting ? <CircularProgress size={16} /> : <Send />}
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? 'Enviando…' : 'Enviar Feedback'}
          </Button>
        </Box>
      </Box>

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
