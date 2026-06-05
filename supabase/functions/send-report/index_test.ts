/**
 * Unit + Integration Tests — send-report Edge Function
 *
 * Tests are organized in layers:
 *   1. Payload validation (unit, no deps)
 *   2. Base64 encoding (unit, pure function)
 *   3. Resend API call (unit, mock fetch + env)
 *   4. Handler errors (method, CORS, auth failure, missing config)
 *   5. Full flow integration (injected mocks)
 */

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from '@std/assert';
import { type SupabaseClient } from '@supabase/supabase-js';
import {
  validateSendReportPayload,
  sendEmailViaResend,
  arrayBufferToBase64,
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
  /** Insert error — null = success */
  insertError?: unknown;
}

/**
 * Build a minimal mock SupabaseClient that satisfies the query chain.
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
        upload: () => Promise.resolve({ error: null }),
        createSignedUrl: () =>
          Promise.resolve({
            data: { signedUrl: 'https://example.com/generated.pdf' },
            error: null,
          }),
      }),
    },
  } as unknown as SupabaseClient;
}

/** Create a simple PDF-like ArrayBuffer for tests */
function createPdfBuffer(): ArrayBuffer {
  return new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]).buffer as ArrayBuffer;
}

/** Store original env values for restore */
const ORIGINAL_ENV: Record<string, string | undefined> = {};

function setTestEnv(key: string, value: string | undefined): void {
  if (!(key in ORIGINAL_ENV)) {
    ORIGINAL_ENV[key] = Deno.env.get(key);
  }
  if (value === undefined) {
    Deno.env.delete(key);
  } else {
    Deno.env.set(key, value);
  }
}

function restoreEnvs(): void {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      Deno.env.delete(key);
    } else {
      Deno.env.set(key, value);
    }
    delete ORIGINAL_ENV[key];
  }
}

// =============================================================================
// 1. Payload validation — validateSendReportPayload
// =============================================================================

Deno.test({
  name: 'validateSendReportPayload: accepts valid payload with string to',
  fn: async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        to: 'user@example.com',
        subject: 'Reporte diario',
        template_code: 'ot-default',
        record_id: 'wo-123',
      }),
    });

    const result = await validateSendReportPayload(request);
    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.payload.to, 'user@example.com');
      assertEquals(result.payload.subject, 'Reporte diario');
      assertEquals(result.payload.template_code, 'ot-default');
      assertEquals(result.payload.record_id, 'wo-123');
      assertEquals(result.payload.message, undefined);
    }
  },
});

Deno.test({
  name: 'validateSendReportPayload: accepts valid payload with array to',
  fn: async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        to: ['a@example.com', 'b@example.com'],
        subject: 'Reporte mensual',
        template_code: 'ot-default',
        record_id: 'wo-456',
        message: 'Adjunto el reporte solicitado.',
      }),
    });

    const result = await validateSendReportPayload(request);
    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(Array.isArray(result.payload.to), true);
      assertEquals((result.payload.to as string[]).length, 2);
      assertEquals(result.payload.message, 'Adjunto el reporte solicitado.');
    }
  },
});

Deno.test({
  name: 'validateSendReportPayload: accepts payload with data (no record_id)',
  fn: async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        to: 'user@example.com',
        subject: 'Report',
        template_code: 'ot-default',
        data: { title: 'Test' },
      }),
    });

    const result = await validateSendReportPayload(request);
    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.payload.data?.title, 'Test');
      assertEquals(result.payload.record_id, undefined);
    }
  },
});

Deno.test({
  name: 'validateSendReportPayload: rejects invalid email (single)',
  fn: async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        to: 'not-an-email',
        subject: 'Report',
        template_code: 'ot-default',
        record_id: 'wo-123',
      }),
    });

    const result = await validateSendReportPayload(request);
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.response.status, 400);
      const body = await result.response.json();
      assertEquals(body.error, 'invalid_payload');
      assertStringIncludes(JSON.stringify(body.details), 'valid email');
    }
  },
});

Deno.test({
  name: 'validateSendReportPayload: rejects invalid email in array',
  fn: async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        to: ['good@example.com', 'bad-email'],
        subject: 'Report',
        template_code: 'ot-default',
        record_id: 'wo-123',
      }),
    });

    const result = await validateSendReportPayload(request);
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.response.status, 400);
      const body = await result.response.json();
      assertStringIncludes(JSON.stringify(body.details), 'not a valid email');
    }
  },
});

