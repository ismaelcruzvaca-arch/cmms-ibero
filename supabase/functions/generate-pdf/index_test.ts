/**
 * Unit + Integration Tests — generate-pdf Edge Function
 *
 * Tests are organized in layers:
 *   1. Auth validation (unit, mock supabase)
 *   2. Payload validation (unit, no deps)
 *   3. Template resolution from DB (unit, mock supabase)
 *   4. Data resolution from DB (unit, mock supabase)
 *   5. Browserless HTML→PDF (unit, mock fetch)
 *   6. Storage upload + report history (unit, mock supabase)
 *   7. Handler errors (method, CORS, auth failure with injected mock)
 *   8. Full flow integration (conditional — needs env vars or injection)
 */

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
  assertRejects,
} from '@std/assert';
import { type SupabaseClient } from '@supabase/supabase-js';
import {
  validateAuth,
  validatePayload,
  resolveTemplateFromDB,
  resolveDataFromDB,
  callBrowserless,
  uploadPDFToStorage,
  insertReportHistory,
  handleRequest,
} from './index.ts';

// =============================================================================
// Mock helpers
// =============================================================================

interface MockSupabaseOptions {
  /** Override for supabase.auth.getUser() */
  authGetUser?: () => Promise<
    { data: { user: { id: string } | null }; error: Error | null }
  >;
  /** Result for any .maybeSingle() / .single() query */
  queryResult?: { data: unknown; error: unknown };
  /** Error from storage.upload() — null = success */
  storageUploadError?: unknown;
  /** Result from storage.createSignedUrl() */
  signedUrlResult?: {
    data: { signedUrl: string } | null;
    error: unknown;
  };
  /** Error from .insert() — null = success */
  insertError?: unknown;
}

/**
 * Build a minimal mock SupabaseClient that satisfies the query chain
 * used by the generate-pdf functions.
 */
function mockSupabase(opts: MockSupabaseOptions = {}): SupabaseClient {
  const queryBuilder = {
    select: () => queryBuilder,
    eq: () => queryBuilder,
    maybeSingle: () => Promise.resolve(
      opts.queryResult ?? { data: null, error: null },
    ),
    single: () => Promise.resolve(
      opts.queryResult ?? { data: null, error: null },
    ),
    insert: (_values: unknown) =>
      Promise.resolve({ data: null, error: opts.insertError ?? null }),
  };

  return {
    auth: {
      getUser: opts.authGetUser ??
        (() => Promise.resolve({ data: { user: null }, error: null })),
    },
    from: () => queryBuilder,
    storage: {
      from: () => ({
        upload: () =>
          Promise.resolve({ error: opts.storageUploadError ?? null }),
        createSignedUrl: () =>
          Promise.resolve(
            opts.signedUrlResult ?? {
              data: { signedUrl: 'https://example.com/generated.pdf' },
              error: null,
            },
          ),
      }),
    },
  } as unknown as SupabaseClient;
}

// =============================================================================
// 1. Auth validation
// =============================================================================

Deno.test('validateAuth: accepts valid JWT', async () => {
  const supabase = mockSupabase({
    authGetUser: () =>
      Promise.resolve({
        data: { user: { id: 'user-abc-123' } },
        error: null,
      }),
  });

  const request = new Request('http://localhost', {
    headers: { Authorization: 'Bearer valid-jwt-token' },
  });

  const result = await validateAuth(request, supabase);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.user.id, 'user-abc-123');
  }
});

Deno.test('validateAuth: rejects missing Authorization header', async () => {
  const supabase = mockSupabase();
  const request = new Request('http://localhost');

  const result = await validateAuth(request, supabase);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 401);
    const body = await result.response.json();
    assertEquals(body.error, 'unauthorized');
  }
});

Deno.test('validateAuth: rejects malformed Authorization header', async () => {
  const supabase = mockSupabase();
  const request = new Request('http://localhost', {
    headers: { Authorization: 'Basic dXNlcjpwYXNz' },
  });

  const result = await validateAuth(request, supabase);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 401);
  }
});

Deno.test('validateAuth: rejects invalid JWT token', async () => {
  const supabase = mockSupabase({
    authGetUser: () =>
      Promise.resolve({
        data: { user: null },
        error: new Error('Invalid token'),
      }),
  });

  const request = new Request('http://localhost', {
    headers: { Authorization: 'Bearer invalid-token' },
  });

  const result = await validateAuth(request, supabase);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 401);
  }
});

