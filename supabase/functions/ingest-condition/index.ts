import { createClient } from "@supabase/supabase-js";

/**
 * ingest-condition Edge Function
 *
 * Endpoint POST para ingesta de datos de condición (ISO 13374 Bloque 3).
 * Acepta payload FeatureSet v0.2 Enriched y persiste en condition_windows
 * y condition_feature_values con validación completa de campos, catálogo
 * de features, catálogo de métodos, source capabilities, y gobierno.
 *
 * SDD 1: DING-001 a DING-007 (validación de source capability)
 * SDD 2: DING-008 a DING-011 (idempotencia, batch, outbox, late-data gate)
 *        CIR-003 (idempotencia por source_type)
 *        CSCE-001 a 004 (enforcement de capabilities)
 *        CLDP-001 a 004 (política de datos tardíos)
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

interface FeatureV2Extended extends FeatureV2 {
  measured_by?: string;
  entered_by?: string;
  measured_at?: string;
  entered_at?: string;
  instrument_ref?: string;
  notes?: string;
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

interface FeatureSetV2Extended extends FeatureSetV2 {
  idempotency_key?: string;
  ingested_by?: string;
  batch_id?: string;
  row_number?: number;
  skip_validation?: boolean;
  features: FeatureV2Extended[];
}

// Calidades válidas
const VALID_QUALITY_FLAGS = new Set(["G0", "G1", "G2", "G3"]);

// ---------------------------------------------------------------------------
// Auth validation: Bearer token
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
// Payload validation: FeatureSet v0.2 — 11 campos obligatorios
// ---------------------------------------------------------------------------
export async function validatePayload(
  request: Request
): Promise<
  | { ok: true; payload: FeatureSetV2Extended }
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
  const validatedFeatures: FeatureV2Extended[] = [];

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
      // SDD 2: extended traceability fields
      measured_by: typeof f.measured_by === "string" ? f.measured_by : undefined,
      entered_by: typeof f.entered_by === "string" ? f.entered_by : undefined,
      measured_at: typeof f.measured_at === "string" ? f.measured_at : undefined,
      entered_at: typeof f.entered_at === "string" ? f.entered_at : undefined,
      instrument_ref: typeof f.instrument_ref === "string" ? f.instrument_ref : undefined,
      notes: typeof f.notes === "string" ? f.notes : undefined,
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

  const payload: FeatureSetV2Extended = {
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
    // SDD 2: extended payload fields
    idempotency_key: typeof body.idempotency_key === "string" ? body.idempotency_key : undefined,
    ingested_by: typeof body.ingested_by === "string" ? body.ingested_by : undefined,
    batch_id: typeof body.batch_id === "string" ? body.batch_id : undefined,
    row_number: typeof body.row_number === "number" ? body.row_number : undefined,
    skip_validation: typeof body.skip_validation === "boolean" ? body.skip_validation : undefined,
  };

  return { ok: true, payload };
}

// ---------------------------------------------------------------------------
// Validation Context
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = ReturnType<typeof createClient<any, any, any>>;

interface ValidationContext {
  supabase: SupabaseClient;
}

// ---------------------------------------------------------------------------
// Catálogo: validar feature_key contra condition_feature_definitions
// ---------------------------------------------------------------------------
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

  const row = data as { id: string };
  return { ok: true, id: row.id };
}

// ---------------------------------------------------------------------------
// Catálogo: validar method_key contra condition_analysis_methods (soft)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// SDD 2: Gobierno de fuente — validar lifecycle de source
// ---------------------------------------------------------------------------
interface SourceLifecycleResult {
  /** true si la fuente permite ingesta */
  ok: boolean;
  /** forzar quality_flag=G2 en todos los features */
  force_g2: boolean;
  /** no disparar evaluación de reglas ni eventos */
  skip_events: boolean;
  /** no recalcular Health Index */
  skip_hi: boolean;
  /** no generar OTs automáticas */
  skip_ot: boolean;
}

