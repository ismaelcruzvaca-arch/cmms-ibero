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
// HELPERS
// =============================================================================

/** Save original env var value, delete it for test, return restore function. */
function withoutSupabaseUrl(): () => void {
  const saved = Deno.env.get("SUPABASE_URL");
  Deno.env.delete("SUPABASE_URL");
  return () => {
    if (saved) Deno.env.set("SUPABASE_URL", saved);
  };
}

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
  const restore = withoutSupabaseUrl();

  const result = await lookupMaterialRequest(1001);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 500);
  }

  restore();
});

Deno.test("insertReceiptTransaction: returns server error without env vars", async () => {
  const restore = withoutSupabaseUrl();

  const result = await insertReceiptTransaction(
    { id: "test-id", work_order_id: "WO-001", part_num: "BOLT-M10-SS" },
    { ReqNum: 1001, PartNum: "BOLT-M10-SS", ReceivedQty: 50, PONum: "PO-2026-0420" },
  );
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 500);
  }

  restore();
});

Deno.test("clearWorkOrderBlock: returns server error without env vars", async () => {
  const restore = withoutSupabaseUrl();

  const result = await clearWorkOrderBlock("WO-001");
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 500);
  }

  restore();
});

// =============================================================================
// INTEGRATION TEST: Full DB round-trip (requires Supabase credentials)
// =============================================================================
// Seeds test data dynamically, runs the webhook, then cleans up.
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY pointing to local Supabase.

Deno.test({
  name: "handleRequest: full flow with DB (local Supabase)",
  ignore: !Deno.env.get("SUPABASE_URL") || !Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // ── Pre-clean: remove any leftover test data from previous runs ─
    await supabase.from("material_requests").delete().eq("req_num", 9999);
    await supabase.from("inventory_transactions").delete().eq("reason_code", "PO: TEST-PO-001");
    await supabase.from("work_orders").delete().eq("equipment_id", "TEST-EQ-001");
    await supabase.from("spare_parts").delete().eq("part_num", "TEST-PART-001");

    // ── Seed: spare_part ──────────────────────────────────────────
    const { error: spErr } = await supabase
      .from("spare_parts")
      .upsert({ part_num: "TEST-PART-001", description: "Test part for integration", uom: "EA" })
      .select();
    if (spErr) throw new Error(`Failed to seed spare_parts: ${spErr.message}`);

    // ── Seed: work_order with MATERIAL block ───────────────────────
    const woId = crypto.randomUUID();
    const { error: woErr } = await supabase
      .from("work_orders")
      .insert({
        id: woId,
        equipment_id: "TEST-EQ-001",
        wo_type: "corrective",
        lifecycle_phase: "WAPPR",
        block_reason: "MATERIAL",
      })
      .select();
    if (woErr) throw new Error(`Failed to seed work_orders: ${woErr.message}`);

    // ── Seed: material_request with req_num = 9999 ────────────────
    const { data: mrData, error: mrErr } = await supabase
      .from("material_requests")
      .insert({
        work_order_id: woId,
        part_num: "TEST-PART-001",
        line_desc: "Integration test material request",
        requested_qty: 1,
        req_num: 9999,
        is_non_stock: false,
      })
      .select("id, work_order_id, part_num")
      .single();
    if (mrErr) throw new Error(`Failed to seed material_requests: ${mrErr.message}`);
    assertEquals(mrData.part_num, "TEST-PART-001", "Seeded material_request.part_num should persist");

    // ── Cleanup function (runs regardless of test outcome) ────────
    async function cleanup() {
      await supabase.from("material_requests").delete().eq("req_num", 9999);
      await supabase.from("inventory_transactions").delete().eq("reason_code", "PO: TEST-PO-001");
      await supabase.from("work_orders").delete().eq("id", woId);
      await supabase.from("spare_parts").delete().eq("part_num", "TEST-PART-001");
    }

    try {
      // ── Execute webhook ─────────────────────────────────────────
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

      // ── Assert 200 OK ───────────────────────────────────────────
      assertEquals(
        response.status,
        200,
        `Expected 200, got ${response.status}: ${JSON.stringify(body)}`,
      );
      assertEquals(body.success, true);
      assertEquals(body.req_num, 9999);
      assertEquals(body.part_num, "TEST-PART-001");
      assertEquals(body.qty, 10);
      assertEquals(body.work_order_id, woId);

      // ── Verify inventory_transaction was created ────────────────
      const { data: tx, error: txError } = await supabase
        .from("inventory_transactions")
        .select("*")
        .eq("reason_code", "PO: TEST-PO-001")
        .limit(1)
        .maybeSingle();

      assertEquals(txError, null, `inventory_transactions query error: ${txError?.message}`);
      assertExists(tx, "Expected inventory_transaction to exist");
      assertEquals(tx.transaction_type, "RECEIPT");
      assertEquals(tx.qty, 10);
      assertEquals(tx.part_num, "TEST-PART-001");
      assertEquals(tx.work_order_id, woId);

      // ── Verify work order block was cleared ─────────────────────
      const { data: wo, error: woError } = await supabase
        .from("work_orders")
        .select("block_reason")
        .eq("id", woId)
        .single();

      assertEquals(woError, null, `work_orders query error: ${woError?.message}`);
      assertExists(wo);
      assertEquals(wo.block_reason, "NONE");
    } finally {
      await cleanup();
    }
  },
});
