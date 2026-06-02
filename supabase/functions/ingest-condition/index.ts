import { createClient } from "@supabase/supabase-js";

/**
 * ingest-condition Edge Function
 *
 * Endpoint POST para ingesta de datos de condición (ISO 13374 Bloque 3).
 * Acepta payload FeatureSet v0.2 Enriched y persiste en condition_windows
 * y condition_feature_values con validación completa de campos, catálogo
 * de features, catálogo de métodos y source capabilities.
 *
 * DING-001 a DING-007 (incluyendo DING-007: validación de source capability).
 */

// ---------------------------------------------------------------------------
// Tipos de datos del contrato FeatureSet v0.2
// ---------------------------------------------------------------------------

interface OperationalContext {
  regime?: string;
  rpm?: number;
  load_pct?: number;
  [key: string]: unknown;
}

interface FeatureV2 {
  measurement_point_id?: string;
  feature_key: string;
  value: number;
  unit: string;
  quality_flag: string;
  method_key: string;
  method_version: string;
  parameters?: Record<string, unknown>;
  uncertainty?: number;
  confidence?: number;
  sample_count?: number;
}

interface FeatureSetV2 {
  external_window_id: string;
  asset_id: string;
  source_id: string;
  source_type: string;
  window_start: string;
  window_end: string;
  pipeline_version?: string;
  config_version?: string;
  operational_context?: OperationalContext;
  features: FeatureV2[];
}

// Calidades válidas
const VALID_QUALITY_FLAGS = new Set(["G0", "G1", "G2", "G3"]);

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

  // En producción, validar contra secreto configurado.
  // Por ahora aceptamos cualquier Bearer token para desarrollo.
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 2. Payload validation: FeatureSet v0.2 — 11 campos obligatorios
// ---------------------------------------------------------------------------
export async function validatePayload(
  request: Request
): Promise<
  | { ok: true; payload: FeatureSetV2 }
  | { ok: false; response: Response }