async function validateSourceLifecycle(
  ctx: ValidationContext,
  sourceId: string
): Promise<SourceLifecycleResult> {
  const { data: source, error } = await ctx.supabase
    .from("condition_sources")
    .select("status")
    .eq("source_id", sourceId)
    .maybeSingle();

  if (error) {
    console.error("Error consultando condition_sources:", error);
    return { ok: false, force_g2: false, skip_events: false, skip_hi: false, skip_ot: false };
  }

  if (!source) {
    // Fuente no registrada — rechazar
    console.warn(`source_id '${sourceId}' no registrado en condition_sources`);
    return { ok: false, force_g2: false, skip_events: false, skip_hi: false, skip_ot: false };
  }

  const src = source as { status: string };
  const status = src.status;

  switch (status) {
    case "draft":
    case "disabled":
    case "deprecated":
      // Rechazar ingesta de fuentes inactivas
      return { ok: false, force_g2: false, skip_events: false, skip_hi: false, skip_ot: false };

    case "candidate":
      // Guardar con G2 forzado, sin eventos ni HI
      console.warn(`source_id '${sourceId}' en estado 'candidate' → G2 forzado, sin eventos/HI`);
      return { ok: true, force_g2: true, skip_events: true, skip_hi: true, skip_ot: true };

    case "field_trial":
      // Permitir ingesta, eventos limitados a info/warning, sin OT
      return { ok: true, force_g2: false, skip_events: false, skip_hi: false, skip_ot: true };

    case "active":
      // Pipeline completo
      return { ok: true, force_g2: false, skip_events: false, skip_hi: false, skip_ot: false };

    default:
      return { ok: false, force_g2: false, skip_events: false, skip_hi: false, skip_ot: false };
  }
}

// ---------------------------------------------------------------------------
// SDD 2: Validación de source capability (enhanced)
// ---------------------------------------------------------------------------
async function validateSourceCapability(
  ctx: ValidationContext,
  sourceId: string,
  featureKey: string,
  methodKey: string
): Promise<
  | { ok: true; degrade_quality: boolean }
  | { ok: false; error: string }
> {
  // SDD 2: usar is_source_capable() SQL function (canonical check)
  // deno-lint-ignore no-explicit-any
  const { data: capable, error: rpcError } = await (ctx.supabase.rpc as any)(
    "is_source_capable",
    {
      p_source_id: sourceId,
      p_feature_key: featureKey,
      p_method_key: methodKey,
    }
  );

  if (rpcError) {
    console.error("Error llamando is_source_capable:", rpcError);
    // Fallback: query directa
    const { data: capabilities, error: qError } = await ctx.supabase
      .from("condition_source_capabilities")
      .select("id, source_id, can_produce, method_key, validation_status, quality_expected")
      .eq("source_id", sourceId);

    if (qError) {
      console.error("Error consultando source_capabilities:", qError);
      return { ok: false, error: "Error interno al validar source capabilities" };
    }

    const exactMatch = (capabilities as Array<{
      id: string; source_id: string; can_produce: string;
      method_key: string; validation_status: string; quality_expected: string;
    }> | null)?.find(
      (c) => c.can_produce === featureKey && c.method_key === methodKey
    );

    if (!exactMatch) {
      return {
        ok: false,
        error: `source_id '${sourceId}' no tiene capacidad registrada para feature_key='${featureKey}' + method_key='${methodKey}'`,
      };
    }

    // Verificar validation_status
    if (exactMatch.validation_status === "draft" || exactMatch.validation_status === "rejected") {
      console.warn(
        `source_id '${sourceId}' capability validation_status='${exactMatch.validation_status}' → quality_flag forzado a G2`
      );
      return { ok: true, degrade_quality: true };
    }

    // Validada: active, field_trial, bench_validated
    if (["active", "field_trial", "bench_validated"].includes(exactMatch.validation_status)) {
      return { ok: true, degrade_quality: false };
    }

    // Cualquier otro estado → rechazar
    return {
      ok: false,
      error: `Capability para source_id '${sourceId}', feature_key='${featureKey}' tiene validation_status='${exactMatch.validation_status}' no válido para ingesta`,
    };
  }

  // is_source_capable() retorna TRUE si validation_status IN (active, field_trial, bench_validated)
  if (capable === true) {
    return { ok: true, degrade_quality: false };
  }

  // No es capaz según la función → verificar si la capability existe con draft/rejected
  const { data: degradedCaps } = await ctx.supabase
    .from("condition_source_capabilities")
    .select("validation_status")
    .eq("source_id", sourceId)
    .eq("can_produce", featureKey)
    .eq("method_key", methodKey)
    .in("validation_status", ["draft", "rejected"])
    .limit(1)
    .maybeSingle();

  if (degradedCaps) {
    // Capability existe pero en draft/rejected → aceptar con G2 forzado
    return { ok: true, degrade_quality: true };
  }

  // No existe capability alguna
  return {
    ok: false,
    error: `source_id '${sourceId}' no tiene capacidad registrada para feature_key='${featureKey}' + method_key='${methodKey}'. Registre capabilities antes de ingerir.`,
  };
}

