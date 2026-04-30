import React from 'react';
import { Container, Typography, Box, AppBar, Toolbar } from '@mui/material';
import AssetTree from './AssetTree';
import { NavSyncIndicator } from './components/SyncStatusIndicator';
import { useWorkOrders } from './hooks/useWorkOrders';

function App() {
  const { loading, syncStatus, error } = useWorkOrders();

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

        {/* Componente de árbol de activos */}
        <AssetTree />
      </Container>
    </Box>
  );
}

export default App;