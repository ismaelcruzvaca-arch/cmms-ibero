/**
 * QRScannerModal — Escáner de códigos QR / barras vía cámara
 *
 * Usa html5-qrcode (zxing) para detectar códigos en tiempo real.
 * - Maneja permisos de cámara denegados / no disponibles
 * - Limpia el recurso de video al cerrar (nunca deja la cámara encendida)
 * - Se cierra automáticamente al detectar un código válido
 * - Botón de reintentar sin cerrar el modal
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  Typography,
  IconButton,
  CircularProgress,
  Button,
  SvgIcon,
} from '@mui/material';

// ─── Iconos (patrón del proyecto: inline SvgIcon) ──────────────────────

function CloseIcon(props) {
  return (
    <SvgIcon {...props}>
      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
    </SvgIcon>
  );
}

const SCANNER_ID = 'qr-scanner-viewfinder';

export default function QRScannerModal({ open, onClose, onScan }) {
  // Ref para evitar closures stale sin depender de props en efectos
  const onScanRef = useRef(onScan);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onScanRef.current = onScan;
    onCloseRef.current = onClose;
  });

  // scanKey permite reiniciar el escáner sin cerrar el modal (retry)
  const [scanKey, setScanKey] = useState(0);
  const [status, setStatus] = useState('idle'); // idle | starting | scanning | error
  const [errorMessage, setErrorMessage] = useState('');

  // ─── Limpieza del escáner ──────────────────────────────────────────
  const stopScanner = useCallback(async () => {
    // eslint-disable-next-line no-use-before-define
    const inst = scannerInstanceRef.current;
    if (!inst) return;
    try {
      await inst.stop();
    } catch (_) { /* ignore */ }
    try {
      await inst.clear();
    } catch (_) { /* ignore */ }
    scannerInstanceRef.current = null;
  }, []);

  const scannerInstanceRef = useRef(null);

  // ─── Arrancar el escáner ───────────────────────────────────────────
  const startScanner = useCallback(async () => {
    const element = document.getElementById(SCANNER_ID);
    if (!element) {
      setStatus('error');
      setErrorMessage('Error interno: no se pudo renderizar el visor.');
      return;
    }

    setStatus('starting');

    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      const scanner = new Html5Qrcode(element);
      scannerInstanceRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 260, height: 260 } },
        (decodedText) => {
          // Código detectado → detener y notificar
          stopScanner().then(() => {
            onScanRef.current?.(decodedText);
            onCloseRef.current?.();
          });
        },
        () => {} // Ignorar errores por frame
      );

      setStatus('scanning');
    } catch (err) {
      const msg = String(err?.message || err || '');
      setStatus('error');

      if (msg.includes('NotAllowed') || msg.includes('Permission')) {
        setErrorMessage(
          'Permiso de cámara denegado. Habilitalo en la configuración del navegador e intentá de nuevo.'
        );
      } else if (msg.includes('NotFound') || msg.includes('not found')) {
        setErrorMessage('No se encontró una cámara en este dispositivo.');
      } else {
        setErrorMessage(`Error al iniciar la cámara: ${msg || 'desconocido'}`);
      }
    }
  }, [stopScanner]);

  // ─── Efecto principal: abrir / reiniciar escáner ────────────────────
  useEffect(() => {
    if (!open) {
      stopScanner();
      setStatus('idle');
      setErrorMessage('');
      return;
    }

    const timer = setTimeout(() => {
      // Arrancar el escáner con un pequeño delay para que el DOM esté listo
      startScanner();
    }, 350);

    return () => {
      clearTimeout(timer);
      stopScanner();
    };
  }, [open, scanKey, startScanner, stopScanner]);

  // ─── Handlers ──────────────────────────────────────────────────────
  const handleClose = () => {
    stopScanner();
    setStatus('idle');
    setErrorMessage('');
    onClose();
  };

  const handleRetry = () => {
    setScanKey((k) => k + 1);
  };

  // ─── Render ───────────────────────────────────────────────────────
  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{ sx: { borderRadius: 3 } }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          px: 3,
          pt: 2.5,
          pb: 1.5,
        }}
      >
        <Typography variant="h6" component="span" fontWeight="700" color="primary.main">
          Escanear código
        </Typography>
        <IconButton onClick={handleClose} size="small" aria-label="Cerrar escáner">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ px: 3, pb: 3, minHeight: 320 }}>
        {/* Iniciando / preparando */}
        {(status === 'idle' || status === 'starting') && (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              py: 6,
              gap: 2,
            }}
          >
            <CircularProgress size={48} />
            <Typography variant="body1" color="text.secondary">
              {status === 'starting' ? 'Iniciando cámara…' : 'Preparando escáner…'}
            </Typography>
            <Typography variant="caption" color="text.disabled" sx={{ textAlign: 'center', maxWidth: 280 }}>
              Asegurate de haber concedido permiso de cámara a la aplicación.
            </Typography>
          </Box>
        )}

        {/* Escaneando — visor de video */}
        {status === 'scanning' && (
          <Box
            sx={{
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
            }}
          >
            <Box
              id={SCANNER_ID}
              sx={{
                width: '100%',
                maxWidth: 380,
                borderRadius: 2,
                overflow: 'hidden',
                '& video': { borderRadius: 2, objectFit: 'cover' },
              }}
            />
            <Typography variant="caption" color="text.disabled">
              Apuntá la cámara al código QR o de barras del equipo
            </Typography>
          </Box>
        )}

        {/* Error */}
        {status === 'error' && (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              py: 4,
              gap: 2,
            }}
          >
            <Typography variant="body1" color="error" sx={{ textAlign: 'center' }}>
              {errorMessage}
            </Typography>
            <Button variant="outlined" onClick={handleRetry}>
              Reintentar
            </Button>
          </Box>
        )}

        {/* 🧪 Botón de test — simula un escaneo sin cámara (solo dev) */}
        <Box sx={{ mt: 3, pt: 2, borderTop: '1px dashed #e0e0e0', textAlign: 'center' }}>
          <Button
            size="small"
            variant="text"
            color="secondary"
            onClick={() => {
              const testCode = 'TOS-MOT-017';
              stopScanner().then(() => {
                onScanRef.current?.(testCode);
                onCloseRef.current?.();
              });
            }}
          >
            🧪 TEST: Simular Escaneo (TOS-MOT-017)
          </Button>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
