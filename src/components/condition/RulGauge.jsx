/**
 * RulGauge — Indicador visual de Vida Útil Remanente (RUL)
 *
 * Muestra un gauge horizontal con 3 zonas de color:
 *  - Verde: RUL > 30 días (>720h)
 *  - Amarillo: RUL entre 7 y 30 días (168-720h)
 *  - Rojo: RUL < 7 días (<168h)
 *
 * Props:
 *  - assetId: ID del activo (usa useRul internamente)
 *
 * Muestra el texto del intervalo "XX–YY días" con la confianza.
 * Estado vacío: "Sin estimación RUL disponible" cuando no hay datos.
 */

import { Box, Paper, Typography, LinearProgress, Tooltip } from '@mui/material';
import useRul from '../../hooks/useRul';

// ─── Constantes ─────────────────────────────────────────────────
const ZONE_THRESHOLDS = {
  red: 7,       // < 7 días
  yellow: 30,   // 7–30 días
  // > 30 días → green
};

const ZONE_COLORS = {
  red: '#f44336',
  yellow: '#ff9800',
  green: '#4caf50',
};

// ─── Helpers ────────────────────────────────────────────────────

function getRulZone(days) {
  if (days == null) return null;
  if (days < ZONE_THRESHOLDS.red) return 'red';
  if (days < ZONE_THRESHOLDS.yellow) return 'yellow';
  return 'green';
}

function getZoneColor(days) {
  const zone = getRulZone(days);
  return zone ? ZONE_COLORS[zone] : '#bdbdbd';
}

function getZoneLabel(days) {
  const zone = getRulZone(days);
  switch (zone) {
    case 'red':
      return 'Crítico — intervención inmediata requerida';
    case 'yellow':
      return 'Precaución — programar intervención';
    case 'green':
      return 'Normal — dentro de parámetros';
    default:
      return '';
  }
}

// ─── Componente ─────────────────────────────────────────────────

export default function RulGauge({ assetId }) {
  const { rulData, isLoading, error } = useRul({ assetId });

  // ─── Estados ──────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
          Vida Útil Remanente (RUL)
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Cargando estimación…
        </Typography>
      </Paper>
    );
  }

  if (error) {
    return (
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography variant="subtitle2" gutterBottom>
          Vida Útil Remanente (RUL)
        </Typography>
        <Typography variant="body2" color="error">
          Error: {error}
        </Typography>
      </Paper>
    );
  }

  if (!assetId || !rulData) {
    return (
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
          Vida Útil Remanente (RUL)
        </Typography>
        <Typography variant="body2" color="text.disabled">
          Sin estimación RUL disponible
        </Typography>
      </Paper>
    );
  }

  const { rulDays, confidence, rulLow, rulHigh, failureModeKey } = rulData;
  const zone = getRulZone(rulDays);
  const zoneColor = ZONE_COLORS[zone];
  const zoneLabel = getZoneLabel(rulDays);

  // Escalar RUL para la barra: 60 días = 100% (máximo visible)
  const maxVisible = 60;
  const barPercent = Math.min((rulDays / maxVisible) * 100, 100);

  // Texto del intervalo
  const intervalText =
    rulLow != null && rulHigh != null
      ? `${Math.round(rulLow)}–${Math.round(rulHigh)} días`
      : `${Math.round(rulDays)} días`;

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
        <Typography variant="subtitle2" fontWeight={700}>
          Vida Útil Remanente (RUL)
        </Typography>
        {failureModeKey && (
          <Typography variant="caption" color="text.secondary">
            {failureModeKey}
          </Typography>
        )}
      </Box>

      {/* ── Zonas de color (fondo) ── */}
      <Box
        sx={{
          position: 'relative',
          height: 16,
          borderRadius: 2,
          background: `linear-gradient(to right,
            ${ZONE_COLORS.red} 0%,
            ${ZONE_COLORS.red} ${(ZONE_THRESHOLDS.red / maxVisible) * 100}%,
            ${ZONE_COLORS.yellow} ${(ZONE_THRESHOLDS.red / maxVisible) * 100}%,
            ${ZONE_COLORS.yellow} ${(ZONE_THRESHOLDS.yellow / maxVisible) * 100}%,
            ${ZONE_COLORS.green} ${(ZONE_THRESHOLDS.yellow / maxVisible) * 100}%,
            ${ZONE_COLORS.green} 100%)`,
          opacity: 0.25,
          mb: 0.5,
        }}
      />

      {/* ── Barra de progreso (posición actual) ── */}
      <Tooltip title={zoneLabel} arrow placement="top">
        <Box sx={{ position: 'relative', height: 8, mb: 1.5 }}>
          <LinearProgress
            variant="determinate"
            value={100 - barPercent} // Invertido: menos RUL → más lleno
            sx={{
              height: 8,
              borderRadius: 2,
              bgcolor: 'transparent',
              '& .MuiLinearProgress-bar': {
                bgcolor: zoneColor,
                borderRadius: 2,
              },
            }}
          />
          {/* Marcador de posición */}
          <Box
            sx={{
              position: 'absolute',
              top: -4,
              left: `${100 - barPercent}%`,
              width: 16,
              height: 16,
              borderRadius: '50%',
              bgcolor: zoneColor,
              border: '2px solid white',
              boxShadow: 1,
              transform: 'translateX(-50%)',
            }}
          />
        </Box>
      </Tooltip>

      {/* ── Leyenda de zonas ── */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1.5 }}>
        <Typography variant="caption" color={ZONE_COLORS.red} fontWeight={600}>
          &lt;{ZONE_THRESHOLDS.red}d
        </Typography>
        <Typography variant="caption" color={ZONE_COLORS.yellow} fontWeight={600}>
          {ZONE_THRESHOLDS.red}–{ZONE_THRESHOLDS.yellow}d
        </Typography>
        <Typography variant="caption" color={ZONE_COLORS.green} fontWeight={600}>
          &gt;{ZONE_THRESHOLDS.yellow}d
        </Typography>
      </Box>

      {/* ── Valores ── */}
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
        <Typography variant="h5" fontWeight={700} sx={{ color: zoneColor }}>
          {intervalText}
        </Typography>
        {confidence != null && (
          <Typography variant="body2" color="text.secondary">
            Confianza: {(confidence * 100).toFixed(0)}%
          </Typography>
        )}
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
        {zoneLabel}
      </Typography>
    </Paper>
  );
}
