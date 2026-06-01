/**
 * FmeaLevelSelector — Selector de nivel del wizard FMEA.
 *
 * Muestra los 3 niveles (Rápido / Experto / Ingeniería) como tarjetas
 * seleccionables tipo ToggleButtonGroup. Cada tarjeta incluye el nombre,
 * descripción y tiempo estimado del nivel.
 *
 * Props:
 *  - value    : string  — nivel seleccionado ('quick' | 'expert' | 'engineering')
 *  - onChange : (value: string) => void
 *  - disabled : boolean — deshabilita la selección
 */
import React from 'react';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import { WIZARD_LEVELS } from './fmeaConstants';

/**
 * Tarjeta individual para cada nivel del wizard.
 * Renderiza título, descripción y badge de tiempo estimado.
 */
const LevelCard = ({ levelKey, level, selected, onChange, disabled }) => {
  const isSelected = selected === levelKey;

  return (
    <ToggleButton
      value={levelKey}
      disabled={disabled}
      selected={isSelected}
      onChange={() => onChange(levelKey)}
      sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 0.5,
        p: 2,
        minHeight: 100,
        textTransform: 'none',
        border: isSelected ? '2px solid' : '1px solid',
        borderColor: isSelected ? 'primary.main' : 'divider',
        backgroundColor: isSelected ? 'action.selected' : 'background.paper',
        borderRadius: 1,
        '&:hover': {
          backgroundColor: isSelected ? 'action.selected' : 'action.hover',
        },
        '&.Mui-selected': {
          backgroundColor: 'action.selected',
          color: 'text.primary',
        },
      }}
    >
      <Typography variant="subtitle1" fontWeight={700} color={isSelected ? 'primary.main' : 'text.primary'}>
        {level.label}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'left', lineHeight: 1.3 }}>
        {level.description}
      </Typography>
      <Chip
        label={`~${level.minMinutes} min`}
        size="small"
        variant="outlined"
        color={isSelected ? 'primary' : 'default'}
        sx={{ mt: 0.5, fontWeight: 500 }}
      />
    </ToggleButton>
  );
};

/**
 * Selector principal de nivel FMEA.
 * Renderiza un ToggleButtonGroup horizontal con los 3 niveles.
 */
export const FmeaLevelSelector = ({ value, onChange, disabled = false }) => {
  const handleChange = (_event, newValue) => {
    // Evita deseleccionar (siempre debe haber un nivel activo)
    if (newValue !== null) {
      onChange(newValue);
    }
  };

  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1, fontWeight: 600 }}>
        Nivel de análisis
      </Typography>
      <ToggleButtonGroup
        value={value}
        exclusive
        onChange={handleChange}
        sx={{
          display: 'flex',
          gap: 1,
          '& .MuiToggleButtonGroup-grouped': {
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: '4px !important',
            '&:not(:first-of-type)': {
              borderRadius: '4px !important',
              ml: 0,
            },
          },
        }}
      >
        {Object.entries(WIZARD_LEVELS).map(([key, level]) => (
          <LevelCard
            key={key}
            levelKey={level.id}
            level={level}
            selected={value}
            onChange={handleChange}
            disabled={disabled}
          />
        ))}
      </ToggleButtonGroup>
    </Box>
  );
};

export default FmeaLevelSelector;