Deno.test({
  name: 'validateSendReportPayload: rejects missing to',
  fn: async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        subject: 'Report',
        template_code: 'ot-default',
        record_id: 'wo-123',
      }),
    });

    const result = await validateSendReportPayload(request);
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.response.status, 400);
      const body = await result.response.json();
      assertStringIncludes(JSON.stringify(body.details), 'to is required');
    }
  },
});

Deno.test({
  name: 'validateSendReportPayload: rejects missing subject',
  fn: async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        to: 'user@example.com',
        template_code: 'ot-default',
        record_id: 'wo-123',
      }),
    });

    const result = await validateSendReportPayload(request);
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.response.status, 400);
      const body = await result.response.json();
      assertStringIncludes(JSON.stringify(body.details), 'subject');
    }
  },
});

Deno.test({
  name: 'validateSendReportPayload: rejects missing template_code',
  fn: async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        to: 'user@example.com',
        subject: 'Report',
        record_id: 'wo-123',
      }),
    });

    const result = await validateSendReportPayload(request);
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.response.status, 400);
      const body = await result.response.json();
      assertStringIncludes(JSON.stringify(body.details), 'template_code');
    }
  },
});

Deno.test({
  name: 'validateSendReportPayload: rejects empty to array',
  fn: async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        to: [],
        subject: 'Report',
        template_code: 'ot-default',
        record_id: 'wo-123',
      }),
    });

    const result = await validateSendReportPayload(request);
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.response.status, 400);
    }
  },
});

Deno.test({
  name: 'validateSendReportPayload: rejects malformed JSON',
  fn: async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      body: 'not-json',
    });

    const result = await validateSendReportPayload(request);
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.response.status, 400);
      const body = await result.response.json();
      assertStringIncludes(JSON.stringify(body.details), 'Invalid JSON');
    }
  },
});

Deno.test({
  name: 'validateSendReportPayload: rejects missing record_id and data',
  fn: async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        to: 'user@example.com',
        subject: 'Report',
        template_code: 'ot-default',
      }),
    });

    const result = await validateSendReportPayload(request);
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.response.status, 400);
      const body = await result.response.json();
      assertStringIncludes(JSON.stringify(body.details), 'record_id or data');
    }
  },
});

Deno.test({
  name: 'validateSendReportPayload: rejects non-string to type',
  fn: async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        to: 123,
        subject: 'Report',
        template_code: 'ot-default',
        record_id: 'wo-123',
      }),
    });

    const result = await validateSendReportPayload(request);
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.response.status, 400);
    }
  },
});

// =============================================================================
// 2. Base64 encoding — arrayBufferToBase64
// =============================================================================

Deno.test({
  name: 'arrayBufferToBase64: encodes ArrayBuffer to base64 string',
  fn: () => {
    const buffer = new Uint8Array([72, 101, 108, 108, 111]).buffer as ArrayBuffer; // "Hello"
    const result = arrayBufferToBase64(buffer);
    assertEquals(result, 'SGVsbG8=');
  },
});

Deno.test({
  name: 'arrayBufferToBase64: handles empty buffer',
  fn: () => {
    const buffer = new ArrayBuffer(0);
    const result = arrayBufferToBase64(buffer);
    assertEquals(result, '');
  },
});

Deno.test({
  name: 'arrayBufferToBase64: encodes PDF magic bytes',
  fn: () => {
    const buffer = createPdfBuffer();
    const result = arrayBufferToBase64(buffer);
    // %PDF-1.4 in base64
    assertEquals(result, 'JVBGRi0xLjQ=');
  },
});

// =============================================================================
// 3. Resend API call — sendEmailViaResend
// =============================================================================

