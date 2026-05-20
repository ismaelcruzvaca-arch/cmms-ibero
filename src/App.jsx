import React, { useState, useCallback } from 'react';
import {
  Box, AppBar, Toolbar, Typography, Paper, Grid, Snackbar, Alert
} from '@mui/material';
import AssetTree from './components/AssetTree';
import { NavSyncIndicator } from './components/SyncStatusIndicator';
import { useWorkOrders } from './hooks/useWorkOrders';
import { useAssets } from './lib/rxdb';
import { AssetSearchBar } from './components/AssetSearchBar';
import { AssetDetailsPanel } from './components/AssetDetailsPanel';
import QRScannerModal from './components/QRScannerModal';
import './App.css';

function App() {
  const { loading, syncStatus, error } = useWorkOrders();
  const { assets } = useAssets();
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // ─── Escáner QR ────────────────────────────────────────────────────
  const [scannerOpen, setScannerOpen] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'warning' });

  const handleOpenScanner = () => setScannerOpen(true);
  const handleCloseScanner = () => setScannerOpen(false);

  const handleScanResult = useCallback((code) => {
    const trimmed = code.trim().toUpperCase();
    const found = assets.find((a) => a.equipment_id?.toUpperCase() === trimmed);

    if (found) {
      setSelectedAsset(found);
      setDrawerOpen(true);
    } else {
      setSnackbar({
        open: true,
        message: `No se encontró un activo con código: ${code}`,
        severity: 'warning',
      });
    }
  }, [assets]);

  const handleSelectAsset = (asset) => {
    setSelectedAsset(asset);
    setDrawerOpen(true);
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f4f6f8', display: 'flex', flexDirection: 'column' }}>

      {/* ── AppBar ── */}
      <AppBar
        position="sticky"
        top={0}
        elevation={0}
        sx={{
          background: 'linear-gradient(90deg, #1565c0 0%, #1976d2 100%)',
          borderBottom: '1px solid rgba(255,255,255,0.12)',
          zIndex: 1200,
        }}
      >
        <Toolbar sx={{ justifyContent: 'space-between', px: { xs: 2, md: 4 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography
              variant="h6"
              fontWeight="800"
              sx={{ letterSpacing: 0.5, color: 'white', fontSize: { xs: '1rem', md: '1.2rem' } }}
            >
              CMMS Ibero
            </Typography>
            <Typography
              variant="caption"
              sx={{
                color: 'rgba(255,255,255,0.6)',
                display: { xs: 'none', md: 'block' },
                borderLeft: '1px solid rgba(255,255,255,0.3)',
                pl: 1.5,
              }}
            >
              Módulo de Jerarquía de Activos
            </Typography>
          </Box>

          {loading ? (
            <Typography variant="body2" sx={{ opacity: 0.7, color: 'white' }}>
              Cargando…
            </Typography>
          ) : error ? (
            <NavSyncIndicator status="offline" />
          ) : (
            <NavSyncIndicator status={syncStatus} />
          )}
        </Toolbar>
      </AppBar>

      {/* ── Contenido principal ── */}
      <Box sx={{ flex: 1, px: { xs: 2, sm: 3, md: 4, lg: 6 }, py: { xs: 2, md: 3 } }}>

        {/* Barra de búsqueda — ancho completo */}
        <Box sx={{ mb: 3 }}>
          <AssetSearchBar onSelectAsset={handleSelectAsset} onOpenScanner={handleOpenScanner} />
        </Box>

        {/* Layout de dos columnas en desktop */}
        <Grid container spacing={3} alignItems="flex-start">

          {/* Columna principal: Árbol de activos */}
          <Grid size={{ xs: 12, md: 8, lg: 9 }}>
            <Paper
              elevation={0}
              sx={{
                borderRadius: 3,
                border: '1px solid #e0e0e0',
                bgcolor: 'white',
                overflow: 'hidden',
              }}
            >
              <AssetTree onSelectAsset={handleSelectAsset} />
            </Paper>
          </Grid>

          {/* Columna lateral: Estadísticas / ayuda rápida en desktop */}
          <Grid size={{ xs: 12, md: 4, lg: 3 }}>
            <Paper
              elevation={0}
              sx={{
                borderRadius: 3,
                border: '1px solid #e0e0e0',
                bgcolor: 'white',
                p: 3,
              }}
            >
              <Typography variant="subtitle2" fontWeight="700" color="primary.main" gutterBottom>
                💡 Cómo navegar
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, lineHeight: 1.7 }}>
                Usá el <strong>buscador</strong> para localizar un equipo por su ID (ej. <code>TOS-MOT</code>) o por descripción.
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, lineHeight: 1.7 }}>
                Hacé clic en cualquier nodo del árbol para expandir su jerarquía de equipos.
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>
                Al seleccionar un equipo, se abre el <strong>panel de detalles</strong> con sus especificaciones técnicas.
              </Typography>

              <Box sx={{ mt: 3, pt: 2, borderTop: '1px solid #f0f0f0' }}>
                <Typography variant="caption" color="text.disabled" display="block" sx={{ mb: 0.5 }}>
                  Base de datos
                </Typography>
                <Typography variant="body2" fontWeight="600" color="text.primary">
                  535 equipos indexados
                </Typography>
                <Typography variant="caption" color="text.disabled">
                  Sincronizado desde Epicor vía Supabase
                </Typography>
              </Box>
            </Paper>
          </Grid>

        </Grid>
      </Box>

      {/* Panel lateral de detalles */}
      <AssetDetailsPanel
        asset={selectedAsset}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />

      {/* Escáner QR / código de barras */}
      <QRScannerModal
        open={scannerOpen}
        onClose={handleCloseScanner}
        onScan={handleScanResult}
      />

      {/* Snackbar para errores de escaneo */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={5000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackbar.severity} variant="filled" sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}

export default App;