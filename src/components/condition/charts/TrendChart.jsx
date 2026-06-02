/**
 * TrendChart — Gráfico de tendencias de condición con bandas de baseline
 *
 * Renderiza un recharts ComposedChart con:
 * - HI line (azul) cuando featureKey es null
 * - Feature value scatter con color según quality_flag cuando featureKey está presente
 * - Banda ±1σ (amarillo) y ±2σ (rojo) desde baseline activo
 * - Línea de media de baseline (verde punteada)
 * - Marcadores de eventos (triángulos rojos)
 * - Selector de rango de fechas (7d / 30d / 90d)
 * - Tooltip personalizado con régimen y quality_flag
 * - Versión de baseline en leyenda
 *
 * Props:
 *  - assetId: ID del activo (obligatorio)
 *  - featureKey: Feature key (opcional, null = muestra HI)
 *  - methodKey: Method key (opcional)
 */

import { useState, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  ToggleButtonGroup,
  ToggleButton,
} from '@mui/material';
import {
  ComposedChart,
  Line,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Label,
} from 'recharts';
import useFeatureTrends from '../../../hooks/useFeatureTrends';

// ─── Constantes ─────────────────────────────────────────────────
const QUALITY_COLORS = {
  G0: '#4caf50',
  G1: '#ffeb3b',
  G2: '#ff9800',
  G3: '#f44336',
};

const DATE_RANGES = [
  { label: '7d', value: 7 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
];

// ─── Custom Tooltip ─────────────────────────────────────────────
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <Paper
      variant="outlined"
      sx={{ px: 1.5, py: 1, backgroundColor: 'background.paper', opacity: 0.95 }}
    >
      <Typography variant="caption" display="block" color="text.secondary">
        {new Date(label).toLocaleString('es-MX')}
      </Typography>
      {payload.map((entry, idx) => (
        <Box key={idx} sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
          <Box
            sx={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              backgroundColor: entry.color,
              flexShrink: 0,
            }}
          />
          <Typography variant="body2" fontWeight={600}>
            {entry.name}: {typeof entry.value === 'number' ? entry.value.toFixed(3) : entry.value}
          </Typography>
        </Box>
      ))}
      {/* Régimen desde el payload de feature */}
      {payload[0]?.payload?.regime && (
        <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.5 }}>
          Régimen: {payload[0].payload.regime}
        </Typography>
      )}
      {payload[0]?.payload?.quality_flag && (
        <Typography variant="caption" display="block" color="text.secondary">
          Quality: {payload[0].payload.quality_flag}
        </Typography>
      )}
      {payload[0]?.payload?.z_score !== undefined && (
        <Typography variant="caption" display="block" color="text.secondary">
          Z-score: {typeof payload[0].payload.z_score === 'number'
            ? payload[0].payload.z_score.toFixed(2)
            : payload[0].payload.z_score}
        </Typography>
      )}
    </Paper>
  );
}

// ─── Custom Dot para quality_flag ──────────────────────────────
function QualityDot(props) {
  const { cx, cy, payload } = props;
  if (!cx || !cy) return null;

  const color = QUALITY_COLORS[payload?.quality_flag] || '#9e9e9e';

  return (
    <circle cx={cx} cy={cy} r={4} fill={color} stroke="none" />
  );
}

// ─── Custom Shape para marcador de evento (triángulo rojo) ────
function EventTriangle({ cx, cy }) {
  if (!cx || !cy) return null;
  const size = 8;
  return (
    <polygon
      points={`${cx},${cy - size} ${cx - size},${cy + size} ${cx + size},${cy + size}`}
      fill="#f44336"
      stroke="#b71c1c"
      strokeWidth={1}
    />
  );
}

