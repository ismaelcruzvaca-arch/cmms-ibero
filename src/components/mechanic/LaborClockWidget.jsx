import { useState, useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import InputLabel from '@mui/material/InputLabel';
import FormControl from '@mui/material/FormControl';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';

const ACTIVITY_CODES = [
  { value: 'DIRECT_WORK', label: 'Trabajo Directo' },
  { value: 'WAIT_MATERIAL', label: 'Espera de Material' },
  { value: 'WAIT_PERMIT', label: 'Espera de Permiso' },
  { value: 'TRAVEL', label: 'Viaje' },
  { value: 'BREAK', label: 'Pausa' }
];

const ACTIVITY_COLORS = {
  DIRECT_WORK: 'success',
  WAIT_MATERIAL: 'warning',
  WAIT_PERMIT: 'warning',
  TRAVEL: 'info',
  BREAK: 'default'
};

function formatTimer(startTime) {
  const diff = Date.now() - new Date(startTime).getTime();
  const totalSeconds = Math.floor(Math.max(0, diff / 1000));
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Widget de control de ingreso/egreso para órdenes de trabajo.
 * 
 * Props:
 *   activeSession   - LaborRecord activo (endTime === null) o null
 *   onClockIn       - (activityCode) => Promise<{success, error}>
 *   onClockOut      - () => Promise<{success, error}>
 *   loading         - boolean, estado de carga
 *   error           - string | null, error externo
 *   lifecyclePhase  - string, fase actual del WO (APPROVED|INPRG|...)
 */
export default function LaborClockWidget({ activeSession, onClockIn, onClockOut, loading, error, lifecyclePhase }) {
  const [activityCode, setActivityCode] = useState('DIRECT_WORK');
  const [elapsed, setElapsed] = useState('');
  const [localError, setLocalError] = useState(null);
  const timerRef = useRef(null);

  // Timer: actualiza cada 1s mientras haya sesión activa
  useEffect(() => {
    if (activeSession?.startTime) {
      setElapsed(formatTimer(activeSession.startTime));
      timerRef.current = setInterval(() => {
        setElapsed(formatTimer(activeSession.startTime));
      }, 1000);
    } else {
      setElapsed('');
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    // El timer es un side effect legítimo para un reloj — no hay forma de derivarlo
  }, [activeSession?.startTime]);

  // Sincronizar error externo
  useEffect(() => {
    setLocalError(error);
  }, [error]);

  const handleClockIn = async () => {
    setLocalError(null);
    const result = await onClockIn(activityCode);
    if (result?.error) {
      setLocalError(result.error);
    }
  };

  const handleClockOut = async () => {
    setLocalError(null);
    const result = await onClockOut();
    if (result?.error) {
      setLocalError(result.error);
    }
  };

  // Early return DESPUÉS de todos los hooks
  if (!lifecyclePhase || !['APPROVED', 'INPRG'].includes(lifecyclePhase)) {
    return null;
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        p: 2,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        bgcolor: 'action.hover'
      }}
    >
      {/* ── Error ── */}
      {localError && (
        <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setLocalError(null)}>
          {localError}
        </Alert>
      )}

      {activeSession ? (
        /* ── Estado ACTIVE: timer + badge + botón Salir ── */
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Chip
              label={ACTIVITY_CODES.find(c => c.value === activeSession.activityCode)?.label || activeSession.activityCode}
              color={ACTIVITY_COLORS[activeSession.activityCode] || 'default'}
              size="small"
            />
            <Typography variant="h5" fontWeight="700" fontFamily="monospace">
              {elapsed}
            </Typography>
          </Box>
          <Button
            variant="contained"
            color="error"
            fullWidth
            size="large"
            startIcon={<StopIcon />}
            onClick={handleClockOut}
            disabled={loading}
            sx={{ textTransform: 'none', fontWeight: 700, py: 1.2 }}
          >
            Registrar Salida
          </Button>
        </Box>
      ) : (
        /* ── Estado IDLE: selector de actividad + botón Ingresar ── */
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <FormControl size="small" fullWidth>
            <InputLabel id="activity-code-label">Actividad</InputLabel>
            <Select
              labelId="activity-code-label"
              value={activityCode}
              label="Actividad"
              onChange={(e) => setActivityCode(e.target.value)}
            >
              {ACTIVITY_CODES.map(ac => (
                <MenuItem key={ac.value} value={ac.value}>
                  {ac.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button
            variant="contained"
            color="primary"
            fullWidth
            size="large"
            startIcon={<PlayArrowIcon />}
            onClick={handleClockIn}
            disabled={loading}
            sx={{ textTransform: 'none', fontWeight: 700, py: 1.2 }}
          >
            Registrar Ingreso
          </Button>
        </Box>
      )}
    </Box>
  );
}
