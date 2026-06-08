/**
 * LaborHoursReport.jsx
 * BarChart (hours per technician) + grouped MUI Table (technician × activity_code).
 *
 * Props:
 *   records: [{ technicianId, technicianName, activityBreakdown, totalHours }]
 *   grandTotal, loading, error, onRetry
 *
 * States: loading → error → empty → success
 */
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Chip from '@mui/material/Chip';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

export default function LaborHoursReport({
  records,
  grandTotal,
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

  // ── Empty ──
  if (!records || records.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 6 }}>
        <Typography variant="body1" color="text.secondary">
          No hay registros de labor en el período seleccionado
        </Typography>
      </Box>
    );
  }

  // ── Success ──
  const chartData = records.map((r) => ({
    name: r.technicianName,
    Horas: r.totalHours,
  }));

  // Collect all unique activity codes across all records
  const allActivityCodes = Array.from(
    new Set(records.flatMap((r) => Object.keys(r.activityBreakdown)))
  ).sort();

  return (
    <Box>
      {/* Summary */}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Total de horas: <strong>{grandTotal}</strong>
      </Typography>

      {/* Bar Chart — hours per technician */}
      <Box data-widget-id="labor-hours-chart" sx={{ mb: 4 }}>
        <Typography variant="subtitle2" fontWeight="600" sx={{ mb: 1 }}>
          Horas por técnico
        </Typography>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="Horas" fill="#1976d2" />
          </BarChart>
        </ResponsiveContainer>
      </Box>

      {/* Grouped Table — technician × activity_code */}
      <Box data-widget-id="labor-hours-table">
        <Typography variant="subtitle2" fontWeight="600" sx={{ mb: 1 }}>
          Desglose por técnico y actividad
        </Typography>
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell><strong>Técnico</strong></TableCell>
                {allActivityCodes.map((code) => (
                  <TableCell key={code} align="right">
                    <strong>{code}</strong>
                  </TableCell>
                ))}
                <TableCell align="right"><strong>Total</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {records.map((record) => (
                <TableRow key={record.technicianId} hover>
                  <TableCell>
                    <Chip
                      label={record.technicianName}
                      size="small"
                      variant="outlined"
                    />
                  </TableCell>
                  {allActivityCodes.map((code) => (
                    <TableCell key={code} align="right">
                      {record.activityBreakdown[code] || '—'}
                    </TableCell>
                  ))}
                  <TableCell align="right">
                    <strong>{record.totalHours}</strong>
                  </TableCell>
                </TableRow>
              ))}
              {/* Totals row */}
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <TableCell><strong>Total</strong></TableCell>
                {allActivityCodes.map((code) => {
                  const colTotal = records.reduce(
                    (sum, r) => sum + (r.activityBreakdown[code] || 0),
                    0
                  );
                  return (
                    <TableCell key={code} align="right">
                      <strong>{colTotal}</strong>
                    </TableCell>
                  );
                })}
                <TableCell align="right">
                  <strong>{grandTotal}</strong>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    </Box>
  );
}
