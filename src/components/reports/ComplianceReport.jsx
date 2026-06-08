/**
 * ComplianceReport.jsx
 * Three-section compliance dashboard: Permisos (expiring/active), LOTO (active blocks),
 * and Certificaciones (technician certs). All labels in Spanish.
 *
 * Props: { permits, lotoRecords, certs, loading, error, sectionErrors, onRetry }
 *
 * States: loading → error (only when ALL 3 sections fail) → empty (all sections empty) → success
 * Partial errors show inline Alerts per section without blocking the whole component.
 */
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';

// ─── MetricCard (reusable inline) ─────────────────────────────────
function MetricCard({ title, value, color }) {
  return (
    <Card variant="outlined" sx={{ borderTop: 3, borderColor: color || 'primary.main', mb: 2 }}>
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

// ─── Empty section placeholder ─────────────────────────────────────
function SectionEmpty({ message }) {
  return (
    <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
      {message}
    </Typography>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

/** Count permits expiring within 7 days from now */
function countExpiringWithin7Days(permits) {
  if (!permits || permits.length === 0) return 0;
  const now = Date.now();
  const sevenDays = Date.now() + 7 * 24 * 60 * 60 * 1000;
  return permits.filter((p) => {
    if (!p.expires_at) return false;
    const exp = new Date(p.expires_at).getTime();
    return exp >= now && exp <= sevenDays;
  }).length;
}

/** Count distinct technician IDs from certs */
function countDistinctTechs(certs) {
  if (!certs || certs.length === 0) return 0;
  return new Set(certs.map((c) => c.technician_id)).size;
}

// ═══════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════

export default function ComplianceReport({
  permits,
  lotoRecords,
  certs,
  loading,
  error,
  sectionErrors = {},
  onRetry,
}) {
  // ── 1. Loading ──
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 6, gap: 2 }}>
        <CircularProgress />
        <Typography variant="body2" color="text.secondary">
          Cargando informe de cumplimiento…
        </Typography>
      </Box>
    );
  }

  // ── 2. Error (ALL 3 sections failed) ──
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

  const hasPermits = Array.isArray(permits) && permits.length > 0;
  const hasLoto = Array.isArray(lotoRecords) && lotoRecords.length > 0;
  const hasCerts = Array.isArray(certs) && certs.length > 0;

  // ── 3. Empty (all sections have no data) ──
  if (!hasPermits && !hasLoto && !hasCerts) {
    return (
      <Box sx={{ textAlign: 'center', py: 6 }}>
        <Typography variant="body1" color="text.secondary">
          No se encontraron datos de cumplimiento en el período seleccionado
        </Typography>
      </Box>
    );
  }

  // ── 4. Success ──
  const expiringCount = countExpiringWithin7Days(permits);
  const lotoCount = Array.isArray(lotoRecords) ? lotoRecords.length : 0;
  const techCount = countDistinctTechs(certs);

  return (
    <Box>
      {/* ═══════════════════════════════════════════
          1. Permisos de Trabajo
          ═══════════════════════════════════════════ */}
      <Box data-widget-id="compliance-permits" sx={{ mb: 4 }}>
        <Typography variant="subtitle1" fontWeight="700" sx={{ mb: 1 }}>
          Permisos de Trabajo
        </Typography>

        <MetricCard title="Permisos por vencer" value={expiringCount} color="#1976d2" />

        {sectionErrors.permits ? (
          <Alert severity="warning" sx={{ mb: 1 }}>
            {sectionErrors.permits}
          </Alert>
        ) : hasPermits ? (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Descripción</TableCell>
                  <TableCell>Ubicación</TableCell>
                  <TableCell>Vence</TableCell>
                  <TableCell>Estado</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {permits.map((p, idx) => (
                  <TableRow key={p.id || idx} hover>
                    <TableCell sx={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {p.description || '—'}
                    </TableCell>
                    <TableCell>{p.location || '—'}</TableCell>
                    <TableCell>
                      {p.expires_at
                        ? new Date(p.expires_at).toLocaleDateString('es-MX')
                        : '—'}
                    </TableCell>
                    <TableCell>{p.permit_status || p.status || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        ) : (
          <SectionEmpty message="No se encontraron permisos de trabajo en el período seleccionado" />
        )}
      </Box>

      {/* ═══════════════════════════════════════════
          2. Bloqueos LOTO
          ═══════════════════════════════════════════ */}
      <Box data-widget-id="compliance-loto" sx={{ mb: 4 }}>
        <Typography variant="subtitle1" fontWeight="700" sx={{ mb: 1 }}>
          Bloqueos LOTO
        </Typography>

        <MetricCard title="Bloqueos activos" value={lotoCount} color="#f57c00" />

        {sectionErrors.loto ? (
          <Alert severity="warning" sx={{ mb: 1 }}>
            {sectionErrors.loto}
          </Alert>
        ) : hasLoto ? (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Activo</TableCell>
                  <TableCell>Estado</TableCell>
                  <TableCell>Bloqueado desde</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {lotoRecords.map((r, idx) => (
                  <TableRow key={r.id || idx} hover>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                      {r.asset_id || '—'}
                    </TableCell>
                    <TableCell>{r.loto_status || '—'}</TableCell>
                    <TableCell>
                      {r.locked_at
                        ? new Date(r.locked_at).toLocaleDateString('es-MX')
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        ) : (
          <SectionEmpty message="No se encontraron bloqueos LOTO activos" />
        )}
      </Box>

      {/* ═══════════════════════════════════════════
          3. Certificaciones de Técnicos
          ═══════════════════════════════════════════ */}
      <Box data-widget-id="compliance-certs">
        <Typography variant="subtitle1" fontWeight="700" sx={{ mb: 1 }}>
          Certificaciones de Técnicos
        </Typography>

        <MetricCard title="Técnicos certificados" value={techCount} color="#388e3c" />

        {sectionErrors.certs ? (
          <Alert severity="warning" sx={{ mb: 1 }}>
            {sectionErrors.certs}
          </Alert>
        ) : hasCerts ? (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Técnico</TableCell>
                  <TableCell>Módulo</TableCell>
                  <TableCell>Nombre del Módulo</TableCell>
                  <TableCell>Nivel Actual</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {certs.map((c, idx) => (
                  <TableRow key={c.id || idx} hover>
                    <TableCell>
                      {c.user_profiles?.full_name || '—'}
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                      {c.technological_modules?.code || '—'}
                    </TableCell>
                    <TableCell>
                      {c.technological_modules?.name || '—'}
                    </TableCell>
                    <TableCell>{c.current_level ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        ) : (
          <SectionEmpty message="No se encontraron certificaciones activas" />
        )}
      </Box>
    </Box>
  );
}
