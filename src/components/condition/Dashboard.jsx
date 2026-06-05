/**
 * Dashboard — Panel principal de monitoreo de condición
 *
 * Muestra métricas agregadas del sistema de monitoreo en una grilla 3×3
 * de tarjetas clickeables. Separa visualmente problemas de activo
 * (diagnósticos, RUL, recomendaciones) de problemas de fuente/dato
 * (calidad, fuentes caídas, dead letters).
 *
 * Props:
 *  - assetId (opcional): scopes métricas a un activo específico
 *  - onNavigate(target): callback con clave semántica para navegar:
 *      'diagnosis', 'fuentes', 'dead-letter', 'captura'
 *
 * Lenguaje: español. Colores: rojo (crítico), amarillo (advertencia),
 *   verde (ok), gris (sin datos).
 */

// NOTE: useState not needed — component derives all state from useDashboardMetrics

import {
  Box,
  Grid,
  Card,
  CardContent,
  Typography,
  Skeleton,
  Alert,
  IconButton,
  Chip,
} from '@mui/material';
import {
  WarningAmber,
  Science,
  Timeline,
  Assignment,
  Assessment,
  SignalWifiOff,
  DeleteOutlined,
  Feedback,
  Build,
  Refresh,
} from '@mui/icons-material';
import { useDashboardMetrics } from '../../hooks/useDashboardMetrics';

// ─── Constantes ─────────────────────────────────────────────────
const PRIORITY_CONFIG = {
  critical: { label: 'Crítica', color: 'error' },
  high:     { label: 'Alta',    color: 'warning' },
  medium:   { label: 'Media',   color: 'info' },
  low:      { label: 'Baja',    color: 'default' },
};

const QUALITY_COLORS = {
  G0: '#4caf50',
  G1: '#8bc34a',
  G2: '#ff9800',
  G3: '#f44336',
};

const SEVERITY = {
  RED:    'error.main',
  YELLOW: 'warning.main',
  GREEN:  'success.main',
  GRAY:   'text.disabled',
};

// ─── Helpers ────────────────────────────────────────────────────

function getCriticalColor(count) {
  if (count > 5) return SEVERITY.RED;
  if (count > 0) return SEVERITY.YELLOW;
  return SEVERITY.GREEN;
}

function getOpenDiagColor(count) {
  if (count > 20) return SEVERITY.RED;
  if (count > 5)  return SEVERITY.YELLOW;
  return SEVERITY.GREEN;
}

function getPendingRecsColor(count) {
  if (count > 10) return SEVERITY.RED;
  if (count > 0)  return SEVERITY.YELLOW;
  return SEVERITY.GREEN;
}

function getStaleColor(count) {
  return count > 0 ? SEVERITY.RED : SEVERITY.GREEN;
}

function getDeadLetterColor(count) {
  return count > 0 ? SEVERITY.RED : SEVERITY.GREEN;
}

function getFeedbackColor(count) {
  if (count > 10) return SEVERITY.RED;
  if (count > 0)  return SEVERITY.YELLOW;
  return SEVERITY.GREEN;
}

function getCbmWoColor(count) {
  if (count > 5)  return SEVERITY.RED;
  if (count > 0)  return SEVERITY.YELLOW;
  return SEVERITY.GREEN;
}

