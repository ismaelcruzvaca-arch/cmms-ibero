# Proposal: Condition Monitoring Hybrid Source Integration & Ingest Governance (SDD 2)

## Intent

SDD 1 construyó el lenguaje común del dato de condición: FeatureSet v0.2, catálogos, Health Index, reglas, eventos. Pero tiene **un solo carril de ingesta** (edge). SDD 2 demuestra que ese lenguaje puede recibir datos de **cualquier fuente** — manual, CSV, edge, portátil, Modbus, API — manteniendo el mismo contrato FeatureSet v0.2, con **gobierno de fuentes, validación de capacidades, trazabilidad, idempotencia, auditoría y control de calidad** antes de que los datos entren al pipeline.

> **SDD 2 no solo abre carriles de ingesta; gobierna fuentes, captura manual, importaciones, trazabilidad, permisos, errores y calidad del dato.**

## Scope

### In Scope

#### Source Governance
- `condition_sources` — registro y gobierno de fuentes (source_id, type, name, status, owner, asset_id, last_seen_at, validation_status, created_by)
- Lifecycle de fuente: draft → candidate → field_trial → active → disabled → deprecated
- Source capability enforcement: toda ingesta valida contra `condition_source_capabilities` (feature_key + method_key + unidad). Sin capability → rechazo o quality_flag degradado.

#### Manual Capture
- UI de captura manual con trazabilidad completa: operator_user_id, measured_at, entered_at, instrument, method_key, quality_flag, operational_context, notes
- FeatureSet v0.2 client-side construction → POST a ingest-condition
- Offline-first: captura local → cola RxDB → sync cuando haya red (measured_at preservado)

#### CSV Import
- Staging pipeline: upload → staging → validación → preview → confirmación → ingest
- `condition_import_batches` + `condition_import_rows` — etapa intermedia antes de condition_windows
- Estados del batch: uploaded → validated → ready_to_import → imported → failed → cancelled
- Reporte de errores (filas inválidas, features desconocidas, activos inexistentes) sin contaminar la BD
- Papa Parse client-side para parsing + column mapping con auto-detección

#### Ingest Reliability
- Idempotencia por source_type: external_window_id (edge/API), batch_id + row_number (CSV), manual_entry_id (manual)
- `condition_ingest_outbox` — encolamiento de payloads fallidos
- Retry con backoff exponencial (máx 3 intentos) vía pg_cron
- Dead-letter para payloads que agotaron reintentos
- `condition_ingest_failures` — registro de errores con payload, error_code, retry_count, status (pending_retry | dead_letter | resolved | ignored | reprocessed)

#### Late Data Policy
- Distinción `measured_at` / `window_start` vs `ingested_at` / `created_at`
- Datos tardíos: alimentan histórico y tendencias, NO generan eventos operativos automáticos
- Regla explícita: si `ingested_at - measured_at > 24h`, el dato se guarda pero no dispara reglas ni OTs

#### Security & Audit
- Permisos RBAC: quién captura manual, quién importa CSV, quién confirma batch, quién activa fuente, quién reintenta dead-letter
- Validaciones: tamaño máximo CSV, tipos de archivo, sanitización
- Auditoría: todo insert en condition_windows/feature_values registra source_id + ingested_by
- Dead-letter review UI (mínimo: listar payloads fallidos, ver error, reintentar o descartar)

### Out of Scope
- Adaptadores de protocolo físico (Modbus, MQTT, SCADA) — viven en el edge/gateway
- Source management UI de escritura completa (editar capabilities) → SDD 5
- Procesador completo de outbox con UI de monitoreo → SDD 5
- Dashboards de condición → SDD 5
- Rutas completas de mantenimiento → otro módulo
- Kalman, RUL, diagnóstico avanzado → SDD 3, 4

## Capabilities

### New Capabilities

| # | Capability | Description |
|---|-----------|-------------|
| 1 | `condition-source-registry` | `condition_sources` — registro y gobierno de fuentes con lifecycle (draft→active→deprecated), metadata operativa (owner, last_seen, created_by), health tracking |
| 2 | `manual-condition-capture` | Captura manual con trazabilidad: operator_user_id, measured_at, instrument, method_key, quality_flag. FeatureSet v0.2 client-side. Offline-first con cola RxDB local. |
| 3 | `csv-condition-import` | Importación por batch con staging (`condition_import_batches` + `condition_import_rows`): upload → validate → preview → confirm → ingest. Reporte de errores sin contaminar BD. |
| 4 | `source-capability-enforcement` | Toda ingesta valida contra `condition_source_capabilities`. Sin capability → rechazo o quality_flag=G2. Fuentes no validadas no disparan OTs automáticas. |
| 5 | `ingest-reliability` | Idempotencia por source_type, `condition_ingest_outbox`, retry con backoff (máx 3), dead-letter, `condition_ingest_failures` con estados (pending_retry | dead_letter | resolved) |
| 6 | `late-data-policy` | Distinción measured_at vs ingested_at. Datos con >24h de retraso: guardar pero no generar eventos/OTs. |
| 7 | `ingest-security-audit` | RBAC para captura/importación/activación de fuentes. Auditoría de inserts con source_id + ingested_by. Dead-letter review UI mínimo. |

