import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Chip from '@mui/material/Chip';
import WorkOrderStatusBadge from './WorkOrderStatusBadge.jsx';

export default function WorkOrderCard({ workOrder, onSelect }) {
  const borderColor = workOrder.criticalityColor === 'error'
    ? '#d32f2f'
    : workOrder.criticalityColor === 'warning'
    ? '#f57c00'
    : workOrder.criticalityColor === 'success'
    ? '#388e3c'
    : 'transparent';

  return (
    <Card
      onClick={() => onSelect?.(workOrder.id)}
      sx={{
        cursor: 'pointer',
        borderLeft: `4px solid ${borderColor}`,
        border: workOrder.hasConflict ? '1px solid #ffd54f' : '1px solid #e0e0e0',
        borderLeftWidth: workOrder.hasConflict ? '4px' : '4px',
        bgcolor: workOrder.hasConflict ? '#fffde7' : 'white',
        transition: 'box-shadow 0.2s',
        '&:hover': { boxShadow: 2 },
        borderRadius: 2,
        mb: 1
      }}
    >
      <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle2" fontWeight="700" noWrap>
              {workOrder.equipmentId}
            </Typography>
            <WorkOrderStatusBadge phase={workOrder.lifecyclePhase} size="small" />
            {workOrder.hasConflict && (
              <Tooltip title="Conflicto de sincronización">
                <Chip label="!" size="small" color="warning" variant="outlined" sx={{ fontWeight: 700, minWidth: 24, height: 24 }} />
              </Tooltip>
            )}
          </Box>
        </Box>

        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            mb: 0.5,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden'
          }}
        >
          {workOrder.description}
        </Typography>

        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Typography variant="caption" color="text.disabled">
            Prioridad: {workOrder.priority}
          </Typography>
          {workOrder.scheduledDate && (
            <Typography variant="caption" color="text.disabled">
              Programado: {workOrder.scheduledDate}
            </Typography>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}