function formatHours(hours) {
  if (hours == null) return '—';
  if (hours < 1) return '< 1 h';
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} d ${hours % 24}h`;
}

function formatRul(value) {
  if (value == null) return '—';
  if (value < 1) return `${(value * 24).toFixed(0)} h`;
  return `${value.toFixed(1)} días`;
}

// ─── MetricTile ─────────────────────────────────────────────────

function MetricTile({ icon, label, value, color, onClick, children }) {
  return (
    <Card
      variant="outlined"
      sx={{
        cursor: onClick ? 'pointer' : 'default',
        transition: 'box-shadow 0.2s, transform 0.15s',
        '&:hover': onClick ? {
          boxShadow: 4,
          transform: 'translateY(-1px)',
        } : {},
        borderLeft: 4,
        borderLeftColor: color || 'primary.main',
        height: '100%',
      }}
      onClick={onClick}
    >
      <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
          <Box sx={{ color: color || 'primary.main', mt: 0.3, lineHeight: 0 }}>
            {icon}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mb: 0.5, display: 'block', fontWeight: 500, letterSpacing: 0.3 }}
            >
              {label}
            </Typography>
            <Typography
              variant="h5"
              fontWeight={800}
              sx={{ color: color || 'text.primary', lineHeight: 1.2 }}
            >
              {value ?? '—'}
            </Typography>
            {children && (
              <Box sx={{ mt: 1 }}>
                {children}
              </Box>
            )}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}

// ─── MetricTile Skeleton ────────────────────────────────────────

function MetricTileSkeleton() {
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
          <Skeleton variant="circular" width={28} height={28} />
          <Box sx={{ flex: 1 }}>
            <Skeleton variant="text" width="60%" height={16} />
            <Skeleton variant="text" width="40%" height={36} sx={{ mt: 0.5 }} />
            <Skeleton variant="text" width="80%" height={14} sx={{ mt: 1 }} />
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}

// ─── Tile content helpers ───────────────────────────────────────

function PrioritiesList({ items }) {
  if (!items || items.length === 0) {
    return (
      <Typography variant="caption" color="text.disabled">
        Sin prioridades
      </Typography>
    );
  }
  return (
    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
      {items.map((p) => {
        const cfg = PRIORITY_CONFIG[p.priority] || { label: p.priority, color: 'default' };
        return (
          <Chip
            key={p.priority}
            label={`${cfg.label}: ${p.count}`}
            size="small"
            color={cfg.color}
            variant="outlined"
            sx={{ fontSize: '0.7rem', height: 22 }}
          />
        );
      })}
    </Box>
  );
}

function TopRulList({ items }) {
  if (!items || items.length === 0) {
    return (
      <Typography variant="caption" color="text.disabled">
        Sin datos de RUL
      </Typography>
    );
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.3 }}>
      {items.slice(0, 5).map((r, i) => {
        const isUrgent = r.result_value != null && r.result_value < 7;
        return (
          <Box key={r.asset_id || i} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography
              variant="caption"
              noWrap
              sx={{ maxWidth: '60%', fontWeight: isUrgent ? 700 : 400, color: isUrgent ? 'error.main' : 'text.primary' }}
            >
              {r.asset_id || `#${i + 1}`}
            </Typography>
            <Typography
              variant="caption"
              fontWeight={700}
              sx={{ color: isUrgent ? 'error.main' : 'warning.main' }}
            >
              {formatRul(r.result_value)}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}

function QualityBreakdown({ items }) {
  if (!items || items.length === 0) {
    return (
      <Typography variant="caption" color="text.disabled">
        Sin datos de calidad
      </Typography>
    );
  }
  // Mostrar primeras 3 fuentes como resumen
  const topSources = items.slice(0, 3);
  const remaining = items.length - topSources.length;

  // Calcular distribución global G0-G3
  let totalG0 = 0, totalG1 = 0, totalG2 = 0, totalG3 = 0;
  let hasValues = false;
  for (const s of items) {
    if (s.total_values > 0) hasValues = true;
    totalG0 += s.g0_pct || 0;
    totalG1 += s.g1_pct || 0;
    totalG2 += s.g2_pct || 0;
    totalG3 += s.g3_pct || 0;
  }
  const count = items.length;
  const avgG0 = count > 0 ? totalG0 / count : 0;
  const avgG1 = count > 0 ? totalG1 / count : 0;
  const avgG2 = count > 0 ? totalG2 / count : 0;
  const avgG3 = count > 0 ? totalG3 / count : 0;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {/* Barra de calidad apilada */}
      {hasValues && (
        <Box sx={{ display: 'flex', height: 8, borderRadius: 1, overflow: 'hidden', mb: 0.5 }}>
          <Box sx={{ flex: avgG0, bgcolor: QUALITY_COLORS.G0, minWidth: avgG0 > 0 ? 2 : 0 }} />
          <Box sx={{ flex: avgG1, bgcolor: QUALITY_COLORS.G1, minWidth: avgG1 > 0 ? 2 : 0 }} />
          <Box sx={{ flex: avgG2, bgcolor: QUALITY_COLORS.G2, minWidth: avgG2 > 0 ? 2 : 0 }} />
          <Box sx={{ flex: avgG3, bgcolor: QUALITY_COLORS.G3, minWidth: avgG3 > 0 ? 2 : 0 }} />
        </Box>
      )}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="caption" sx={{ color: QUALITY_COLORS.G0, fontWeight: 600 }}>
          G0: {avgG0.toFixed(0)}%
        </Typography>
        <Typography variant="caption" sx={{ color: QUALITY_COLORS.G1, fontWeight: 600 }}>
          G1: {avgG1.toFixed(0)}%
        </Typography>
        <Typography variant="caption" sx={{ color: QUALITY_COLORS.G2, fontWeight: 600 }}>
          G2: {avgG2.toFixed(0)}%
        </Typography>
        <Typography variant="caption" sx={{ color: QUALITY_COLORS.G3, fontWeight: 600 }}>
          G3: {avgG3.toFixed(0)}%
        </Typography>
      </Box>
      {topSources.length > 0 && (
        <Box sx={{ mt: 0.5 }}>
          {topSources.map((s) => (
            <Typography key={s.source_id} variant="caption" display="block" color="text.secondary" noWrap>
              {s.source_name || s.source_id}: G0 {s.g0_pct ?? 0}% · G3 {s.g3_pct ?? 0}%
            </Typography>
          ))}
          {remaining > 0 && (
            <Typography variant="caption" color="text.disabled">
              +{remaining} más
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}

function StaleSourcesList({ items }) {
  if (!items || items.length === 0) {
    return (
      <Typography variant="caption" color="text.disabled">
        Todas las fuentes activas
      </Typography>
    );
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.3 }}>
      {items.slice(0, 3).map((s) => (
        <Box key={s.source_id} sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="caption" noWrap sx={{ maxWidth: '60%' }}>
            {s.name || s.source_id}
          </Typography>
          <Typography variant="caption" fontWeight={700} color="error.main">
            {formatHours(s.hours_since_last_data)}
          </Typography>
        </Box>
      ))}
      {items.length > 3 && (
        <Typography variant="caption" color="text.disabled">
          +{items.length - 3} más
        </Typography>
      )}
    </Box>
  );
}

function FMList({ items }) {
  if (!items || items.length === 0) {
    return (
      <Typography variant="caption" color="text.disabled">
        Sin diagnósticos abiertos
      </Typography>
    );
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.3 }}>
      {items.slice(0, 4).map((fm) => (
        <Box key={fm.failure_mode_key} sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="caption" noWrap sx={{ maxWidth: '65%' }}>
            {fm.failure_mode_key}
          </Typography>
          <Typography variant="caption" fontWeight={700}>
            {fm.count}
          </Typography>
        </Box>
      ))}
      {items.length > 4 && (
        <Typography variant="caption" color="text.disabled">
          +{items.length - 4} modos más
        </Typography>
      )}
    </Box>
  );
}