### Modified Capabilities

| Capability | Change |
|---|---|
| `condition-data-ingest` | Extender ingest-condition EF con idempotency key, batch support, outbox write on failure, late-data gating |
| `condition-source-capabilities` | Seeds multi-feature (≥2 features por fuente edge). Enforcement en ingesta. Policy table para fuentes no validadas (qué pueden y qué no). |

## Approach

### PR 1 — Backend + Ingest Governance (~900 LOC)

**Migrations**:
1. `condition_sources` DDL — 13 cols (source_id, source_type, name, status, asset_id, owner, last_seen_at, validation_status, created_by), 5 indexes, RLS
2. `condition_import_batches` + `condition_import_rows` DDL — staging pipeline, FK a condition_sources, estados del batch
3. `condition_ingest_outbox` DDL — idempotency_key UNIQUE, payload JSONB, retry_count, status
4. `condition_ingest_failures` DDL — dead-letter registro con payload, error_code, resolución
5. Extended capabilities seed: multi-feature para edge_001 (vibration.rms + vibration.peak + temperature.bearing), nuevos source types para CSV y manual

**Edge Functions**:
- `ingest-condition` extendida: idempotency_key param, batch window array, late-data gate (>24h → no events), outbox insert on DB failure, source capability enforcement

**SQL Functions**:
- `retry_failed_ingests()` — pg_cron-driven, backoff exponencial, máx 3 intentos
- `purge_dead_letters(days)` — limpieza de dead-letters antiguos
- `is_source_capable(source_id, feature_key, method_key)` → BOOLEAN

**pgTAP**: ~60 assertions (schema, constraints, RLS, idempotency, outbox flow, late-data gate)

### PR 2 — Frontend (~1400 LOC, 3 stacked slices)

**Slice 2a — Manual Capture (~500 LOC)**:
- `ConditionCapture.jsx` — formulario: asset selector, feature selector (con method_key auto), value input, quality_flag, operational_context, notes, instrument
- `useConditionCapture.js` — FeatureSet v0.2 construction, offline queue (RxDB local → sync), validation client-side
- Sub-tab "Captura" en App.jsx

**Slice 2b — CSV Import (~450 LOC)**:
- `CsvImportForm.jsx` — upload, Papa Parse, column auto-detection, mapping UI, preview table con errores resaltados
- `useCsvImport.js` — staging batch creation, row validation, confirm → bulk ingest
- Sub-tab "CSV" en App.jsx

**Slice 2c — Source Panel + Dead Letter (~450 LOC)**:
- `SourceManagementPanel.jsx` — lista fuentes con badges (active/offline/error/field_trial), capabilities visibles, last_seen
- `SourceHealthBadge.jsx` — indicador visual de estado
- `DeadLetterPanel.jsx` — listar payloads fallidos, ver error, reintentar/descartar
- `useConditionSources.js` — RxDB pull-only para condition_sources
- Sub-tab "Fuentes" en App.jsx

**RxDB**: pull-only para `condition_source_registry`, `condition_feature_definitions` (catálogos). Direct Supabase para writes.

**Tests**: Playwright (manual capture flow, CSV import flow, source panel) + Vitest (hooks, validation)

## Policy: Qué puede hacer cada fuente según su estado

| Estado | Guardar dato | Afectar HI | Generar evento | Crear OT |
|--------|-------------|------------|----------------|----------|
| `draft` | ❌ | ❌ | ❌ | ❌ |
| `candidate` | ✅ (G2 forzado) | ❌ | ❌ | ❌ |
| `field_trial` | ✅ | ✅ (marcado) | Evento `info` solamente | ❌ |
| `active` | ✅ | ✅ | ✅ | ✅ |
| `disabled` | ❌ | ❌ | ❌ | ❌ |
| `deprecated` | ❌ (solo histórico) | ❌ | ❌ | ❌ |

## Late Data Policy

| Retraso | Guardar | Recalcular HI | Generar evento | Crear OT |
|---------|---------|---------------|----------------|----------|
| ≤ 24h | ✅ | ✅ | ✅ | ✅ |
| > 24h, ≤ 7d | ✅ | ✅ (marcado late) | ❌ | ❌ |
| > 7d | ✅ (solo histórico) | ❌ | ❌ | ❌ |

## Idempotency Keys por Source Type

