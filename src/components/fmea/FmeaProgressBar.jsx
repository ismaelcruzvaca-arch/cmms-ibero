/**
 * FmeaProgressBar — Barra de progreso del análisis FMEA.
 *
 * Consulta getPendingAnalyses del hook y muestra el avance
 * de modos de falla evaluados vs total esperado.
 *
 * Props:
 *  - assetId       : string  — ID del activo
 *  - totalExpected : number  — (opcional) total esperado, si se conoce externamente
 *  - repo          : object  — objeto retornado por useFmeaRepository()
 */
import React, { useState, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';

/**
 * Determina el color de la barra según el porcentaje de avance.
 * Verde > 80%, Amarillo > 40%, Rojo <= 40%.
 */
function getProgressColor(percentage) {
  if (percentage >= 80) return 'success';
  if (percentage >= 40) return 'warning';
  return 'error';
}

/**
 * Barra de progreso del análisis FMEA.
 * Muestra "N de M modos evaluados (X%)" con color según avance.
 */
export const FmeaProgressBar = ({ assetId, totalExpected, repo }) => {
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Efecto para refrescar periódicamente (cada 10 s) o al montar
  useEffect(() => {
    if (!assetId || !repo?.getPendingAnalyses) {
      setLoading(false);
      setProgress(null);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        const result = await repo.getPendingAnalyses(assetId);
        if (!cancelled) {
          setProgress(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Error al cargar progreso');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();

    // Refresh cada 10 segundos para capturar cambios externos
    const interval = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [assetId, repo, refreshKey]);

  // Permite refresh manual
  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  // --- Estados de carga y error ---
  if (loading && !progress) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
        <CircularProgress size={20} />
        <Typography variant="body2" color="text.secondary">
          Cargando progreso FMEA...
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="warning" sx={{ mb: 1 }}>
        No se pudo cargar el progreso: {error}
      </Alert>
    );
  }

  // --- Sin análisis ---
  if (!progress || progress.total === 0) {
    return (
      <Box sx={{ py: 1 }}>
        <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
          Sin análisis FMEA — inicia uno nuevo
        </Typography>
      </Box>
    );
  }

  // --- Con datos ---
  const completed = progress.total - progress.pending;
  const expected = totalExpected || progress.expected || progress.total;
  const percentage = expected > 0 ? Math.round((completed / expected) * 100) : 0;
  const color = getProgressColor(percentage);

  return (
    <Box sx={{ py: 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
        <Typography variant="body2" fontWeight={600} color="text.primary">
          Análisis FMEA: {completed} de {expected} modos evaluados ({percentage}%)
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ cursor: 'pointer' }} onClick={handleRefresh}>
          ↻
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={Math.min(percentage, 100)}
        color={color}
        sx={{
          height: 8,
          borderRadius: 1,
          backgroundColor: 'grey.200',
        }}
      />
    </Box>
  );
};

export default FmeaProgressBar;
