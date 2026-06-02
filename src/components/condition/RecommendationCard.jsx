/**
 * RecommendationCard — Tarjeta de recomendación de mantenimiento
 *
 * Muestra una recomendación activa de mantenimiento con:
 *  - Chip de prioridad (color según nivel)
 *  - Acción recomendada
 *  - Ventana de días para intervención
 *  - Badge "Requiere confirmación" si aplica
 *  - Tipo de OT
 *  - Botón "Confirmar y crear OT"
 *
 * Props:
 *  - assetId: ID del activo (consulta la recomendación más reciente)
 *
 * Estados:
 *  - Con datos: tarjeta completa con chips y botón
 *  - Vacío: "Sin recomendaciones activas"
 *  - Carga: mensaje de carga
 *  - Error: mensaje de error
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Card,
  CardContent,
  CardActions,
  Chip,
  Button,
} from '@mui/material';
import { supabase } from '../../lib/supabaseClient';

// ─── Constantes ─────────────────────────────────────────────────
const PRIORITY_CONFIG = {
  critical: { label: 'Crítica', color: 'error' },
  high:     { label: 'Alta',    color: 'warning' },
  medium:   { label: 'Media',   color: 'info' },
  low:      { label: 'Baja',    color: 'default' },
};

const WO_TYPE_LABELS = {
  CBM: 'CBM (Condición)',
  PM: 'PM (Planificada)',
  CM: 'CM (Correctiva)',
  INSPECTION: 'Inspección',
};

// ─── Componente ─────────────────────────────────────────────────

export default function RecommendationCard({ assetId }) {
  const [recommendation, setRecommendation] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    if (!assetId) {
      setRecommendation(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Traer la recomendación más reciente vinculada al activo
      // mediante JOIN a condition_diagnoses
      const { data, error: dbError } = await supabase
        .from('maintenance_recommendations')
        .select(`
          *,
          diagnosis:condition_diagnoses!inner(
            asset_id,
            diagnosis_status,
            confidence
          )
        `)
        .eq('diagnosis.asset_id', assetId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (dbError) throw new Error(dbError.message);
      setRecommendation(data || null);
    } catch (err) {
      setError(err.message);
      console.warn('[RecommendationCard] Error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [assetId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ─── Estados ──────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
        <Typography color="text.secondary">Cargando recomendaciones…</Typography>
      </Paper>
    );
  }

  if (error) {
    return (
      <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
        <Typography color="error">Error: {error}</Typography>
      </Paper>
    );
  }

  if (!assetId || !recommendation) {
    return (
      <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
        <Typography color="text.secondary">
          Sin recomendaciones activas
        </Typography>
        <Typography variant="caption" color="text.disabled" sx={{ mt: 1, display: 'block' }}>
          No hay recomendaciones de mantenimiento pendientes para este activo.
        </Typography>
      </Paper>
    );
  }

  // ─── Render ───────────────────────────────────────────────────
  const priorityCfg = PRIORITY_CONFIG[recommendation.priority] || { label: recommendation.priority, color: 'default' };

  const handleConfirm = async () => {
    console.log('[RecommendationCard] Confirmar recomendación:', recommendation.id);
    // TODO: llamar RPC generate_recommendation y crear work_order
  };

  return (
    <Card variant="outlined">
      <CardContent sx={{ pb: 1 }}>
        {/* ── Header: prioridad + tipo OT ── */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <Chip
            label={priorityCfg.label}
            color={priorityCfg.color}
            size="small"
          />
          {recommendation.work_order_type && (
            <Chip
              label={WO_TYPE_LABELS[recommendation.work_order_type] || recommendation.work_order_type}
              variant="outlined"
              size="small"
              color="default"
            />
          )}
          {recommendation.requires_confirmation && (
            <Chip
              label="Requiere confirmación"
              size="small"
              color="warning"
              variant="outlined"
              icon={<span style={{ fontSize: 14 }}>⚠</span>}
            />
          )}
        </Box>

        {/* ── Acción recomendada ── */}
        <Typography variant="body1" fontWeight={600} gutterBottom>
          {recommendation.recommended_action}
        </Typography>

        {/* ── Detalles ── */}
        <Box sx={{ display: 'flex', gap: 3, mt: 1, flexWrap: 'wrap' }}>
          {recommendation.due_window_days != null && (
            <Box>
              <Typography variant="caption" color="text.secondary" display="block">
                Ventana de intervención
              </Typography>
              <Typography variant="body2" fontWeight={600}>
                {recommendation.due_window_days} días
              </Typography>
            </Box>
          )}
          {recommendation.diagnosis?.confidence != null && (
            <Box>
              <Typography variant="caption" color="text.secondary" display="block">
                Confianza del diagnóstico
              </Typography>
              <Typography variant="body2" fontWeight={600}>
                {(recommendation.diagnosis.confidence * 100).toFixed(0)}%
              </Typography>
            </Box>
          )}
          <Box>
            <Typography variant="caption" color="text.secondary" display="block">
              Estado del diagnóstico
            </Typography>
            <Typography variant="body2" fontWeight={600}>
              {recommendation.diagnosis?.diagnosis_status || '—'}
            </Typography>
          </Box>
        </Box>
      </CardContent>

      <CardActions sx={{ px: 2, pb: 2 }}>
        <Button
          variant="contained"
          color="primary"
          onClick={handleConfirm}
          disabled={recommendation.requires_confirmation === false}
        >
          Confirmar y crear OT
        </Button>
      </CardActions>
    </Card>
  );
}