// ─── Dashboard ──────────────────────────────────────────────────

export default function Dashboard({ assetId, onNavigate }) {
  const { metrics, loading, error, refetch } = useDashboardMetrics({ assetId });

  // ─── Estados ──────────────────────────────────────────────────
  if (loading) {
    return (
      <Grid container spacing={2.5}>
        {Array.from({ length: 9 }).map((_, i) => (
          <Grid key={i} size={{ xs: 12, sm: 6, md: 4 }}>
            <MetricTileSkeleton />
          </Grid>
        ))}
      </Grid>
    );
  }

  if (error) {
    return (
      <Alert
        severity="error"
        variant="outlined"
        action={
          <IconButton color="inherit" size="small" onClick={refetch}>
            <Refresh />
          </IconButton>
        }
        sx={{ mb: 3 }}
      >
        Error al cargar métricas del dashboard: {error}
      </Alert>
    );
  }

  const hasData =
    metrics.criticalAssets > 0 ||
    metrics.openDiagnoses > 0 ||
    metrics.topLowestRul.length > 0 ||
    metrics.pendingRecs > 0 ||
    metrics.sourcesQuality.length > 0 ||
    metrics.staleSources.length > 0 ||
    metrics.deadLetterCount > 0 ||
    metrics.feedbackPending > 0 ||
    metrics.cbmWoOpen > 0;

  if (!hasData) {
    return (
      <Box sx={{ textAlign: 'center', py: 6 }}>
        <Typography variant="h6" color="text.secondary" gutterBottom>
          No hay datos de monitoreo disponibles
        </Typography>
        <Typography variant="body2" color="text.disabled" sx={{ mb: 2 }}>
          No se encontraron métricas{assetId ? ' para este activo' : ''}. Podés comenzar capturando datos desde la pestaña Captura.
        </Typography>
        <IconButton onClick={refetch} color="primary">
          <Refresh />
        </IconButton>
      </Box>
    );
  }

  // ─── Render ───────────────────────────────────────────────────
  return (
    <Box>
      {/* ── Fila 1: Activo ── */}
      <Grid container spacing={2.5} sx={{ mb: 2.5 }}>
        {/* Activos Críticos */}
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <MetricTile
            icon={<WarningAmber />}
            label="Activos Críticos"
            value={metrics.criticalAssets}
            color={getCriticalColor(metrics.criticalAssets)}
            onClick={() => onNavigate?.('diagnosis')}
          >
            <Typography variant="caption" color="text.secondary">
              Con diagnóstico activo + confianza ≥ 70%
            </Typography>
          </MetricTile>
        </Grid>

        {/* Diagnósticos Abiertos */}
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <MetricTile
            icon={<Science />}
            label="Diagnósticos Abiertos"
            value={metrics.openDiagnoses}
            color={getOpenDiagColor(metrics.openDiagnoses)}
            onClick={() => onNavigate?.('diagnosis')}
          >
            <FMList items={metrics.openDiagnosesByFM} />
          </MetricTile>
        </Grid>

        {/* RUL más Bajo */}
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <MetricTile
            icon={<Timeline />}
            label="RUL más Bajo"
            value={metrics.topLowestRul.length > 0 ? formatRul(metrics.topLowestRul[0].result_value) : '—'}
            color={
              metrics.topLowestRul.some((r) => r.result_value != null && r.result_value < 7)
                ? SEVERITY.RED
                : SEVERITY.GREEN
            }
            onClick={() => onNavigate?.('diagnosis')}
          >
            <TopRulList items={metrics.topLowestRul} />
          </MetricTile>
        </Grid>
      </Grid>

      {/* ── Fila 2: Datos ── */}
      <Grid container spacing={2.5} sx={{ mb: 2.5 }}>
        {/* Recos Pendientes */}
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <MetricTile
            icon={<Assignment />}
            label="Recos Pendientes"
            value={metrics.pendingRecs}
            color={getPendingRecsColor(metrics.pendingRecs)}
            onClick={() => onNavigate?.('recos')}
          >
            <PrioritiesList items={metrics.pendingRecsByPriority} />
          </MetricTile>
        </Grid>

        {/* Calidad de Datos */}
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <MetricTile
            icon={<Assessment />}
            label="Calidad de Datos"
            value={`${metrics.sourcesQuality.length} fuentes`}
            color={
              metrics.sourcesQuality.some((s) => (s.g3_pct || 0) > 30)
                ? SEVERITY.RED
                : SEVERITY.GREEN
            }
            onClick={() => onNavigate?.('fuentes')}
          >
            <QualityBreakdown items={metrics.sourcesQuality} />
          </MetricTile>
        </Grid>

        {/* Fuentes Caídas */}
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <MetricTile
            icon={<SignalWifiOff />}
            label="Fuentes Caídas"
            value={metrics.staleSources.length}
            color={getStaleColor(metrics.staleSources.length)}
            onClick={() => onNavigate?.('fuentes')}
          >
            <StaleSourcesList items={metrics.staleSources} />
          </MetricTile>
        </Grid>
      </Grid>

      {/* ── Fila 3: Acciones ── */}
      <Grid container spacing={2.5}>
        {/* Dead Letters */}
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <MetricTile
            icon={<DeleteOutlined />}
            label="Dead Letters"
            value={metrics.deadLetterCount}
            color={getDeadLetterColor(metrics.deadLetterCount)}
            onClick={() => onNavigate?.('dead-letter')}
          >
            <Typography variant="caption" color={metrics.deadLetterCount > 0 ? 'error.main' : 'text.disabled'}>
              {metrics.deadLetterCount > 0
                ? 'Requieren revisión'
                : 'Sin errores de ingesta'}
            </Typography>
          </MetricTile>
        </Grid>

        {/* Feedback Pendiente */}
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <MetricTile
            icon={<Feedback />}
            label="Feedback Pendiente"
            value={metrics.feedbackPending}
            color={getFeedbackColor(metrics.feedbackPending)}
            onClick={() => onNavigate?.('diagnosis')}
          >
            <Typography variant="caption" color="text.secondary">
              Evaluaciones técnicas pendientes
            </Typography>
          </MetricTile>
        </Grid>

        {/* OTs CBM Abiertas */}
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <MetricTile
            icon={<Build />}
            label="OTs CBM Abiertas"
            value={metrics.cbmWoOpen}
            color={getCbmWoColor(metrics.cbmWoOpen)}
            onClick={() => onNavigate?.('captura')}
          >
            <Typography variant="caption" color="text.secondary">
              Órdenes de trabajo basadas en condición
            </Typography>
          </MetricTile>
        </Grid>
      </Grid>
    </Box>
  );
}
