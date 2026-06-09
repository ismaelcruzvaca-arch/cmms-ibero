/**
 * generate-pdf — Edge Function
 *
 * Accepts POST with { template_code, record_id, record_type?, data?, template? },
 * resolves template + data, renders HTML via @cmms/pdf-engine, converts to PDF
 * via Browserless.io, uploads to generated_pdfs bucket, writes report_history,
 * and returns a signed URL.
 *
 * Auth: valid JWT Bearer token required (Supabase Auth).
 * Internal DB/Storage access via Service Role key.
 */

import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import { resolveTemplate, validateTemplate } from '@cmms/pdf-engine';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GeneratePdfRequest {
  template_code: string;
  record_id?: string;
  record_type?: string;
  data?: Record<string, unknown>;
  template?: object;
}

export interface GeneratePdfResponse {
  signed_url: string;
  expires_at: string;
  storage_path: string;
  report_history_id: string;
}

// ---------------------------------------------------------------------------
// CORS headers — allow frontend access
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const JSON_HEADERS = { ...CORS_HEADERS, 'Content-Type': 'application/json' };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function missingEnvResponse(variable: string): Response {
  console.error(`Missing ${variable}`);
  return jsonResponse({ error: 'Internal server error' }, 500);
}

// ---------------------------------------------------------------------------
// 1. Auth validation
// ---------------------------------------------------------------------------

export async function validateAuth(
  request: Request,
  supabase: SupabaseClient,
): Promise<
  { ok: true; user: { id: string } } | { ok: false; response: Response }
> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false, response: jsonResponse({ error: 'unauthorized' }, 401) };
  }

  const token = authHeader.slice(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return { ok: false, response: jsonResponse({ error: 'unauthorized' }, 401) };
  }

  return { ok: true, user: { id: user.id } };
}

// ---------------------------------------------------------------------------
// 2. Payload validation
// ---------------------------------------------------------------------------

