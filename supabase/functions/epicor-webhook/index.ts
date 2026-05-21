import { createClient } from "@supabase/supabase-js";

/**
 * Epicor Webhook Edge Function
 *
 * Receives synchronous material receipt alerts from Epicor ERP via BPM Outbound.
 * Validates Bearer auth, looks up the material request, records the receipt,
 * and updates the work order block reason.
 */

// ---------------------------------------------------------------------------
// 1. Auth validation: Bearer token must match EPICOR_WEBHOOK_SECRET
// ---------------------------------------------------------------------------
export function validateAuth(request: Request): { ok: true } | { ok: false; response: Response } {
  const authHeader = request.headers.get("Authorization");
  const secretKey = Deno.env.get("EPICOR_WEBHOOK_SECRET");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  const token = authHeader.slice(7);
  if (token !== secretKey) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// 2. Payload validation: JSON with ReqNum, PartNum, ReceivedQty, PONum
// ---------------------------------------------------------------------------
export interface EpicorReceiptPayload {
  ReqNum: number;
  PartNum: string;
  ReceivedQty: number;
  PONum: string;
}

export async function validatePayload(
  request: Request,
): Promise<
  | { ok: true; payload: EpicorReceiptPayload }
  | { ok: false; response: Response }
> {
  let body: Record<string, unknown>;

  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Invalid payload" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  if (
    typeof body.ReqNum !== "number" ||
    typeof body.PartNum !== "string" ||
    body.PartNum.trim() === "" ||
    typeof body.ReceivedQty !== "number" ||
    body.ReceivedQty <= 0 ||
    typeof body.PONum !== "string" ||
    body.PONum.trim() === ""
  ) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Invalid payload" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  return {
    ok: true,
    payload: {
      ReqNum: body.ReqNum,
      PartNum: body.PartNum,
      ReceivedQty: body.ReceivedQty,
      PONum: body.PONum,
    },
  };
}

// ---------------------------------------------------------------------------
// 3. Material request lookup: find by req_num
// ---------------------------------------------------------------------------
export interface MaterialRequestRow {
  id: string;
  work_order_id: string;
  part_num: string | null;
}

export async function lookupMaterialRequest(
  reqNum: number,
): Promise<
  | { ok: true; request: MaterialRequestRow }
  | { ok: false; response: Response }
> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: request, error } = await supabase
    .from("material_requests")
    .select("id, work_order_id, part_num")
    .eq("req_num", reqNum)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Material request lookup error:", error);
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  if (!request) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: `Material request not found for ReqNum ${reqNum}` }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      ),
    };
  }

  return { ok: true, request };
}

// ---------------------------------------------------------------------------
// 4. Insert receipt transaction
// ---------------------------------------------------------------------------
export async function insertReceiptTransaction(
  request: MaterialRequestRow,
  payload: EpicorReceiptPayload,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const transaction = {
    transaction_type: "RECEIPT",
    part_num: request.part_num,
    qty: payload.ReceivedQty,
    work_order_id: request.work_order_id,
    reason_code: `PO: ${payload.PONum}`,
  };

  const { error } = await supabase.from("inventory_transactions").insert(transaction);

  if (error) {
    console.error("Receipt insert error:", error);
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// 5. Update work order: clear block_reason
// ---------------------------------------------------------------------------
export async function clearWorkOrderBlock(
  workOrderId: string,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { error } = await supabase
    .from("work_orders")
    .update({ block_reason: "NONE" })
    .eq("id", workOrderId);

  if (error) {
    console.error("Work order update error:", error);
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Exported handler for testing
// ---------------------------------------------------------------------------
export async function handleRequest(request: Request): Promise<Response> {
  try {
    // Only accept POST requests
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 1. Validate Bearer auth
    const authResult = validateAuth(request);
    if (!authResult.ok) {
      return authResult.response;
    }

    // 2. Parse and validate payload
    const payloadResult = await validatePayload(request);
    if (!payloadResult.ok) {
      return payloadResult.response;
    }

    const payload = payloadResult.payload;

    // 3. Look up material request by ReqNum
    const lookupResult = await lookupMaterialRequest(payload.ReqNum);
    if (!lookupResult.ok) {
      return lookupResult.response;
    }

    // 4. Insert receipt transaction
    const receiptResult = await insertReceiptTransaction(lookupResult.request, payload);
    if (!receiptResult.ok) {
      return receiptResult.response;
    }

    // 5. Clear block_reason on the work order
    const blockResult = await clearWorkOrderBlock(lookupResult.request.work_order_id);
    if (!blockResult.ok) {
      return blockResult.response;
    }

    // 6. Return 200 with success
    return new Response(
      JSON.stringify({
        success: true,
        req_num: payload.ReqNum,
        part_num: payload.PartNum,
        qty: payload.ReceivedQty,
        work_order_id: lookupResult.request.work_order_id,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ---------------------------------------------------------------------------
// Main entrypoint — guarded so it doesn't fire during tests
// ---------------------------------------------------------------------------
if (import.meta.main) {
  Deno.serve(handleRequest);
}