Deno.test({
  name: 'sendEmailViaResend: sends email and returns messageId on success',
  fn: async () => {
    const originalFetch = globalThis.fetch;
    const originalResendKey = Deno.env.get('RESEND_API_KEY');
    const originalFromEmail = Deno.env.get('RESEND_FROM_EMAIL');

    try {
      Deno.env.set('RESEND_API_KEY', 're_test_key_123');
      Deno.env.set('RESEND_FROM_EMAIL', 'Test <test@example.com>');

      let requestBody: unknown = null;
      let requestHeaders: Record<string, string> = {};

      globalThis.fetch = (
        url: string | URL,
        opts?: RequestInit,
      ) => {
        if (String(url).includes('api.resend.com')) {
          requestBody = JSON.parse(opts?.body as string);
          requestHeaders = opts?.headers as Record<string, string>;
          return Promise.resolve(
            new Response(JSON.stringify({ id: 'msg-resend-abc' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
        return Promise.resolve(new Response('OK', { status: 200 }));
      };

      const pdfBase64 = 'JVBGRi0xLjQ=';
      const result = await sendEmailViaResend({
        to: 'user@example.com',
        subject: 'Test Report',
        html: '<p>Test</p>',
        pdfBase64,
      });

      assertEquals(result.ok, true);
      if (result.ok) {
        assertEquals(result.messageId, 'msg-resend-abc');
      }

      // Verify request body shape
      const body = requestBody as Record<string, unknown>;
      assertEquals(body.from, 'Test <test@example.com>');
      assertEquals(body.to, 'user@example.com');
      assertEquals(body.subject, 'Test Report');
      assertEquals(body.html, '<p>Test</p>');

      // Verify attachment
      const attachments = body.attachments as Array<Record<string, unknown>>;
      assertEquals(attachments.length, 1);
      assertEquals(attachments[0].filename, 'report.pdf');
      assertEquals(attachments[0].content, pdfBase64);
      assertEquals(attachments[0].type, 'application/pdf');

      // Verify authorization header
      assertEquals(requestHeaders['Authorization'], 'Bearer re_test_key_123');
    } finally {
      globalThis.fetch = originalFetch;
      if (originalResendKey === undefined) {
        Deno.env.delete('RESEND_API_KEY');
      } else {
        Deno.env.set('RESEND_API_KEY', originalResendKey);
      }
      if (originalFromEmail === undefined) {
        Deno.env.delete('RESEND_FROM_EMAIL');
      } else {
        Deno.env.set('RESEND_FROM_EMAIL', originalFromEmail);
      }
    }
  },
});

Deno.test({
  name: 'sendEmailViaResend: returns 500 when RESEND_API_KEY missing',
  fn: async () => {
    const originalKey = Deno.env.get('RESEND_API_KEY');
    try {
      Deno.env.delete('RESEND_API_KEY');
      Deno.env.set('RESEND_FROM_EMAIL', 'test@example.com');

      const result = await sendEmailViaResend({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
        pdfBase64: 'dGVzdA==',
      });

      assertEquals(result.ok, false);
      if (!result.ok) {
        assertEquals(result.response.status, 500);
        const body = await result.response.json();
        assertEquals(body.error, 'missing_configuration');
      }
    } finally {
      if (originalKey === undefined) {
        Deno.env.delete('RESEND_API_KEY');
      } else {
        Deno.env.set('RESEND_API_KEY', originalKey);
      }
    }
  },
});

Deno.test({
  name: 'sendEmailViaResend: propagates 429 rate limit',
  fn: async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = Deno.env.get('RESEND_API_KEY');
    try {
      Deno.env.set('RESEND_API_KEY', 're_test_key');
      Deno.env.set('RESEND_FROM_EMAIL', 'test@example.com');

      globalThis.fetch = () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ error: 'rate_limited', message: 'Too many requests' }),
            { status: 429 },
          ),
        );

      const result = await sendEmailViaResend({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
        pdfBase64: 'dGVzdA==',
      });

      assertEquals(result.ok, false);
      if (!result.ok) {
        assertEquals(result.response.status, 429);
        const body = await result.response.json();
        assertEquals(body.error, 'rate_limited');
      }
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) {
        Deno.env.delete('RESEND_API_KEY');
      } else {
        Deno.env.set('RESEND_API_KEY', originalKey);
      }
    }
  },
});

Deno.test({
  name: 'sendEmailViaResend: returns 502 on upstream failure',
  fn: async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = Deno.env.get('RESEND_API_KEY');
    try {
      Deno.env.set('RESEND_API_KEY', 're_test_key');
      Deno.env.set('RESEND_FROM_EMAIL', 'test@example.com');

      globalThis.fetch = () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ error: 'Internal server error' }),
            { status: 500 },
          ),
        );

      const result = await sendEmailViaResend({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
        pdfBase64: 'dGVzdA==',
      });

      assertEquals(result.ok, false);
      if (!result.ok) {
        assertEquals(result.response.status, 502);
        const body = await result.response.json();
        assertEquals(body.error, 'email_delivery_failed');
      }
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) {
        Deno.env.delete('RESEND_API_KEY');
      } else {
        Deno.env.set('RESEND_API_KEY', originalKey);
      }
    }
  },
});