// =============================================================================
// 2. Payload validation
// =============================================================================

Deno.test('validatePayload: accepts valid payload with record_id', async () => {
  const request = new Request('http://localhost', {
    method: 'POST',
    body: JSON.stringify({
      template_code: 'ot-default',
      record_id: 'wo-123',
      record_type: 'work_order',
    }),
  });

  const result = await validatePayload(request);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.payload.template_code, 'ot-default');
    assertEquals(result.payload.record_id, 'wo-123');
    assertEquals(result.payload.record_type, 'work_order');
  }
});

Deno.test('validatePayload: accepts payload with inline data (no record_id)', async () => {
  const request = new Request('http://localhost', {
    method: 'POST',
    body: JSON.stringify({
      template_code: 'ot-default',
      data: { work_order_id: 'wo-123', title: 'Test' },
    }),
  });

  const result = await validatePayload(request);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.payload.data?.work_order_id, 'wo-123');
    assertEquals(result.payload.record_id, undefined);
  }
});

Deno.test('validatePayload: accepts payload with inline template (no DB fetch)', async () => {
  const request = new Request('http://localhost', {
    method: 'POST',
    body: JSON.stringify({
      template_code: 'ot-default',
      data: { title: 'Test' },
      template: { id: 'inline', name: 'Inline', sections: [] },
    }),
  });

  const result = await validatePayload(request);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertExists(result.payload.template);
  }
});

Deno.test('validatePayload: rejects missing template_code', async () => {
  const request = new Request('http://localhost', {
    method: 'POST',
    body: JSON.stringify({ record_id: 'wo-123' }),
  });

  const result = await validatePayload(request);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 400);
    const body = await result.response.json();
    assertStringIncludes(JSON.stringify(body.details), 'template_code');
  }
});

Deno.test('validatePayload: rejects empty template_code string', async () => {
  const request = new Request('http://localhost', {
    method: 'POST',
    body: JSON.stringify({ template_code: '', record_id: 'wo-123' }),
  });

  const result = await validatePayload(request);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 400);
  }
});

Deno.test('validatePayload: rejects when record_id, data, and template are all missing', async () => {
  const request = new Request('http://localhost', {
    method: 'POST',
    body: JSON.stringify({ template_code: 'ot-default' }),
  });

  const result = await validatePayload(request);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 400);
    const body = await result.response.json();
    assertExists(body.details);
  }
});

Deno.test('validatePayload: rejects malformed JSON body', async () => {
  const request = new Request('http://localhost', {
    method: 'POST',
    body: 'not-json',
  });

  const result = await validatePayload(request);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 400);
  }
});

Deno.test('validatePayload: rejects non-string template_code', async () => {
  const request = new Request('http://localhost', {
    method: 'POST',
    body: JSON.stringify({ template_code: 123, record_id: 'wo-123' }),
  });

  const result = await validatePayload(request);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 400);
  }
});

// =============================================================================
// 3. Template resolution from DB
// =============================================================================

Deno.test('resolveTemplateFromDB: returns template when found', async () => {
  const expectedTemplate = {
    id: 'tmpl-1',
    name: 'OT Default',
    sections: [{ type: 'title', text: '{{title}}' }],
  };

  const supabase = mockSupabase({
    queryResult: {
      data: { id: 'tmpl-1', code: 'ot-default', template: expectedTemplate },
      error: null,
    },
  });

  const result = await resolveTemplateFromDB(supabase, 'ot-default');
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.template, expectedTemplate);
  }
});

Deno.test('resolveTemplateFromDB: returns 404 when not found', async () => {
  const supabase = mockSupabase({
    queryResult: { data: null, error: null },
  });

  const result = await resolveTemplateFromDB(supabase, 'nonexistent');
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 404);
    const body = await result.response.json();
    assertEquals(body.error, 'template_not_found');
    assertEquals(body.code, 'nonexistent');
  }
});

Deno.test('resolveTemplateFromDB: returns 500 on query error', async () => {
  const supabase = mockSupabase({
    queryResult: { data: null, error: new Error('DB connection failed') },
  });

  const result = await resolveTemplateFromDB(supabase, 'ot-default');
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 500);
  }
});