> {
  let body: Record<string, unknown>;

  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "Payload inválido: no es JSON" }),
        { status: 400, headers: corsHeaders() }
      ),
    };
  }

  // Validar campos de ventana (6 obligatorios)
  const errors: string[] = [];

  if (typeof body.external_window_id !== "string" || body.external_window_id.trim() === "") {
    errors.push("external_window_id es obligatorio");
  }
  if (typeof body.asset_id !== "string" || body.asset_id.trim() === "") {
    errors.push("asset_id es obligatorio");
  }
  if (typeof body.source_id !== "string" || body.source_id.trim() === "") {
    errors.push("source_id es obligatorio");
  }
  if (typeof body.source_type !== "string" || body.source_type.trim() === "") {
    errors.push("source_type es obligatorio");
  }
  if (typeof body.window_start !== "string" || body.window_start.trim() === "") {
    errors.push("window_start es obligatorio");
  }
  if (typeof body.window_end !== "string" || body.window_end.trim() === "") {
    errors.push("window_end es obligatorio");
  }

  // Validar features array
  if (!Array.isArray(body.features) || body.features.length === 0) {
    errors.push("features es obligatorio y debe contener al menos un feature");
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "Campos obligatorios faltantes", details: errors }),
        { status: 400, headers: corsHeaders() }
      ),
    };
  }

  // Validar cada feature (5 campos obligatorios por feature)
  const features = body.features as Record<string, unknown>[];
  const validatedFeatures: FeatureV2[] = [];

  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    const prefix = `features[${i}]`;
    const fErrors: string[] = [];

    if (typeof f.feature_key !== "string" || f.feature_key.trim() === "") {
      fErrors.push(`${prefix}.feature_key es obligatorio`);
    }
    if (typeof f.value !== "number" && typeof f.value !== "string") {
      fErrors.push(`${prefix}.value es obligatorio y debe ser numérico`);
    }
    if (typeof f.unit !== "string" || f.unit.trim() === "") {
      fErrors.push(`${prefix}.unit es obligatorio`);
    }
    if (typeof f.quality_flag !== "string" || !VALID_QUALITY_FLAGS.has(f.quality_flag)) {
      fErrors.push(`${prefix}.quality_flag es obligatorio y debe ser G0, G1, G2 o G3`);
    }
    if (typeof f.method_key !== "string" || f.method_key.trim() === "") {
      fErrors.push(`${prefix}.method_key es obligatorio`);
    }
    if (typeof f.method_version !== "string" || f.method_version.trim() === "") {
      fErrors.push(`${prefix}.method_version es obligatorio`);
    }

    if (fErrors.length > 0) {
      errors.push(...fErrors);
      continue;
    }

    validatedFeatures.push({
      measurement_point_id: typeof f.measurement_point_id === "string" ? f.measurement_point_id : undefined,
      feature_key: f.feature_key as string,
      value: typeof f.value === "string" ? parseFloat(f.value as string) : (f.value as number),
      unit: f.unit as string,
      quality_flag: f.quality_flag as string,
      method_key: f.method_key as string,
      method_version: f.method_version as string,
      parameters: f.parameters as Record<string, unknown> | undefined,
      uncertainty: typeof f.uncertainty === "number" ? f.uncertainty : undefined,
      confidence: typeof f.confidence === "number" ? f.confidence : undefined,
      sample_count: typeof f.sample_count === "number" ? f.sample_count : undefined,
    });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "Campos obligatorios faltantes en features", details: errors }),
        { status: 400, headers: corsHeaders() }
      ),
    };
  }

  // Validar ISO 8601 de window_start y window_end
  const winStart = new Date(body.window_start as string);
  const winEnd = new Date(body.window_end as string);
  if (isNaN(winStart.getTime())) {
    errors.push("window_start no es una fecha ISO 8601 válida");
  }
  if (isNaN(winEnd.getTime())) {
    errors.push("window_end no es una fecha ISO 8601 válida");
  }
  if (!isNaN(winStart.getTime()) && !isNaN(winEnd.getTime()) && winEnd <= winStart) {
    errors.push("window_end debe ser posterior a window_start");
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "Validación de fechas fallida", details: errors }),
        { status: 400, headers: corsHeaders() }
      ),
    };
  }

  const payload: FeatureSetV2 = {
    external_window_id: body.external_window_id as string,
    asset_id: body.asset_id as string,
    source_id: body.source_id as string,
    source_type: body.source_type as string,
    window_start: body.window_start as string,
    window_end: body.window_end as string,
    pipeline_version: typeof body.pipeline_version === "string" ? body.pipeline_version : undefined,
    config_version: typeof body.config_version === "string" ? body.config_version : undefined,
    operational_context: body.operational_context as OperationalContext | undefined,
    features: validatedFeatures,
  };

  return { ok: true, payload };
}

// ---------------------------------------------------------------------------
// 3. Validación cruzada contra catálogos (feature_definitions, methods, source_capabilities)
// ---------------------------------------------------------------------------
interface ValidationContext {
  supabase: ReturnType<typeof createClient>;
}

async function validateFeatureKey(
  ctx: ValidationContext,
  featureKey: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data, error } = await ctx.supabase
    .from("condition_feature_definitions")
    .select("id")
    .eq("feature_key", featureKey)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Error consultando feature_definition:", error);
    return { ok: false, error: "Error interno al validar feature_key" };
  }

  if (!data) {
    return { ok: false, error: `feature_key '${featureKey}' no registrado en condition_feature_definitions` };
  }

  return { ok: true, id: data.id };
}

async function validateMethodKey(
  ctx: ValidationContext,
  methodKey: string
): Promise<{ ok: true } | { ok: false; degrade: boolean }> {
  const { data, error } = await ctx.supabase
    .from("condition_analysis_methods")
    .select("method_key")
    .eq("method_key", methodKey)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Error consultando analysis_method:", error);
    return { ok: false, degrade: false };
  }

  if (!data) {
    // DING-005: método no registrado → aceptar pero forzar quality_flag=G2
    console.warn(`method_key '${methodKey}' no registrado — quality_flag forzado a G2`);
    return { ok: false, degrade: true };
  }

  return { ok: true };
}

