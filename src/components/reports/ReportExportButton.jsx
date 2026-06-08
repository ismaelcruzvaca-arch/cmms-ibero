/**
 * ReportExportButton.jsx
 * "Exportar PDF" button that opens a WidgetSelector modal and triggers PDF export.
 *
 * Props:
 *   widgetRefs: [{ id, label, ref }] — the available widgets/charts
 *   disabled: boolean — disables button (e.g., no data)
 *   filename: string — optional PDF filename
 */
import { useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import { useReportExport } from '../../hooks/useReportExport';
import WidgetSelector from './WidgetSelector';

export default function ReportExportButton({
  widgetRefs,
  disabled = false,
  filename,
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const { state, progress, error, exportPdf, reset } = useReportExport();

  // Initialize widget selection state
  const [widgets, setWidgets] = useState(() =>
    widgetRefs.map((w) => ({ ...w, selected: true }))
  );

  // Sync when widgetRefs changes
  const [prevRefs, setPrevRefs] = useState(widgetRefs);
  if (widgetRefs !== prevRefs) {
    setPrevRefs(widgetRefs);
    setWidgets(widgetRefs.map((w) => ({ ...w, selected: true })));
  }

  const allSelected = widgets.every((w) => w.selected);

  const handleOpen = useCallback(() => {
    setWidgets(widgetRefs.map((w) => ({ ...w, selected: true })));
    setModalOpen(true);
  }, [widgetRefs]);

  const handleCancel = useCallback(() => {
    setModalOpen(false);
    reset();
  }, [reset]);

  const handleToggle = useCallback((id) => {
    setWidgets((prev) =>
      prev.map((w) => (w.id === id ? { ...w, selected: !w.selected } : w))
    );
  }, []);

  const handleToggleAll = useCallback(() => {
    setWidgets((prev) => {
      const allSelectedNow = prev.every((w) => w.selected);
      return prev.map((w) => ({ ...w, selected: !allSelectedNow }));
    });
  }, []);

  const handleExport = useCallback(async () => {
    await exportPdf({ widgets, filename });
  }, [exportPdf, widgets, filename]);

  return (
    <Box>
      <Tooltip title={disabled ? 'No hay datos para exportar' : ''}>
        <span>
          <Button
            variant="outlined"
            startIcon={<PictureAsPdfIcon />}
            onClick={handleOpen}
            disabled={disabled || state === 'capturing' || state === 'assembling'}
            size="small"
          >
            Exportar PDF
          </Button>
        </span>
      </Tooltip>

      <WidgetSelector
        open={modalOpen}
        widgets={widgets}
        onExport={handleExport}
        onCancel={handleCancel}
        onToggle={handleToggle}
        onToggleAll={handleToggleAll}
        exporting={state === 'capturing' || state === 'assembling'}
        progress={progress}
        allSelected={allSelected}
      />

      {error && (
        <Button size="small" color="error" onClick={handleCancel} sx={{ ml: 1 }}>
          Error: {error} — Cerrar
        </Button>
      )}
    </Box>
  );
}