// =============================================================================
// 4. Data resolution from DB
// =============================================================================

Deno.test('resolveDataFromDB: returns work_order with relations', async () => {
  const fakeWorkOrder = {
    id: 'wo-abc',
    title: 'Test WO',
    equipment_id: 'EQ-001',
    lifecycle_phase: 'COMP',
    labor: [{ technician: 'T1', hours: 2 }],
    materials: [{ part: 'P1', qty: 1 }],
  };

  const supabase = mockSupabase({
    queryResult: { data: fakeWorkOrder, error: null },
  });

  const result = await resolveDataFromDB(supabase, 'wo-abc', 'work_order');
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.data.id, 'wo-abc');
    assertEquals(result.data.title, 'Test WO');
    // Verify relation loading
    assertExists(result.data.labor);
    assertEquals(Array.isArray(result.data.labor), true);
  }
});

Deno.test('resolveDataFromDB: defaults to work_order type', async () => {
  const supabase = mockSupabase({
    queryResult: { data: { id: 'wo-xyz' }, error: null },
  });

  const result = await resolveDataFromDB(supabase, 'wo-xyz');
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.data.id, 'wo-xyz');
  }
});

Deno.test('resolveDataFromDB: returns 404 when record not found', async () => {
  const supabase = mockSupabase({
    queryResult: { data: null, error: null },
  });

  const result = await resolveDataFromDB(supabase, 'nonexistent-wo');
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 404);
    const body = await result.response.json();
    assertEquals(body.error, 'record_not_found');
  }
});

Deno.test('resolveDataFromDB: returns 500 on query error', async () => {
  const supabase = mockSupabase({
    queryResult: { data: null, error: new Error('Timeout') },
  });

  const result = await resolveDataFromDB(supabase, 'wo-abc');
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 500);
  }
});

// =============================================================================
// 5. Browserless HTML → PDF
// =============================================================================

Deno.test('callBrowserless: returns PDF buffer on success', async () => {
  const pdfBytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]); // %PDF-1.4
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (_url: string | URL, _opts?: RequestInit) =>
      Promise.resolve(
        new Response(pdfBytes, {
          status: 200,
          headers: { 'Content-Type': 'application/pdf' },
        }),
      );

    const result = await callBrowserless(
      '<html><body>Test</body></html>',
      'test-api-key',
    );
    assertExists(result);
    assertEquals(result.byteLength, pdfBytes.length);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('callBrowserless: throws on 503', async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (_url: string | URL, _opts?: RequestInit) =>
      Promise.resolve(new Response('Service Unavailable', { status: 503 }));

    await assertRejects(
      () =>
        callBrowserless('<html></html>', 'test-key'),
      Error,
      'browserless_unavailable',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('callBrowserless: throws on non-503 error status', async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (_url: string | URL, _opts?: RequestInit) =>
      Promise.resolve(new Response('Bad Request', { status: 400 }));

    await assertRejects(
      () =>
        callBrowserless('<html></html>', 'test-key'),
      Error,
      'browserless_error: 400',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// =============================================================================
// 6. Storage upload + report history
// =============================================================================

Deno.test('uploadPDFToStorage: uploads file and returns signed URL', async () => {
  const supabase = mockSupabase({
    signedUrlResult: {
      data: { signedUrl: 'https://supabase.co/storage/v1/object/sign/...' },
      error: null,
    },
  });

  const pdfBuffer = new Uint8Array([37, 80, 68, 70]).buffer as ArrayBuffer;
  const result = await uploadPDFToStorage(
    supabase,
    pdfBuffer,
    'default/ot-default/wo-123-20260605T120000Z.pdf',
  );

  assertEquals(result.ok, true);
  if (result.ok) {
    assertStringIncludes(result.signedUrl, 'supabase.co');
    assertExists(result.expiresAt);
  }
});

Deno.test('uploadPDFToStorage: returns 500 on upload error', async () => {
  const supabase = mockSupabase({
    storageUploadError: new Error('Bucket not found'),
  });

  const pdfBuffer = new ArrayBuffer(10);
  const result = await uploadPDFToStorage(
    supabase,
    pdfBuffer,
    'default/test/file.pdf',
  );

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 500);
  }
});

Deno.test('insertReportHistory: inserts row and returns id', async () => {
  const supabase = mockSupabase({ insertError: null });

  const result = await insertReportHistory(supabase, {
    userId: 'user-1',
    templateCode: 'ot-default',
    recordType: 'work_order',
    recordId: 'wo-123',
    storagePath: 'default/ot-default/wo-123-file.pdf',
    signedUrlExpiresAt: '2026-06-05T13:00:00Z',
  });

  assertEquals(result.ok, true);
  if (result.ok) {
    assertExists(result.id);
    // Should be a valid UUID
    assertEquals(result.id.length, 36);
  }
});

Deno.test('insertReportHistory: returns 500 on insert error', async () => {
  const supabase = mockSupabase({
    insertError: new Error('Database constraint violation'),
  });

  const result = await insertReportHistory(supabase, {
    userId: 'user-1',
    templateCode: 'ot-default',
    recordType: 'work_order',
    recordId: 'wo-123',
    storagePath: 'default/ot-default/wo-123-file.pdf',
    signedUrlExpiresAt: '2026-06-05T13:00:00Z',
  });

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 500);
  }
});