interface SourceCapability {
  id: string;
  source_id: string;
  can_produce: string;
  method_key: string;
  validation_status: string;
  quality_expected: string;
}

async function validateSourceCapability(
  ctx: ValidationContext,
  sourceId: string,
  featureKey: string,
  methodKey: string
): Promise<
  | { ok: true; degrade_quality: boolean }
  | { ok: false; error: string }
> {
  const { data: capabilities, error } = await ctx.supabase
    .from("condition_source_capabilities")
    .select("id, source_id, can_produce, method_key, validation_status, quality_expected")
    .eq("source_id", sourceId);

  if (error) {
    console.error("Error consultando source_capabilities:", error);
    return { ok: false, error: "Error interno al validar source capabilities" };
  }

  const exactMatch = (capabilities as SourceCapability[] | null)?.find(
    (c) => c.can_produce === featureKey && c.method_key === methodKey
  );

  if (!exactMatch) {
    // DING-007: source_id no tiene capability para feature_key+method_key → rechazar
    return {
      ok: false,
      error: `source_id '${sourceId}' no tiene capacidad registrada para feature_key='${featureKey}' + method_key='${methodKey}'`,
    };
  }

  // DING-007: capability existe → verificar validation_status
  if (exactMatch.validation_status === "draft" || exactMatch.validation_status === "rejected") {
    // SCAP-003: capability en draft/rejected → aceptar pero forzar quality_flag=G2
    console.warn(
      `source_id '${sourceId}' capability validation_status='${exactMatch.validation_status}' → quality_flag forzado a G2`
    );
    return { ok: true, degrade_quality: true };
  }

  // Capability activa (active, field_trial, bench_validated): respetar quality_flag de la fuente
  return { ok: true, degrade_quality: false };
}

// ---------------------------------------------------------------------------
// 4. Transacción de ingesta: INSERT window + feature_values
// ---------------------------------------------------------------------------
async function ingestFeatures(
  payload: FeatureSetV2,
  validatedFeatures: FeatureV2[],
  featureIdMap: Map<string, string>
): Promise<
  | { ok: true; windowId: string; featureCount: number }
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

  // 4a. Verificar unicidad de external_window_id
  const { data: existingWindow, error: lookupError } = await supabase
    .from("condition_windows")
    .select("id")
    .eq("external_window_id", payload.external_window_id)
    .limit(1)
    .maybeSingle();

  if (lookupError) {
    console.error("Error verificando ventana existente:", lookupError);
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "Error interno al verificar ventana" }),
        { status: 500, headers: corsHeaders() }
      ),
    };
  }

  if (existingWindow) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({
          error: "Ventana duplicada",
          details: `external_window_id '${payload.external_window_id}' ya existe`,
        }),
        { status: 409, headers: corsHeaders() }
      ),
    };
  }

  // 4b. INSERT condition_windows
  const windowRow = {
    external_window_id: payload.external_window_id,
    asset_id: payload.asset_id,
    source_id: payload.source_id,
    source_type: payload.source_type,
    window_start: payload.window_start,
    window_end: payload.window_end,
    pipeline_version: payload.pipeline_version ?? null,
    config_version: payload.config_version ?? null,
    operational_context: payload.operational_context ?? {},
    status: "received",
  };

  const { data: newWindow, error: windowError } = await supabase
    .from("condition_windows")
    .insert(windowRow)
    .select("id")
    .single();

  if (windowError) {
    console.error("Error insertando ventana:", windowError);
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "Error al insertar ventana", details: windowError.message }),
        { status: 500, headers: corsHeaders() }
      ),
    };
  }

  const windowId = newWindow.id;

  // 4c. INSERT condition_feature_values (uno por feature)
  const featureValueRows = validatedFeatures.map((f) => ({
    window_id: windowId,
    feature_definition_id: featureIdMap.get(f.feature_key) ?? null,
    value: f.value,
    unit: f.unit,
    quality_flag: f.quality_flag,
    method_key: f.method_key,
    method_version: f.method_version,
    parameters: f.parameters ?? {},
    uncertainty: f.uncertainty ?? null,
    confidence: f.confidence ?? 1.0,
    measurement_point_id: f.measurement_point_id ?? null,
    sample_count: f.sample_count ?? null,
  }));

  const { error: fvError } = await supabase
    .from("condition_feature_values")
    .insert(featureValueRows);

  if (fvError) {
    console.error("Error insertando feature_values:", fvError);

    // Rollback: eliminar la ventana creada (marcar como rejected)
    await supabase
      .from("condition_windows")
      .update({ status: "rejected" })
      .eq("id", windowId);

    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "Error al insertar feature values", details: fvError.message }),
        { status: 500, headers: corsHeaders() }
      ),
    };
  }

  // 4d. Actualizar status de la ventana a 'processed'
  await supabase
    .from("condition_windows")
    .update({ status: "processed" })
    .eq("id", windowId);

  return { ok: true, windowId, featureCount: validatedFeatures.length };
}

