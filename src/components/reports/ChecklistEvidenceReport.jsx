/**
 * ChecklistEvidenceReport.jsx
 * Summary cards + instance detail table with PASS/FAIL/NA badges and
 * photo evidence (inline <img crossOrigin="anonymous"> or placeholder).
 *
 * Props:
 *   instances — Array from useChecklistEvidence (checklist_instances w/ responses)
 *   summary   — { totalInstances, passCount, failCount, naCount, withPhotoCount }
 *   loading   — boolean
 *   error     — string|null
 *   onRetry   — () => void
 *
 * States: loading → error → empty → success
 */
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';

// ─── Status chip color mapping ────────────────────────────────────
const STATUS_COLORS = {
  PASS: 'success',
  FAIL: 'error',
  NA: 'default',
};

// ─── MetricCard (reusable inline) ─────────────────────────────────
function MetricCard({ title, value, color }) {
  return (
    <Card variant="outlined" sx={{ borderTop: 3, borderColor: color || 'primary.main', height: '100%' }}>
      <CardContent>
        <Typography variant="caption" color="text.secondary" fontWeight="600">
          {title}
        </Typography>
        <Typography variant="h4" fontWeight="700" sx={{ my: 0.5 }}>
          {value ?? '—'}
        </Typography>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════

export default function ChecklistEvidenceReport({
  instances,
  summary,
  loading,
  error,
  onRetry,
}) {
  // ── 1. Loading ──
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 6, gap: 2 }}>
        <CircularProgress />
        <Typography variant="body2" color="text.secondary">
          Cargando evidencia de checklists…
        </Typography>
      </Box>
    );
  }

  // ── 2. Error ──
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

  // ── 3. Empty ──
  const hasInstances = Array.isArray(instances) && instances.length > 0;
  if (!hasInstances) {
    return (
      <Box sx={{ textAlign: 'center', py: 6 }}>
        <Typography variant="body1" color="text.secondary">
          No se encontraron instancias de checklist en el período seleccionado
        </Typography>
      </Box>
    );
  }

  // ── 4. Success ──
  const totalResponses = summary.passCount + summary.failCount + summary.naCount;
  const passRate = totalResponses > 0 ? Math.round((summary.passCount / totalResponses) * 100) : 0;
  const failRate = totalResponses > 0 ? Math.round((summary.failCount / totalResponses) * 100) : 0;

  return (
    <Box>
      {/* ═══════════════════════════════════════════
          Summary cards
          ═══════════════════════════════════════════ */}
      <Box data-widget-id="checklist-summary" sx={{ mb: 4 }}>
        <Typography variant="subtitle2" fontWeight="600" sx={{ mb: 1 }}>
          Resumen de checklists
        </Typography>
        <Grid container spacing={2}>
          <Grid size={{ xs: 6, sm: 3 }}>
            <MetricCard title="Total instancias" value={summary.totalInstances} color="#1976d2" />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <MetricCard title="Tasa PASS" value={`${passRate}%`} color="#388e3c" />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <MetricCard title="Tasa FAIL" value={`${failRate}%`} color="#d32f2f" />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <MetricCard title="Con fotos" value={summary.withPhotoCount} color="#f57c00" />
          </Grid>
        </Grid>
      </Box>

      {/* ═══════════════════════════════════════════
          Instance detail
          ═══════════════════════════════════════════ */}
      <Box data-widget-id="checklist-detail">
        {instances.map((instance, idx) => {
          const responses = instance.checklist_item_responses || [];
          return (
            <Paper key={instance.id || idx} variant="outlined" sx={{ mb: 2, p: 2 }}>
              {/* Instance header */}
              <Typography variant="subtitle2" fontWeight="600" sx={{ mb: 1 }}>
                {instance.user_profiles?.full_name || 'Técnico desconocido'}
              </Typography>
              <Box sx={{ display: 'flex', gap: 3, mb: 1.5, flexWrap: 'wrap' }}>
                <Typography variant="caption" color="text.secondary">
                  <strong>Completado:</strong>{' '}
                  {instance.completed_at
                    ? new Date(instance.completed_at).toLocaleDateString('es-MX')
                    : '—'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  <strong>Orden de Trabajo:</strong> {instance.work_order_id || '—'}
                </Typography>
              </Box>

              {/* Items table */}
              {responses.length > 0 ? (
                <TableContainer component={Paper} variant="outlined" sx={{ mt: 1 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>Estado</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Comentario</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Foto</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {responses.map((resp) => (
                        <TableRow key={resp.id} hover>
                          <TableCell>
                            <Chip
                              label={resp.status}
                              color={STATUS_COLORS[resp.status] || 'default'}
                              size="small"
                              variant="outlined"
                            />
                          </TableCell>
                          <TableCell sx={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {resp.comment || '—'}
                          </TableCell>
                          <TableCell>
                            {resp.photo_url ? (
                              <img
                                src={resp.photo_url}
                                crossOrigin="anonymous"
                                alt="Evidencia"
                                style={{ maxWidth: 100, maxHeight: 80, borderRadius: 4 }}
                              />
                            ) : (
                              <Typography variant="caption" color="text.disabled">
                                Sin foto
                              </Typography>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                  Sin respuestas registradas
                </Typography>
              )}
            </Paper>
          );
        })}
      </Box>
    </Box>
  );
}
