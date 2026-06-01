/**
 * RcmQuestions — Panel de preguntas RCM (Reliability-Centered Maintenance).
 *
 * Muestra las 5 preguntas binarias del árbol de decisión RCM con
 * botones de Sí/No, la estrategia calculada al fondo y un badge
 * con el RPN si se proporciona.
 *
 * Props:
 *  - values   : { q1?: boolean, q2?: boolean, q3?: boolean, q4?: boolean, q5?: boolean }
 *  - onChange : (qId: string, value: boolean) => void
 *  - readOnly : boolean — modo solo lectura (oculta los toggles, muestra badges)
 *  - compact  : boolean — modo compacto (usa shortLabel en lugar de label)
 *  - level    : 'quick' | 'expert' | 'engineering' — selecciona el wording de preguntas (default: 'expert')
 *  - rpn      : number|null — RPN calculado para mostrar (opcional)
 */
import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import {
  RCM_QUESTIONS_QUICK,
  RCM_QUESTIONS_EXPERT,
  RCM_STRATEGIES,
  fn_determine_rcm_strategy,
  formatRPN,
} from './fmeaConstants';

/**
 * Fila individual de pregunta RCM.
 * En modo edición muestra botones Sí/No. En readOnly muestra un badge.
 */
const QuestionRow = ({ question, value, onChange, readOnly, compact }) => {
  const label = compact ? question.shortLabel : question.label;

  // En modo readOnly: mostrar badge del valor seleccionado
  if (readOnly) {
    if (value === null || value === undefined) {
      return (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            py: 0.75,
            px: 1,
            borderRadius: 1,
            bgcolor: 'grey.50',
          }}
        >
          <Typography variant="body2" color="text.secondary">
            {label}
          </Typography>
          <Chip label="—" size="small" variant="outlined" sx={{ minWidth: 48 }} />
        </Box>
      );
    }

    const chipColor = value ? 'success' : 'error';
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          py: 0.75,
          px: 1,
          borderRadius: 1,
          bgcolor: 'grey.50',
        }}
      >
        <Typography variant="body2">{label}</Typography>
        <Chip
          label={value ? 'Sí' : 'No'}
          size="small"
          color={chipColor}
          variant={value ? 'filled' : 'outlined'}
          sx={{ minWidth: 48, fontWeight: 600 }}
        />
      </Box>
    );
  }

  // En modo edición: toggle Sí/No
  const currentValue = value === true ? 'si' : value === false ? 'no' : null;

  const handleChange = (_event, newValue) => {
    // No permitir deseleccionar — forzar elección
    if (newValue !== null) {
      onChange(question.id, newValue === 'si');
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        py: 0.75,
        px: 1,
        borderRadius: 1,
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Typography
        variant="body2"
        fontWeight={500}
        sx={{ flex: 1, mr: 2 }}
      >
        {label}
      </Typography>
      <ToggleButtonGroup
        value={currentValue}
        exclusive
        onChange={handleChange}
        size="small"
        sx={{
          '& .MuiToggleButton-root': {
            px: 2,
            minWidth: 48,
            fontWeight: 600,
            textTransform: 'none',
          },
        }}
      >
        <ToggleButton
          value="si"
          sx={{
            '&.Mui-selected': {
              bgcolor: 'success.main',
              color: 'white',
              '&:hover': { bgcolor: 'success.dark' },
            },
          }}
        >
          Sí
        </ToggleButton>
        <ToggleButton
          value="no"
          sx={{
            '&.Mui-selected': {
              bgcolor: 'error.main',
              color: 'white',
              '&:hover': { bgcolor: 'error.dark' },
            },
          }}
        >
          No
        </ToggleButton>
      </ToggleButtonGroup>
    </Box>
  );
};

/**
 * Panel completo de preguntas RCM.
 * Incluye las 5 preguntas, la estrategia calculada y RPN (opcional).
 */
export const RcmQuestions = ({ values = {}, onChange, readOnly = false, compact = false, level = 'expert', rpn = null }) => {
  // Seleccionar preguntas según nivel
  const questions = level === 'quick' ? RCM_QUESTIONS_QUICK : RCM_QUESTIONS_EXPERT;

  // Determinar estrategia RCM basada en respuestas
  const strategy = fn_determine_rcm_strategy(values);
  const strategyInfo = RCM_STRATEGIES[strategy];

  // Verificar si hay respuestas suficientes para mostrar estrategia
  const hasAnswers = Object.values(values).some((v) => v !== null && v !== undefined);

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2" fontWeight={700} color="text.primary" sx={{ mb: 1 }}>
        Árbol de decisión RCM
      </Typography>

      <Stack spacing={0.5} divider={<Divider flexItem />}>
        {questions.map((q) => (
          <QuestionRow
            key={q.id}
            question={q}
            value={values[q.id]}
            onChange={onChange}
            readOnly={readOnly}
            compact={compact}
          />
        ))}
      </Stack>

      {/* Resultados: Estrategia RCM + RPN */}
      {hasAnswers && (
        <Box
          sx={{
            mt: 2,
            p: 1.5,
            borderRadius: 1,
            bgcolor: 'grey.50',
            border: '1px solid',
            borderColor: 'divider',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 1,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2" color="text.secondary" fontWeight={600}>
              Estrategia RCM:
            </Typography>
            <Tooltip title={strategyInfo?.description || ''}>
              <Chip
                label={strategyInfo?.label || strategy}
                size="small"
                sx={{
                  backgroundColor: strategyInfo?.color || '#9e9e9e',
                  color: '#fff',
                  fontWeight: 700,
                }}
              />
            </Tooltip>
          </Box>

          {rpn !== null && rpn !== undefined && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" color="text.secondary" fontWeight={600}>
                RPN:
              </Typography>
              <Chip
                label={formatRPN(rpn)}
                size="small"
                variant="outlined"
                color={rpn >= 200 ? 'error' : rpn >= 100 ? 'warning' : 'success'}
                sx={{ fontWeight: 700 }}
              />
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};

export default RcmQuestions;
