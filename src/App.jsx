import React from 'react';
import { Container, Typography, Box } from '@mui/material';
import AssetTree from './AssetTree';

function App() {
  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box sx={{ mb: 4, textAlign: 'center' }}>
        <Typography variant="h3" component="h1" gutterBottom color="primary.main" fontWeight="bold">
          CMMS Ibero
        </Typography>
        <Typography variant="subtitle1" color="text.secondary">
          Módulo de Jerarquía de Activos
        </Typography>
      </Box>

      {/* Aquí renderizamos el componente que acabamos de crear */}
      <AssetTree />
    </Container>
  );
}

export default App;