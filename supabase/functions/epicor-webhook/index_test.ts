import {
  assertEquals,
  assertExists,
} from "jsr:@std/assert";
import { createClient } from "@supabase/supabase-js";
import {
  validateAuth,
  validatePayload,
  handleRequest,
  lookupMaterialRequest,
  insertReceiptTransaction,
  clearWorkOrderBlock,
} from "./index.ts";

// =============================================================================
// UNIT TESTS: Auth Validation
// =============================================================================

Deno.test("validateAuth: accepts valid Bearer token", () => {
  Deno.env.set("EPICOR_WEBHOOK_SECRET", "test-secret-123");

  const request = new Request("http://localhost", {
    headers: { Authorization: "Bearer test-secret-123" },
  });

  const result = validateAuth(request);
  assertEquals(result.ok, true);
});

Deno.test("validateAuth: rejects missing Authorization header", () => {
  Deno.env.set("EPICOR_WEBHOOK_SECRET", "test-secret-123");

  const request = new Request("http://localhost");
  const result = validateAuth(request);

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 401);
  }
});

Deno.test("validateAuth: rejects invalid Bearer token (errónea)", () => {
  Deno.env.set("EPICOR_WEBHOOK_SECRET", "test-secret-123");

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
  Deno.env.set("EPICOR_WEBHOOK_SECRET", "test-secret-123");

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

Deno.test("validatePayload: accepts valid Epicor receipt payload", async () => {
  const request = new Request("http://localhost", {
    method: "POST",
    body: JSON.stringify({
      ReqNum: 1001,
      PartNum: "BOLT-M10-SS",
      ReceivedQty: 50,
      PONum: "PO-2026-0420",
    }),
  });

  const result = await validatePayload(request);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.payload.ReqNum, 1001);
    assertEquals(result.payload.PartNum, "BOLT-M10-SS");
    assertEquals(result.payload.ReceivedQty, 50);
    assertEquals(result.payload.PONum, "PO-2026-0420");
  }
});

Deno.test("validatePayload: rejects missing ReqNum", async () => {
  const request = new Request("http://localhost", {
    method: "POST",
    body: JSON.stringify({
      PartNum: "BOLT-M10-SS",
      ReceivedQty: 50,
      PONum: "PO-2026-0420",
    }),
  });

  const result = await validatePayload(request);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 400);
  }
});

Deno.test("validatePayload: rejects malformed JSON (payload malformado)", async () => {
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

Deno.test("validatePayload: rejects empty PartNum", async () => {
  const request = new Request("http://localhost", {
    method: "POST",
    body: JSON.stringify({
      ReqNum: 1001,
      PartNum: "",
      ReceivedQty: 50,
      PONum: "PO-2026-0420",
    }),
  });

  const result = await validatePayload(request);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 400);
  }
});

Deno.test("validatePayload: rejects zero ReceivedQty", async () => {
  const request = new Request("http://localhost", {
    method: "POST",
    body: JSON.stringify({
      ReqNum: 1001,
      PartNum: "BOLT-M10-SS",
      ReceivedQty: 0,
      PONum: "PO-2026-0420",
    }),
  });

  const result = await validatePayload(request);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 400);
  }
});

Deno.test("validatePayload: rejects non-number ReqNum", async () => {
  const request = new Request("http://localhost", {
    method: "POST",
    body: JSON.stringify({
      ReqNum: "NOT-A-NUMBER",
      PartNum: "BOLT-M10-SS",
      ReceivedQty: 50,
      PONum: "PO-2026-0420",
    }),
  });

  const result = await validatePayload(request);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 400);
  }
});

// =============================================================================
// INTEGRATION TEST: End-to-end handler flow
// =============================================================================

Deno.test("handleRequest: rejects GET method", async () => {
  const request = new Request("http://localhost", { method: "GET" });
  const response = await handleRequest(request);
  assertEquals(response.status, 405);
});

