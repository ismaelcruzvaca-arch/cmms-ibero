/**
 * Tests for WidgetSelector — checkbox modal with progress overlay.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import WidgetSelector from '../WidgetSelector';

const theme = createTheme();

function renderWithTheme(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
}

const defaultWidgets = [
  { id: 'chart-1', label: 'Gráfico de barras', selected: true },
  { id: 'table-1', label: 'Tabla de detalle', selected: true },
  { id: 'metrics-1', label: 'Tarjetas de métricas', selected: true },
];

describe('WidgetSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ───── 1. Renderiza modal con checkboxes ─────
  it('renderiza modal con lista de widgets', () => {
    renderWithTheme(
      <WidgetSelector
        open={true}
        widgets={defaultWidgets}
        onExport={vi.fn()}
        onCancel={vi.fn()}
        onToggle={vi.fn()}
        onToggleAll={vi.fn()}
        exporting={false}
        progress={0}
        allSelected={true}
      />
    );

    expect(screen.getByText('Seleccionar widgets para exportar')).toBeInTheDocument();
    expect(screen.getByText('Gráfico de barras')).toBeInTheDocument();
    expect(screen.getByText('Tabla de detalle')).toBeInTheDocument();
    expect(screen.getByText('Tarjetas de métricas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Exportar/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancelar/i })).toBeInTheDocument();
  });

  // ───── 2. Checkboxes responden al toggle ─────
  it('llama onToggle cuando se clickea un checkbox', () => {
    const onToggle = vi.fn();
    renderWithTheme(
      <WidgetSelector
        open={true}
        widgets={defaultWidgets}
        onExport={vi.fn()}
        onCancel={vi.fn()}
        onToggle={onToggle}
        onToggleAll={vi.fn()}
        exporting={false}
        progress={0}
        allSelected={true}
      />
    );

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(3);

    fireEvent.click(checkboxes[0]);
    expect(onToggle).toHaveBeenCalledWith('chart-1');
  });

  // ───── 3. Toggle All ─────
  it('llama onToggleAll cuando se clickea Select All/Deselect All', () => {
    const onToggleAll = vi.fn();
    renderWithTheme(
      <WidgetSelector
        open={true}
        widgets={defaultWidgets}
        onExport={vi.fn()}
        onCancel={vi.fn()}
        onToggle={vi.fn()}
        onToggleAll={onToggleAll}
        exporting={false}
        progress={0}
        allSelected={true}
      />
    );

    const toggleAllBtn = screen.getByRole('button', { name: /Deseleccionar todo/i });
    fireEvent.click(toggleAllBtn);
    expect(onToggleAll).toHaveBeenCalled();
  });

  // ───── 4. Export disabled when all unchecked ─────
  it('deshabilita Export cuando ningún widget está seleccionado', () => {
    renderWithTheme(
      <WidgetSelector
        open={true}
        widgets={defaultWidgets.map((w) => ({ ...w, selected: false }))}
        onExport={vi.fn()}
        onCancel={vi.fn()}
        onToggle={vi.fn()}
        onToggleAll={vi.fn()}
        exporting={false}
        progress={0}
        allSelected={false}
      />
    );

    const exportBtn = screen.getByRole('button', { name: /Exportar/i });
    expect(exportBtn).toBeDisabled();
  });

  // ───── 5. Muestra overlay de progreso ─────
  it('muestra overlay de progreso cuando exporting=true', () => {
    renderWithTheme(
      <WidgetSelector
        open={true}
        widgets={defaultWidgets}
        onExport={vi.fn()}
        onCancel={vi.fn()}
        onToggle={vi.fn()}
        onToggleAll={vi.fn()}
        exporting={true}
        progress={50}
        allSelected={true}
      />
    );

    expect(screen.getByText('Capturando widget 2 de 3')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  // ───── 6. No renderiza cuando closed ─────
  it('no renderiza nada cuando open=false', () => {
    const { container } = renderWithTheme(
      <WidgetSelector
        open={false}
        widgets={defaultWidgets}
        onExport={vi.fn()}
        onCancel={vi.fn()}
        onToggle={vi.fn()}
        onToggleAll={vi.fn()}
        exporting={false}
        progress={0}
        allSelected={true}
      />
    );

    // MUI Dialog returns null when closed
    expect(container.innerHTML).toBe('');
  });
});
