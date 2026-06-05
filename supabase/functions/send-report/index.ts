/**
 * send-report — Edge Function
 *
 * Accepts POST with { to, subject, message?, template_code, record_id?, record_type?, data? },
 * resolves template + data, renders HTML via @cmms/pdf-engine, converts to PDF
 * via Browserless.io, base64-encodes it, and sends it as a Resend API attachment.
 *
 * Auth: valid JWT Bearer token required (Supabase Auth), OR
 *   X-Internal-Secret header matching INTERNAL_SECRET env var
 *   for internal calls from pg_cron (bypasses JWT).
 * Internal DB/Storage access via Service Role key.
 */

import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import { resolveTemplate, validateTemplate } from '@cmms/pdf-engine';

// ---------------------------------------------------------------------------
// Shared helpers — imported from generate-pdf to avoid duplication
// ---------------------------------------------------------------------------

import {
  validateAuth,
  resolveTemplateFromDB,
  resolveDataFromDB,
  callBrowserless,
  jsonResponse as genJsonResponse,
} from '../generate-pdf/index.ts';

// ---------------------------------------------------------------------------
// CORS headers — match generate-pdf's pattern
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const JSON_HEADERS = { ...CORS_HEADERS, 'Content-Type': 'application/json' };

function jsonResponse(body: unknown, status: number): Response {
  return genJsonResponse(body, status);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SendReportRequest {
  to: string | string[];
  subject: string;
  message?: string;
  template_code: string;
  record_id?: string;
  record_type?: string;
  data?: Record<string, unknown>;
}

export interface SendReportResponse {
  messageId: string;
}

// ---------------------------------------------------------------------------
// 1. Payload validation — send-report schema
// ---------------------------------------------------------------------------

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

export async function validateSendReportPayload(
  request: Request,
): Promise<
  { ok: true; payload: SendReportRequest } | { ok: false; response: Response }
> {
  let body: Record<string, unknown>;

  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      response: jsonResponse(
        { error: 'invalid_payload', details: ['Invalid JSON body'] },
        400,
      ),
    };
  }

  const errors: string[] = [];

  // ── Validate `to` — must be email string or non-empty email array ──
  if (body.to === undefined || body.to === null) {
    errors.push('to is required');
  } else if (typeof body.to === 'string') {
    if (!isValidEmail(body.to)) {
      errors.push('to must be a valid email address');
    }
  } else if (Array.isArray(body.to)) {
    if (body.to.length === 0) {
      errors.push('to must contain at least one email address');
    } else {
      for (let i = 0; i < body.to.length; i++) {
        const email = body.to[i];
        if (typeof email !== 'string' || !isValidEmail(email)) {
          errors.push(`to[${i}] is not a valid email address`);
        }
      }
    }
  } else {
    errors.push('to must be a string or array of strings');
  }

  // ── Validate `subject` ──
  if (typeof body.subject !== 'string' || body.subject.trim() === '') {
    errors.push('subject is required and must be a non-empty string');
  }

  // ── Validate `template_code` ──
  if (typeof body.template_code !== 'string' || body.template_code.trim() === '') {
    errors.push('template_code is required and must be a non-empty string');
  }

  // ── Validate `message` (optional) ──
  if (body.message !== undefined && typeof body.message !== 'string') {
    errors.push('message must be a string');
  }

  // ── At least one of record_id or data must be provided ──
  if (!body.record_id && !body.data) {
    errors.push('record_id or data is required');
  }

  if (body.record_id !== undefined && typeof body.record_id !== 'string') {
    errors.push('record_id must be a string');
  }

  if (body.record_type !== undefined && typeof body.record_type !== 'string') {
    errors.push('record_type must be a string');
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: jsonResponse({ error: 'invalid_payload', details: errors }, 400),
    };
  }

  return {
    ok: true,
    payload: {
      to: body.to as string | string[],
      subject: body.subject as string,
      message: body.message as string | undefined,
      template_code: body.template_code as string,
      record_id: body.record_id as string | undefined,
      record_type: body.record_type as string | undefined,
      data: body.data as Record<string, unknown> | undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// 2. Base64 encode an ArrayBuffer (PDF buffer → Resend attachment content)
// ---------------------------------------------------------------------------

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// 3. Send email via Resend API
// ---------------------------------------------------------------------------

export async function sendEmailViaResend(
  params: {
    to: string | string[];
    subject: string;
    html: string;
    message?: string;
    pdfBase64: string;
  },
): Promise<
  { ok: true; messageId: string } | { ok: false; response: Response }
> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    return {
      ok: false,
      response: jsonResponse(
        { error: 'missing_configuration', details: ['RESEND_API_KEY is not set'] },
        500,
      ),
    };
  }

  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') ||
    'CMMS Ibero <reports@tu-dominio.com>';

  // Build the Resend API request body
  const payload = {
    from: fromEmail,
    to: params.to,
    subject: params.subject,
    html: params.html,
    text: params.message || undefined,
    attachments: [
      {
        filename: 'report.pdf',
        content: params.pdfBase64,
        type: 'application/pdf',
      },
    ],
  };

  let response: Response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('Resend API fetch error:', err);
    return {
      ok: false,
      response: jsonResponse(
        { error: 'email_delivery_failed', details: ['Could not reach Resend API'] },
        502,
      ),
    };
  }

  if (response.ok) {
    const result = await response.json();
    const messageId: string = result.id || result.messageId || '';
    return { ok: true, messageId };
  }

  // ── Error handling for non-2xx responses ──
  const status = response.status;
  let errorBody: Record<string, unknown> = {};
  try {
    errorBody = await response.json();
  } catch {
    // ignore parse errors
  }

  const errorMessage =
    (errorBody.error as string) ||
    (errorBody.message as string) ||
    response.statusText ||
    'Resend API error';

  console.error(`Resend API returned ${status}:`, errorBody);

  if (status === 429) {
    // Surface rate limit errors upstream
    return {
      ok: false,
      response: jsonResponse(
        { error: 'rate_limited', details: [errorMessage] },
        429,
      ),
    };
  }

  if (status === 400 || status === 422) {
    return {
      ok: false,
      response: jsonResponse(
        { error: 'invalid_email_request', details: [errorMessage] },
        400,
      ),
    };
  }

  // Generic upstream failure
  return {
    ok: false,
    response: jsonResponse(
      { error: 'email_delivery_failed', details: [errorMessage] },
      502,
    ),
  };
}