Deno.test("handleRequest: returns 401 without auth header", async () => {
  const request = new Request("http://localhost", {
    method: "POST",
    body: JSON.stringify({
      ReqNum: 1001,
      PartNum: "BOLT-M10-SS",
      ReceivedQty: 50,
      PONum: "PO-2026-0420",
    }),
  });

  const response = await handleRequest(request);
  assertEquals(response.status, 401);

  const body = await response.json();
  assertEquals(body.error, "Unauthorized");
});

Deno.test("handleRequest: returns 400 with invalid payload", async () => {
  Deno.env.set("EPICOR_WEBHOOK_SECRET", "test-secret-123");

  const request = new Request("http://localhost", {
    method: "POST",
    headers: { Authorization: "Bearer test-secret-123" },
    body: JSON.stringify({ ReqNum: 1001 }),  // Missing PartNum, ReceivedQty, PONum
  });

  const response = await handleRequest(request);
  assertEquals(response.status, 400);

  const body = await response.json();
  assertEquals(body.error, "Invalid payload");
});

// =============================================================================
// UNIT TESTS: Mocked successful processing (sin DB real)
// =============================================================================

Deno.test("lookupMaterialRequest: returns server error without env vars", async () => {
  Deno.env.delete("SUPABASE_URL");

  const result = await lookupMaterialRequest(1001);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 500);
  }

  Deno.env.set("SUPABASE_URL", "http://localhost");
});

Deno.test("insertReceiptTransaction: returns server error without env vars", async () => {
  Deno.env.delete("SUPABASE_URL");

  const result = await insertReceiptTransaction(
    { id: "test-id", work_order_id: "WO-001", part_num: "BOLT-M10-SS" },
    { ReqNum: 1001, PartNum: "BOLT-M10-SS", ReceivedQty: 50, PONum: "PO-2026-0420" },
  );
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 500);
  }

  Deno.env.set("SUPABASE_URL", "http://localhost");
});

Deno.test("clearWorkOrderBlock: returns server error without env vars", async () => {
  Deno.env.delete("SUPABASE_URL");

  const result = await clearWorkOrderBlock("WO-001");
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 500);
  }

  Deno.env.set("SUPABASE_URL", "http://localhost");
});

// =============================================================================
// INTEGRATION TEST: Full DB round-trip (requires Supabase credentials)
// =============================================================================
// Skipped by default because it requires live Supabase credentials.
// To enable: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, and ensure
// the material_requests table contains a row with req_num = 9999.

Deno.test({
  name: "handleRequest: full flow with DB (requires env vars)",
  ignore: !Deno.env.get("SUPABASE_URL") || !Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  fn: async () => {
    Deno.env.set("EPICOR_WEBHOOK_SECRET", "integration-test-secret");

    const request = new Request("http://localhost", {
      method: "POST",
      headers: { Authorization: "Bearer integration-test-secret" },
      body: JSON.stringify({
        ReqNum: 9999,
        PartNum: "TEST-PART-001",
        ReceivedQty: 10,
        PONum: "TEST-PO-001",
      }),
    });

    const response = await handleRequest(request);
    const body = await response.json();

    // With valid credentials, expect 200, 404 (req not found), or 500
    if (response.status === 200) {
      assertEquals(body.success, true);
      assertEquals(body.req_num, 9999);
      assertEquals(body.part_num, "TEST-PART-001");
      assertEquals(body.qty, 10);
      assertExists(body.work_order_id);

      // Verify inventory_transaction was created
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, serviceRoleKey);

      const { data: tx, error: txError } = await supabase
        .from("inventory_transactions")
        .select("*")
        .eq("reason_code", "TEST-PO-001")
        .limit(1)
        .maybeSingle();

      assertEquals(txError, null);
      assertExists(tx);
      assertEquals(tx.transaction_type, "RECEIPT");
      assertEquals(tx.qty, 10);

      // Verify work order block was cleared
      const { data: wo, error: woError } = await supabase
        .from("work_orders")
        .select("block_reason")
        .eq("id", body.work_order_id)
        .single();

      assertEquals(woError, null);
      assertEquals(wo.block_reason, "NONE");
    } else if (response.status === 404) {
      assertEquals(body.error, "Material request not found for ReqNum 9999");
    } else {
      throw new Error(`Unexpected status: ${response.status} - ${JSON.stringify(body)}`);
    }
  },
});
