/**
 * HtmlReportPreview.jsx
 * Modal de previsualización de reportes HTML con soporte para impresión.
 *
 * Props: { html, loading, error, empty, templateName, onPrint, onClose }
 *
 * Estados:
 * - loading: CircularProgress centrado
 * - error: Alert severity="error"
 * - empty: Alert severity="info" + mensaje de template por defecto
 * - success: iframe con srcdoc + botones Imprimir / Cerrar
 */
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import PrintIcon from '@mui/icons-material/Print';
import CloseIcon from '@mui/icons-material/Close';

/**
 * @param {Object} props
 * @param {string|null} props.html - HTML renderizado del reporte
 * @param {boolean} props.loading - true mientras se renderiza
 * @param {string|null} props.error - mensaje de error
 * @param {boolean} props.empty - true si se usó template por defecto
 * @param {string|null} props.templateName - nombre del template usado
 * @param {() => void} props.onPrint - callback de impresión
 * @param {() => void} props.onClose - callback para cerrar el modal
 */
export default function HtmlReportPreview({
  html,
  loading,
  error,
  empty,
  templateName,
  onPrint,
  onClose,
}) {
  const hasContent = !loading && !error;

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="md"
      fullScreen={false}
      slotProps={{
        backdrop: { sx: { backgroundColor: 'rgba(0,0,0,0.5)' } },
      }}
      sx={{
        // Fullscreen en mobile, tamaño fijo en desktop
        '& .MuiDialog-paper': {
          width: { xs: '100%', sm: 720 },
          height: { xs: '100%', sm: 'auto' },
          maxHeight: { xs: '100%', sm: '90vh' },
          m: { xs: 0, sm: 2 },
          borderRadius: { xs: 0, sm: 1 },
        },
      }}
    >
      {/* ── Header ── */}
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <PrintIcon color="primary" />
        <Typography variant="h6" component="span" fontWeight="700" sx={{ flex: 1 }}>
          {templateName ? `Vista previa — ${templateName}` : 'Vista previa'}
        </Typography>
        <IconButton onClick={onClose} size="small" aria-label="Cerrar">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      {/* ── Content ── */}
      <DialogContent dividers sx={{ p: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Loading */}
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        )}

        {/* Error */}
        {error && !loading && (
          <Box sx={{ p: 3 }}>
            <Alert severity="error" onClose={onClose}>
              {error}
            </Alert>
          </Box>
        )}

        {/* Empty — template por defecto */}
        {empty && !loading && !error && (
          <Box sx={{ p: 3 }}>
            <Alert severity="info" sx={{ mb: 2 }}>
              No hay template activo. Usando formato por defecto.
            </Alert>
            {html && (
              <Box
                component="iframe"
                title="Vista previa del reporte"
                srcDoc={html}
                sx={{
                  width: '100%',
                  height: '70vh',
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                }}
              />
            )}
          </Box>
        )}

        {/* Success — iframe con el HTML */}
        {!loading && !error && !empty && html && (
          <Box
            component="iframe"
            title="Vista previa del reporte"
            srcDoc={html}
            sx={{
              width: '100%',
              height: '70vh',
              border: 'none',
              flex: 1,
            }}
          />
        )}
      </DialogContent>

      {/* ── Actions ── */}
      {hasContent && html && (
        <DialogActions sx={{ px: 3, py: 2 }}>
          {empty && (
            <Typography variant="caption" color="text.secondary" sx={{ mr: 'auto' }}>
              Template por defecto — sin personalizar
            </Typography>
          )}
          <Button onClick={onClose} color="inherit">
            Cerrar
          </Button>
          <Button
            variant="contained"
            color="primary"
            startIcon={<PrintIcon />}
            onClick={onPrint}
          >
            Imprimir
          </Button>
        </DialogActions>
      )}
    </Dialog>
  );
}
