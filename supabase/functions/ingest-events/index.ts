import { createClient } from "@supabase/supabase-js";

/**
 * ingest-events Edge Function
 *
 * Endpoint POST para ingesta de eventos de condición (ISO 13374 Bloque 5).
 * Acepta payload de evento y persiste en condition_events con vínculos
 * opcionales a condition_event_sources.
 *
 * CEVT-001: Registro de eventos de condición
 * CEVT-002: Atribución de fuentes del evento
 */

// ---------------------------------------------------------------------------
// Tipos de datos del contrato de ingesta de eventos
// ---------------------------------------------------------------------------

interface EventIngestPayload {
  asset_id: string;
  event_type: string;
  severity: string;
  message?: string;
  hi_value?: number;
  dhi_dt_value?: number;
  feature_value_ids?: string[];
  analysis_result_ids?: string[];
}

// Valores permitidos según CEVT-001 y REQ-CEVT-001
const VALID_SEVERITIES = new Set(["info", "warning", "critical"]);
const VALID_EVENT_TYPES = new Set([
  "threshold_exceeded",
  "trend_detected",
  "quality_degraded",
  "manual",
]);

// ---------------------------------------------------------------------------
// 1. Auth validation: Bearer token
// ---------------------------------------------------------------------------
export function validateAuth(
  request: Request
): { ok: true } | { ok: false; response: Response } {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: corsHeaders(),
      }),
    };
  }

  // En producci�n, validar contra secreto configurado.
  // Por ahora aceptamos cualquier Bearer token para desarrollo.
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 2. Payload validation: campos obligatorios + tipos + valores permitidos
// ---------------------------------------------------------------------------
export async function validatePayload(
  request: Request
): Promise<
  | { ok: true; payload: EventIngestPayload }
  | { ok: false; response: Response }