// ─── TrendChart ─────────────────────────────────────────────────
export default function TrendChart({ assetId, featureKey = null, methodKey = null }) {
  const [days, setDays] = useState(30);

  const { hiData, featureData, baseline, events, isLoading, error } = useFeatureTrends({
    assetId,
    featureKey,
    days,
  });

  const handleDaysChange = useCallback((_, value) => {
    if (value !== null) setDays(value);
  }, []);

  // ─── Preparar datos para el gráfico ──────────────────────────
  const isHIMode = featureKey === null;

  // Data para HI mode: health_index values
  const hiChartData = isHIMode
    ? hiData.map((r) => ({
        timestamp: new Date(r.window_end).getTime(),
        health_index: r.result_value,
        z_score: r.parameters?.z_score ?? r.z_score,
      }))
    : [];

  // Data para feature mode: feature values con quality_flag y regime
  const featureChartData = !isHIMode
    ? featureData.map((fv) => ({
        timestamp: new Date(fv.timestamp || fv.created_at || Date.now()).getTime(),
        value: fv.value,
        quality_flag: fv.quality_flag || 'G0',
        regime: fv.regime,
        feature_definition_id: fv.feature_definition_id,
      }))
    : [];

  // Event markers
  const eventMarkers = events.map((ev) => ({
    timestamp: new Date(ev.created_at || ev.detected_at || Date.now()).getTime(),
    severity: ev.severity || 'warning',
    message: ev.message || '',
  }));

  // Baseline bands
  const baselineMean = baseline?.mean ?? null;
  const baselineStd = baseline?.stddev ?? null;
  const baselineVersion = baseline?.baseline_version ?? null;

  // Dominio Y
  const allValues = [
    ...hiChartData.map((d) => d.health_index),
    ...featureChartData.map((d) => d.value),
  ];
  const dataMin = Math.min(...allValues, baselineMean - 2 * baselineStd || 0);
  const dataMax = Math.max(...allValues, baselineMean + 2 * baselineStd || 1);
  const yDomain = [
    Math.floor(Math.min(0, dataMin) * 100) / 100,
    Math.ceil(Math.max(1, dataMax) * 100) / 100,
  ];

  // ─── Render ──────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
        <Typography color="text.secondary">Cargando tendencias…</Typography>
      </Paper>
    );
  }

  if (error) {
    return (
      <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
        <Typography color="error">Error al cargar: {error}</Typography>
      </Paper>
    );
  }

  const hasData = isHIMode ? hiChartData.length > 0 : featureChartData.length > 0;
  const hasBaseline = baseline !== null;
  const noBaselineNote = !isHIMode && !hasBaseline && hasData;
  const noDataNote = !hasData;

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      {/* ── Header: selector de fechas ── */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={700}>
          {isHIMode ? 'Índice de Salud (HI)' : `Tendencia: ${featureKey}`}
        </Typography>
        <ToggleButtonGroup
          value={days}
          exclusive
          onChange={handleDaysChange}
          size="small"
          color="primary"
        >
          {DATE_RANGES.map((r) => (
            <ToggleButton key={r.value} value={r.value} sx={{ px: 2 }}>
              {r.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>

      {/* ── Estados vacíos ── */}
      {noDataNote && (
        <Box sx={{ py: 6, textAlign: 'center' }}>
          <Typography color="text.secondary">
            Sin datos de condición para este activo
          </Typography>
        </Box>
      )}

      {noBaselineNote && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          Sin línea base disponible
        </Typography>
      )}

      {/* ── Gráfico ── */}
      {hasData && (
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart
            margin={{ top: 10, right: 30, left: 10, bottom: 10 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
            <XAxis
              dataKey="timestamp"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(ts) => {
                const d = new Date(ts);
                return `${d.getDate()}/${d.getMonth() + 1}`;
              }}
              stroke="#9e9e9e"
              fontSize={12}
            />
            <YAxis
              type="number"
              domain={yDomain}
              stroke="#9e9e9e"
              fontSize={12}
              tickFormatter={(v) => v.toFixed(1)}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              verticalAlign="top"
              height={36}
              formatter={(value) => (
                <Typography variant="caption" component="span">
                  {value}
                </Typography>
              )}
            />

            {/* ── Baseline bands (solo feature mode) ── */}
            {!isHIMode && hasBaseline && baselineStd > 0 && (
              <>
                {/* ±2σ band (red semi-transparent) */}
                <ReferenceArea
                  y1={baselineMean - 2 * baselineStd}
                  y2={baselineMean + 2 * baselineStd}
                  fill="#f44336"
                  fillOpacity={0.08}
                  stroke="none"
                />
                {/* ±1σ band (yellow semi-transparent) */}
                <ReferenceArea
                  y1={baselineMean - baselineStd}
                  y2={baselineMean + baselineStd}
                  fill="#ff9800"
                  fillOpacity={0.1}
                  stroke="none"
                />
              </>
            )}

            {/* ── Threshold lines desde spec DEXP-003 ── */}
            {!isHIMode && hasBaseline && baselineStd > 0 && (
              <>
                {/* z=2 threshold (naranja punteada) */}
                <ReferenceLine
                  y={baselineMean + 2 * baselineStd}
                  stroke="#ff9800"
                  strokeDasharray="6 3"
                  strokeWidth={1.5}
                >
                  <Label value="+2σ" position="right" fontSize={11} fill="#ff9800" />
                </ReferenceLine>
                {/* z=3 threshold (roja punteada) */}
                <ReferenceLine
                  y={baselineMean + 3 * baselineStd}
                  stroke="#f44336"
                  strokeDasharray="6 3"
                  strokeWidth={1.5}
                >
                  <Label value="+3σ" position="right" fontSize={11} fill="#f44336" />
                </ReferenceLine>
              </>
            )}

            {/* ── Baseline mean line (verde punteada) ── */}
            {!isHIMode && hasBaseline && (
              <ReferenceLine
                y={baselineMean}
                stroke="#4caf50"
                strokeDasharray="4 4"
                strokeWidth={1.5}
              >
                <Label
                  value={`Media${baselineVersion ? ` (v${baselineVersion})` : ''}`}
                  position="right"
                  fontSize={11}
                  fill="#4caf50"
                />
              </ReferenceLine>
            )}

            {/* ── HI Line (azul, sólido) ── */}
            {isHIMode && (
              <Line
                data={hiChartData}
                type="monotone"
                dataKey="health_index"
                name="Health Index"
                stroke="#1976d2"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 5 }}
                connectNulls={false}
              />
            )}

            {/* ── Feature value line (scatter con quality dots) ── */}
            {!isHIMode && (
              <Line
                data={featureChartData}
                type="monotone"
                dataKey="value"
                name={featureKey}
                stroke="#9e9e9e"
                strokeWidth={1.5}
                dot={<QualityDot />}
                activeDot={{ r: 6 }}
                connectNulls={true}
              />
            )}

            {/* ── Event markers (triángulos rojos) ── */}
            {eventMarkers.length > 0 && (
              <Scatter
                data={eventMarkers}
                dataKey="severity"
                name="Eventos"
                shape={<EventTriangle />}
                fill="#f44336"
              />
            )}

          </ComposedChart>
        </ResponsiveContainer>
      )}
    </Paper>
  );
}