| Source Type | Idempotency Key |
|-------------|-----------------|
| `edge` | `external_window_id` |
| `api` | `external_window_id` |
| `manual` | `source_id + asset_id + feature_key + method_key + measured_at` |
| `csv` | `batch_id + row_number` |
| `portable` | `source_id + asset_id + measured_at` |

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/migrations/` | New (5) | sources, import_batches, import_rows, outbox, failures + extended capabilities seed |
| `supabase/functions/ingest-condition/` | Modified | Idempotency + batch + outbox + late-data gate + capability enforcement |
| `supabase/functions/` | New (1) | SQL functions for retry, purge, capability check |
| `src/pages/ConditionCapture.jsx` | New | Manual capture form |
| `src/components/condition/` | New (6) | FeatureForm, CsvImportForm, SourcePanel, HealthBadge, DeadLetterPanel, ColumnMapper |
| `src/hooks/` | New (3) | useConditionSources, useConditionCapture, useCsvImport |
| `src/lib/rxdb.js` | Modified | Add 2 RxDB schemas (pull-only) |
| `src/App.jsx` | Modified | New Tab "Monitoreo de Condición" con 3 sub-tabs |
| `supabase/tests/database/` | New (3) | pgTAP: sources, outbox, import staging |
| `tests/` | New (4) | Playwright: manual, csv, source panel, dead letter |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| ingest-condition regresión al agregar idempotencia + batch + late-data | Medium | Tests Deno exportando handleRequest; pgTAP pre/post; deploy canary |
| CSV column mapping UX confuso para no-técnicos | Medium | Auto-detección de columnas (feature_key, value, timestamp, unit); preview con errores resaltados en rojo; validación sin submit |
| FeatureSet v0.2 mal construido desde frontend (manual capture) | Low | Validación client-side con mismas interfaces TS que la EF; unit test de construcción del payload |
| Fuente manual activada prematuramente genera OTs falsas | Medium | Policy table explícita; field_trial por defecto para fuentes nuevas; requiere promoción manual a active |
| Outbox retry amplifica inserts fallidos | Low | Almacena payload completo (no feature por feature); máx 3 retries con backoff 1min/5min/15min; dead-letter después del 3er fail |
| RxDB sync agrega complejidad offline | Low | Solo pull-only para 2 colecciones de catálogo; writes van directo a Supabase; cola offline opcional |
| Datos tardíos disparan eventos incorrectos | Medium | Gate explícito en ingest-condition: si ingested_at - measured_at > 24h → skip trigger de reglas |

## Rollback Plan

1. **Migrations**: `supabase migration repair` para revertir a SDD 1. Tablas nuevas no referenciadas por SDD 1 → safe drop.
2. **EF ingest-condition**: redeploy de versión SDD 1 desde tag/commit previo.
3. **Frontend**: revertir commit PR 2. App.jsx vuelve a 3 tabs. RxDB schemas extra no bloquean.
4. **Datos**: feature_values/windows creados durante la ventana de deploy no se borran automáticamente. Limpieza manual si es necesario.

## Dependencies

- **SDD 1 `condition-monitoring-base-metrology`** — COMPLETED y ARCHIVED. 10 tablas, catálogos, ingest-condition EF, RLS. Sin SDD 1 no hay destino.
- **Papa Parse** — nueva dependencia npm (~40kB, MIT). Sin dependencias adicionales.
- **pg_cron** — extensión Supabase ya disponible para retry_failed_ingests().

## Success Criteria

- [ ] `condition_sources` poblado con ≥5 fuentes (edge_001, manual_route_001, csv_import, mock_source, portable_01)
- [ ] `condition_source_capabilities` con seeds multi-feature (≥2 features por fuente edge)
- [ ] Manual capture: técnico selecciona asset → feature → ingresa valor con measured_at e instrument → FeatureSet v0.2 → POST exitoso → ventana + feature_values persistidos con trazabilidad completa
- [ ] CSV import: archivo ≥10 filas → staging → column mapping → preview con errores → confirm → todas las ventanas creadas, filas inválidas reportadas sin contaminar BD
- [ ] Source capability enforcement: fuente sin capability para feature_key+method_key → rechazo 400 o quality_flag=G2
- [ ] Idempotency: mismo idempotency_key repetido → 409, sin duplicados (probado por source_type)
- [ ] Outbox: fallo simulado de BD → payload en outbox → retry exitoso en siguiente ciclo pg_cron → dead-letter tras 3 fails
- [ ] Late data gate: dato con measured_at de hace 48h → guardado pero sin evento/OT generado
- [ ] Policy enforcement: fuente en field_trial → evento info solamente, sin OT; fuente candidate → G2 forzado, sin HI
- [ ] Dead-letter UI: listar payloads fallidos, ver error_message, reintentar o descartar
- [ ] Source panel: lista fuentes con status badges, capabilities, last_seen
- [ ] RBAC: solo PLANNER/ADMIN puede activar fuente o reintentar dead-letter
- [ ] pgTAP: ~60 assertions pasan en tablas nuevas
- [ ] Playwright: 4 flujos end-to-end pasan (manual, CSV, source panel, dead letter)
- [ ] No regresión: 326 assertions pgTAP de SDD 1 siguen pasando
