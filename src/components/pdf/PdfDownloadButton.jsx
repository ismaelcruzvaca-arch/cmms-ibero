/**
 * PdfDownloadButton.jsx
 * Botón MUI para descargar PDFs server-side via Edge Function generate-pdf.
 *
 * Props:
 * - templateCode (string, required): Código del template (ej: "ot-default")
 * - recordId (string, optional): ID del registro asociado
 * - recordType (string, optional): Tipo de registro (ej: "work_order")
 * - data (object, optional): Datos directos (alternativa a recordId)
 * - variant ('icon'|'text', optional): Tipo de botón (default: 'icon')
 * - size ('small'|'medium'|'large', optional): Tamaño (default: 'small')
 * - onComplete (function, optional): Callback al completar la descarga
 *
 * Estados:
 * - idle: botón normal con icono de descarga
 * - loading: CircularProgress
 * - success: CheckCircleIcon por 3s, luego vuelve a idle
 * - error: Snackbar con Alert de error
 */
import { useCallback, useEffect } from 'react';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import DownloadIcon from '@mui/icons-material/Download';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { usePdfDownload } from '../../hooks/usePdfDownload';

/**
 * @param {Object} props
 * @param {string} props.templateCode
 * @param {string} [props.recordId]
 * @param {string} [props.recordType]
 * @param {object} [props.data]
 * @param {'icon'|'text'} [props.variant='icon']
 * @param {'small'|'medium'|'large'} [props.size='small']
 * @param {Function} [props.onComplete]
 */
export default function PdfDownloadButton({
  templateCode,
  recordId,
  recordType,
  data,
  variant = 'icon',
  size = 'small',
  onComplete,
}) {
  const { download, loading, error, state, reset } = usePdfDownload({ onComplete });

  // Auto-reset after success
  useEffect(() => {
    if (state === 'success') {
      const timer = setTimeout(() => reset(), 3000);
      return () => clearTimeout(timer);
    }
  }, [state, reset]);

  // Button is disabled while loading or when required props are missing
  const disabled = loading || !templateCode || (!recordId && !data);

  const handleClick = useCallback(() => {
    if (disabled) return;
    download({ templateCode, recordId, recordType, data });
  }, [disabled, download, templateCode, recordId, recordType, data]);

  const showSuccess = state === 'success';

  const icon = showSuccess
    ? <CheckCircleIcon color="success" fontSize="small" />
    : loading
      ? <CircularProgress size={18} color="inherit" />
      : <DownloadIcon fontSize="small" />;

  const tooltipTitle = loading
    ? 'Generando PDF…'
    : showSuccess
      ? 'PDF descargado'
      : 'Descargar PDF';

  const showError = state === 'error' && error;

  // ── Snackbar for error feedback ──
  const errorSnackbar = (
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
  );

  if (variant === 'icon') {
    return (
      <>
        <Tooltip title={tooltipTitle}>
          <span>
            <IconButton
              onClick={handleClick}
              disabled={disabled}
              size={size}
              color="primary"
              aria-label="Descargar PDF"
            >
              {icon}
            </IconButton>
          </span>
        </Tooltip>
        {errorSnackbar}
      </>
    );
  }

  // ── Text variant button ──
  return (
    <>
      <Button
        onClick={handleClick}
        disabled={disabled}
        variant="contained"
        size={size}
        startIcon={icon}
        color={showSuccess ? 'success' : 'primary'}
      >
        {loading ? 'Generando…' : showSuccess ? 'Descargado' : 'Descargar PDF'}
      </Button>
      {errorSnackbar}
    </>
  );
}
