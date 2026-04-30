/**
 * Indicador de estado de sincronización RxDB
 * Muestra estado de conexión en la interfaz
 */
import React from 'react';
import { Box, Chip, Tooltip } from '@mui/material';

const statusConfig = {
  online: {
    label: 'Online',
    color: 'success',
    icon: '🟢'
  },
  syncing: {
    label: 'Sincronizando',
    color: 'warning',
    icon: '🟡'
  },
  offline: {
    label: 'Offline',
    color: 'error',
    icon: '🔴'
  }
};

export function SyncStatusIndicator({ status = 'offline' }) {
  const config = statusConfig[status] || statusConfig.offline;

  return (
    <Tooltip title={`Estado de sincronización: ${config.label}`}>
      <Chip
        label={`${config.icon} ${config.label}`}
        color={config.color}
        size="small"
        variant="outlined"
        sx={{
          fontWeight: 500,
          fontSize: '0.75rem',
          '& .MuiChip-icon': {
            fontSize: '0.9rem'
          }
        }}
      />
    </Tooltip>
  );
}

// Componente para barra de navegación
export function NavSyncIndicator({ status = 'offline' }) {
  const config = statusConfig[status] || statusConfig.offline;

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 2,
        py: 0.5,
        borderRadius: 1,
        bgcolor: status === 'online' ? 'success.light' 
          : status === 'syncing' ? 'warning.light' 
          : 'error.light',
        color: status === 'online' ? 'success.dark' 
          : status === 'syncing' ? 'warning.dark' 
          : 'error.dark',
        fontSize: '0.8rem',
        fontWeight: 500
      }}
    >
      <span>{config.icon}</span>
      <span>{config.label}</span>
    </Box>
  );
}

export default SyncStatusIndicator;