// ---------------------------------------------------------------------------
// Main handler — exported for testing
// ---------------------------------------------------------------------------

export async function handleRequest(
  request: Request,
  /** Injected supabase client for testing — omit in production */
  injectedSupabase?: SupabaseClient,
): Promise<Response> {
  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    // Set up Supabase admin client
    const supabase = injectedSupabase ?? (() => {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

      if (!supabaseUrl || !serviceRoleKey) {
        return null;
      }

      return createClient(supabaseUrl, serviceRoleKey);
    })();

    if (!supabase) {
      return jsonResponse(
        { error: 'missing_configuration', details: ['SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set'] },
        500,
      );
    }

    // 0. Internal auth bypass (before JWT check)
    // If X-Internal-Secret header matches INTERNAL_SECRET env var,
    // skip JWT entirely. If present but wrong, return 401 immediately
    // (don't fall through to JWT — prevents guessing attacks).
    const internalSecretHeader = request.headers.get('X-Internal-Secret');
    if (internalSecretHeader) {
      if (internalSecretHeader === Deno.env.get('INTERNAL_SECRET')) {
        // Valid internal secret — skip JWT auth, proceed as system user
      } else {
        // Invalid secret — return 401 without falling through to JWT
        return jsonResponse({ error: 'unauthorized' }, 401);
      }
    } else {
      // No internal secret — normal JWT auth
      const authResult = await validateAuth(request, supabase);
      if (!authResult.ok) return authResult.response;
    }

    // 2. Validate payload
    const payloadResult = await validateSendReportPayload(request);
    if (!payloadResult.ok) return payloadResult.response;
    const payload = payloadResult.payload;

    // 3. Resolve template from DB
    const templateResult = await resolveTemplateFromDB(supabase, payload.template_code);
    if (!templateResult.ok) return templateResult.response;
    const template = templateResult.template;

    // Validate template structure
    const validation = validateTemplate(template);
    if (!validation.valid) {
      return jsonResponse(
        { error: 'invalid_template', details: validation.errors },
        400,
      );
    }

    // 4. Resolve data
    let data: Record<string, unknown>;
    if (payload.data) {
      data = payload.data;
    } else if (payload.record_id) {
      const dataResult = await resolveDataFromDB(
        supabase,
        payload.record_id,
        payload.record_type,
      );
      if (!dataResult.ok) return dataResult.response;
      data = dataResult.data;
    } else {
      // Should not happen — validated in validateSendReportPayload
      return jsonResponse(
        { error: 'invalid_payload', details: ['record_id or data is required'] },
        400,
      );
    }

    // 5. Render HTML
    const html = resolveTemplate(template, data);
    if (!html || typeof html !== 'string') {
      console.error('Template rendering returned empty HTML');
      return jsonResponse({ error: 'Internal server error' }, 500);
    }

    // 6. Convert to PDF via Browserless
    const browserlessApiKey = Deno.env.get('BROWSERLESS_API_KEY');
    if (!browserlessApiKey) {
      return jsonResponse(
        { error: 'missing_configuration', details: ['BROWSERLESS_API_KEY is not set'] },
        500,
      );
    }

    let pdfBuffer: ArrayBuffer | undefined;
    let lastError: unknown;
    const maxRetries = 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          // Exponential backoff: 1s, 2s
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
        }
        pdfBuffer = await callBrowserless(html, browserlessApiKey);
        break;
      } catch (err) {
        lastError = err;
        if (
          attempt < maxRetries &&
          err instanceof Error &&
          err.name === 'BrowserlessUnavailableError'
        ) {
          console.warn(`Browserless 503 on attempt ${attempt + 1}, retrying...`);
        } else if (
          !(err instanceof Error && err.name === 'BrowserlessUnavailableError')
        ) {
          console.error('Browserless non-retryable error:', err);
          return jsonResponse({ error: 'pdf_generation_failed' }, 502);
        }
      }
    }

    if (!pdfBuffer) {
      console.error('Browserless failed after all retries');
      return jsonResponse(
        { error: 'pdf_generation_failed', details: 'Browserless unavailable after retries' },
        502,
      );
    }

    // 7. Base64-encode the PDF buffer for Resend attachment
    const pdfBase64 = arrayBufferToBase64(pdfBuffer);

    // 8. Send via Resend
    const recipients = Array.isArray(payload.to) ? payload.to : [payload.to];
    const receiptHtml = recipients.map((email) => `<li>${email}</li>`).join('');

    const emailHtml = payload.message
      ? `<p>${payload.message.replace(/\n/g, '<br>')}</p><p>Adjunto encontrarás el reporte en PDF.</p>`
      : '<p>Adjunto encontrarás el reporte en PDF.</p>';

    const emailResult = await sendEmailViaResend({
      to: payload.to,
      subject: payload.subject,
      html: emailHtml,
      message: payload.message,
      pdfBase64,
    });

    if (!emailResult.ok) return emailResult.response;

    // 9. Return success
    return jsonResponse({ messageId: emailResult.messageId }, 200);
  } catch (err) {
    console.error('Unexpected error:', err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}

// ---------------------------------------------------------------------------
// Entrypoint — only fires when invoked directly (not during tests)
// ---------------------------------------------------------------------------

if (import.meta.main) {
  Deno.serve(handleRequest);
}