Deno.test({
  name: 'sendEmailViaResend: returns 502 on network error',
  fn: async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = Deno.env.get('RESEND_API_KEY');
    try {
      Deno.env.set('RESEND_API_KEY', 're_test_key');
      Deno.env.set('RESEND_FROM_EMAIL', 'test@example.com');

      globalThis.fetch = () => Promise.reject(new Error('Network failure'));

      const result = await sendEmailViaResend({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
        pdfBase64: 'dGVzdA==',
      });

      assertEquals(result.ok, false);
      if (!result.ok) {
        assertEquals(result.response.status, 502);
      }
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) {
        Deno.env.delete('RESEND_API_KEY');
      } else {
        Deno.env.set('RESEND_API_KEY', originalKey);
      }
    }
  },
});

Deno.test({
  name: 'sendEmailViaResend: sends with array to recipients',
  fn: async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = Deno.env.get('RESEND_API_KEY');
    try {
      Deno.env.set('RESEND_API_KEY', 're_test_key');
      Deno.env.set('RESEND_FROM_EMAIL', 'Test <test@example.com>');

      let requestBody: unknown = null;
      globalThis.fetch = (url: string | URL, opts?: RequestInit) => {
        if (String(url).includes('api.resend.com')) {
          requestBody = JSON.parse(opts?.body as string);
          return Promise.resolve(
            new Response(JSON.stringify({ id: 'msg-456' }), { status: 200 }),
          );
        }
        return Promise.resolve(new Response('OK', { status: 200 }));
      };

      const result = await sendEmailViaResend({
        to: ['a@example.com', 'b@example.com'],
        subject: 'Group Report',
        html: '<p>Group test</p>',
        pdfBase64: 'dGVzdA==',
      });

      assertEquals(result.ok, true);
      const body = requestBody as Record<string, unknown>;
      assertEquals(Array.isArray(body.to), true);
      assertEquals((body.to as string[]).length, 2);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) {
        Deno.env.delete('RESEND_API_KEY');
      } else {
        Deno.env.set('RESEND_API_KEY', originalKey);
      }
    }
  },
});

// =============================================================================
// 4. Handler entrypoint — method validation, CORS, error propagation
// =============================================================================

Deno.test({
  name: 'handleRequest: rejects GET method',
  fn: async () => {
    const request = new Request('http://localhost', { method: 'GET' });
    const response = await handleRequest(request);
    assertEquals(response.status, 405);

    const body = await response.json();
    assertEquals(body.error, 'Method not allowed');
  },
});

Deno.test({
  name: 'handleRequest: handles OPTIONS preflight (CORS)',
  fn: async () => {
    const request = new Request('http://localhost', { method: 'OPTIONS' });
    const response = await handleRequest(request);
    assertEquals(response.status, 204);

    const corsOrigin = response.headers.get('Access-Control-Allow-Origin');
    assertEquals(corsOrigin, '*');
  },
});

Deno.test({
  name: 'handleRequest: returns 401 with injected mock (no auth)',
  fn: async () => {
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
        to: 'user@example.com',
        subject: 'Test',
        template_code: 'ot-default',
        data: { title: 'Test' },
      }),
    });

    const response = await handleRequest(request, supabase);
    assertEquals(response.status, 401);

    const body = await response.json();
    assertEquals(body.error, 'unauthorized');
  },
});

Deno.test({
  name: 'handleRequest: returns 404 when record_id not found (propagates from resolveDataFromDB)',
  fn: async () => {
    const supabase = mockSupabase({
      authGetUser: () =>
        Promise.resolve({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      // Return null data — simulates record not found
      queryResult: { data: null, error: null },
    });

    const request = new Request('http://localhost', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-token' },
      body: JSON.stringify({
        to: 'user@example.com',
        subject: 'Test 404',
        template_code: 'ot-default',
        record_id: 'nonexistent-wo',
      }),
    });

    const response = await handleRequest(request, supabase);
    assertEquals(response.status, 404);

    const body = await response.json();
    assertEquals(body.error, 'record_not_found');
    assertEquals(body.record_id, 'nonexistent-wo');
  },
});

Deno.test({
  name: 'handleRequest: returns 400 with injected mock (invalid payload)',
  fn: async () => {
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
      body: JSON.stringify({
        to: 'invalid',
        subject: 'Test',
        template_code: 'ot-default',
        record_id: 'wo-123',
      }),
    });

    const response = await handleRequest(request, supabase);
    assertEquals(response.status, 400);

    const body = await response.json();
    assertEquals(body.error, 'invalid_payload');
  },
});

