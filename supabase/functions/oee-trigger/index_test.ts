import {
  assertEquals,
  assertExists,
  assertNotEquals,
} from "jsr:@std/assert";
import { validateAuth, validatePayload, handleRequest } from "./index.ts";

// =============================================================================
// UNIT TESTS: Auth Validation
// =============================================================================

Deno.test("validateAuth: accepts valid Bearer token", () => {
  Deno.env.set("OEE_SECRET_KEY", "test-secret-123");

  const request = new Request("http://localhost", {
    headers: { Authorization: "Bearer test-secret-123" },
  });

  const result = validateAuth(request);
  assertEquals(result.ok, true);
});

Deno.test("validateAuth: rejects missing Authorization header", () => {
  Deno.env.set("OEE_SECRET_KEY", "test-secret-123");

  const request = new Request("http://localhost");
  const result = validateAuth(request);

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 401);
  }
});

Deno.test("validateAuth: rejects invalid Bearer token", () => {
  Deno.env.set("OEE_SECRET_KEY", "test-secret-123");

  const request = new Request("http://localhost", {
    headers: { Authorization: "Bearer wrong-secret" },
  });

  const result = validateAuth(request);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 401);
  }
});

Deno.test("validateAuth: rejects malformed Authorization header", () => {
  Deno.env.set("OEE_SECRET_KEY", "test-secret-123");

  const request = new Request("http://localhost", {
    headers: { Authorization: "Basic dXNlcjpwYXNz" },
  });

  const result = validateAuth(request);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 401);
  }
});

// =============================================================================
// UNIT TESTS: Payload Validation
// =============================================================================

Deno.test("validatePayload: accepts valid JSON payload", async () => {
  const request = new Request("http://localhost", {
    method: "POST",
    body: JSON.stringify({
      equipment_id: "EQ-001",
      sintoma: "Motor overheating",
    }),
  });

  const result = await validatePayload(request);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.payload.equipment_id, "EQ-001");
    assertEquals(result.payload.sintoma, "Motor overheating");
  }
});

Deno.test("validatePayload: rejects missing equipment_id", async () => {
  const request = new Request("http://localhost", {
    method: "POST",
    body: JSON.stringify({ sintoma: "Motor overheating" }),
  });

  const result = await validatePayload(request);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 400);
  }
});

Deno.test("validatePayload: rejects missing sintoma", async () => {
  const request = new Request("http://localhost", {
    method: "POST",
    body: JSON.stringify({ equipment_id: "EQ-001" }),
  });

  const result = await validatePayload(request);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 400);
  }
});

Deno.test("validatePayload: rejects empty equipment_id string", async () => {
  const request = new Request("http://localhost", {
    method: "POST",
    body: JSON.stringify({
      equipment_id: "",
      sintoma: "Motor overheating",
    }),
  });

  const result = await validatePayload(request);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 400);
  }
});

Deno.test("validatePayload: rejects empty sintoma string", async () => {
  const request = new Request("http://localhost", {
    method: "POST",
    body: JSON.stringify({
      equipment_id: "EQ-001",
      sintoma: "",
    }),
  });

  const result = await validatePayload(request);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 400);
  }
});

Deno.test("validatePayload: rejects malformed JSON", async () => {
  const request = new Request("http://localhost", {
    method: "POST",
    body: "not-json-at-all",
  });

  const result = await validatePayload(request);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 400);
  }
});

Deno.test("validatePayload: rejects non-string equipment_id", async () => {
  const request = new Request("http://localhost", {
    method: "POST",
    body: JSON.stringify({
      equipment_id: 12345,
      sintoma: "Motor overheating",
    }),
  });

  const result = await validatePayload(request);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 400);
  }
});

// =============================================================================
// INTEGRATION TEST: End-to-end handler flow (auth + payload)
// =============================================================================
// NOTE: Full integration tests requiring Supabase DB access are documented below.
// To run them, set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.

Deno.test("handleRequest: rejects GET method", async () => {
  const request = new Request("http://localhost", { method: "GET" });
  const response = await handleRequest(request);
  assertEquals(response.status, 405);
});

Deno.test("handleRequest: returns 401 without auth header", async () => {
  const request = new Request("http://localhost", {
    method: "POST",
    body: JSON.stringify({
      equipment_id: "EQ-001",
      sintoma: "Motor overheating",
    }),
  });

  const response = await handleRequest(request);
  assertEquals(response.status, 401);

  const body = await response.json();
  assertEquals(body.error, "Unauthorized");
});

Deno.test("handleRequest: returns 400 with invalid payload", async () => {
  Deno.env.set("OEE_SECRET_KEY", "test-secret-123");

  const request = new Request("http://localhost", {
    method: "POST",
    headers: { Authorization: "Bearer test-secret-123" },
    body: JSON.stringify({ equipment_id: "EQ-001" }),
  });

  const response = await handleRequest(request);
  assertEquals(response.status, 400);

  const body = await response.json();
  assertEquals(body.error, "Invalid payload");
});

// =============================================================================
// INTEGRATION TEST: Full DB round-trip (requires Supabase credentials)
// =============================================================================
// Skipped by default because it requires live Supabase credentials.
// To enable: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, and ensure
// the assets table contains a row with equipment_id = 'TEST-EQ-001'.

Deno.test({
  name: "handleRequest: full flow with DB (requires env vars)",
  ignore: !Deno.env.get("SUPABASE_URL") || !Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  fn: async () => {
    Deno.env.set("OEE_SECRET_KEY", "integration-test-secret");

    const request = new Request("http://localhost", {
      method: "POST",
      headers: { Authorization: "Bearer integration-test-secret" },
      body: JSON.stringify({
        equipment_id: "TEST-EQ-001",
        sintoma: "Integration test symptom",
      }),
    });

    const response = await handleRequest(request);
    const body = await response.json();

    // With valid credentials, expect 200 or 404 (if test asset doesn't exist)
    if (response.status === 200) {
      assertExists(body.id);
      assertNotEquals(body.id, "");
      // UUID v4 format check
      const uuidV4Regex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      assertEquals(uuidV4Regex.test(body.id), true);
    } else if (response.status === 404) {
      assertEquals(body.error, "Equipment not found");
    } else {
      throw new Error(`Unexpected status: ${response.status} - ${JSON.stringify(body)}`);
    }
  },
});
