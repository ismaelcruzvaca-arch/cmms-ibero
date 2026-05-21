import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';

export default function WorkOrderNotesForm({ values = {}, onChange, errors = {}, lifecyclePhase }) {
  if (lifecyclePhase !== 'INPRG') return null;

  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="subtitle2" fontWeight="700" color="text.secondary" sx={{ mb: 1.5 }}>
        Notas técnicas
      </Typography>

      <TextField
        label="Síntomas observados"
        value={values.symptom_note || ''}
        onChange={(e) => onChange('symptom_note', e.target.value)}
        error={!!errors.symptom_note}
        helperText={errors.symptom_note}
        multiline
        minRows={3}
        fullWidth
        required
        size="small"
        sx={{ mb: 1.5 }}
      />

      <TextField
        label="Causa probable"
        value={values.cause_note || ''}
        onChange={(e) => onChange('cause_note', e.target.value)}
        multiline
        minRows={2}
        fullWidth
        size="small"
        sx={{ mb: 1.5 }}
      />

      <TextField
        label="Acción realizada"
        value={values.action_note || ''}
        onChange={(e) => onChange('action_note', e.target.value)}
        error={!!errors.action_note}
        helperText={errors.action_note}
        multiline
        minRows={3}
        fullWidth
        required
        size="small"
      />
    </Box>
  );
}
