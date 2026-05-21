import { createClient } from "@supabase/supabase-js";

/**
 * OEE Webhook Edge Function
 *
 * Receives POST requests from an external OEE system, validates Bearer auth,
 * resolves equipment_id to an asset, and inserts a corrective work order.
 */

// ---------------------------------------------------------------------------
// 1. Auth validation: Bearer token must match OEE_SECRET_KEY env var
// ---------------------------------------------------------------------------
export function validateAuth(request: Request): { ok: true } | { ok: false; response: Response } {
  const authHeader = request.headers.get("Authorization");
  const secretKey = Deno.env.get("OEE_SECRET_KEY");

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
// 2. Payload validation: JSON with equipment_id and sintoma required
// ---------------------------------------------------------------------------
export async function validatePayload(request: Request): Promise<
  | { ok: true; payload: { equipment_id: string; sintoma: string } }
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
    typeof body.equipment_id !== "string" ||
    body.equipment_id.trim() === "" ||
    typeof body.sintoma !== "string" ||
    body.sintoma.trim() === ""
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
      equipment_id: body.equipment_id,
      sintoma: body.sintoma,
    },
  };
}

// ---------------------------------------------------------------------------
// 3. Asset lookup: resolve equipment_id to asset.id via Service Role client
// ---------------------------------------------------------------------------
export async function lookupAsset(equipmentId: string): Promise<
  | { ok: true; asset: { id: number; equipment_id: string } }
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

  const { data: asset, error } = await supabase
    .from("assets")
    .select("id,equipment_id")
    .eq("equipment_id", equipmentId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Asset lookup error:", error);
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  if (!asset) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Equipment not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  return { ok: true, asset };
}

// ---------------------------------------------------------------------------
// 4. Work order insert: create corrective WO with required defaults
// ---------------------------------------------------------------------------
export async function insertWorkOrder(
  asset: { id: number; equipment_id: string },
  sintoma: string
): Promise<{ ok: true; id: string } | { ok: false; response: Response }> {
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

  const id = crypto.randomUUID();
  const workOrder = {
    id,
    asset_id: String(asset.id),
    equipment_id: asset.equipment_id,
    wo_type: "corrective",
    lifecycle_phase: "WAPPR",
    block_reason: "NONE",
    symptom_note: sintoma,
    planned_hours: 0,
  };

  const { error } = await supabase.from("work_orders").insert(workOrder);

  if (error) {
    console.error("Work order insert error:", error);
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  return { ok: true, id };
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

    const { equipment_id, sintoma } = payloadResult.payload;

    // 3. Look up asset by equipment_id
    const assetResult = await lookupAsset(equipment_id);
    if (!assetResult.ok) {
      return assetResult.response;
    }

    // 4. Insert work order
    const insertResult = await insertWorkOrder(assetResult.asset, sintoma);
    if (!insertResult.ok) {
      return insertResult.response;
    }

    // 5. Return 200 with the created work order ID
    return new Response(JSON.stringify({ id: insertResult.id }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
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
