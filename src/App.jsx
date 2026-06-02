import { useState, useCallback, useEffect } from 'react';
import {
  Box, AppBar, Toolbar, Typography, Paper, Grid, Snackbar, Alert, Tabs, Tab, Badge
} from '@mui/material';
import AssetTree from './components/AssetTree';
import { NavSyncIndicator } from './components/SyncStatusIndicator';
import { useWorkOrders } from './hooks/useWorkOrders';
import { useAssets, useRxDB } from './lib/rxdb';
import { AssetSearchBar } from './components/AssetSearchBar';
import { AssetDetailsPanel } from './components/AssetDetailsPanel';
import QRScannerModal from './components/QRScannerModal';
import MechanicDashboard from './pages/MechanicDashboard.jsx';
import PlannerBandeja from './components/fmea/PlannerBandeja.jsx';
import ConditionCapture from './components/condition/ConditionCapture.jsx';
import CsvImportForm from './components/condition/CsvImportForm.jsx';
import SourceManagementPanel from './components/condition/SourceManagementPanel.jsx';
import DeadLetterPanel from './components/condition/DeadLetterPanel.jsx';
import TrendChart from './components/condition/charts/TrendChart.jsx';
import DiagnosisPanel from './components/condition/DiagnosisPanel.jsx';
import RulGauge from './components/condition/RulGauge.jsx';
import RecommendationCard from './components/condition/RecommendationCard.jsx';
import { supabase } from './lib/supabaseClient';
import './App.css';

function App() {
  const { loading, syncStatus, error } = useWorkOrders();
  const { assets } = useAssets();
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [conditionSubTab, setConditionSubTab] = useState(0);

  // Índice dinámico del tab "Monitoreo de Condición" (varía según rol)
  const monitoringTabIndex = (userRole === 'PLANNER' || userRole === 'ADMIN') ? 3 : 2;

  // ─── Auth / Rol ─────────────────────────────────────────────────────
  const [userRole, setUserRole] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const { db } = useRxDB();

  // Obtener rol del usuario desde user_profiles
  useEffect(() => {
    let cancelled = false;

    const getRole = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) {
          const { data } = await supabase
            .from('user_profiles')
            .select('role')
            .eq('id', session.user.id)
            .single();
          if (!cancelled && data?.role) {
            setUserRole(data.role);
          }
        }
      } catch (err) {
        console.warn('[App] Error obteniendo rol:', err);
      }
    };

    getRole();
    return () => { cancelled = true; };
  }, []);

  // Suscripción reactiva al contador de análisis pendientes
  useEffect(() => {
    if (!db) return;

    const sub = db.fmea_rcm_analysis.find({
      selector: { _deleted: false }
    }).$.subscribe({
      next: (docs) => {
        try {
          const pending = docs.filter((d) => !d.get('recommended_strategy'));
          setPendingCount(pending.length);
        } catch (e) {
          // ignorar
        }
      },
      error: () => {
        // ignorar — el badge se queda en 0
      }
    });

    return () => sub.unsubscribe();
  }, [db]);

  // Escuchar evento personalizado de PlannerBandeja para ir a un activo
  useEffect(() => {
    const handler = (e) => {
      const { assetId } = e.detail;
      if (assetId) {
        setActiveTab(1); // Ir a la pestaña Activos
        const found = assets.find((a) => a.id === assetId);
        if (found) {
          setSelectedAsset(found);
          setDrawerOpen(true);
        }
      }
    };
    window.addEventListener('fmea:select-asset', handler);
    return () => window.removeEventListener('fmea:select-asset', handler);
  }, [assets]);

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

        {/* Tabs: Órdenes de Trabajo / Activos / Bandeja */}
        <Tabs
          value={activeTab}
          onChange={(e, v) => setActiveTab(v)}
          sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab label="Órdenes de Trabajo" />
          <Tab label="Activos" />
          {(userRole === 'PLANNER' || userRole === 'ADMIN') && (
            <Tab
              label={
                <Badge
                  badgeContent={pendingCount}
                  color="error"
                  invisible={pendingCount === 0}
                  sx={{ '& .MuiBadge-badge': { fontSize: 10, height: 18, minWidth: 18 } }}
                >
                  Bandeja FMEA
                </Badge>
              }
            />
          )}
          {(userRole === 'TECHNICIAN' || userRole === 'PLANNER' || userRole === 'ADMIN') && (
            <Tab label="Monitoreo de Condición" />
          )}
        </Tabs>

        {(() => {
          if (activeTab === 0) {
            return (
              <Paper variant="outlined" sx={{ p: 3 }}>
                <MechanicDashboard />
              </Paper>
            );
          }
          if (activeTab === 1) {
            return (
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
            );
          }
          if (activeTab === 2 && (userRole === 'PLANNER' || userRole === 'ADMIN')) {
            return (
              <Paper variant="outlined" sx={{ p: 3 }}>
                <PlannerBandeja />
              </Paper>
            );
          }
          if (activeTab === monitoringTabIndex) {
            return (
              <Box>
                <Tabs
                  value={conditionSubTab}
                  onChange={(e, v) => setConditionSubTab(v)}
                  sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
                >
                  <Tab label="Captura" />
                  {(userRole === 'PLANNER' || userRole === 'ADMIN') && <Tab label="CSV" />}
                  <Tab label="Fuentes" />
                  {(userRole === 'PLANNER' || userRole === 'ADMIN') && <Tab label="Dead-Letter" />}
                  <Tab label="Tendencias" />
                  <Tab label="Diagnóstico" />
                </Tabs>
                {(() => {
                  // Computar índice real basado en visibilidad condicional
                  let tradIdx = -1;
                  let csvIdx = -1;
                  let fuentesIdx = -1;
                  let deadIdx = -1;
                  let diagIdx = -1;

                  if (userRole === 'PLANNER' || userRole === 'ADMIN') {
                    // Captura=0, CSV=1, Fuentes=2, Dead-Letter=3, Tendencias=4, Diagnóstico=5
                    csvIdx = 1;
                    fuentesIdx = 2;
                    deadIdx = 3;
                    tradIdx = 4;
                    diagIdx = 5;
                  } else {
                    // Captura=0, Fuentes=1, Tendencias=2, Diagnóstico=3
                    fuentesIdx = 1;
                    tradIdx = 2;
                    diagIdx = 3;
                  }

                  if (conditionSubTab === diagIdx && diagIdx !== -1) {
                    return (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <RulGauge assetId={selectedAsset?.id || null} />
                        <DiagnosisPanel assetId={selectedAsset?.id || null} />
                        <RecommendationCard assetId={selectedAsset?.id || null} />
                      </Box>
                    );
                  }
                  if (conditionSubTab === tradIdx && tradIdx !== -1) {
                    return (
                      <Box>
                        <TrendChart
                          assetId={selectedAsset?.id || null}
                          featureKey={null}
                        />
                      </Box>
                    );
                  }
                  if (conditionSubTab === fuentesIdx) return <SourceManagementPanel />;
                  if (conditionSubTab === csvIdx && csvIdx !== -1) return <CsvImportForm />;
                  if (conditionSubTab === deadIdx && deadIdx !== -1) return <DeadLetterPanel />;
                  return <ConditionCapture />;
                })()}
              </Box>
            );
          }
          return (
            <Grid container spacing={3} alignItems="flex-start">
              <Grid size={{ xs: 12, md: 8, lg: 9 }}>
                <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
                  <AssetTree onSelectAsset={handleSelectAsset} />
                </Paper>
              </Grid>
            </Grid>
          );
        })()}
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