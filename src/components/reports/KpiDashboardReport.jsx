/**
 * KpiDashboardReport.jsx
 * Metric cards (MTBF, MTTR, Availability) + BarChart (MTBF/MTTR by month) + LineChart (Availability trend).
 *
 * Props:
 *   current: { mtbfHours, mttrHours, availabilityPct, totalWos }
 *   monthly: [{ periodMonth, mtbfHours, mttrHours, availabilityPct, woCount }]
 *   loading, error, onRetry
 *
 * States: loading → error → insufficient-data → success
 */
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

function MetricCard({ title, value, unit, color }) {
  const displayValue = value != null ? value.toFixed(1) : '--';
  return (
    <Card variant="outlined" sx={{ borderTop: 3, borderColor: color || 'primary.main' }}>
      <CardContent>
        <Typography variant="caption" color="text.secondary" fontWeight="600">
          {title}
        </Typography>
        <Typography variant="h4" fontWeight="700" sx={{ my: 0.5 }}>
          {displayValue}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {unit}
        </Typography>
      </CardContent>
    </Card>
  );
}

export default function KpiDashboardReport({
  current,
  monthly,
  loading,
  error,
  onRetry,
}) {
  // ── Loading ──
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 6, gap: 2 }}>
        <CircularProgress />
        <Typography variant="body2" color="text.secondary">
          Cargando informe…
        </Typography>
      </Box>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        <Typography variant="body2">{error}</Typography>
        {onRetry && (
          <Button size="small" onClick={onRetry} sx={{ mt: 1 }}>
            Reintentar
          </Button>
        )}
      </Alert>
    );
  }

  const hasData = monthly && monthly.length > 0;

  // ── Insufficient data ──
  if (!hasData) {
    return (
      <Box sx={{ textAlign: 'center', py: 6 }}>
        <Typography variant="body1" color="text.secondary">
          Datos insuficientes para calcular KPI
        </Typography>
      </Box>
    );
  }

  // ── Success ──
  const { mtbfHours, mttrHours, availabilityPct } = current;

  return (
    <Box>
      {/* Metric Cards */}
      <Box data-widget-id="kpi-metric-cards" sx={{ mb: 4 }}>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 4 }}>
            <MetricCard
              title="MTBF"
              value={mtbfHours}
              unit="horas entre fallas"
              color="#1976d2"
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <MetricCard
              title="MTTR"
              value={mttrHours}
              unit="horas de reparación"
              color="#f57c00"
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <MetricCard
              title="Disponibilidad"
              value={availabilityPct}
              unit="%"
              color="#388e3c"
            />
          </Grid>
        </Grid>
      </Box>

      {/* BarChart: MTBF vs MTTR by month */}
      <Box data-widget-id="kpi-bar-chart" sx={{ mb: 4 }}>
        <Typography variant="subtitle2" fontWeight="600" sx={{ mb: 1 }}>
          MTBF / MTTR por mes
        </Typography>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={monthly}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="periodMonth" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="mtbfHours" fill="#1976d2" name="MTBF (horas)" />
            <Bar dataKey="mttrHours" fill="#f57c00" name="MTTR (horas)" />
          </BarChart>
        </ResponsiveContainer>
      </Box>

      {/* LineChart: Availability trend */}
      <Box data-widget-id="kpi-line-chart">
        <Typography variant="subtitle2" fontWeight="600" sx={{ mb: 1 }}>
          Tendencia de Disponibilidad
        </Typography>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={monthly}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="periodMonth" />
            <YAxis domain={[0, 100]} />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey="availabilityPct"
              stroke="#388e3c"
              name="Disponibilidad (%)"
              strokeWidth={2}
              dot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </Box>
    </Box>
  );
}