// ---------------------------------------------------------------------------
// SDD 2: Late data policy gate
// ---------------------------------------------------------------------------
interface LateDataResult {
  late_data_flag: boolean;
  late_data_hours: number;
  skip_events: boolean;
  skip_hi: boolean;
}

async function computeLateDataPolicy(
  ctx: ValidationContext,
  sourceId: string,
  measuredAt: string
): Promise<LateDataResult> {
  // Calcular diferencia en horas entre NOW() y measured_at
  const measuredDate = new Date(measuredAt);
  const diffMs = Date.now() - measuredDate.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  // Si measuredAt es futuro o inválido → no es late
  if (isNaN(measuredDate.getTime()) || diffHours < 0) {
    return { late_data_flag: false, late_data_hours: 0, skip_events: false, skip_hi: false };
  }

  // Obtener cutoff de condition_sources
  const { data: source, error } = await ctx.supabase
    .from("condition_sources")
    .select("late_event_cutoff_hours")
    .eq("source_id", sourceId)
    .maybeSingle();

  if (error) {
    console.error("Error consultando condition_sources para late data:", error);
    // Por seguridad, tratar como late
    return { late_data_flag: true, late_data_hours: diffHours, skip_events: true, skip_hi: true };
  }

  const src = source as { late_event_cutoff_hours: number } | null;
  const cutoff = src?.late_event_cutoff_hours ?? 24;

  // cutoff = 0 → siempre late (CSV histórico)
  if (cutoff === 0) {
    return {
      late_data_flag: true,
      late_data_hours: diffHours,
      skip_events: true,
      skip_hi: diffHours > 168, // > 7 días → no recalcular HI
    };
  }

  if (diffHours > cutoff) {
    // Late data: guardar pero no eventos
    return {
      late_data_flag: true,
      late_data_hours: diffHours,
      skip_events: true,
      skip_hi: diffHours > 168, // > 7 días → no HI
    };
  }

  // Dentro del cutoff: procesamiento normal
  return { late_data_flag: false, late_data_hours: diffHours, skip_events: false, skip_hi: false };
}

// ---------------------------------------------------------------------------
// SDD 2: Idempotency key builder per source_type
// ---------------------------------------------------------------------------
function buildIdempotencyKey(payload: FeatureSetV2Extended): string {
  // Si el cliente ya proveyó una key, usarla
  if (payload.idempotency_key) {
    return payload.idempotency_key;
  }

  const st = payload.source_type;

  switch (st) {
    case "edge":
    case "api":
    case "modbus":
    case "mqtt":
    case "scada":
      // Fuentes automáticas: external_window_id es la clave natural
      return payload.external_window_id;

    case "manual":
    case "portable":
      // Fuentes manuales: source_id + asset_id + (primer feature_key + method_key) + window_start
      // Esto evita duplicados de la misma medición manual
      if (payload.features.length > 0) {
        const f = payload.features[0];
        return `${payload.source_id}:${payload.asset_id}:${f.feature_key}:${f.method_key}:${payload.window_start}`;
      }
      return `${payload.source_id}:${payload.asset_id}:${payload.window_start}`;

    case "csv":
      // CSV: batch_id + row_number
      if (payload.batch_id && payload.row_number !== undefined) {
        return `${payload.batch_id}:${payload.row_number}`;
      }
      return payload.external_window_id;

    default:
      return payload.external_window_id;
  }
}

// ---------------------------------------------------------------------------
// SDD 2: Idempotency check against outbox + windows
// ---------------------------------------------------------------------------
async function checkIdempotency(
  ctx: ValidationContext,
  idempotencyKey: string
): Promise<{ exists: boolean }> {
  // 1. Verificar en outbox
  const { data: outboxEntry, error: outboxError } = await ctx.supabase
    .from("condition_ingest_outbox")
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .limit(1)
    .maybeSingle();

  if (outboxError) {
    console.error("Error verificando idempotencia en outbox:", outboxError);
    // No rechazar por error de consulta — dejar pasar y que la UNIQUE constraint maneje
    return { exists: false };
  }

  if (outboxEntry) {
    return { exists: true };
  }

  // 2. Para edge/api: external_window_id ya es UNIQUE en condition_windows
  //    La check de duplicado se hace en ingestFeatures(). El idempotency_key
  //    para edge/api ES el external_window_id, así que la UNIQUE constraint
  //    de condition_windows ya protege.
  return { exists: false };
}

