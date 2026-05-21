import Chip from '@mui/material/Chip';
import { getPhaseLabel, getPhaseColor } from '../../lib/fsm.js';

export default function WorkOrderStatusBadge({ phase, size = 'medium' }) {
  return (
    <Chip
      label={getPhaseLabel(phase)}
      color={getPhaseColor(phase)}
      size={size}
    />
  );
}