// =============================================================================
// 4b. Internal Auth — X-Internal-Secret bypass (TDD RED)
// =============================================================================

Deno.test({
  name:
    'handleRequest: valid internal secret bypasses JWT and proceeds',
  fn: async () => {
    const originalFetch = globalThis.fetch;
    const originalInternalSecret = Deno.env.get('INTERNAL_SECRET');
    const originalKey = Deno.env.get('RESEND_API_KEY');
    const originalFrom = Deno.env.get('RESEND_FROM_EMAIL');
    const originalBrowserless = Deno.env.get('BROWSERLESS_API_KEY');

    try {
      Deno.env.set('INTERNAL_SECRET', 'valid-internal-secret');
      Deno.env.set('RESEND_API_KEY', 're_test_internal');
      Deno.env.set('RESEND_FROM_EMAIL', 'Test <test@example.com>');
      Deno.env.set('BROWSERLESS_API_KEY', 'bl_internal_key');

      // Mock supabase that FAILS auth — to prove the bypass works
      const supabase = mockSupabase({
        authGetUser: () =>
          Promise.resolve({
            data: { user: null },
            error: new Error('Should not reach here'),
          }),
        queryResult: {
          data: {
            id: 'tmpl-internal',
            code: 'ot-default',
            template: {
              id: 'test-internal',
              name: 'Internal Test',
              sections: [{ type: 'title', text: '{{title}}' }],
            },
          },
          error: null,
        },
      });

      globalThis.fetch = (url: string | URL, opts?: RequestInit) => {
        if (String(url).includes('chrome.browserless.io')) {
          const pdfBuffer = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]);
          return Promise.resolve(
            new Response(pdfBuffer, {
              status: 200,
              headers: { 'Content-Type': 'application/pdf' },
            }),
          );
        }
        if (String(url).includes('api.resend.com')) {
          return Promise.resolve(
            new Response(JSON.stringify({ id: 'msg-internal-ok' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
        return Promise.resolve(new Response('OK', { status: 200 }));
      };

      const request = new Request('http://localhost', {
        method: 'POST',
        headers: { 'X-Internal-Secret': 'valid-internal-secret' },
        body: JSON.stringify({
          to: 'admin@example.com',
          subject: 'Internal Report',
          template_code: 'ot-default',
          data: { title: 'Test' },
        }),
      });

      const response = await handleRequest(request, supabase);
      assertEquals(response.status, 200);

      const body = await response.json();
      assertExists(body.messageId);
      assertEquals(body.messageId, 'msg-internal-ok');
    } finally {
      globalThis.fetch = originalFetch;
      if (originalInternalSecret === undefined) Deno.env.delete('INTERNAL_SECRET');
      else Deno.env.set('INTERNAL_SECRET', originalInternalSecret);
      if (originalKey === undefined) Deno.env.delete('RESEND_API_KEY');
      else Deno.env.set('RESEND_API_KEY', originalKey);
      if (originalFrom === undefined) Deno.env.delete('RESEND_FROM_EMAIL');
      else Deno.env.set('RESEND_FROM_EMAIL', originalFrom);
      if (originalBrowserless === undefined) Deno.env.delete('BROWSERLESS_API_KEY');
      else Deno.env.set('BROWSERLESS_API_KEY', originalBrowserless);
    }
  },
});

Deno.test({
  name: 'handleRequest: invalid internal secret returns 401',
  fn: async () => {
    const originalInternalSecret = Deno.env.get('INTERNAL_SECRET');

    try {
      Deno.env.set('INTERNAL_SECRET', 'the-real-secret');

      // No mock supabase needed — should fail before reaching DB
      const request = new Request('http://localhost', {
        method: 'POST',
        headers: { 'X-Internal-Secret': 'wrong-secret' },
        body: JSON.stringify({
          to: 'admin@example.com',
          subject: 'Unauthorized',
          template_code: 'ot-default',
          data: { title: 'Test' },
        }),
      });

      const response = await handleRequest(request);
      assertEquals(response.status, 401);

      const body = await response.json();
      assertEquals(body.error, 'unauthorized');
    } finally {
      if (originalInternalSecret === undefined) Deno.env.delete('INTERNAL_SECRET');
      else Deno.env.set('INTERNAL_SECRET', originalInternalSecret);
    }
  },
});

Deno.test({
  name:
    'handleRequest: missing internal secret falls through to JWT auth (returns 401)',
  fn: async () => {
    const originalInternalSecret = Deno.env.get('INTERNAL_SECRET');

    try {
      Deno.env.set('INTERNAL_SECRET', 'valid-internal-secret');

      // Mock supabase that returns auth failure
      const supabase = mockSupabase({
        authGetUser: () =>
          Promise.resolve({
            data: { user: null },
            error: new Error('No token'),
          }),
      });

      // No X-Internal-Secret header → falls through to JWT auth
      const request = new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'user@example.com',
          subject: 'Test',
          template_code: 'ot-default',
          data: { title: 'Test' },
        }),
      });

      const response = await handleRequest(request, supabase);
      assertEquals(response.status, 401);

      const body = await response.json();
      assertEquals(body.error, 'unauthorized');
    } finally {
      if (originalInternalSecret === undefined) Deno.env.delete('INTERNAL_SECRET');
      else Deno.env.set('INTERNAL_SECRET', originalInternalSecret);
    }
  },
});

