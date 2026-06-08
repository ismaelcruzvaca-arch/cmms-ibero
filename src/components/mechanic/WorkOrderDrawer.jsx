import { useState, useEffect, useCallback, startTransition } from 'react';
import SwipeableDrawer from '@mui/material/SwipeableDrawer';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import CloseIcon from '@mui/icons-material/Close';
import BuildIcon from '@mui/icons-material/Build';
import PrintIcon from '@mui/icons-material/Print';
import Tooltip from '@mui/material/Tooltip';
import WorkOrderDetail from './WorkOrderDetail.jsx';
import WorkOrderNotesForm from './WorkOrderNotesForm.jsx';
import WorkOrderActions from './WorkOrderActions.jsx';
import LaborClockWidget from './LaborClockWidget.jsx';
import HtmlReportPreview from '../pdf/HtmlReportPreview.jsx';
import PdfDownloadButton from '../pdf/PdfDownloadButton.jsx';
import PdfEmailButton from '../pdf/PdfEmailButton.jsx';
import { useReport } from '../../hooks/useReport.js';
import { validateCompletion } from '../../lib/adapters/workOrderAdapter.js';
import { initRxDB } from '../../lib/rxdb.js';

const PHASE_ACTION_LABELS = {
  INPRG: 'Iniciada',
  COMP: 'Completada',
  CLOSED: 'Cerrada'
};

/**
 * Toma el work_order_id y consulta material_requests desde RxDB.
 */
