import { useState, useEffect, useCallback, startTransition } from 'react';
import Drawer from '@mui/material/Drawer';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import CloseIcon from '@mui/icons-material/Close';
import WorkOrderDetail from './WorkOrderDetail.jsx';
import WorkOrderNotesForm from './WorkOrderNotesForm.jsx';
import WorkOrderActions from './WorkOrderActions.jsx';
import { validateCompletion } from '../../lib/adapters/workOrderAdapter.js';

const PHASE_ACTION_LABELS = {
  INPRG: 'Iniciada',
  COMP: 'Completada',
  CLOSED: 'Cerrada'
};

export default function WorkOrderDrawer({ workOrder, open, onClose, onTransition }) {
  // Local form state
  const [notes, setNotes] = useState({ symptom_note: '', cause_note: '', action_note: '' });
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [transitionError, setTransitionError] = useState(null);

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
    // Clear field error on change
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
    // Validate if transitioning from INPRG → COMP
    if (workOrder.lifecyclePhase === 'INPRG' && targetPhase === 'COMP') {
      const validation = validateCompletion(notes);
      if (!validation.valid) {
        setErrors(validation.errors);
        return; // Button is disabled anyway, but safety net
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

    const updates = { lifecycle_phase: pendingTarget };
    if (workOrder.lifecyclePhase === 'INPRG' && pendingTarget === 'COMP') {
      updates.symptom_note = notes.symptom_note;
      updates.cause_note = notes.cause_note;
      updates.action_note = notes.action_note;
    }

    const result = await onTransition(workOrder.id, updates);

    if (result.success) {
      // Brief success feedback, then close
      setTimeout(() => {
        onClose();
      }, 800);
    } else {
      setTransitionError(result.error || 'Error al ejecutar la transición');
      setIsSubmitting(false);
    }
  }, [pendingTarget, workOrder, notes, onTransition, onClose]);

  const handleCancelConfirm = useCallback(() => {
    setConfirmOpen(false);
    setPendingTarget(null);
  }, []);

  const actionLabel = PHASE_ACTION_LABELS[pendingTarget] || pendingTarget;

  return (
    <>
      <Drawer
        anchor="right"
        open={open}
        onClose={isSubmitting ? undefined : onClose}
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
        {/* Header */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6" fontWeight="700">
            Orden de Trabajo
          </Typography>
          <IconButton onClick={onClose} disabled={isSubmitting} size="small">
            <CloseIcon />
          </IconButton>
        </Box>

        <Divider sx={{ mb: 2 }} />

        {/* Read-only detail */}
        <WorkOrderDetail workOrder={workOrder} />

        <Divider sx={{ my: 2 }} />

        {/* Conditional notes form */}
        <WorkOrderNotesForm
          values={notes}
          onChange={handleChange}
          errors={errors}
          lifecyclePhase={workOrder.lifecyclePhase}
        />

        {/* Error alert */}
        {transitionError && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setTransitionError(null)}>
            {transitionError}
          </Alert>
        )}

        {/* Phase-guided actions */}
        <WorkOrderActions
          lifecyclePhase={workOrder.lifecyclePhase}
          onAction={handleAction}
          isSubmitting={isSubmitting}
          validationErrors={Object.keys(errors)}
        />
      </Drawer>

      {/* Confirmation dialog */}
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
    </>
  );
}