// ---------------------------------------------------------------------------
// SDD 2: Write payload to outbox (fire-and-forget reliability)
// ---------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
async function writeOutbox(
  supabase: any,
  payload: FeatureSetV2Extended,
  idempotencyKey: string,
  errorCode: string,
  errorMessage: string
): Promise<void> {
  try {
    const payloadStr = JSON.stringify(payload);
    // deno-lint-ignore no-explicit-any
    const { error: outboxError } = await (supabase.from("condition_ingest_outbox") as any)
      .insert({
        idempotency_key: idempotencyKey,
        source_id: payload.source_id,
        source_type: payload.source_type,
        payload: JSON.parse(payloadStr), // JSONB
        payload_size_bytes: new TextEncoder().encode(payloadStr).length,
        status: "pending",
        retry_count: 0,
        max_retries: 3,
        error_code: errorCode,
        error_message: errorMessage,
        error_details: { payload_summary: `${payload.features.length} features, asset=${payload.asset_id}` },
      });

    if (outboxError) {
      console.error("Error escribiendo en outbox:", outboxError);
    } else {
      console.log(`Payload escrito en outbox: idempotency_key=${idempotencyKey}`);
    }
  } catch (err) {
    console.error("Error inesperado en writeOutbox:", err);
  }
}

// ---------------------------------------------------------------------------
// Ingesta: INSERT window + feature_values (extended for SDD 2)
// ---------------------------------------------------------------------------
interface IngestGovernance {
  ingested_by: string;
  late_data_flag: boolean;
  late_data_hours: number;
  quality_gate_passed: boolean;
}

async function ingestFeatures(
  payload: FeatureSetV2Extended,
  validatedFeatures: FeatureV2Extended[],
  featureIdMap: Map<string, string>,
  governance: IngestGovernance
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

  // 4b. INSERT condition_windows (extended with governance columns)
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
    ingested_by: governance.ingested_by,
    late_data_flag: governance.late_data_flag,
    late_data_hours: governance.late_data_hours > 0 ? governance.late_data_hours : null,
    quality_gate_passed: governance.quality_gate_passed,
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

  // 4c. INSERT condition_feature_values (extended with traceability)
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
    // SDD 2: extended traceability
    ingested_by: governance.ingested_by,
    measured_by: f.measured_by ?? null,
    entered_by: f.entered_by ?? null,
    measured_at: f.measured_at ?? payload.window_start,
    entered_at: f.entered_at ?? new Date().toISOString(),
    instrument_ref: f.instrument_ref ?? null,
    notes: f.notes ?? null,
  }));

  const { error: fvError } = await supabase
    .from("condition_feature_values")
    .insert(featureValueRows);

  if (fvError) {
    console.error("Error insertando feature_values:", fvError);

    // Rollback: marcar ventana como rejected
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

  // 4e. Actualizar last_seen_at de la fuente
  await supabase
    .from("condition_sources")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("source_id", payload.source_id);

  return { ok: true, windowId, featureCount: validatedFeatures.length };
}