// ---------------------------------------------------------------------------
// 5. Exported handler for testing
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

    // 2. Parsear y validar payload (11 campos obligatorios + tipos + ISO 8601)
    const payloadResult = await validatePayload(request);
    if (!payloadResult.ok) {
      return payloadResult.response;
    }

    const payload = payloadResult.payload;
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      return new Response(
        JSON.stringify({ error: "Error interno del servidor" }),
        { status: 500, headers: corsHeaders() }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const ctx: ValidationContext = { supabase };

    // 3. Validar catálogos y source capabilities por cada feature
    const featureIdMap = new Map<string, string>();
    const validationWarnings: string[] = [];

    for (const feature of payload.features) {
      // 3a. Validar feature_key en condition_feature_definitions (DING-003)
      const featureResult = await validateFeatureKey(ctx, feature.feature_key);
      if (!featureResult.ok) {
        return new Response(
          JSON.stringify({ error: featureResult.error }),
          { status: 400, headers: corsHeaders() }
        );
      }
      featureIdMap.set(feature.feature_key, featureResult.id);

      // 3b. Validar method_key en condition_analysis_methods (DING-005)
      const methodResult = await validateMethodKey(ctx, feature.method_key);
      if (!methodResult.ok && methodResult.degrade) {
        // Método no registrado → forzar G2
        feature.quality_flag = "G2";
        validationWarnings.push(
          `method_key '${feature.method_key}' no registrado → quality_flag forzado a G2`
        );
      }

      // 3c. Validar source capability (DING-007) — CRÍTICO
      const capabilityResult = await validateSourceCapability(
        ctx,
        payload.source_id,
        feature.feature_key,
        feature.method_key
      );
      if (!capabilityResult.ok) {
        return new Response(
          JSON.stringify({ error: capabilityResult.error }),
          { status: 400, headers: corsHeaders() }
        );
      }
      if (capabilityResult.degrade_quality) {
        // Capability en draft/rejected → forzar G2
        feature.quality_flag = "G2";
        validationWarnings.push(
          `source_id '${payload.source_id}' capability no activa para feature_key='${feature.feature_key}' → quality_flag forzado a G2`
        );
      }
    }

    // 4. Transacción de ingesta
    const ingestResult = await ingestFeatures(payload, payload.features, featureIdMap);
    if (!ingestResult.ok) {
      return ingestResult.response;
    }

    // 5. Respuesta exitosa
    return new Response(
      JSON.stringify({
        window_id: ingestResult.windowId,
        external_window_id: payload.external_window_id,
        features_ingested: ingestResult.featureCount,
        status: "processed",
        warnings: validationWarnings.length > 0 ? validationWarnings : undefined,
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
