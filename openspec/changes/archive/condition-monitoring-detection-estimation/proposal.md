# Proposal: Detection, Adaptive Baselines, Residuals & State Estimation (SDD 3)

## Intent

SDD 1 permitía detectar contra **límites contextuales definidos** (thresholds ISO por clase de activo + método + régimen).
SDD 2 agregó ingesta híbrida con gobierno de fuentes, idempotencia y política de datos tardíos.

SDD 3 agrega **detección contra la normalidad propia del activo**: el sistema aprende qué es "normal" para cada activo en cada régimen, calcula desviaciones significativas, estima estado latente con Kalman, y dispara eventos por **residual sostenido** o **tendencia anómala** — incluso si los valores absolutos están dentro de los límites ISO.

> **SDD 1 detecta "esto excede un límite". SDD 3 detecta "esto se desvía de su propia normalidad".**

## Scope

### In Scope

#### 1. Baseline Management — `condition-baseline-management`
- `condition_baselines` tabla formal con: asset_id, feature_key, method_key, measurement_point_id, regime, rpm_band, load_band, mean, stddev, median, mad, p95, p99, sample_count, valid_from, valid_to, baseline_status, baseline_version, quality_filter, created_by, approved_by
- Lifecycle: draft → candidate → active → frozen → needs_review → deprecated
- Baseline se versiona (no se sobreescribe — cada versión se preserva para auditoría)
- Baseline propuesto, no auto-aprobado: requiere promoción manual o automática con criterios

#### 2. Baseline Learning Policy — `baseline-learning-policy`
- ❌ No actualizar baseline con datos G2/G3
- ❌ No actualizar baseline durante evento activo en ese activo
- ❌ No actualizar baseline con fuente candidate (solo active/field_trial)
- ❌ No actualizar baseline con datos late/históricos (measured_at > 24h)
- ❌ No actualizar baseline si la tendencia es significativa (R² > 0.5 y slope ≠ 0)
- ❌ No actualizar baseline si hay residual sostenido (últimas 5 ventanas con z > 2)
- ✅ Sí actualizar con ventanas de fuente field_trial si el baseline es candidate
- ✅ Sí actualizar con ventanas de régimen nominal y calidad G0/G1
- Periodo de estabilización post-mantenimiento: no aprender baseline hasta N ventanas después de OT cerrada

#### 3. Regime-Aware Baselines — `regime-aware-baselines`
- Baseline por (asset_id + feature_key + method_key + regime + rpm_band + load_band)
- Múltiples baselines por activo (uno por contexto operativo)
- Si no hay baseline para el régimen actual → usar el baseline del régimen más cercano, marcado como "aproximado"

#### 4. Trend & Regression Analysis — `trend-regression-analysis`
- `compute_feature_trend()`: per-feature linear regression con slope, intercept, R², sample_count, lookback_window, regime_consistency
- Almacena en `condition_analysis_results` con analysis_type='trend_slope'
- Confianza: R² bajo (< 0.3) → tendencia no confiable, no dispara eventos críticos
- Muestras insuficientes (< 5) → no evaluar
- Datos mezclados de régimen → no evaluar
- Muchos G2/G3 en la ventana (> 50%) → no evaluar

#### 5. Residual Analysis — `residual-analysis`
Tres niveles, aunque solo se implemente el tipo A en esta versión:
- **Tipo A**: residual = value - baseline_mean (contra baseline estándar)
- **Tipo B**: residual = value - expected_value(regime) (contra baseline contextual) — opcional
- **Tipo C**: residual = measured - model_expected (contra modelo Kalman/regresión) — opcional
- Normalización: z-score = residual / stddev_baseline
- Almacena en `condition_analysis_results` con analysis_type='residual'

#### 6. State Estimation (Kalman 1D) — `state-estimation`
- `compute_kalman_1d()`: filtro Kalman escalar en PL/pgSQL (~80 LOC)
- Variables Q (ruido de proceso) y R (ruido de medición) configurables por método
- Guarda en `condition_analysis_results` con analysis_type='kalman_state':
  - state_estimate (señal filtrada)
  - state_variance (varianza de la estimación)
  - innovation (diferencia entre medición y predicción — CLAVE para detección)
  - innovation_variance (varianza de la innovación)
  - kalman_gain (ganancia de Kalman)
  - method_version y parámetros Q/R para auditoría
- Si la innovación se mantiene consistentemente alta → no es ruido, es evidencia de anomalía