Deno.test({
  name:
    'handleRequest: full flow with internal secret and mocked dependencies',
  fn: async () => {
    const originalFetch = globalThis.fetch;
    const originalInternalSecret = Deno.env.get('INTERNAL_SECRET');
    const originalKey = Deno.env.get('RESEND_API_KEY');
    const originalFrom = Deno.env.get('RESEND_FROM_EMAIL');
    const originalBrowserless = Deno.env.get('BROWSERLESS_API_KEY');

    try {
      Deno.env.set('INTERNAL_SECRET', 'integration-secret');
      Deno.env.set('RESEND_API_KEY', 're_test_integration');
      Deno.env.set('RESEND_FROM_EMAIL', 'CMMS <test@cmms.com>');
      Deno.env.set('BROWSERLESS_API_KEY', 'bl_integration_key');

      const supabase = mockSupabase({
        authGetUser: () =>
          Promise.resolve({
            data: { user: null },
            error: new Error('Should not reach auth'),
          }),
        queryResult: {
          data: {
            id: 'tmpl-flow',
            code: 'ot-default',
            template: {
              id: 'test-flow',
              name: 'Full Flow Internal',
              sections: [
                { type: 'title', text: '{{title}}' },
                {
                  type: 'label-value',
                  label: 'Equipo',
                  value: '{{equipment_id}}',
                },
              ],
            },
          },
          error: null,
        },
        insertError: null,
      });

      let resendRequestBody: unknown = null;

      globalThis.fetch = (url: string | URL, opts?: RequestInit) => {
        const urlStr = String(url);
        if (urlStr.includes('chrome.browserless.io')) {
          const pdfBuffer = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]);
          return Promise.resolve(
            new Response(pdfBuffer, {
              status: 200,
              headers: { 'Content-Type': 'application/pdf' },
            }),
          );
        }
        if (urlStr.includes('api.resend.com')) {
          resendRequestBody = JSON.parse(opts?.body as string);
          return Promise.resolve(
            new Response(JSON.stringify({ id: 'msg-flow-internal' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
        return Promise.resolve(new Response('OK', { status: 200 }));
      };

      const request = new Request('http://localhost', {
        method: 'POST',
        headers: { 'X-Internal-Secret': 'integration-secret' },
        body: JSON.stringify({
          to: ['admin@planta.com', 'supervisor@planta.com'],
          subject: 'Reporte Diario - Órdenes de Trabajo',
          template_code: 'ot-default',
          data: { title: 'WO Report', equipment_id: 'EQ-001' },
        }),
      });

      const response = await handleRequest(request, supabase);
      assertEquals(response.status, 200);

      const body = await response.json();
      assertExists(body.messageId);
      assertEquals(body.messageId, 'msg-flow-internal');

      // Verify Resend request body
      const resendBody = resendRequestBody as Record<string, unknown>;
      assertEquals(resendBody.subject, 'Reporte Diario - Órdenes de Trabajo');
      const attachments = resendBody.attachments as Array<Record<string, unknown>>;
      assertEquals(attachments.length, 1);
      assertEquals(attachments[0].filename, 'report.pdf');
      assertEquals(attachments[0].type, 'application/pdf');
    } finally {
      globalThis.fetch = originalFetch;
      if (originalInternalSecret === undefined) Deno.env.delete('INTERNAL_SECRET');
      else Deno.env.set('INTERNAL_SECRET', originalInternalSecret);
      if (originalKey === undefined) Deno.env.delete('RESEND_API_KEY');
      else Deno.env.set('RESEND_API_KEY', originalKey);
      if (originalFrom === undefined) Deno.env.delete('RESEND_FROM_EMAIL');
      else Deno.env.set('RESEND_FROM_EMAIL', originalFrom);
      if (originalBrowserless === undefined) Deno.env.delete('BROWSERLESS_API_KEY');
      else Deno.env.set('BROWSERLESS_API_KEY', originalBrowserless);
    }
  },
});

// =============================================================================
// 5. Full flow integration (injected mocks — no real DB needed)
// =============================================================================

Deno.test({
  name:
    'handleRequest: full flow with injected mocks (auth + template + data + Browserless + Resend)',
  fn: async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = Deno.env.get('RESEND_API_KEY');
    const originalFrom = Deno.env.get('RESEND_FROM_EMAIL');
    const originalBrowserless = Deno.env.get('BROWSERLESS_API_KEY');

    try {
      // Set env vars for the handler
      Deno.env.set('RESEND_API_KEY', 're_test_integration');
      Deno.env.set('RESEND_FROM_EMAIL', 'CMMS <test@cmms.com>');
      Deno.env.set('BROWSERLESS_API_KEY', 'bl_test_key');

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
                {
                  type: 'label-value',
                  label: 'Equipo',
                  value: '{{equipment_id}}',
                },
              ],
            },
          },
          error: null,
        },
        insertError: null,
      });

      let resendRequestBody: unknown = null;

      globalThis.fetch = (url: string | URL, opts?: RequestInit) => {
        const urlStr = String(url);
        if (urlStr.includes('chrome.browserless.io')) {
          const pdfBuffer = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]);
          return Promise.resolve(
            new Response(pdfBuffer, {
              status: 200,
              headers: { 'Content-Type': 'application/pdf' },
            }),
          );
        }
        if (urlStr.includes('api.resend.com')) {
          resendRequestBody = JSON.parse(opts?.body as string);
          return Promise.resolve(
            new Response(JSON.stringify({ id: 'msg-integration-ok' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
        return Promise.resolve(new Response('OK', { status: 200 }));
      };

      const request = new Request('http://localhost', {
        method: 'POST',
        headers: { Authorization: 'Bearer integration-token' },
        body: JSON.stringify({
          to: 'user@example.com',
          subject: 'Reporte de integración',
          template_code: 'ot-default',
          record_id: 'wo-123',
          record_type: 'work_order',
        }),
      });

      const response = await handleRequest(request, supabase);
      assertEquals(response.status, 200);

      const body = await response.json();
      assertExists(body.messageId);
      assertEquals(body.messageId, 'msg-integration-ok');

      // Verify Resend request body included the PDF attachment
      const resendBody = resendRequestBody as Record<string, unknown>;
      assertEquals(resendBody.subject, 'Reporte de integración');
      const attachments = resendBody.attachments as Array<Record<string, unknown>>;
      assertEquals(attachments.length, 1);
      assertEquals(attachments[0].filename, 'report.pdf');
      assertEquals(attachments[0].type, 'application/pdf');
      const pdfContent = attachments[0].content as string;
      assertEquals(pdfContent, 'JVBGRi0xLjQ=');
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) Deno.env.delete('RESEND_API_KEY');
      else Deno.env.set('RESEND_API_KEY', originalKey);
      if (originalFrom === undefined) Deno.env.delete('RESEND_FROM_EMAIL');
      else Deno.env.set('RESEND_FROM_EMAIL', originalFrom);
      if (originalBrowserless === undefined) Deno.env.delete('BROWSERLESS_API_KEY');
      else Deno.env.set('BROWSERLESS_API_KEY', originalBrowserless);
    }
  },
});