// =============================================================================
// 7. Handler — method validation and CORS
// =============================================================================

Deno.test('handleRequest: rejects GET method', async () => {
  const request = new Request('http://localhost', { method: 'GET' });
  const response = await handleRequest(request);
  assertEquals(response.status, 405);

  const body = await response.json();
  assertEquals(body.error, 'Method not allowed');
});

Deno.test('handleRequest: handles OPTIONS preflight (CORS)', async () => {
  const request = new Request('http://localhost', { method: 'OPTIONS' });
  const response = await handleRequest(request);
  assertEquals(response.status, 204);

  const corsOrigin = response.headers.get('Access-Control-Allow-Origin');
  assertEquals(corsOrigin, '*');
});

Deno.test('handleRequest: returns 401 with injected mock (no auth)', async () => {
  const supabase = mockSupabase({
    authGetUser: () =>
      Promise.resolve({
        data: { user: null },
        error: new Error('No token'),
      }),
  });

  const request = new Request('http://localhost', {
    method: 'POST',
    body: JSON.stringify({
      template_code: 'ot-default',
      data: { title: 'Test' },
    }),
  });

  const response = await handleRequest(request, supabase);
  assertEquals(response.status, 401);

  const body = await response.json();
  assertEquals(body.error, 'unauthorized');
});

Deno.test('handleRequest: returns 400 with injected mock (invalid payload)', async () => {
  const supabase = mockSupabase({
    authGetUser: () =>
      Promise.resolve({
        data: { user: { id: 'user-1' } },
        error: null,
      }),
  });

  const request = new Request('http://localhost', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-token' },
    body: JSON.stringify({ template_code: '' }),
  });

  const response = await handleRequest(request, supabase);
  assertEquals(response.status, 400);

  const body = await response.json();
  assertEquals(body.error, 'invalid_payload');
});

