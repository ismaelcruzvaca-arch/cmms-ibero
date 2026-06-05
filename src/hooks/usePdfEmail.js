/**
 * usePdfEmail.js
 * Hook para enviar PDFs por email via Edge Function send-report.
 *
 * Flujo:
 * 1. sendEmail() obtiene token JWT de sesión Supabase
 * 2. POST a /functions/v1/send-report con { to, subject, message?, template_code, record_id }
 * 3. Recibe { messageId } de Resend
 *
 * Retorna: { sendEmail, loading, error, messageId, state, reset }
 * Estados: idle → loading → success | error
 *
 * Props: { to, subject, message?, templateCode, recordId?, recordType?, data? }
 * - to: string | string[] — email(s) del destinatario — requerido
 * - subject: string — asunto del correo — requerido
 * - message: string — cuerpo opcional del mensaje
 * - templateCode: string (ej: "ot-default") — requerido
 * - recordId: string — UUID del registro (ej: work_order.id)
 * - recordType: string — tipo de registro (ej: "work_order")
 * - data: object — datos directos (alternativa a recordId)
 */
import { useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';

/**
 * @typedef {'idle'|'loading'|'success'|'error'} PdfEmailState
 */

/**
 * @param {Object} [options]
 * @param {(result: { success: boolean, messageId?: string, error?: string, reauth?: boolean }) => void} [options.onComplete]
 * @returns {{
 *   sendEmail: (params: { to: string|string[], subject: string, message?: string, templateCode: string, recordId?: string, recordType?: string, data?: object }) => Promise<void>,
 *   loading: boolean,
 *   error: string|null,
 *   messageId: string|null,
 *   state: PdfEmailState,
 *   reset: () => void,
 * }}
 */
export function usePdfEmail({ onComplete } = {}) {
  const [state, setState] = useState(/** @type {PdfEmailState} */( 'idle' ));
  const [error, setError] = useState(null);
  const [messageId, setMessageId] = useState(null);
  const loadingRef = useRef(false);

  const sendEmail = useCallback(async ({ to, subject, message, templateCode, recordId, recordType, data }) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setState('loading');
    setError(null);
    setMessageId(null);

    try {
      // ── 1. Validate required params ──
      if (!templateCode) {
        throw new Error('Código de template requerido');
      }

      if (!to) {
        throw new Error('Destinatario requerido');
      }

      if (!subject) {
        throw new Error('Asunto requerido');
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
      const body = {
        to,
        subject,
        template_code: templateCode,
      };
      if (message) body.message = message;
      if (recordId) body.record_id = recordId;
      if (recordType) body.record_type = recordType;
      if (data) body.data = data;

      // ── 4. Call Edge Function ──
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const response = await fetch(
        `${supabaseUrl}/functions/v1/send-report`,
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

      if (response.status === 429) {
        const errBody = await response.json().catch(() => ({}));
        throw Object.assign(
          new Error(errBody.details?.[0] || 'Demasiadas solicitudes. Intenta nuevamente.'),
          { httpStatus: 429 },
        );
      }

      if (response.status === 502) {
        throw Object.assign(
          new Error('Error al enviar el email. Intenta nuevamente.'),
          { httpStatus: 502 },
        );
      }

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        const message = errBody.details?.[0] || errBody.error || 'Error al enviar el email';
        throw Object.assign(
          new Error(message),
          { httpStatus: response.status },
        );
      }

      // ── 6. Parse success response ──
      const result = await response.json();

      setMessageId(result.messageId);
      setState('success');
      onComplete?.({ success: true, messageId: result.messageId });
    } catch (err) {
      const message = err.message || 'Error al enviar el email';
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
    setMessageId(null);
  }, []);

  return {
    sendEmail,
    loading: state === 'loading',
    error,
    messageId,
    state,
    reset,
  };
}

export default usePdfEmail;
