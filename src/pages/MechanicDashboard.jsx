import { useState, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import { useWorkOrders } from '../hooks/useWorkOrders';
import { useLaborRecords } from '../hooks/useLaborRecords';
import { toViewModelList } from '../lib/adapters/workOrderAdapter.js';
import { supabase } from '../lib/supabaseClient.js';
import { NavSyncIndicator } from '../components/SyncStatusIndicator.jsx';
import WorkOrderList from '../components/mechanic/WorkOrderList.jsx';
import WorkOrderDrawer from '../components/mechanic/WorkOrderDrawer.jsx';

export default function MechanicDashboard() {
  const { workOrders, loading, error, syncStatus, updateWorkOrder } = useWorkOrders({
    lifecycleFilter: ['WAPPR', 'APPROVED']
  });

  const viewModels = toViewModelList(workOrders);

  // Drawer state
  const [selectedWorkOrder, setSelectedWorkOrder] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleSelect = useCallback((id) => {
    const found = viewModels.find(vm => vm.id === id);
    if (found) {
      setSelectedWorkOrder(found);
      setDrawerOpen(true);
    }
  }, [viewModels]);

  const handleCloseDrawer = useCallback(() => {
    setDrawerOpen(false);
  }, []);

  const handleTransition = useCallback(async (id, updates) => {
    return await updateWorkOrder(id, updates);
  }, [updateWorkOrder]);

  // ── Obtener userId de la sesión ──
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.id) {
        setUserId(session.user.id);
      }
    });
  }, []);

  // ── Labor records para el WO seleccionado ──
  const laborState = useLaborRecords({
    workOrderId: selectedWorkOrder?.id,
    userId
  });

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

      {selectedWorkOrder && (
        <WorkOrderDrawer
          workOrder={selectedWorkOrder}
          open={drawerOpen}
          onClose={handleCloseDrawer}
          onTransition={handleTransition}
          laborState={laborState}
        />
      )}
    </Box>
  );
}
