import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import WorkOrderCard from './WorkOrderCard.jsx';

export default function WorkOrderList({ workOrders, onSelect }) {
  if (!workOrders || workOrders.length === 0) {
    return (
      <Box sx={{ py: 4, textAlign: 'center' }}>
        <Typography variant="body1" color="text.disabled">
          No hay órdenes de trabajo pendientes
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {workOrders.map(wo => (
        <WorkOrderCard key={wo.id} workOrder={wo} onSelect={onSelect} />
      ))}
    </Box>
  );
}
