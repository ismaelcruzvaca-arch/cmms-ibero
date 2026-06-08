/**
 * MaintenanceHistoryReport.jsx
 * BarChart (WOs/month) + MUI Table (WO details).
 *
 * Props:
 *   wos, timeline, assetName, loading, error, onRetry
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

export default function MaintenanceHistoryReport({
  wos,
  timeline,
  assetName,
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
  if (!wos || wos.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 6 }}>
        <Typography variant="body1" color="text.secondary">
          No se encontraron órdenes para este activo en el período seleccionado
        </Typography>
      </Box>
    );
  }

  // ── Success ──
  return (
    <Box>
      {assetName && (
        <Typography variant="subtitle1" fontWeight="600" sx={{ mb: 2 }}>
          Activo: {assetName}
        </Typography>
      )}

      {/* Bar Chart — WOs per month */}
      <Box data-widget-id="maintenance-history-chart" sx={{ mb: 4 }}>
        <Typography variant="subtitle2" fontWeight="600" sx={{ mb: 1 }}>
          Órdenes por mes
        </Typography>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={timeline}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" fill="#1976d2" name="Órdenes" />
          </BarChart>
        </ResponsiveContainer>
      </Box>

      {/* Detail Table */}
      <Box data-widget-id="maintenance-history-table">
        <Typography variant="subtitle2" fontWeight="600" sx={{ mb: 1 }}>
          Detalle de órdenes
        </Typography>
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>WO</TableCell>
                <TableCell>Estado</TableCell>
                <TableCell>Descripción</TableCell>
                <TableCell>F. Creación</TableCell>
                <TableCell>F. Cierre</TableCell>
                <TableCell>Códigos</TableCell>
                <TableCell>Horas</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {wos.map((wo) => (
                <TableRow key={wo.id} hover>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                    {wo.id}
                  </TableCell>
                  <TableCell>{wo.lifecycle_phase}</TableCell>
                  <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {wo.description || '—'}
                  </TableCell>
                  <TableCell>
                    {wo.created_at
                      ? new Date(wo.created_at).toLocaleDateString('es-MX')
                      : '—'}
                  </TableCell>
                  <TableCell>
                    {wo.completed_at
                      ? new Date(wo.completed_at).toLocaleDateString('es-MX')
                      : '—'}
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                    {[wo.problem_code, wo.cause_code, wo.remedy_code]
                      .filter(Boolean)
                      .join(' / ') || '—'}
                  </TableCell>
                  <TableCell>{wo.actual_hours ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    </Box>
  );
}
