import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

const dotBase = {
  display: 'inline-block',
  width: 10,
  height: 10,
  borderRadius: '50%',
  mr: 0.75
};

const keyframes = `
@keyframes pulse {
  0% { opacity: 0.4; transform: scale(0.9); }
  50% { opacity: 1; transform: scale(1.2); }
  100% { opacity: 0.4; transform: scale(0.9); }
}
`;

const styles = {
  online: { bgcolor: '#2e7d32' },
  syncing: { bgcolor: '#1565c0', animation: 'pulse 1.2s ease-in-out infinite' },
  offline: { bgcolor: '#d32f2f' }
};

const labels = {
  online: 'En línea',
  syncing: 'Sincronizando',
  offline: 'Sin conexión'
};

export function NavSyncIndicator({ status = 'online' }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center' }}>
      <style>{keyframes}</style>
      <Box sx={{ ...dotBase, ...styles[status] }} />
      <Typography variant="body2" sx={{ color: 'white', opacity: 0.9 }}>
        {labels[status]}
      </Typography>
    </Box>
  );
}
