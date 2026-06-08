/**
 * MaterialsConsumedReport.jsx
 * BarChart (top parts by qty) + MUI Table (part_num, description, uom, total_qty, WO, date).
 *
 * Props:
 *   records — Array from useMaterialsConsumed (report_materials_consumed view)
 *   loading, error, onRetry
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
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

export default function MaterialsConsumedReport({
  records,
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
          No se encontraron materiales consumidos en el período seleccionado
        </Typography>
      </Box>
    );
  }

  // ── Success ──

  // Aggregate consumption by part_num for the bar chart (top 10 parts)
  const chartData = Object.values(
    records.reduce((acc, r) => {
      if (!acc[r.part_num]) {
        acc[r.part_num] = { part_num: r.part_num, total_qty: 0, description: r.description || '' };
      }
      acc[r.part_num].total_qty += r.total_qty;
      return acc;
    }, {})
  )
    .sort((a, b) => b.total_qty - a.total_qty)
    .slice(0, 10);

  return (
    <Box>
      {/* Bar Chart — top parts consumed */}
      <Box data-widget-id="materials-chart" sx={{ mb: 4 }}>
        <Typography variant="subtitle2" fontWeight="600" sx={{ mb: 1 }}>
          Partes más consumidas
        </Typography>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="part_num" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="total_qty" fill="#1976d2" name="Cantidad consumida" />
          </BarChart>
        </ResponsiveContainer>
      </Box>

      {/* Detail Table */}
      <Box data-widget-id="materials-table">
        <Typography variant="subtitle2" fontWeight="600" sx={{ mb: 1 }}>
          Detalle de materiales consumidos
        </Typography>
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Parte</TableCell>
                <TableCell>Descripción</TableCell>
                <TableCell>UOM</TableCell>
                <TableCell align="right">Cantidad</TableCell>
                <TableCell>WO</TableCell>
                <TableCell>Descripción WO</TableCell>
                <TableCell>Última transacción</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {records.map((r, idx) => (
                <TableRow key={`${r.part_num}-${r.work_order_id}-${idx}`} hover>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                    {r.part_num}
                  </TableCell>
                  <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.description || '—'}
                  </TableCell>
                  <TableCell>{r.uom || '—'}</TableCell>
                  <TableCell align="right">{r.total_qty ?? '—'}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                    {r.work_order_id ?? '—'}
                  </TableCell>
                  <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.wo_description || '—'}
                  </TableCell>
                  <TableCell>
                    {r.last_transaction_at
                      ? new Date(r.last_transaction_at).toLocaleDateString('es-MX')
                      : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    </Box>
  );
}
