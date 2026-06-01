/**
 * SodDefinitionTables — Tablas de referencia AIAG/VDA para S/O/D.
 *
 * Muestra en un Dialog la tabla completa de definiciones estándar
 * para Severidad, Ocurrencia o Detección según AIAG/VDA.
 * Resalta la fila del valor actualmente seleccionado.
 *
 * Props:
 *  - type          : 'severity' | 'occurrence' | 'detection'
 *  - open          : boolean — controla la visibilidad del Dialog
 *  - onClose       : () => void
 *  - selectedValue : number — valor actual (1-10) para resaltar
 */
import React from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import IconButton from '@mui/material/IconButton';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import CloseIcon from '@mui/icons-material/Close';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import {
  SEVERITY_STANDARD,
  OCCURRENCE_STANDARD,
  DETECTION_STANDARD,
  getSeverityColor,
} from './fmeaConstants';

/**
 * Mapas de tipo a datos y etiquetas.
 */
const TYPE_CONFIG = {
  severity: {
    title: 'Tabla de Severidad — AIAG/VDA',
    data: SEVERITY_STANDARD,
    colorFn: getSeverityColor,
  },
  occurrence: {
    title: 'Tabla de Ocurrencia — AIAG/VDA',
    data: OCCURRENCE_STANDARD,
    colorFn: () => null,
  },
  detection: {
    title: 'Tabla de Detección — AIAG/VDA',
    data: DETECTION_STANDARD,
    colorFn: () => null,
  },
};

/**
 * Dialog con la tabla de definiciones estándar AIAG/VDA.
 * Resalta la fila seleccionada y muestra un indicador visual.
 */
export const SodDefinitionTables = ({ type, open, onClose, selectedValue }) => {
  const config = TYPE_CONFIG[type];

  if (!config) {
    return null;
  }

  const { title, data, colorFn } = config;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: { borderRadius: 1 },
        },
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pr: 1,
          pl: 2,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <DialogTitle sx={{ p: 2, pl: 0, fontWeight: 700 }}>{title}</DialogTitle>
        <IconButton onClick={onClose} aria-label="Cerrar tabla">
          <CloseIcon />
        </IconButton>
      </Box>

      {/* Tabla de definiciones */}
      <DialogContent sx={{ p: 0 }}>
        <TableContainer component={Paper} variant="outlined" sx={{ m: 2, borderRadius: 1 }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.100' }}>
                <TableCell sx={{ fontWeight: 700, width: 70 }} align="center">
                  Valor
                </TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Clasificación</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Descripción</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.map((row) => {
                const isSelected = row.value === selectedValue;
                const rowColor = colorFn ? colorFn(row.value) : null;

                return (
                  <TableRow
                    key={row.value}
                    selected={isSelected}
                    sx={{
                      '&.Mui-selected': {
                        bgcolor: 'primary.50',
                        '&:hover': { bgcolor: 'primary.100' },
                      },
                      ...(isSelected && {
                        borderLeft: '4px solid',
                        borderColor: 'primary.main',
                      }),
                    }}
                  >
                    <TableCell align="center">
                      <Box
                        sx={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 36,
                          height: 36,
                          borderRadius: '50%',
                          bgcolor: rowColor || 'grey.200',
                          color: rowColor ? '#fff' : 'text.primary',
                          fontWeight: 800,
                          fontSize: '0.9rem',
                        }}
                      >
                        {row.value}
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" fontWeight={600}>
                          {row.label}
                        </Typography>
                        {isSelected && (
                          <CheckCircleIcon fontSize="small" color="primary" />
                        )}
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {row.description}
                      </Typography>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </DialogContent>
    </Dialog>
  );
};

export default SodDefinitionTables;