#### 7. Anomaly Detection Rules — `anomaly-detection-rules`
- Reglas que usan z-score del residual contra baseline (ej: z > 3 durante N ventanas)
- Reglas que usan innovación de Kalman sostenida
- Reglas que usan tendencia significativa (R² > 0.5, slope > umbral)
- Reglas compuestas: residual + tendencia + calidad combinadas
- Distinguen field_trial (evento info solamente) vs active (evento real)

#### 8. Detection Explainability — `detection-explainability`
- Cada evento de anomalía debe explicar: qué feature, qué desviación (z-score), contra qué baseline (versión), qué régimen, qué regla disparó
- Almacenado en `condition_events.message` y `condition_event_sources` con referencias a los contribuyentes

### To be added to scope
- `compute_baselines()` SQL function — rolling window statistics per context
- `compute_baseline_residual()` SQL function — residual + z-score
- `compute_kalman_1d()` — scalar Kalman filter in PL/pgSQL
- `compute_feature_trend()` — per-feature linear regression
- `evaluate_condition_rules()` — implementar evaluation_type='residual' (antes placeholder)
- `compute_health_index()` — opcionalmente usar zonas adaptativas desde baselines
- `TrendChart` — recharts component con baseline bands
- Subtab "Tendencias" en la sección de monitoreo de condición
- Bootstrap seeding: 30-50 condition_windows con datos sintéticos realistas por activo
- `compute-hi` EF extendida para llamar nuevas funciones

### Out of Scope
- ❌ Extended Kalman Filter (EKF) → SDD 4
- ❌ Sensor fusion con covarianza → SDD 4
- ❌ RUL prediction → SDD 4
- ❌ Curvas P-F → SDD 4
- ❌ Nuevas Edge Functions → SQL-only + extender compute-hi
- ❌ Full uncertainty propagation (GUM) → SDD 4
- ❌ Diagnóstico causal profundo → SDD 4

## Capabilities

### Modified Capabilities (SDD 1 specs)
| Spec | Change |
|------|--------|
| `condition-analysis-results` | CAR-002: implementar residual, kalman_state, trend_slope reales (eran placeholders) |
| `condition-rules` | CRUL-002: implementar evaluation_type='residual' (era no-op). Agregar detección por z-score, innovación, tendencia |
| `condition-health-index` | CHI-001: HI puede usar zonas adaptativas desde baselines (mean+1σ/2σ/3σ) como alternativa a ISO fijo |
| `condition-thresholds` | Nuevo origen de umbrales: baselines aprendidos por activo, no solo ISO genérico |

### New Specifications Needed
- `condition-baseline-management` — tabla, lifecycle, versionado, gobernanza
- `condition-baseline-learning-policy` — reglas de cuándo aprender/no aprender
- `condition-regime-aware-baselines` — baselines por contexto operativo
- `condition-trend-regression` — per-feature trend con confianza
- `condition-residual-analysis` — residual tipo A/B/C
- `condition-state-estimation` — Kalman 1D gobernado
- `condition-anomaly-detection-rules` — reglas específicas para detección
- `condition-detection-explainability` — eventos con explicación de anomalía

## Baseline Governance Model

### Lifecycle States

```
draft ───→ candidate ───→ active ───→ frozen
  ↑            ↑              │            │
  │            └──── needs_review ←────────┘
  │                            │
  └───────────────────────→ deprecated
```

### Baseline Update Rules (enforced)

| Condition | ¿Actualiza baseline? |
|-----------|---------------------|
| Datos G2/G3 | ❌ No |
| Evento activo en el activo | ❌ No |
| Fuente candidate | ❌ No |
| Datos late (>24h) | ❌ No |
| Tendencia significativa activa | ❌ No |
| Residual sostenido (z>2 × 5 ventanas) | ❌ No |
| Datos G0/G1, régimen nominal, fuente activa | ✅ Sí (EWMA) |
| Post-mantenimiento sin estabilización | ❌ No |
| Rebaseline aprobado manualmente | ✅ Sí (nueva versión) |

### Rebaseline After Maintenance
- Cuando una OT de intervención relevante (reemplazo, alineación, calibración) se cierra:
  - Baseline activo pasa a `needs_review`
  - Periodo de estabilización (N ventanas, configurable, default 20)
  - Después del periodo: se propone nuevo baseline como `candidate`
  - Requiere aprobación manual o automática si cumple criterios
  - El baseline anterior queda como `frozen` (para consulta histórica, no se borra)

## Residual Framework

| Tipo | Descripción | Implementación |
|------|-------------|---------------|
| A — Baseline | value - baseline_mean | ✅ SQL function, SDD 3 |
| B — Contextual | value - expected_value(regime, rpm, load) | ⏳ Opcional SDD 3 |
| C — Modelo | measured - model_expected (Kalman/regresión) | ⏳ Kalman innovation tracking |

