/**
 * SourceManagementPanel.jsx — Panel de Gestión de Fuentes de Condición
 *
 * Tabla con listado de condition_sources registradas.
 * Muestra status badges, last_seen, capabilities y metadatos.
 * Read-only en este slice — la gestión (activar/desactivar) viene en SDD 5.
 *
 * Visible para cualquier usuario autenticado.
 */
import { useState } from 'react';
import {
  Box, Paper, Typography, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Chip, CircularProgress,
  Alert, Collapse, IconButton, Tooltip,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useConditionSources, SOURCE_STATUS_COLORS } from '../../hooks/useConditionSources';

export default function SourceManagementPanel() {
  const { sources, loading, error, refresh } = useConditionSources();
  const [expandedSource, setExpandedSource] = useState(null);

  const toggleExpand = (sourceId) => {
    setExpandedSource((prev) => (prev === sourceId ? null : sourceId));
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Alert severity="error" action={
          <IconButton color="inherit" size="small" onClick={refresh}>
            <RefreshIcon />
          </IconButton>
        }>
          Error al cargar fuentes: {error}
        </Alert>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
      {/* ── Header ── */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box>
          <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>
            Fuentes de Condición
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {sources.length} fuentes registradas en el sistema de monitoreo
          </Typography>
        </Box>
        <Tooltip title="Actualizar">
          <IconButton onClick={refresh} size="small">
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {/* ── Tabla ── */}
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell><strong>Fuente</strong></TableCell>
              <TableCell><strong>Tipo</strong></TableCell>
              <TableCell><strong>Estado</strong></TableCell>
              <TableCell><strong>Última actividad</strong></TableCell>
              <TableCell><strong>Capabilities</strong></TableCell>
              <TableCell><strong>Cutoff</strong></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sources.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                    No hay fuentes registradas
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              sources.map((source) => (
                <TableRow key={source.id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {source.name || source.source_id}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {source.source_id}
                    </Typography>
                  </TableCell>

                  <TableCell>
                    <Typography variant="body2">
                      {source.source_type}
                    </Typography>
                  </TableCell>

                  <TableCell>
                    <Chip
                      label={source.statusColor.label}
                      size="small"
                      sx={{
                        bgcolor: source.statusColor.bg,
                        color: source.statusColor.color,
                        fontWeight: 600,
                      }}
                    />
                  </TableCell>

                  <TableCell>
                    <Typography
                      variant="body2"
                      color={source.last_seen_at ? 'text.primary' : 'text.disabled'}
                    >
                      {source.lastSeenLabel}
                    </Typography>
                  </TableCell>

                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Typography variant="body2">
                        {source.capabilityCount}
                      </Typography>
                      {source.capabilityCount > 0 && (
                        <IconButton
                          size="small"
                          onClick={() => toggleExpand(source.source_id)}
                        >
                          {expandedSource === source.source_id ? (
                            <ExpandLessIcon fontSize="small" />
                          ) : (
                            <ExpandMoreIcon fontSize="small" />
                          )}
                        </IconButton>
                      )}
                    </Box>

                    {/* Capabilities expandible */}
                    <Collapse in={expandedSource === source.source_id}>
                      <Box sx={{ pl: 2, pt: 1 }}>
                        {source.capabilitiesList.map((cap) => (
                          <Box key={cap.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                            <Typography variant="caption" fontWeight={600}>
                              {cap.can_produce}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              método: {cap.method_key}
                            </Typography>
                            {cap.quality_expected && (
                              <Chip
                                label={cap.quality_expected}
                                size="small"
                                variant="outlined"
                                sx={{ fontSize: '0.65rem', height: 18 }}
                              />
                            )}
                            {cap.validation_status && (
                              <Chip
                                label={cap.validation_status}
                                size="small"
                                variant="outlined"
                                sx={{ fontSize: '0.65rem', height: 18 }}
                              />
                            )}
                          </Box>
                        ))}
                      </Box>
                    </Collapse>
                  </TableCell>

                  <TableCell>
                    <Typography variant="body2">
                      {source.late_event_cutoff_hours} h
                    </Typography>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* ── Leyenda ── */}
      <Box sx={{ mt: 3, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
          Leyenda de estados:
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {Object.entries(SOURCE_STATUS_COLORS).map(([key, val]) => (
            <Chip
              key={key}
              label={val.label}
              size="small"
              sx={{ bgcolor: val.bg, color: val.color, fontWeight: 500 }}
            />
          ))}
        </Box>
      </Box>
    </Paper>
  );
}
