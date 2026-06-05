/**
 * usePdfDownload.js
 * Hook para descargar PDFs generados server-side por el Edge Function generate-pdf.
 *
 * Flujo:
 * 1. download() obtiene token JWT de sesión Supabase
 * 2. POST a /functions/v1/generate-pdf con template_code + record_id o data
 * 3. Recibe signed URL de Supabase Storage
 * 4. Dispara descarga via <a> click
 *
 * Retorna: { download, loading, error, pdfUrl, state, reset }
 * Estados: idle → loading → success | error
 *
 * Props: { templateCode, recordId?, recordType?, data? }
 * - templateCode: string (ej: "ot-default") — requerido
 * - recordId: string — UUID del registro (ej: work_order.id)
 * - recordType: string — tipo de registro (ej: "work_order")
 * - data: object — datos directos (alternativa a recordId, skips DB fetch)
 */
import { useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';

/**
 * @typedef {'idle'|'loading'|'success'|'error'} PdfDownloadState
 */

/**
 * @param {Object} [options]
 * @param {(result: { success: boolean, pdfUrl?: string, error?: string, reauth?: boolean }) => void} [options.onComplete]
 * @returns {{
 *   download: (params: { templateCode: string, recordId?: string, recordType?: string, data?: object }) => Promise<void>,
 *   loading: boolean,
 *   error: string|null,
 *   pdfUrl: string|null,
 *   state: PdfDownloadState,
 *   reset: () => void,
 * }}
 */
export function usePdfDownload({ onComplete } = {}) {
  const [state, setState] = useState(/** @type {PdfDownloadState} */('idle'));
  const [error, setError] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const loadingRef = useRef(false);

  const download = useCallback(async ({ templateCode, recordId, recordType, data }) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setState('loading');
    setError(null);
    setPdfUrl(null);

    try {
      // ── 1. Validate required params ──
      if (!templateCode) {
        throw new Error('Código de template requerido');
      }

      // ── 2. Get auth session ──
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();

      if (sessionError || !session?.access_token) {
        throw Object.assign(
          new Error('Sesión expirada. Por favor, inicia sesión nuevamente.'),
          { httpStatus: 401 },
        );
      }

      // ── 3. Build request body ──
      const body = { template_code: templateCode };
      if (recordId) body.record_id = recordId;
      if (recordType) body.record_type = recordType;
      if (data) body.data = data;

      // ── 4. Call Edge Function ──
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const response = await fetch(
        `${supabaseUrl}/functions/v1/generate-pdf`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(body),
        },
      );

      // ── 5. Handle error status codes ──
      if (response.status === 401) {
        throw Object.assign(
          new Error('Sesión expirada. Por favor, inicia sesión nuevamente.'),
          { httpStatus: 401 },
        );
      }

      if (response.status === 404) {
        const errBody = await response.json().catch(() => ({}));
        const message =
          errBody.error === 'template_not_found'
            ? 'Template no disponible'
            : errBody.error === 'record_not_found'
              ? 'Registro no encontrado'
              : 'Recurso no encontrado';
        throw Object.assign(new Error(message), { httpStatus: 404 });
      }

      if (response.status === 502) {
        throw Object.assign(
          new Error('Error al generar el PDF. Intenta nuevamente.'),
          { httpStatus: 502 },
        );
      }

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw Object.assign(
          new Error(errBody.error || 'Error al generar el PDF'),
          { httpStatus: response.status },
        );
      }

      // ── 6. Parse success response ──
      const result = await response.json();

      // ── 7. Trigger download via anchor click ──
      const a = document.createElement('a');
      a.href = result.signed_url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();

      setPdfUrl(result.signed_url);
      setState('success');
      onComplete?.({ success: true, pdfUrl: result.signed_url });
    } catch (err) {
      const message = err.message || 'Error al generar el PDF';
      setError(message);
      setState('error');

      if (err.httpStatus === 401) {
        onComplete?.({ success: false, error: message, reauth: true });
      } else {
        onComplete?.({ success: false, error: message });
      }
    } finally {
      loadingRef.current = false;
    }
  }, [onComplete]);

  const reset = useCallback(() => {
    setState('idle');
    setError(null);
    setPdfUrl(null);
  }, []);

  return {
    download,
    loading: state === 'loading',
    error,
    pdfUrl,
    state,
    reset,
  };
}

export default usePdfDownload;
