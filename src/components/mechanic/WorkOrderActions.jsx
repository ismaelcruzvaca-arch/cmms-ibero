import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import { getAllowedTransitions } from '../../lib/fsm.js';

const ACTION_CONFIG = {
  APPROVED: { label: 'Iniciar', color: 'primary' },
  INPRG: { label: 'Completar', color: 'success' },
  COMP: { label: 'Cerrar', color: 'warning' }
};

export default function WorkOrderActions({ lifecyclePhase, onAction, isSubmitting, validationErrors = [] }) {
  const allowed = getAllowedTransitions(lifecyclePhase);
  const firstTarget = allowed[0];
  const config = firstTarget ? ACTION_CONFIG[lifecyclePhase] : null;

  if (!config) return null;

  const isDisabled = isSubmitting || validationErrors.length > 0;
  const tooltipText = validationErrors.length > 0
    ? 'Completá los campos obligatorios (Síntomas y Acción) antes de finalizar.'
    : '';

  const button = (
    <Button
      variant="contained"
      color={config.color}
      fullWidth
      size="large"
      disabled={isDisabled}
      onClick={() => onAction(firstTarget)}
      sx={{ textTransform: 'none', fontWeight: 700, py: 1.2 }}
    >
      {isSubmitting ? (
        <CircularProgress size={20} sx={{ color: 'white' }} />
      ) : (
        config.label
      )}
    </Button>
  );

  return (
    <Box sx={{ mt: 2 }}>
      {tooltipText ? (
        <Tooltip title={tooltipText} arrow placement="top">
          <Box>{button}</Box>
        </Tooltip>
      ) : (
        button
      )}
    </Box>
  );
}