function useMaterialRequests(workOrderId) {
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!workOrderId) {
      // workOrderId no disponible aún — estado inicial ya es vacío
      return;
    }

    let cancelled = false;

    (async () => {
      // Defer setState para evitar React 19 warning de setState síncrono en effect
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);

      try {
        const db = await initRxDB();
        if (!db.material_requests || cancelled) {
          if (!cancelled) setLoading(false);
          return;
        }
        const docs = await db.material_requests
          .find({ selector: { work_order_id: workOrderId } })
          .exec();
        if (!cancelled) {
          setMaterials(docs.map(d => d.toJSON()));
        }
      } catch (err) {
        console.warn('[WorkOrderDrawer] Error cargando materiales:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [workOrderId]);

  return { materials, loading };
}

export default function WorkOrderDrawer({ workOrder, open, onClose, onTransition, laborState }) {
  // Labor state (clock-in/out) — solo relevante para APPROVED/INPRG
  const hasActiveClock = !!laborState?.activeSession;
  // Local form state
  const [notes, setNotes] = useState({ symptom_note: '', cause_note: '', action_note: '' });
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [transitionError, setTransitionError] = useState(null);

  // Material requests
  const { materials, loading: materialsLoading } = useMaterialRequests(workOrder?.id);

  // ── Print report ──
  const [printOpen, setPrintOpen] = useState(false);

  const report = useReport({
    templateCode: 'work_order',
    context: {
      workOrder,
      laborRecords: laborState?.records || [],
      materialRequests: materials,
    },
  });

  const handlePrintClick = useCallback(() => {
    setPrintOpen(true);
  }, []);

  const handlePrintClose = useCallback(() => {
    setPrintOpen(false);
  }, []);

  // Confirmation dialog state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingTarget, setPendingTarget] = useState(null);

  // Reset form when drawer opens/closes or workOrder changes
  useEffect(() => {
    if (open) {
      startTransition(() => {
        setNotes({ symptom_note: '', cause_note: '', action_note: '' });
        setErrors({});
        setTransitionError(null);
        setIsSubmitting(false);
        setConfirmOpen(false);
        setPendingTarget(null);
      });
    }
  }, [open, workOrder?.id]);

  const handleChange = (field, value) => {
    setNotes(prev => ({ ...prev, [field]: value }));
    setErrors(prev => {
      if (prev[field]) {
        const next = { ...prev };
        delete next[field];
        return next;
      }
      return prev;
    });
  };

  const handleAction = (targetPhase) => {
    if (workOrder.lifecyclePhase === 'INPRG' && targetPhase === 'COMP') {
      const validation = validateCompletion(notes);
      if (!validation.valid) {
        setErrors(validation.errors);
        return;
      }
    }

    setPendingTarget(targetPhase);
    setConfirmOpen(true);
  };

  const handleConfirm = useCallback(async () => {
    if (!pendingTarget) return;

    setIsSubmitting(true);
    setTransitionError(null);
    setConfirmOpen(false);

    // ── Paso 1: clockIn/clockOut si corresponde ──
    if (pendingTarget === 'INPRG' && !laborState?.activeSession) {
      const clockResult = await laborState.clockIn('DIRECT_WORK');
      if (clockResult?.error) {
        setTransitionError(clockResult.error);
        setIsSubmitting(false);
        return;
      }
    }

    if (pendingTarget === 'COMP' && laborState?.activeSession) {
      const clockResult = await laborState.clockOut();
      if (clockResult?.error) {
        setTransitionError(clockResult.error);
        setIsSubmitting(false);
        return;
      }
    }

    // ── Paso 2: transición de WO ──
    const updates = { lifecycle_phase: pendingTarget };
    if (workOrder.lifecyclePhase === 'INPRG' && pendingTarget === 'COMP') {
      updates.symptom_note = notes.symptom_note;
      updates.cause_note = notes.cause_note;
      updates.action_note = notes.action_note;
    }

    const result = await onTransition(workOrder.id, updates);

    if (result.success) {
      setTimeout(() => onClose(), 800);
    } else {
      setTransitionError(result.error || 'Error al ejecutar la transición');
      setIsSubmitting(false);
    }
  }, [pendingTarget, workOrder, notes, onTransition, onClose, laborState]);

  const handleCancelConfirm = useCallback(() => {
    setConfirmOpen(false);
    setPendingTarget(null);
  }, []);

  const actionLabel = PHASE_ACTION_LABELS[pendingTarget] || pendingTarget;
  const iOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);

  return (
    <>
      <SwipeableDrawer
        anchor="right"
        open={open}
        onClose={isSubmitting ? undefined : onClose}
        onOpen={() => {}}
        disableBackdropTransition={!iOS}
        disableDiscovery={iOS}
        slotProps={{
          backdrop: { sx: isSubmitting ? { pointerEvents: 'none' } : undefined }
        }}
        sx={{
          '& .MuiDrawer-paper': {
            width: { xs: '100%', sm: 420 },
            p: 3,
            boxSizing: 'border-box'
          }
        }}
      >
        {/* ── Header ── */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography variant="h6" fontWeight="700">
              Orden de Trabajo
            </Typography>

            {/* Badge de wo_type */}
            {workOrder.woType && (
              <Chip
                icon={workOrder.woType === 'PM' ? <BuildIcon /> : undefined}
                label={workOrder.woTypeLabel || workOrder.woType}
                color={workOrder.woTypeColor || 'default'}
                size="small"
                variant="outlined"
                sx={{ alignSelf: 'flex-start', fontWeight: 600 }}
              />
            )}
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {/* Descargar PDF + Imprimir OT — siempre visible, sin restricción de fase */}
            <PdfDownloadButton
              templateCode="ot-default"
              recordId={workOrder.id}
              recordType="work_order"
              variant="icon"
              size="small"
            />
            <PdfEmailButton
              templateCode="ot-default"
              recordId={workOrder.id}
              recordType="work_order"
            />
            <Tooltip title="Imprimir orden de trabajo">
              <IconButton onClick={handlePrintClick} size="small" color="primary">
                <PrintIcon />
              </IconButton>
            </Tooltip>
            <IconButton onClick={onClose} disabled={isSubmitting} size="small">
              <CloseIcon />
            </IconButton>
          </Box>
        </Box>

        <Divider sx={{ mb: 2 }} />

        {/* ── Detalle de la OT ── */}
        <WorkOrderDetail workOrder={workOrder} />

        {/* ── Materiales Solicitados ── */}
        {materials.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" fontWeight="700" sx={{ mb: 1.5 }}>
              Materiales Solicitados
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {materials.map(mat => (
                <Box
                  key={mat.id}
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    p: 1.5,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                  }}
                >
                  <Box>
                    <Typography variant="body2" fontWeight="600">
                      {mat.line_desc}
                    </Typography>
                    {mat.part_num && (
                      <Typography variant="caption" color="text.secondary">
                        {mat.part_num}
                      </Typography>
                    )}
                  </Box>
                  <Chip
                    label={`${mat.requested_qty} UN`}
                    size="small"
                    color="primary"
                    variant="outlined"
                  />
                </Box>
              ))}
            </Box>
          </>
        )}

        {materials.length === 0 && !materialsLoading && (
          <Typography variant="caption" color="text.disabled" sx={{ mt: 1, display: 'block' }}>
            Sin materiales solicitados
          </Typography>
        )}

        {/* ── ClockWidget (solo APPROVED / INPRG) ── */}
        {['APPROVED', 'INPRG'].includes(workOrder.lifecyclePhase) && laborState && (
          <Box sx={{ mt: 2 }}>
            <LaborClockWidget
              activeSession={laborState.activeSession}
              onClockIn={laborState.clockIn}
              onClockOut={laborState.clockOut}
              loading={laborState.loading}
              error={laborState.error}
              lifecyclePhase={workOrder.lifecyclePhase}
            />
          </Box>
        )}

        <Divider sx={{ my: 2 }} />

        {/* ── Formulario de notas ── */}
        <WorkOrderNotesForm
          values={notes}
          onChange={handleChange}
          errors={errors}
          lifecyclePhase={workOrder.lifecyclePhase}
        />

        {/* ── Error alert ── */}
        {transitionError && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setTransitionError(null)}>
            {transitionError}
          </Alert>
        )}

        {/* ── Acciones ── */}
        <WorkOrderActions
          lifecyclePhase={workOrder.lifecyclePhase}
          onAction={handleAction}
          isSubmitting={isSubmitting}
          validationErrors={Object.keys(errors)}
          hasActiveClock={hasActiveClock}
        />
      </SwipeableDrawer>

      {/* ── Diálogo de confirmación ── */}
      <Dialog open={confirmOpen} onClose={handleCancelConfirm}>
        <DialogTitle>Confirmar acción</DialogTitle>
        <DialogContent>
          <Typography>
            ¿Estás seguro de marcar como <strong>{actionLabel}</strong> esta orden?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelConfirm} color="inherit">
            Cancelar
          </Button>
          <Button onClick={handleConfirm} variant="contained" color="primary" autoFocus>
            Confirmar
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Vista previa de impresión ── */}
      {printOpen && (
        <HtmlReportPreview
          html={report.html}
          loading={report.loading}
          error={report.error}
          empty={report.empty}
          templateName={report.templateName}
          onPrint={report.print}
          onClose={handlePrintClose}
        />
      )}
    </>
  );
}