// ---------------------------------------------------------------------------
// Main handler (extended for SDD 2)
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
    // deno-lint-ignore no-explicit-any
    const ctx: ValidationContext = { supabase: supabase as any };

    // ── SDD 2 STEP 5: Validate source lifecycle ─────────────────
    const lifecycleResult = await validateSourceLifecycle(ctx, payload.source_id);
    if (!lifecycleResult.ok) {
      return new Response(
        JSON.stringify({
          error: `source_id '${payload.source_id}' no permite ingesta (status no activo/field_trial)`,
          details: "La fuente está en draft, disabled o deprecated. Active la fuente antes de ingerir.",
        }),
        { status: 400, headers: corsHeaders() }
      );
    }

    // ── SDD 2 STEP 6: Compute late data policy ──────────────────
    const lateDataResult = await computeLateDataPolicy(
      ctx,
      payload.source_id,
      payload.window_start
    );

    // ── SDD 2 STEP 7: Build idempotency key ─────────────────────
    const idempotencyKey = buildIdempotencyKey(payload);

    // ── SDD 2 STEP 8: Idempotency check ─────────────────────────
    const dupCheck = await checkIdempotency(ctx, idempotencyKey);
    if (dupCheck.exists) {
      return new Response(
        JSON.stringify({
          error: "Idempotency key ya procesado",
          details: `idempotency_key='${idempotencyKey}' ya fue utilizado. No se crearon duplicados.`,
        }),
        { status: 409, headers: corsHeaders() }
      );
    }

    // 3. Validar catálogos y source capabilities por cada feature
    const featureIdMap = new Map<string, string>();
    const validationWarnings: string[] = [];
    let forceG2 = lifecycleResult.force_g2; // Hereda del lifecycle gate

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
        feature.quality_flag = "G2";
        validationWarnings.push(
          `method_key '${feature.method_key}' no registrado → quality_flag forzado a G2`
        );
      }

      // 3c. Validar source capability (SDD 2: enhanced enforcement — CSCE-001,002,003)
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
        feature.quality_flag = "G2";
        forceG2 = true;
        validationWarnings.push(
          `source_id '${payload.source_id}' capability no activa para feature_key='${feature.feature_key}' → quality_flag forzado a G2`
        );
      }
    }

    // Aplicar forceG2 a todos los features si es necesario
    if (forceG2) {
      for (const feature of payload.features) {
        feature.quality_flag = "G2";
      }
    }

    // ── SDD 2 STEP 9: Transaction with governance metadata ──────
    const ingestResult = await ingestFeatures(
      payload,
      payload.features,
      featureIdMap,
      {
        ingested_by: payload.ingested_by ?? `ingest-condition/${payload.source_id}`,
        late_data_flag: lateDataResult.late_data_flag,
        late_data_hours: lateDataResult.late_data_hours,
        quality_gate_passed: !forceG2,
      }
    );

    if (!ingestResult.ok) {
      // ── SDD 2: DB failure → write to outbox ──────────────────
      try {
        // Parse error details from response
        const errorBody = await ingestResult.response.clone().json();
        const errorMsg = errorBody?.error ?? "Error desconocido en ingesta";

        // deno-lint-ignore no-explicit-any
        await writeOutbox(
          supabase as any,
          payload,
          idempotencyKey,
          "DB_INSERT_FAILURE",
          errorMsg
        );
      } catch (outboxErr) {
        console.error("Error writing to outbox:", outboxErr);
      }

      return ingestResult.response;
    }

    // ── SDD 2: Write to outbox (fire-and-forget reliability) ────
    // Always record in outbox so retry_failed_ingests() can replay if needed
    await writeOutbox(
      supabase as any,
      payload,
      idempotencyKey,
      "SUCCESS",
      "Ingested successfully"
    );

    // ── SDD 2 STEP 10: Conditional fire-and-forget ──────────────
    // Only trigger rules/HI if gates allow it
    const shouldTriggerEvents =
      !lateDataResult.skip_events &&
      !lifecycleResult.skip_events;
    const shouldComputeHI =
      !lateDataResult.skip_hi &&
      !lifecycleResult.skip_hi;

    if (shouldTriggerEvents) {
      // Fire-and-forget: no bloquea la respuesta
      const rpcUrl = `${supabaseUrl}/rest/v1/rpc/evaluate_condition_rules`;
      fetch(rpcUrl, {
        method: "POST",
        headers: {
          "apikey": serviceRoleKey,
          "Authorization": `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_asset_id: payload.asset_id }),
      }).catch(e => console.error("evaluate_condition_rules async error:", e));
    }

    if (shouldComputeHI) {
      const hiUrl = `${supabaseUrl}/rest/v1/rpc/compute_health_index`;
      fetch(hiUrl, {
        method: "POST",
        headers: {
          "apikey": serviceRoleKey,
          "Authorization": `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_asset_id: payload.asset_id,
          p_window_end: payload.window_end,
        }),
      }).catch(e => console.error("compute_health_index async error:", e));
    }

    // 5. Respuesta exitosa
    return new Response(
      JSON.stringify({
        window_id: ingestResult.windowId,
        external_window_id: payload.external_window_id,
        idempotency_key: idempotencyKey,
        features_ingested: ingestResult.featureCount,
        status: "processed",
        late_data: lateDataResult.late_data_flag
          ? { flagged: true, hours: lateDataResult.late_data_hours, events_skipped: true }
          : undefined,
        quality_overrides: forceG2 ? "G2 forzado por governance gate" : undefined,
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