export async function validatePayload(
  request: Request,
): Promise<
  { ok: true; payload: GeneratePdfRequest } | { ok: false; response: Response }
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

  if (typeof body.template_code !== 'string' || body.template_code.trim() === '') {
    return {
      ok: false,
      response: jsonResponse(
        { error: 'invalid_payload', details: ['template_code is required'] },
        400,
      ),
    };
  }

  if (!body.record_id && !body.data && !body.template) {
    return {
      ok: false,
      response: jsonResponse(
        {
          error: 'invalid_payload',
          details: ['record_id, data, or template is required'],
        },
        400,
      ),
    };
  }

  return {
    ok: true,
    payload: {
      template_code: body.template_code as string,
      record_id: body.record_id as string | undefined,
      record_type: body.record_type as string | undefined,
      data: body.data as Record<string, unknown> | undefined,
      template: body.template as object | undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// 3. Template resolution — fetch from DB or use provided template
// ---------------------------------------------------------------------------

export async function resolveTemplateFromDB(
  supabase: SupabaseClient,
  templateCode: string,
): Promise<
  { ok: true; template: object } | { ok: false; response: Response }
> {
  const { data: template, error } = await supabase
    .from('report_templates')
    .select('*')
    .eq('code', templateCode)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    console.error('Template lookup error:', error);
    return { ok: false, response: jsonResponse({ error: 'Internal server error' }, 500) };
  }

  if (!template) {
    return {
      ok: false,
      response: jsonResponse(
        { error: 'template_not_found', code: templateCode },
        404,
      ),
    };
  }

  // The template column contains the full template structure (JSONB)
  const templateBody = typeof template.template === 'object' && template.template !== null
    ? template.template
    : {};

  return { ok: true, template: templateBody as object };
}

// ---------------------------------------------------------------------------
// 4. Data resolution — fetch from DB or use provided data
// ---------------------------------------------------------------------------

export async function resolveDataFromDB(
  supabase: SupabaseClient,
  recordId: string,
  recordType?: string,
): Promise<
  { ok: true; data: Record<string, unknown> } | { ok: false; response: Response }
> {
  const type = recordType || 'work_order';

  if (type === 'work_order') {
    // Fetch work order with related labor and materials
    const { data: workOrder, error } = await supabase
      .from('work_orders')
      .select('*, labor:labor_records(*), materials:material_requests(*)')
      .eq('id', recordId)
      .maybeSingle();

    if (error) {
      console.error('Record lookup error:', error);
      return { ok: false, response: jsonResponse({ error: 'Internal server error' }, 500) };
    }

    if (!workOrder) {
      return {
        ok: false,
        response: jsonResponse(
          { error: 'record_not_found', record_id: recordId },
          404,
        ),
      };
    }

    return { ok: true, data: workOrder as Record<string, unknown> };
  }

  // Generic record lookup by type
  const { data: record, error } = await supabase
    .from(type)
    .select('*')
    .eq('id', recordId)
    .maybeSingle();

  if (error) {
    console.error('Record lookup error:', error);
    return { ok: false, response: jsonResponse({ error: 'Internal server error' }, 500) };
  }

  if (!record) {
    return {
      ok: false,
      response: jsonResponse(
        { error: 'record_not_found', record_id: recordId },
        404,
      ),
    };
  }

  return { ok: true, data: record as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// 5. Browserless.io HTML → PDF (with retry on 503)
// ---------------------------------------------------------------------------

export async function callBrowserless(
  html: string,
  apiKey: string,
): Promise<ArrayBuffer> {
  const url = `https://chrome.browserless.io/pdf?token=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      html,
      options: {
        format: 'A4',
        margin: {
          top: '15mm',
          bottom: '15mm',
          left: '15mm',
          right: '15mm',
        },
        printBackground: true,
        landscape: false,
      },
    }),
  });

  if (response.status === 503) {
    throw new BrowserlessUnavailableError();
  }

  if (!response.ok) {
    throw new Error(`browserless_error: ${response.status}`);
  }

  return response.arrayBuffer();
}

class BrowserlessUnavailableError extends Error {
  constructor() {
    super('browserless_unavailable');
    this.name = 'BrowserlessUnavailableError';
  }
}

// ---------------------------------------------------------------------------
// 6. Upload PDF to storage + generate signed URL
// ---------------------------------------------------------------------------

export async function uploadPDFToStorage(
  supabase: SupabaseClient,
  pdfBuffer: ArrayBuffer,
  storagePath: string,
): Promise<
  { ok: true; signedUrl: string; expiresAt: string } | { ok: false; response: Response }
> {
  const { error: uploadError } = await supabase.storage
    .from('generated_pdfs')
    .upload(storagePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: false,
    });

  if (uploadError) {
    console.error('Storage upload error:', uploadError);
    return { ok: false, response: jsonResponse({ error: 'Internal server error' }, 500) };
  }

  const expirySeconds = Math.min(
    Math.max(
      parseInt(Deno.env.get('SIGNED_URL_EXPIRY_SECONDS') || '3600', 10),
      300,  // min 5 minutes
    ),
    86400, // max 24 hours
  );

  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from('generated_pdfs')
    .createSignedUrl(storagePath, expirySeconds);

  if (signedUrlError || !signedUrlData) {
    console.error('Signed URL error:', signedUrlError);
    return { ok: false, response: jsonResponse({ error: 'Internal server error' }, 500) };
  }

  const expiresAt = new Date(Date.now() + expirySeconds * 1000).toISOString();

  return { ok: true, signedUrl: signedUrlData.signedUrl, expiresAt };
}

// ---------------------------------------------------------------------------
// 7. Insert report_history row
// ---------------------------------------------------------------------------

export async function insertReportHistory(
  supabase: SupabaseClient,
  params: {
    userId: string;
    templateCode: string;
    recordType: string;
    recordId: string;
    storagePath: string;
    signedUrlExpiresAt: string;
  },
): Promise<
  { ok: true; id: string } | { ok: false; response: Response }
> {
  const id = crypto.randomUUID();

  const { error } = await supabase.from('report_history').insert({
    id,
    template_code: params.templateCode,
    generated_by: params.userId,
    record_type: params.recordType,
    record_id: params.recordId,
    storage_path: params.storagePath,
    signed_url_expires_at: params.signedUrlExpiresAt,
  });

  if (error) {
    console.error('Report history insert error:', error);
    return { ok: false, response: jsonResponse({ error: 'Internal server error' }, 500) };
  }

  return { ok: true, id };
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
        return null; // caller will handle
      }

      return createClient(supabaseUrl, serviceRoleKey);
    })();

    if (!supabase) {
      return missingEnvResponse('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }

    // 1. Validate auth
    const authResult = await validateAuth(request, supabase);
    if (!authResult.ok) return authResult.response;
    const { user } = authResult;

    // 2. Validate payload
    const payloadResult = await validatePayload(request);
    if (!payloadResult.ok) return payloadResult.response;
    const payload = payloadResult.payload;

    // 3. Resolve template (from DB or provided inline)
    let template: object;
    if (payload.template) {
      template = payload.template;
    } else {
      const templateResult = await resolveTemplateFromDB(supabase, payload.template_code);
      if (!templateResult.ok) return templateResult.response;
      template = templateResult.template;
    }

    // Validate template structure
    const validation = validateTemplate(template);
    if (!validation.valid) {
      return jsonResponse(
        { error: 'invalid_template', details: validation.errors },
        400,
      );
    }

    // 4. Resolve data (from DB or provided inline)
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
      // Should not happen — validated in validatePayload
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

    // 6. Convert to PDF via Browserless (retry up to 2x on 503)
    const browserlessApiKey = Deno.env.get('BROWSERLESS_API_KEY');
    if (!browserlessApiKey) {
      return missingEnvResponse('BROWSERLESS_API_KEY');
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
        if (attempt < maxRetries && err instanceof BrowserlessUnavailableError) {
          console.warn(`Browserless 503 on attempt ${attempt + 1}, retrying...`);
        } else if (!(err instanceof BrowserlessUnavailableError)) {
          // Non-retryable error — bail immediately
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

    // 7. Upload to storage
    const tenant = 'default';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const recordId = payload.record_id || crypto.randomUUID();
    const storagePath = `${tenant}/${payload.template_code}/${recordId}-${timestamp}.pdf`;

    const storageResult = await uploadPDFToStorage(supabase, pdfBuffer, storagePath);
    if (!storageResult.ok) return storageResult.response;
    const { signedUrl, expiresAt } = storageResult;

    // 8. Insert report_history
    const historyResult = await insertReportHistory(supabase, {
      userId: user.id,
      templateCode: payload.template_code,
      recordType: payload.record_type || 'work_order',
      recordId,
      storagePath,
      signedUrlExpiresAt: expiresAt,
    });
    if (!historyResult.ok) return historyResult.response;

    // 9. Return signed URL response
    const response: GeneratePdfResponse = {
      signed_url: signedUrl,
      expires_at: expiresAt,
      storage_path: storagePath,
      report_history_id: historyResult.id,
    };

    return jsonResponse(response, 200);
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
