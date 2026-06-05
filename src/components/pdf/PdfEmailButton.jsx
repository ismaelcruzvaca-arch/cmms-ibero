/**
 * PdfEmailButton.jsx
 * Botón MUI que abre un diálogo para enviar PDFs por email via Edge Function send-report.
 *
 * Props:
 * - templateCode (string, required): Código del template (ej: "ot-default")
 * - recordId (string, optional): ID del registro asociado
 * - recordType (string, optional): Tipo de registro (ej: "work_order")
 * - data (object, optional): Datos directos (alternativa a recordId)
 * - onComplete (function, optional): Callback al completar el envío
 *
 * Estados del hook:
 * - idle: botón normal con icono de email
 * - loading: CircularProgress en botón Send
 * - success: Snackbar "Reporte enviado" por 3s, luego vuelve a idle
 * - error: Snackbar con Alert de error
 */
import { useState, useCallback, useEffect } from 'react';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import CircularProgress from '@mui/material/CircularProgress';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import SendIcon from '@mui/icons-material/Send';
import { usePdfEmail } from '../../hooks/usePdfEmail';

/**
 * @param {Object} props
 * @param {string} props.templateCode
 * @param {string} [props.recordId]
 * @param {string} [props.recordType]
 * @param {object} [props.data]
 * @param {Function} [props.onComplete]
 */
export default function PdfEmailButton({
  templateCode,
  recordId,
  recordType,
  data,
  onComplete,
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [validationErrors, setValidationErrors] = useState({});

  // Close dialog on success via onComplete callback (evita cascading render en useEffect)
  const handleComplete = useCallback((result) => {
    if (result.success) {
      setDialogOpen(false);
    }
    onComplete?.(result);
  }, [onComplete]);

  const { sendEmail, loading, error, state, reset } = usePdfEmail({ onComplete: handleComplete });

  // Safety net: cierra el diálogo en el siguiente tick si state cambió a success
  // (el flujo principal cierra via onComplete; este effect cubre tests y edge cases)
  useEffect(() => {
    if (state === 'success') {
      const closeTimer = setTimeout(() => setDialogOpen(false), 0);
      const resetTimer = setTimeout(() => reset(), 3000);
      return () => {
        clearTimeout(closeTimer);
        clearTimeout(resetTimer);
      };
    }
  }, [state, reset]);

  // Button is disabled while loading or when required props are missing
  const disabled = loading || !templateCode || (!recordId && !data);

  const handleOpenDialog = useCallback(() => {
    if (disabled) return;
    setTo('');
    setSubject('');
    setMessage('');
    setValidationErrors({});
    setDialogOpen(true);
  }, [disabled]);

  const handleCloseDialog = useCallback(() => {
    if (loading) return;
    setDialogOpen(false);
    setValidationErrors({});
  }, [loading]);

  const validate = useCallback(() => {
    const errors = {};

    if (!to.trim()) {
      errors.to = 'Destinatario requerido';
    } else {
      const emails = to.split(',').map(e => e.trim()).filter(Boolean);
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      for (let i = 0; i < emails.length; i++) {
        if (!emailRegex.test(emails[i])) {
          errors.to = `Email inválido: "${emails[i]}"`;
          break;
        }
      }
    }

    if (!subject.trim()) {
      errors.subject = 'Asunto requerido';
    }

    return errors;
  }, [to, subject]);

  const handleSubmit = useCallback(async () => {
    const errors = validate();
    setValidationErrors(errors);

    if (Object.keys(errors).length > 0) return;

    const toValue = to.includes(',')
      ? to.split(',').map(e => e.trim()).filter(Boolean)
      : to.trim();

    await sendEmail({
      to: toValue,
      subject: subject.trim(),
      message: message.trim() || undefined,
      templateCode,
      recordId,
      recordType,
      data,
    });
  }, [to, subject, message, templateCode, recordId, recordType, data, sendEmail, validate]);

  const showSuccess = state === 'success';
  const showError = state === 'error' && error;

  return (
    <>
      <Tooltip title="Enviar por email">
        <span>
          <IconButton
            onClick={handleOpenDialog}
            disabled={disabled}
            size="small"
            color="primary"
            aria-label="Enviar por email"
          >
            <SendIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>

      {/* ── Envío exitoso ── */}
      <Snackbar
        open={showSuccess}
        autoHideDuration={3000}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" variant="filled">
          Reporte enviado
        </Alert>
      </Snackbar>

      {/* ── Error ── */}
      <Snackbar
        open={showError}
        autoHideDuration={5000}
        onClose={reset}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={reset} variant="filled">
          {error}
        </Alert>
      </Snackbar>

      {/* ── Diálogo de envío ── */}
      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>Enviar reporte por email</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Destinatario"
            type="email"
            fullWidth
            variant="outlined"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            error={!!validationErrors.to}
            helperText={validationErrors.to}
            placeholder="user@example.com"
            disabled={loading}
            slotProps={{ htmlInput: { 'aria-label': 'Destinatario' } }}
          />
          <TextField
            margin="dense"
            label="Asunto"
            fullWidth
            variant="outlined"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            error={!!validationErrors.subject}
            helperText={validationErrors.subject}
            placeholder="Reporte de orden de trabajo"
            disabled={loading}
            slotProps={{ htmlInput: { 'aria-label': 'Asunto' } }}
          />
          <TextField
            margin="dense"
            label="Mensaje (opcional)"
            fullWidth
            variant="outlined"
            multiline
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={loading}
            slotProps={{ htmlInput: { 'aria-label': 'Mensaje' } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog} color="inherit" disabled={loading}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            variant="contained"
            color="primary"
            disabled={loading}
            startIcon={loading ? <CircularProgress size={18} color="inherit" /> : undefined}
          >
            {loading ? 'Enviando…' : 'Enviar'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
