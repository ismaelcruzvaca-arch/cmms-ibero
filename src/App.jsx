import { useState, useCallback } from 'react';
import {
  Box, AppBar, Toolbar, Typography, Paper, Grid, Snackbar, Alert, Tabs, Tab
} from '@mui/material';
import AssetTree from './components/AssetTree';
import { NavSyncIndicator } from './components/SyncStatusIndicator';
import { useWorkOrders } from './hooks/useWorkOrders';
import { useAssets } from './lib/rxdb';
import { AssetSearchBar } from './components/AssetSearchBar';
import { AssetDetailsPanel } from './components/AssetDetailsPanel';
import QRScannerModal from './components/QRScannerModal';
import MechanicDashboard from './pages/MechanicDashboard.jsx';
import './App.css';

function App() {
  const { loading, syncStatus, error } = useWorkOrders();
  const { assets } = useAssets();
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(0);

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
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>

      {/* ── AppBar ── */}
      <AppBar position="sticky" top={0} elevation={0} sx={{ zIndex: 1200 }}>
        <Toolbar sx={{ justifyContent: 'space-between', px: { xs: 2, md: 4 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography
              variant="h6"
              fontWeight="800"
              sx={{ letterSpacing: 0.5, fontSize: { xs: '1rem', md: '1.2rem' } }}
            >
              CMMS Ibero
            </Typography>
            <Typography
              variant="caption"
              sx={{
                opacity: 0.7,
                display: { xs: 'none', md: 'block' },
                borderLeft: 1,
                borderColor: 'divider',
                pl: 1.5,
              }}
            >
              Módulo de Órdenes y Activos
            </Typography>
          </Box>

          {loading ? (
            <Typography variant="body2" sx={{ opacity: 0.7 }}>
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

        {/* Tabs: Órdenes de Trabajo / Activos */}
        <Tabs
          value={activeTab}
          onChange={(e, v) => setActiveTab(v)}
          sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab label="Órdenes de Trabajo" />
          <Tab label="Activos" />
        </Tabs>

        {activeTab === 0 ? (
          <Paper variant="outlined" sx={{ p: 3 }}>
            <MechanicDashboard />
          </Paper>
        ) : (
          <Grid container spacing={3} alignItems="flex-start">

            {/* Columna principal: Árbol de activos */}
            <Grid size={{ xs: 12, md: 8, lg: 9 }}>
              <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
                <AssetTree onSelectAsset={handleSelectAsset} />
              </Paper>
            </Grid>

            {/* Columna lateral: Estadísticas / ayuda rápida en desktop */}
            <Grid size={{ xs: 12, md: 4, lg: 3 }}>
              <Paper variant="outlined" sx={{ p: 3 }}>
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

                <Box sx={{ mt: 3, pt: 2, borderTop: 1, borderColor: 'divider' }}>
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
        )}
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