/**
 * SourceManagementPanel.jsx — Panel de Gestión de Fuentes de Condición
 *
 * Tabla con listado de condition_sources registradas.
 * Muestra status badges, last_seen, capabilities y metadatos.
 * Read-only en este slice — la gestión (activar/desactivar) viene en SDD 5.
 *
 * Visible para cualquier usuario autenticado.
 */
import { useState, useEffect, useRef } from 'react';
import {
  Box, Paper, Typography, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Chip, CircularProgress,
  Alert, Collapse, IconButton, Tooltip, Popover,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import RefreshIcon from '@mui/icons-material/Refresh';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useConditionSources, SOURCE_STATUS_COLORS } from '../../hooks/useConditionSources';
import { supabase } from '../../lib/supabaseClient';

const QUALITY_COLORS = {
  G0: { bg: '#4caf50', label: 'Excelente' },
  G1: { bg: '#8bc34a', label: 'Buena' },
  G2: { bg: '#ff9800', label: 'Regular' },
  G3: { bg: '#f44336', label: 'Mala' },
};

function getDominantGrade(stats) {
  if (!stats) return 'G0';
  const grades = [
    { key: 'G0', pct: stats.g0_pct ?? 0 },
    { key: 'G1', pct: stats.g1_pct ?? 0 },
    { key: 'G2', pct: stats.g2_pct ?? 0 },
    { key: 'G3', pct: stats.g3_pct ?? 0 },
  ];
  return grades.reduce((a, b) => (a.pct >= b.pct ? a : b)).key;
}

function isStale(lastSeenAt) {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() > 24 * 60 * 60 * 1000;
}

export default function SourceManagementPanel({ onNavigate }) {
  const { sources, loading, error, refresh } = useConditionSources();
  const [expandedSource, setExpandedSource] = useState(null);
  const [qualityData, setQualityData] = useState({});
  const [deadLetterCounts, setDeadLetterCounts] = useState({});
  const [qualityAnchorEl, setQualityAnchorEl] = useState(null);
  const [selectedSourceId, setSelectedSourceId] = useState(null);
  const qualityCacheRef = useRef({});
  const qualityLoadedRef = useRef(false);

  useEffect(() => {
    if (qualityLoadedRef.current) return;
    qualityLoadedRef.current = true;
    supabase.rpc('compute_source_quality_stats').then(({ data, error }) => {
      if (!error && data) {
        const map = {};
        data.forEach((item) => { map[item.source_id] = item; });
        setQualityData(map);
        qualityCacheRef.current = map;
      }
    }).catch((err) => console.warn('[SourceManagementPanel] Error loading quality:', err));
  }, []);

  useEffect(() => {
    if (sources.length === 0) return;
    supabase.from('condition_ingest_failures').select('source_id').then(({ data, error }) => {
      if (!error && data) {
        const map = {};
        data.forEach((item) => { map[item.source_id] = (map[item.source_id] || 0) + 1; });
        setDeadLetterCounts(map);
      }
    }).catch((err) => console.warn('[SourceManagementPanel] Error loading dead letters:', err));
  }, [sources]);

  async function fetchSourceQuality(sourceId) {
    if (qualityCacheRef.current[sourceId]) return qualityCacheRef.current[sourceId];
    try {
      const { data, error } = await supabase.rpc('compute_source_quality_stats', { p_source_id: sourceId });
      if (error) throw error;
      const result = data?.[0] || null;
      qualityCacheRef.current[sourceId] = result;
      setQualityData((prev) => ({ ...prev, [sourceId]: result }));
      return result;
    } catch (err) {
      console.warn('[SourceManagementPanel] Error fetching quality:', err);
      return null;
    }
  }

  const handleQualityClick = (event, sourceId) => {
    setQualityAnchorEl(event.currentTarget);
    setSelectedSourceId(sourceId);
    fetchSourceQuality(sourceId);
  };

  const handleQualityClose = () => {
    setQualityAnchorEl(null);
    setSelectedSourceId(null);
  };

  const qualityOpen = Boolean(qualityAnchorEl);
  const selectedQuality = selectedSourceId ? qualityData[selectedSourceId] : null;

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
              <TableCell><strong>Calidad</strong></TableCell>
              <TableCell><strong>Última actividad</strong></TableCell>
              <TableCell><strong>Capabilities</strong></TableCell>
              <TableCell><strong>Cutoff</strong></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sources.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
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
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      {qualityData[source.source_id] ? (
                        <Chip
                          label={getDominantGrade(qualityData[source.source_id])}
                          size="small"
                          sx={{
                            bgcolor: QUALITY_COLORS[getDominantGrade(qualityData[source.source_id])]?.bg,
                            color: '#fff',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                          onClick={(e) => handleQualityClick(e, source.source_id)}
                        />
                      ) : (
                        <Typography variant="caption" color="text.disabled">—</Typography>
                      )}
                      {isStale(source.last_seen_at) && (
                        <Tooltip title="Sin datos &gt;24h">
                          <WarningAmberIcon fontSize="small" color="warning" />
                        </Tooltip>
                      )}
                      {(deadLetterCounts[source.source_id] || 0) > 0 && (
                        <Tooltip title={`${deadLetterCounts[source.source_id]} dead letters`}>
                          <Chip
                            label={deadLetterCounts[source.source_id]}
                            size="small"
                            color="error"
                            variant="filled"
                            sx={{ fontWeight: 700, cursor: 'pointer' }}
                            onClick={() => onNavigate?.('dead-letter')}
                          />
                        </Tooltip>
                      )}
                    </Box>
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

      {/* ── Quality Stats Popover ── */}
      <Popover
        open={qualityOpen}
        anchorEl={qualityAnchorEl}
        onClose={handleQualityClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Box sx={{ p: 2, minWidth: 200 }}>
          {selectedQuality ? (
            <>
              <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                {selectedQuality.source_name || selectedSourceId}
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 1 }}>
                {['G0', 'G1', 'G2', 'G3'].map((g) => (
                  <Box key={g} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: QUALITY_COLORS[g]?.bg }} />
                    <Typography variant="caption">
                      {g}: {selectedQuality[`${g.toLowerCase()}_pct`]?.toFixed(1) ?? 0}%
                    </Typography>
                  </Box>
                ))}
                <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
                  <Typography variant="caption" display="block">
                    Total valores: {selectedQuality.total_values ?? '—'}
                  </Typography>
                  <Typography variant="caption" display="block">
                    Últimos datos: {selectedQuality.last_data_at
                      ? new Date(selectedQuality.last_data_at).toLocaleDateString('es-MX', {
                          day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
                        })
                      : '—'}
                  </Typography>
                </Box>
              </Box>
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">Cargando…</Typography>
          )}
        </Box>
      </Popover>

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
