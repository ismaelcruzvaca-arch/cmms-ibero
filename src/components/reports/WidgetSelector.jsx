/**
 * WidgetSelector.jsx
 * Modal dialog with checkboxes for selecting widgets/charts to export.
 *
 * Props:
 *   open, widgets: [{ id, label, selected }],
 *   onExport, onCancel, onToggle(id), onToggleAll(),
 *   exporting, progress (0–100), allSelected
 */
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import LinearProgress from '@mui/material/LinearProgress';
import Divider from '@mui/material/Divider';

export default function WidgetSelector({
  open,
  widgets,
  onExport,
  onCancel,
  onToggle,
  onToggleAll,
  exporting,
  progress,
  allSelected,
}) {
  if (!open) return null;

  const selectedCount = widgets.filter((w) => w.selected).length;
  const hasSelection = selectedCount > 0;

  // Calculate progress text
  const total = widgets.length;

  return (
    <Dialog open={open} onClose={exporting ? undefined : onCancel} maxWidth="xs" fullWidth>
      <DialogTitle>
        {exporting ? 'Exportando…' : 'Seleccionar widgets para exportar'}
      </DialogTitle>

      <DialogContent>
        {exporting ? (
          /* ── Progress overlay ── */
          <Box sx={{ textAlign: 'center', py: 3 }}>
            <LinearProgress variant="determinate" value={progress} sx={{ mb: 2 }} />
            <Typography variant="body2" color="text.secondary">
              Capturando widget {Math.round((progress / 100) * total)} de {total}
            </Typography>
            <Typography variant="caption" color="text.disabled" sx={{ mt: 1, display: 'block' }}>
              {progress}% completado
            </Typography>
          </Box>
        ) : (
          /* ── Checkbox list ── */
          <Box>
            <Button
              size="small"
              onClick={onToggleAll}
              sx={{ mb: 1, textTransform: 'none' }}
            >
              {allSelected ? 'Deseleccionar todo' : 'Seleccionar todo'}
            </Button>

            <Divider sx={{ mb: 1 }} />

            <FormGroup>
              {widgets.map((widget) => (
                <FormControlLabel
                  key={widget.id}
                  control={
                    <Checkbox
                      checked={widget.selected}
                      onChange={() => onToggle(widget.id)}
                      size="small"
                    />
                  }
                  label={
                    <Typography variant="body2">{widget.label}</Typography>
                  }
                />
              ))}
            </FormGroup>
          </Box>
        )}
      </DialogContent>

      {!exporting && (
        <DialogActions>
          <Button onClick={onCancel} color="inherit">
            Cancelar
          </Button>
          <Button
            onClick={onExport}
            variant="contained"
            disabled={!hasSelection}
          >
            Exportar
          </Button>
        </DialogActions>
      )}
    </Dialog>
  );
}
