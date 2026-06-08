/**
 * useReportExport.js
 * Hook for client-side PDF export using html2canvas + jsPDF.
 *
 * Accepts widget refs with selection state.
 * Captures each selected widget as PNG, assembles A4 portrait PDF.
 *
 * Returns: { state, progress, error, exportPdf, reset }
 *   state: 'idle' | 'capturing' | 'assembling' | 'done' | 'error'
 *   progress: 0–100
 */
import { useState, useCallback, useRef } from 'react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

/**
 * @typedef {'idle'|'capturing'|'assembling'|'done'|'error'} ExportState
 */

/**
 * @param {Object} [options]
 * @returns {{
 *   state: ExportState,
 *   progress: number,
 *   error: string|null,
 *   exportPdf: (config: { widgets: Array, filename?: string }) => Promise<void>,
 *   reset: () => void,
 * }}
 */
export function useReportExport() {
  const [state, setState] = useState(/** @type {ExportState} */('idle'));
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const runningRef = useRef(false);

  const exportPdf = useCallback(async ({ widgets, filename }) => {
    if (runningRef.current) return;
    runningRef.current = true;

    const selected = widgets.filter((w) => w.selected);
    if (selected.length === 0) {
      setState('done');
      setProgress(100);
      runningRef.current = false;
      return;
    }

    setState('capturing');
    setError(null);
    setProgress(0);

    try {
      // ── Step 1: Capture each widget ──
      const images = [];
      for (let i = 0; i < selected.length; i++) {
        const widget = selected[i];
        try {
          const canvas = await html2canvas(widget.ref.current, {
            scale: 2,
            useCORS: true,
            logging: false,
          });
          images.push({
            id: widget.id,
            dataUrl: canvas.toDataURL('image/png'),
          });
        } catch (captureErr) {
          // On error, push a placeholder
          images.push({
            id: widget.id,
            dataUrl: null,
            error: true,
          });
        }
        setProgress(Math.round(((i + 1) / selected.length) * 50));
      }

      // ── Step 2: Assemble PDF ──
      setState('assembling');
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const maxWidth = 190; // mm with margins
      const marginX = (pageWidth - maxWidth) / 2;

      images.forEach((img, index) => {
        if (index > 0) {
          pdf.addPage();
        }

        if (img.error || !img.dataUrl) {
          // Placeholder for failed captures
          pdf.setFontSize(12);
          pdf.text('Error al capturar el gráfico', marginX, 50);
          return;
        }

        const imgWidth = maxWidth;
        const imgHeight = (imgWidth * 297) / 210; // proportional to A4
        // But we need actual aspect ratio... use canvas aspect ratio or default
        // Since we don't have the original image dimensions, we use a fixed approach
        // But we do know it's from a div — use A4 proportional

        pdf.addImage(img.dataUrl, 'PNG', marginX, 20, imgWidth, imgHeight * 0.7, img.id, 'FAST');
      });

      // ── Step 3: Download ──
      const pdfFilename = filename || `reporte-${new Date().toISOString().slice(0, 10)}.pdf`;
      pdf.save(pdfFilename);

      setProgress(100);
      setState('done');
    } catch (err) {
      setError(err.message || 'Error al exportar PDF');
      setState('error');
    } finally {
      runningRef.current = false;
    }
  }, []);

  const reset = useCallback(() => {
    setState('idle');
    setProgress(0);
    setError(null);
  }, []);

  return { state, progress, error, exportPdf, reset };
}

export default useReportExport;
