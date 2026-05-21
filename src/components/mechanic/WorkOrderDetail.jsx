import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import WorkOrderStatusBadge from './WorkOrderStatusBadge.jsx';

const criticalityBorders = {
  error: '#d32f2f',
  warning: '#f57c00',
  success: '#388e3c'
};

export default function WorkOrderDetail({ workOrder }) {
  const borderColor = criticalityBorders[workOrder.criticalityColor] || 'transparent';

  return (
    <Box sx={{ borderLeft: `4px solid ${borderColor}`, pl: 2, mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography variant="h6" fontWeight="700">
          {workOrder.equipmentId}
        </Typography>
        <WorkOrderStatusBadge phase={workOrder.lifecyclePhase} size="small" />
      </Box>

      <Typography variant="body1" sx={{ mb: 1.5, whiteSpace: 'pre-wrap' }}>
        {workOrder.description}
      </Typography>

      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="caption" color="text.disabled" display="block">
            Prioridad
          </Typography>
          <Typography variant="body2" fontWeight="600">
            {workOrder.priority}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.disabled" display="block">
            Tipo
          </Typography>
          <Typography variant="body2" fontWeight="600">
            {workOrder.woType}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.disabled" display="block">
            Horas Planificadas
          </Typography>
          <Typography variant="body2" fontWeight="600">
            {workOrder.plannedHours}
          </Typography>
        </Box>
        {workOrder.scheduledDate && (
          <Box>
            <Typography variant="caption" color="text.disabled" display="block">
              Programado
            </Typography>
            <Typography variant="body2" fontWeight="600">
              {workOrder.scheduledDate}
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