## Kalman 1D — Governance

No es "filtro mágico". Es un método registrado y auditable:

- Parámetros Q (process noise) y R (measurement noise) registrados en `condition_analysis_methods.default_parameters`
- Cada estimación guarda: state, variance, innovation, innovation_variance, kalman_gain
- La innovación se usa como evidencia de anomalía (no se descarta como ruido)
- Si innovation > 3σ_innovation sostenido → posible anomalía, no ruido

## Approach

**SQL-only + extend compute-hi EF**: todas las nuevas funciones en PL/pgSQL. No hay nuevas Edge Functions.

**Dos PRs hacia main**:
- **PR 1 (Backend)**: condition_baselines table, baseline learning policy SQL functions, residual functions, Kalman 1D, per-feature trend, extend evaluate_condition_rules, bootstrap seeding, pgTAP (~600 LOC)
- **PR 2 (Frontend)**: TrendChart recharts, "Tendencias" subtab, baseline visualization, explainability info en eventos (~350 LOC)

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/migrations/` | **+2** | condition_baselines + compute functions + bootstrap seed |
| `supabase/functions/compute-hi/` | Extended | +3 RPC calls (baselines, residuals, kalman) |
| `supabase/tests/database/` | +2 files | ~60 pgTAP assertions |
| `src/components/condition/` | New | TrendChart, BaselineViewer (opcional) |
| `src/App.jsx` | Modified | +1 subtab "Tendencias" |
| `src/hooks/` | New | useFeatureTrends.js |
| `openspec/specs/` | 8 new + 4 deltas | Especificaciones para cada capability |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Baseline aprende deterioro como normal | Med | Learning policy explícita: no aprender si tendencia/evento/residual activo. Baselines versionados, no auto-aprobados sin criterios |
| Kalman 1D insuficiente para patrones reales de vibración | Med | Intencional — EKF diferido a SDD 4. 1D Kalman cubre slow-drift y filtrado básico |
| Bootstrap seeding no representativo de datos reales | Low | Revisado contra zonas ISO conocidas; datos reales lo reemplazan en SDD 5 (mejora continua) |
| Regímenes operativos no cubiertos generan falsas alarmas | Med | Si no hay baseline para el régimen actual, se usa el más cercano marcado como "aproximado" |
| Rebaseline post-mantenimiento sin datos suficientes | Low | Periodo de estabilización configurable; baseline queda como candidate hasta suficientes muestras |

## Rollback Plan

Per-migration atomicity: `DROP TABLE condition_baselines CASCADE`, `DROP FUNCTION compute_baselines, compute_baseline_residual, compute_kalman_1d, compute_feature_trend`, revert `compute-hi` EF, remove TrendChart + subtab. Bootstrap seed data rolls back with table.

## Dependencies

- SDD 1 + SDD 2 schema fully deployed
- recharts (verify in package.json)
- Bootstrap seed data (Task 0) — sin esto, las funciones computan sobre vacío

## Success Criteria

- [ ] `condition_baselines` tabla con lifecycle: seed ≥3 baselines (draft → active con aprobación)
- [ ] Baseline learning policy enforzada: G2/G3 no actualizan baseline, eventos activos bloquean learning
- [ ] Regime-aware: baseline por (asset + feature + method + regime + rpm_band + load_band)
- [ ] Rebaseline post-mantenimiento: OT cerrada → baseline → needs_review → estabilización → nuevo candidate
- [ ] `compute_baseline_residual()` retorna z-score correcto para un valor desviante conocido (z > 3)
- [ ] `compute_kalman_1d()` guarda state, variance, innovation, kalman_gain auditable
- [ ] `compute_feature_trend()` retorna slope + R² con confianza; R² < 0.3 no dispara eventos
- [ ] `evaluate_condition_rules()` con evaluation_type='residual' genera eventos por residual sostenido
- [ ] Evaluación de tendencia no se ejecuta con muestras insuficientes (< 5), régimen mezclado, o >50% G2/G3
- [ ] Anomalía explicable: evento guarda qué feature, qué desviación, contra qué baseline (versión), qué regla
- [ ] Bootstrap seed: ≥30 windows por asset con ≥3 features en cada uno, mezclando regímenes nominal y parcial
- [ ] TrendChart renderiza time-series con baseline bandas para ≥1 activo
- [ ] pgTAP: ≥60 assertions pasan
- [ ] No regresión: 542 assertions SDD 1+2 siguen pasando
