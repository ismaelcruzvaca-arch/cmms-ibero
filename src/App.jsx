import React, { useState } from 'react';
import { Container, Typography, Box, AppBar, Toolbar, Button, Dialog, DialogTitle, DialogContent } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AssetTree from './components/AssetTree';
import AddAssetForm from './components/AddAssetForm';
import AssetDetailsPanel from './components/AssetDetailsPanel';
import { NavSyncIndicator } from './components/SyncStatusIndicator';
import { useWorkOrders } from './hooks/useWorkOrders';

function App() {
  const { loading, syncStatus, error } = useWorkOrders();
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const handleAssetClick = (asset) => {
    setSelectedAsset(asset);
    setDrawerOpen(true);
  };

  const handleCloseDrawer = () => {
    setDrawerOpen(false);
  };

  const handleFormOpen = () => setFormOpen(true);
  const handleFormClose = () => setFormOpen(false);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'grey.50' }}>
      {/* Barra de navegación con indicador de sincronización */}
      <AppBar position="static" color="primary" elevation={1}>
        <Toolbar sx={{ justifyContent: 'space-between' }}>
          <Typography variant="h6" fontWeight="bold">
            CMMS Ibero
          </Typography>
          {loading ? (
            <Typography variant="body2" sx={{ opacity: 0.8 }}>
              Cargando...
            </Typography>
          ) : error ? (
            <NavSyncIndicator status="offline" />
          ) : (
            <NavSyncIndicator status={syncStatus} />
          )}
        </Toolbar>
      </AppBar>

      <Container maxWidth="md" sx={{ py: 4 }}>
        <Box sx={{ mb: 4, textAlign: 'center' }}>
          <Typography variant="h3" component="h1" gutterBottom color="primary.main" fontWeight="bold">
            Módulo de Jerarquía de Activos
          </Typography>
          <Typography variant="subtitle1" color="text.secondary">
            Sistema de Gestión de Mantenimiento
          </Typography>
        </Box>

        {/* Botón de creación de activo + árbol */}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleFormOpen}
            size="large"
          >
            + Nuevo Activo
          </Button>
        </Box>

        {/* Componente de árbol de activos (RxDB offline-first) */}
        <AssetTree onAssetClick={handleAssetClick} />
      </Container>

      {/* Modal de creación de activos */}
      <Dialog open={formOpen} onClose={handleFormClose} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>Nuevo Activo</DialogTitle>
        <DialogContent dividers>
          <AddAssetForm onSuccess={handleFormClose} />
        </DialogContent>
      </Dialog>

      {/* Panel lateral de detalles */}
      <AssetDetailsPanel
        asset={selectedAsset}
        open={drawerOpen}
        onClose={handleCloseDrawer}
      />
    </Box>
  );
}

export default App;