Deno.test({
  name:
    'handleRequest: full flow with inline data (no record_id)',
  fn: async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = Deno.env.get('RESEND_API_KEY');
    const originalFrom = Deno.env.get('RESEND_FROM_EMAIL');
    const originalBrowserless = Deno.env.get('BROWSERLESS_API_KEY');

    try {
      Deno.env.set('RESEND_API_KEY', 're_test_inline');
      Deno.env.set('RESEND_FROM_EMAIL', 'CMMS <test@cmms.com>');
      Deno.env.set('BROWSERLESS_API_KEY', 'bl_inline_key');

      const supabase = mockSupabase({
        authGetUser: () =>
          Promise.resolve({
            data: { user: { id: 'user-inline' } },
            error: null,
          }),
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
        insertError: null,
      });

      globalThis.fetch = (url: string | URL, opts?: RequestInit) => {
        if (String(url).includes('chrome.browserless.io')) {
          const pdfBuffer = new Uint8Array([37, 80, 68, 70]);
          return Promise.resolve(
            new Response(pdfBuffer, {
              status: 200,
              headers: { 'Content-Type': 'application/pdf' },
            }),
          );
        }
        if (String(url).includes('api.resend.com')) {
          return Promise.resolve(
            new Response(JSON.stringify({ id: 'msg-inline-ok' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
        return Promise.resolve(new Response('OK', { status: 200 }));
      };

      const request = new Request('http://localhost', {
        method: 'POST',
        headers: { Authorization: 'Bearer inline-token' },
        body: JSON.stringify({
          to: 'admin@example.com',
          subject: 'Inline Report',
          template_code: 'ot-default',
          data: { title: 'Inline WO', status: 'COMP' },
        }),
      });

      const response = await handleRequest(request, supabase);
      assertEquals(response.status, 200);

      const body = await response.json();
      assertExists(body.messageId);
      assertEquals(body.messageId, 'msg-inline-ok');
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) Deno.env.delete('RESEND_API_KEY');
      else Deno.env.set('RESEND_API_KEY', originalKey);
      if (originalFrom === undefined) Deno.env.delete('RESEND_FROM_EMAIL');
      else Deno.env.set('RESEND_FROM_EMAIL', originalFrom);
      if (originalBrowserless === undefined) Deno.env.delete('BROWSERLESS_API_KEY');
      else Deno.env.set('BROWSERLESS_API_KEY', originalBrowserless);
    }
  },
});

Deno.test({
  name:
    'handleRequest: returns 502 when Browserless fails (503 all retries exhausted)',
  fn: async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = Deno.env.get('RESEND_API_KEY');
    const originalFrom = Deno.env.get('RESEND_FROM_EMAIL');
    const originalBrowserless = Deno.env.get('BROWSERLESS_API_KEY');

    try {
      Deno.env.set('RESEND_API_KEY', 're_test');
      Deno.env.set('RESEND_FROM_EMAIL', 'test@example.com');
      Deno.env.set('BROWSERLESS_API_KEY', 'bl_test');

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

      globalThis.fetch = (url: string | URL) => {
        if (String(url).includes('chrome.browserless.io')) {
          return Promise.resolve(new Response('Unavailable', { status: 503 }));
        }
        return Promise.resolve(new Response('OK', { status: 200 }));
      };

      const request = new Request('http://localhost', {
        method: 'POST',
        headers: { Authorization: 'Bearer valid-token' },
        body: JSON.stringify({
          to: 'user@example.com',
          subject: 'Test',
          template_code: 'ot-default',
          data: { title: 'Test' },
        }),
      });

      const response = await handleRequest(request, supabase);
      assertEquals(response.status, 502);

      const body = await response.json();
      assertEquals(body.error, 'pdf_generation_failed');
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) Deno.env.delete('RESEND_API_KEY');
      else Deno.env.set('RESEND_API_KEY', originalKey);
      if (originalFrom === undefined) Deno.env.delete('RESEND_FROM_EMAIL');
      else Deno.env.set('RESEND_FROM_EMAIL', originalFrom);
      if (originalBrowserless === undefined) Deno.env.delete('BROWSERLESS_API_KEY');
      else Deno.env.set('BROWSERLESS_API_KEY', originalBrowserless);
    }
  },
});
