/**
 * FmeaWizard — Contenedor maestro del asistente de análisis FMEA guiado.
 *
 * Orquesta la selección de nivel (Rápido / Experto / Ingeniería),
 * la barra de progreso y el componente de nivel activo.
 * Preserva el estado del formulario al cambiar entre niveles.
 *
 * Props:
 *  - assetId      : string — ID del activo a analizar
 *  - onComplete   : () => void — callback al completar un análisis
 *  - initialLevel : 'quick' | 'expert' | 'engineering' (default: 'quick')
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Collapse from '@mui/material/Collapse';
import Paper from '@mui/material/Paper';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ChevronDownIcon from '@mui/icons-material/ChevronDown';
import ScienceIcon from '@mui/icons-material/Science';
import { useFmeaRepository } from '../../hooks/useFmeaRepository';
import { FmeaLevelSelector } from './FmeaLevelSelector';
import { FmeaProgressBar } from './FmeaProgressBar';
import { LevelQuick } from './LevelQuick';
import { LevelExpert } from './LevelExpert';
import { LevelEngineering } from './LevelEngineering';
import { WIZARD_LEVELS } from './fmeaConstants';

/**
 * Estado inicial del formulario compartido entre niveles.
 */
const INITIAL_FORM_STATE = {
  componentId: '',
  componentTypeId: '',
  failureModeId: '',
  severity: 5,
  occurrence: 3,
  detection: 4,
  q1: null,
  q2: null,
  q3: null,
  q4: null,
  q5: null,
  notes: '',
  failureCauses: [],
  mitigation_actions: '',
  recommended_frequency: '',
};

/**
 * Contenedor maestro del asistente FMEA.
 * Renderiza la barra de progreso, el selector de nivel y el nivel activo.
 */
export const FmeaWizard = ({ assetId, onComplete, initialLevel = 'quick' }) => {
  // ─── Estado ───
  const [expanded, setExpanded] = useState(true);
  const [currentLevel, setCurrentLevel] = useState(initialLevel);
  const [formData, setFormData] = useState({ ...INITIAL_FORM_STATE });
  const [completedCount, setCompletedCount] = useState(0);

  // Inicializar repositorio FMEA
  const repo = useFmeaRepository();

  // Estados del repositorio
  const { loading, error, createAnalysis } = repo;

  // Reset form cuando se pide explícitamente
  const handleResetRef = useRef(false);
  useEffect(() => {
    if (handleResetRef.current) {
      setFormData({ ...INITIAL_FORM_STATE });
      handleResetRef.current = false;
    }
  }, [formData]);

  // Limpiar componentTypeId cada vez que se cambia el nivel (para evitar
  // que un nivel anterior deje datos incompatibles)
  const handleLevelChange = useCallback((newLevel) => {
    setCurrentLevel(newLevel);
    // No reseteamos formData — preservamos estado entre niveles
  }, []);

  // Cambiar un campo del formulario
  const handleFormChange = useCallback((key, value) => {
    if (key === 'reset') {
      setFormData({ ...INITIAL_FORM_STATE });
      return;
    }
    setFormData((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Guardar análisis
  const handleSave = useCallback(async (data) => {
    const result = await createAnalysis(data);
    if (result?.success) {
      setCompletedCount((c) => c + 1);
      if (onComplete) onComplete();
    }
    return result;
  }, [createAnalysis, onComplete]);

  // ─── Render del nivel activo ───
  const renderActiveLevel = () => {
    if (loading) {
      return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 4, justifyContent: 'center' }}>
          <CircularProgress size={24} />
          <Typography variant="body2" color="text.secondary">
            Inicializando repositorio FMEA...
          </Typography>
        </Box>
      );
    }

    if (error) {
      return (
        <Alert severity="error" sx={{ mt: 2 }}>
          Error al inicializar FMEA: {error}
        </Alert>
      );
    }

    if (!assetId) {
      return (
        <Alert severity="info" sx={{ mt: 2 }}>
          Seleccioná un activo para iniciar el análisis FMEA.
        </Alert>
      );
    }

    const levelProps = {
      assetId,
      repo,
      formData,
      onChange: handleFormChange,
      onSave: handleSave,
    };

    switch (currentLevel) {
      case 'quick':
        return <LevelQuick {...levelProps} />;
      case 'expert':
        return <LevelExpert {...levelProps} />;
      case 'engineering':
        return <LevelEngineering {...levelProps} />;
      default:
        return <LevelQuick {...levelProps} />;
    }
  };

  // ─── Header con toggle ───
  const currentLevelInfo = Object.values(WIZARD_LEVELS).find((l) => l.id === currentLevel);
  const toggleLabel = expanded
    ? 'Colapsar asistente FMEA'
    : 'Expandir asistente FMEA';

  return (
    <Paper variant="outlined" sx={{ mb: 2 }}>
      {/* Header expandible */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 2,
          py: 1.5,
          cursor: 'pointer',
          '&:hover': { bgcolor: 'action.hover' },
        }}
        onClick={() => setExpanded((prev) => !prev)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded((prev) => !prev);
          }
        }}
        aria-label={toggleLabel}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ScienceIcon color="primary" />
          <Typography variant="subtitle1" fontWeight={700} color="text.primary">
            Análisis FMEA
          </Typography>
          {currentLevelInfo && (
            <Typography variant="body2" color="text.secondary" sx={{ ml: 0.5 }}>
              — {currentLevelInfo.label}
            </Typography>
          )}
        </Box>
        <IconButton size="small" edge="end" aria-label={toggleLabel}>
          {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
        </IconButton>
      </Box>

      {/* Barra de progreso — visible siempre */}
      <Box sx={{ px: 2, pb: expanded ? 0 : 2 }}>
        <FmeaProgressBar assetId={assetId} repo={repo} />
      </Box>

      {/* Contenido expandible */}
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <Divider />
        <Box sx={{ px: 2, py: 2 }}>
          {/* Selector de nivel */}
          <FmeaLevelSelector
            value={currentLevel}
            onChange={handleLevelChange}
            disabled={loading}
          />

          <Divider sx={{ my: 2 }} />

          {/* Nivel activo */}
          {renderActiveLevel()}
        </Box>
      </Collapse>
    </Paper>
  );
};

export default FmeaWizard;
