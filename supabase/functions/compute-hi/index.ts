import { createClient } from "@supabase/supabase-js";

/**
 * compute-hi Edge Function
 *
 * Endpoint POST para cómputo de Health Index y Velocidad de Degradación
 * por activo (ISO 13374 Bloque 3b — Análisis).
 *
 * Invocación: programada (pg_cron) o manual POST.
 * Acepta: { asset_id: string } o { asset_ids: string[] }.
 * Para cada activo:
 *   a) Llama compute_health_index(asset_id)
 *   b) Llama compute_degradation_velocity(asset_id)
 *   c) Llama evaluate_condition_rules(asset_id)
 *   d) Retorna resultados acumulados
 *
 * DING-010: Cómputo de HI + dHI/dt + evaluación de reglas por activo.
 */

// ---------------------------------------------------------------------------
// Tipos de datos
// ---------------------------------------------------------------------------

interface ComputeRequest {
  asset_id?: string;
  asset_ids?: string[];
}

interface AssetResult {
  asset_id: string;
  hi: number | null;
  hi_confidence: number | null;
  dhi_dt: number | null;
  dhi_dt_r_squared: number | null;
  fired_events: number;
  error?: string;
}

interface ComputeResponse {
  processed: number;
  results: AssetResult[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function corsHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function errorResponse(
  status: number,
  message: string,
  details?: string,
): Response {
  const body: Record<string, unknown> = { error: message };
  if (details) body.details = details;
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(),
  });
}

// ---------------------------------------------------------------------------
// 1. Auth validation: Bearer token
// ---------------------------------------------------------------------------

function validateAuth(
  request: Request,
): { ok: true } | { ok: false; response: Response } {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      ok: false,
      response: errorResponse(401, "Unauthorized"),
    };
  }

  // En producción, validar contra secreto configurado.
  // Por ahora aceptamos cualquier Bearer token para desarrollo.
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 2. Parsear request body
// ---------------------------------------------------------------------------

async function parseRequest(
  request: Request,
): Promise<
  | { ok: true; assetIds: string[] }
  | { ok: false; response: Response }
> {
  let body: Record<string, unknown>;

  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      response: errorResponse(400, "Payload inválido: no es JSON"),
    };
  }

  // Resolver lista de asset_ids
  const assetIds: string[] = [];

  if (typeof body.asset_id === "string" && body.asset_id.trim() !== "") {
    assetIds.push(body.asset_id.trim());
  }

  if (Array.isArray(body.asset_ids)) {
    for (const id of body.asset_ids) {
      if (typeof id === "string" && id.trim() !== "") {
        if (!assetIds.includes(id.trim())) {
          assetIds.push(id.trim());
        }
      }
    }
  }

  if (assetIds.length === 0) {
    return {
      ok: false,
      response: errorResponse(
        400,
        "Se requiere asset_id (string) o asset_ids (string[])",
        "Debe proporcionar al menos un identificador de activo.",
      ),
    };
  }

  return { ok: true, assetIds };
}

// ---------------------------------------------------------------------------
// 3. Procesar un activo: HI + dHI/dt + reglas
// ---------------------------------------------------------------------------

async function processAsset(
  supabaseUrl: string,
  serviceRoleKey: string,
  assetId: string,
): Promise<AssetResult> {
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const result: AssetResult = {
    asset_id: assetId,
    hi: null,
    hi_confidence: null,
    dhi_dt: null,
    dhi_dt_r_squared: null,
    fired_events: 0,
  };

  try {
    // 3a. compute_health_index(asset_id)
    const { data: hiData, error: hiError } = await supabase.rpc(
      "compute_health_index",
      {
        p_asset_id: assetId,
        p_window_end: new Date().toISOString(),
        p_asset_class: null,
      },
    );

    if (hiError) {
      console.error(`Error compute_health_index para ${assetId}:`, hiError);
      result.error = `HI error: ${hiError.message}`;
    } else if (Array.isArray(hiData) && hiData.length > 0) {
      result.hi = hiData[0].health_index ?? null;
      result.hi_confidence = hiData[0].confidence ?? null;
    }

    // 3b. compute_degradation_velocity(asset_id)
    const { data: dvData, error: dvError } = await supabase.rpc(
      "compute_degradation_velocity",
      {
        p_asset_id: assetId,
        p_window_hours: 168,
      },
    );

    if (dvError) {
      console.error(
        `Error compute_degradation_velocity para ${assetId}:`,
        dvError,
      );
      if (!result.error) {
        result.error = `dHI/dt error: ${dvError.message}`;
      }
    } else if (Array.isArray(dvData) && dvData.length > 0) {
      result.dhi_dt = dvData[0].slope ?? null;
      result.dhi_dt_r_squared = dvData[0].r_squared ?? null;
    }

    // 3c. evaluate_condition_rules(asset_id)
    const { data: rulesData, error: rulesError } = await supabase.rpc(
      "evaluate_condition_rules",
      {
        p_asset_id: assetId,
      },
    );

    if (rulesError) {
      console.error(
        `Error evaluate_condition_rules para ${assetId}:`,
        rulesError,
      );
      if (!result.error) {
        result.error = `Rules error: ${rulesError.message}`;
      }
    } else {
      // evaluate_condition_rules returns INT (count of fired rules)
      result.fired_events = typeof rulesData === "number" ? rulesData : 0;
    }
  } catch (err) {
    console.error(`Error procesando activo ${assetId}:`, err);
    result.error = `Error interno: ${err instanceof Error ? err.message : String(err)}`;
  }

  return result;
}

// ---------------------------------------------------------------------------
// 4. Main handler (exportado para testing)
// ---------------------------------------------------------------------------

export async function handleRequest(request: Request): Promise<Response> {
  try {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Solo POST
    if (request.method !== "POST") {
      return errorResponse(405, "Method not allowed");
    }

    // 1. Validar auth
    const authResult = validateAuth(request);
    if (!authResult.ok) {
      return authResult.response;
    }

    // 2. Parsear request
    const parseResult = await parseRequest(request);
    if (!parseResult.ok) {
      return parseResult.response;
    }

    const assetIds = parseResult.assetIds;

    // 3. Obtener credenciales de Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      return errorResponse(500, "Error interno del servidor");
    }

    // 4. Procesar cada activo en secuencia
    const results: AssetResult[] = [];
    for (const assetId of assetIds) {
      const assetResult = await processAsset(
        supabaseUrl,
        serviceRoleKey,
        assetId,
      );
      results.push(assetResult);
    }

    // 5. Respuesta
    const response: ComputeResponse = {
      processed: results.length,
      results,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: corsHeaders(),
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    return errorResponse(500, "Error interno del servidor");
  }
}

// ---------------------------------------------------------------------------
// Main entrypoint — guarded so it doesn't fire during tests
// ---------------------------------------------------------------------------

if (import.meta.main) {
  Deno.serve(handleRequest);
}