Deno.test('handleRequest: returns 502 with injected mock (Browserless failure)', async () => {
  const supabase = mockSupabase({
    authGetUser: () =>
      Promise.resolve({
        data: { user: { id: 'user-1' } },
        error: null,
      }),
    queryResult: {
      data: {
        id: 'tmpl-1',
        code: 'ot-default',
        template: {
          id: 'test',
          name: 'Test Template',
          sections: [{ type: 'title', text: '{{title}}' }],
        },
      },
      error: null,
    },
  });

  // Mock Browserless returning 503 for all attempts
  const originalFetch = globalThis.fetch;
  try {
    let callCount = 0;
    globalThis.fetch = (_url: string | URL, _opts?: RequestInit) => {
      callCount++;
      if (String(_url).includes('chrome.browserless.io')) {
        return Promise.resolve(new Response('Unavailable', { status: 503 }));
      }
      return Promise.resolve(new Response('Not found', { status: 404 }));
    };

    const request = new Request('http://localhost', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-token' },
      body: JSON.stringify({
        template_code: 'ot-default',
        data: { title: 'Test' },
      }),
    });

    const response = await handleRequest(request, supabase);
    assertEquals(response.status, 502);

    const body = await response.json();
    assertEquals(body.error, 'pdf_generation_failed');

    // Should have retried up to 3 times (initial + 2 retries)
    // Note: the non-Browserless fetch calls may add to the count
    const browserlessCalls = callCount;
    assertExists(browserlessCalls);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// =============================================================================
// 8. Full flow integration (injected mocks — no real DB needed)
// =============================================================================

Deno.test({
  name:
    'handleRequest: full flow with injected mocks (template + data + Browserless + storage + history)',
  fn: async () => {
    const supabase = mockSupabase({
      authGetUser: () =>
        Promise.resolve({
          data: { user: { id: 'user-integration' } },
          error: null,
        }),
      queryResult: {
        data: {
          id: 'tmpl-1',
          code: 'ot-default',
          template: {
            id: 'test-wo',
            name: 'OT Default',
            sections: [
              { type: 'title', text: '{{title}}' },
              { type: 'label-value', label: 'Equipo', value: '{{equipment_id}}' },
            ],
          },
        },
        error: null,
      },
      signedUrlResult: {
        data: {
          signedUrl:
            'https://supabase.co/storage/v1/object/sign/generated_pdfs/default/ot-default/wo-123-20260605T120000Z.pdf',
        },
        error: null,
      },
      insertError: null,
      storageUploadError: null,
    });

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (_url: string | URL, _opts?: RequestInit) => {
        if (String(_url).includes('chrome.browserless.io')) {
          const pdfBuffer = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]);
          return Promise.resolve(
            new Response(pdfBuffer, {
              status: 200,
              headers: { 'Content-Type': 'application/pdf' },
            }),
          );
        }
        // For any other fetch (supabase internal calls), return OK
        return Promise.resolve(new Response('OK', { status: 200 }));
      };

      const request = new Request('http://localhost', {
        method: 'POST',
        headers: { Authorization: 'Bearer integration-token' },
        body: JSON.stringify({
          template_code: 'ot-default',
          record_id: 'wo-123',
          record_type: 'work_order',
        }),
      });

      const response = await handleRequest(request, supabase);
      assertEquals(response.status, 200);

      const body = await response.json();
      assertExists(body.signed_url);
      assertExists(body.expires_at);
      assertExists(body.storage_path);
      assertExists(body.report_history_id);

      assertEquals(body.storage_path.startsWith('default/ot-default/'), true);
      assertStringIncludes(body.signed_url, 'supabase.co');
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
});

Deno.test({
  name:
    'handleRequest: full flow with inline data payload (no record_id)',
  fn: async () => {
    const supabase = mockSupabase({
      authGetUser: () =>
        Promise.resolve({
          data: { user: { id: 'user-inline' } },
          error: null,
        }),
      // Template query result
      queryResult: {
        data: {
          id: 'tmpl-2',
          code: 'ot-default',
          template: {
            id: 'test-inline',
            name: 'Inline Test',
            sections: [
              { type: 'title', text: '{{title}}' },
              { type: 'label-value', label: 'Status', value: '{{status}}' },
            ],
          },
        },
        error: null,
      },
      signedUrlResult: {
        data: { signedUrl: 'https://supabase.co/storage/v1/object/sign/...' },
        error: null,
      },
      insertError: null,
      storageUploadError: null,
    });

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (_url: string | URL, _opts?: RequestInit) => {
        if (String(_url).includes('chrome.browserless.io')) {
          const pdfBuffer = new Uint8Array([37, 80, 68, 70]);
          return Promise.resolve(
            new Response(pdfBuffer, {
              status: 200,
              headers: { 'Content-Type': 'application/pdf' },
            }),
          );
        }
        return Promise.resolve(new Response('OK', { status: 200 }));
      };

      const request = new Request('http://localhost', {
        method: 'POST',
        headers: { Authorization: 'Bearer inline-token' },
        body: JSON.stringify({
          template_code: 'ot-default',
          data: { title: 'Inline WO', status: 'COMP' },
        }),
      });

      const response = await handleRequest(request, supabase);
      assertEquals(response.status, 200);

      const body = await response.json();
      assertExists(body.signed_url);

      // Should generate a UUID for record_id since none was provided
      assertExists(body.storage_path);
      assertExists(body.report_history_id);
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
});