> {
  let body: Record<string, unknown>;

  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "Payload inv�lido: no es JSON" }),
        { status: 400, headers: corsHeaders() }
      ),
    };
  }

  const errors: string[] = [];

  // Validar campos obligatorios: asset_id, event_type, severity
  if (typeof body.asset_id !== "string" || body.asset_id.trim() === "") {
    errors.push("asset_id es obligatorio");
  }

  if (typeof body.event_type !== "string" || body.event_type.trim() === "") {
    errors.push("event_type es obligatorio");
  } else if (!VALID_EVENT_TYPES.has(body.event_type)) {
    errors.push(
      `event_type inv�lido: '${body.event_type}'. Valores permitidos: threshold_exceeded, trend_detected, quality_degraded, manual`
    );
  }

  if (typeof body.severity !== "string" || body.severity.trim() === "") {
    errors.push("severity es obligatorio");
  } else if (!VALID_SEVERITIES.has(body.severity)) {
    errors.push(
      `severity inv�lido: '${body.severity}'. Valores permitidos: info, warning, critical`
    );
  }

  // Validar tipos de campos opcionales
  if (body.hi_value !== undefined && typeof body.hi_value !== "number") {
    errors.push("hi_value debe ser num�rico");
  }

  if (body.dhi_dt_value !== undefined && typeof body.dhi_dt_value !== "number") {
    errors.push("dhi_dt_value debe ser num�rico");
  }

  if (body.message !== undefined && typeof body.message !== "string") {
    errors.push("message debe ser texto");
  }

  // Validar feature_value_ids: array de strings (UUIDs)
  if (body.feature_value_ids !== undefined) {
    if (!Array.isArray(body.feature_value_ids)) {
      errors.push("feature_value_ids debe ser un array de UUIDs");
    } else {
      for (const id of body.feature_value_ids) {
        if (typeof id !== "string" || id.trim() === "") {
          errors.push("feature_value_ids contiene valores inv�lidos");
          break;
        }
      }
    }
  }

  // Validar analysis_result_ids: array de strings (UUIDs)
  if (body.analysis_result_ids !== undefined) {
    if (!Array.isArray(body.analysis_result_ids)) {
      errors.push("analysis_result_ids debe ser un array de UUIDs");
    } else {
      for (const id of body.analysis_result_ids) {
        if (typeof id !== "string" || id.trim() === "") {
          errors.push("analysis_result_ids contiene valores inv�lidos");
          break;
        }
      }
    }
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "Validaci�n fallida", details: errors }),
        { status: 400, headers: corsHeaders() }
      ),
    };
  }

  return {
    ok: true,
    payload: {
      asset_id: body.asset_id as string,
      event_type: body.event_type as string,
      severity: body.severity as string,
      message: typeof body.message === "string" ? body.message : undefined,
      hi_value: typeof body.hi_value === "number" ? body.hi_value : undefined,
      dhi_dt_value:
        typeof body.dhi_dt_value === "number" ? body.dhi_dt_value : undefined,
      feature_value_ids: Array.isArray(body.feature_value_ids)
        ? (body.feature_value_ids as string[])
        : undefined,
      analysis_result_ids: Array.isArray(body.analysis_result_ids)
        ? (body.analysis_result_ids as string[])
        : undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// 3. Validaci�n cruzada: existencia de feature_value_ids en cat�logo
// ---------------------------------------------------------------------------
async function validateFeatureValueIds(
  supabase: ReturnType<typeof createClient>,
  featureValueIds: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("condition_feature_values")
    .select("id")
    .in("id", featureValueIds);

  if (error) {
    console.error("Error validando feature_value_ids:", error);
    return { ok: false, error: "Error interno al validar feature_value_ids" };
  }

  const foundIds = new Set((data ?? []).map((r: { id: string }) => r.id));
  const missing = featureValueIds.filter((id) => !foundIds.has(id));

  if (missing.length > 0) {
    return {
      ok: false,
      error: `feature_value_ids no encontrados: [${missing.join(", ")}]`,
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// 4. Transacci�n de ingesta: INSERT condition_events + event_sources
// ---------------------------------------------------------------------------
async function ingestEvent(
  payload: EventIngestPayload
): Promise<
  | { ok: true; eventId: string; status: string }
  | { ok: false; response: Response }
> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "Error interno del servidor" }),
        { status: 500, headers: corsHeaders() }
      ),
    };
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // 4a. Validar feature_value_ids si fueron provistos
  if (payload.feature_value_ids && payload.feature_value_ids.length > 0) {
    const validation = await validateFeatureValueIds(
      supabase,
      payload.feature_value_ids
    );
    if (!validation.ok) {
      return {
        ok: false,
        response: new Response(
          JSON.stringify({ error: validation.error }),
          { status: 400, headers: corsHeaders() }
        ),
      };
    }
  }

  // 4b. INSERT condition_events
  const eventRow: Record<string, unknown> = {
    asset_id: payload.asset_id,
    event_type: payload.event_type,
    severity: payload.severity,
  };

  if (payload.message !== undefined) {
    eventRow.message = payload.message;
  }
  if (payload.hi_value !== undefined) {
    eventRow.hi_value = payload.hi_value;
  }
  if (payload.dhi_dt_value !== undefined) {
    eventRow.dhi_dt_value = payload.dhi_dt_value;
  }

  const { data: newEvent, error: eventError } = await supabase
    .from("condition_events")
    .insert(eventRow)
    .select("id, status")
    .single();

  if (eventError) {
    console.error("Error insertando condition_events:", eventError);
    return {
      ok: false,
      response: new Response(
        JSON.stringify({
          error: "Error al insertar evento",
          details: eventError.message,
        }),
        { status: 500, headers: corsHeaders() }
      ),
    };
  }

  const eventId: string = newEvent.id;
  const eventStatus: string = newEvent.status;

  // 4c. INSERT condition_event_sources (si hay feature_value_ids)
  const featureIds = payload.feature_value_ids ?? [];
  const analysisIds = payload.analysis_result_ids ?? [];

  const sourceRows: Record<string, unknown>[] = [];

  for (const fvId of featureIds) {
    sourceRows.push({
      event_id: eventId,
      feature_value_id: fvId,
    });
  }

  for (const arId of analysisIds) {
    sourceRows.push({
      event_id: eventId,
      analysis_result_id: arId,
    });
  }

  if (sourceRows.length > 0) {
    const { error: sourceError } = await supabase
      .from("condition_event_sources")
      .insert(sourceRows);

    if (sourceError) {
      console.error(
        "Error insertando condition_event_sources:",
        sourceError
      );

      // Rollback parcial: eliminar el evento creado si fallan las fuentes
      await supabase
        .from("condition_events")
        .delete()
        .eq("id", eventId);

      return {
        ok: false,
        response: new Response(
          JSON.stringify({
            error: "Error al insertar fuentes del evento",
            details: sourceError.message,
          }),
          { status: 500, headers: corsHeaders() }
        ),
      };
    }
  }

  return { ok: true, eventId, status: eventStatus };
}

// ---------------------------------------------------------------------------
// 5. Exported handler (testeable)
// ---------------------------------------------------------------------------
export async function handleRequest(request: Request): Promise<Response> {
  try {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Solo POST
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers: corsHeaders() }
      );
    }

    // 1. Validar auth
    const authResult = validateAuth(request);
    if (!authResult.ok) {
      return authResult.response;
    }

    // 2. Parsear y validar payload
    const payloadResult = await validatePayload(request);
    if (!payloadResult.ok) {
      return payloadResult.response;
    }

    const payload = payloadResult.payload;

    // 3. Transaccion de ingesta
    const ingestResult = await ingestEvent(payload);
    if (!ingestResult.ok) {
      return ingestResult.response;
    }

    // 4. Respuesta exitosa
    return new Response(
      JSON.stringify({
        event_id: ingestResult.eventId,
        status: ingestResult.status,
      }),
      { status: 200, headers: corsHeaders() }
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Error interno del servidor" }),
      { status: 500, headers: corsHeaders() }
    );
  }
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

// ---------------------------------------------------------------------------
// Main entrypoint — guarded so it doesn't fire during tests
// ---------------------------------------------------------------------------
if (import.meta.main) {
  Deno.serve(handleRequest);
}
