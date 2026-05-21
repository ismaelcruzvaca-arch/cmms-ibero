import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import { useWorkOrders } from '../hooks/useWorkOrders';
import { toViewModelList } from '../lib/adapters/workOrderAdapter.js';
import { NavSyncIndicator } from '../components/SyncStatusIndicator.jsx';
import WorkOrderList from '../components/mechanic/WorkOrderList.jsx';

export default function MechanicDashboard() {
  const { workOrders, loading, error, syncStatus } = useWorkOrders({
    lifecycleFilter: ['WAPPR', 'APPROVED']
  });

  const viewModels = toViewModelList(workOrders);

  const handleSelect = (id) => {
    console.log('[MechanicDashboard] Work order selected:', id);
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        Error al cargar órdenes de trabajo: {error.message}
      </Alert>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight="700">
          Órdenes de Trabajo
        </Typography>
        <NavSyncIndicator status={syncStatus} />
      </Box>
      <WorkOrderList workOrders={viewModels} onSelect={handleSelect} />
    </Box>
  );
}
