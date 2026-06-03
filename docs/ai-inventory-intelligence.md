# AI/ML para Inteligencia de Inventario MRO en GEMA CMMS

**Fecha:** 2026-05-25
**Contexto:** GEMA CMMS + Epicor ERP (Epicor gestiona inventario, GEMA registra consumo)
**Arquitectura:** Supabase (PostgreSQL) + Edge Functions + React Frontend

---

## 1. Executive Summary

GEMA CMMS registra **qué partes se usaron, cuándo, en qué activo, y por qué orden de trabajo** — pero NO gestiona stock. Epicor maneja los niveles de inventario, órdenes de compra, y recepciones. Esto define todo el approach de AI/ML: trabajamos con **datos de consumo**, no con balances de stock.

El objetivo de la inteligencia de inventario MRO es:

1. **Predecir demanda futura** de partes basada en histórico de consumo + PM schedules
2. **Detectar anomalías** en consumo (robos, errores de captura, cambios de patrón)
3. **Recomendar partes** al crear una orden de trabajo (asociaciones frecuentes)
4. **Calcular riesgo de desabasto** combinando consumo proyectado vs datos de Epicor
5. **Automatizar clasificación ABC** de repuestos según valor de consumo + criticidad

### Filosofía: SQL-First, ML-Gradual

Para un equipo pequeño, el approach correcto es:

```
Fase 1 (Semana 1-2):  SQL heuristics —  70% del valor, 0% de infraestructura ML
Fase 2 (Semana 3-4):  Prophet + Edge Fn — forecasting con modelos ligeros
Fase 3 (Mes 2-3):     XGBoost/scikit-learn — recomendaciones y clasificación
```

No necesitamos GPU, no necesitamos clusters Spark, no necesitamos data lakes. PostgreSQL es nuestra plataforma de ML.

---

## 2. The Data We Have

### 2.1 Tablas Relevantes

| Tabla | Columnas clave | Propósito para AI/ML |
|---|---|---|
| `work_orders` | `id`, `asset_id`, `failure_class`, `problem_code`, `cause_code`, `criticality`, `wo_type`, `lifecycle_phase`, `created_at`, `completed_at`, `job_plan_id` | Contexto de la orden — qué activo, qué falla, cuándo |
| `inventory_transactions` | `transaction_type` (ISSUE/RETURN/DIRECT_ISSUE), `part_num`, `qty` (±), `work_order_id`, `created_at` | **Fuente principal de demanda** — qué parte, cuándo se usó |
| `material_requests` | `work_order_id`, `part_num`, `requested_qty`, `created_at` | Demanda planificada (vs real en transactions) |
| `job_plans` | `id`, `code`, `intervention_type`, `estimated_hours` | Template de tarea preventiva |
| `job_plan_materials` | `job_plan_id`, `part_num`, `planned_qty` | Partes planeadas por job plan |
| `pm_schedules` | `asset_id`, `job_plan_id`, `time_frequency_days`, `next_target_date` | Demanda FUTURA conocida (programada) |
| `labor_records` | `work_order_id`, `activity_code`, `hours_worked`, `start_time` | Señal de espera por partes (`WAIT_MATERIAL`) |
| `checklist_item_responses` | `checklist_instance_id`, `status`, `causa_falla_id` | FALTA_REPUESTO como causa de falla |
| `assets` | `id`, `criticality` (A/B/C), `asset_type_id` | Criticidad del activo — ponderador |
| `spare_parts` | `part_num`, `description`, `uom` | Catálogo de partes |
| `asset_spare_parts` | `asset_id`, `part_num` | BOM — qué partes aplican a qué activo |

### 2.2 Lo Que NO Tenemos (y por qué está bien)

- **Stock levels** → los tiene Epicor. Los leeremos vía webhook/outbox cuando los necesitemos.
- **Lead times** → los tiene Epicor. Podemos cachearlos en `spare_parts.lead_time_days` agregado.
- **Supplier data** → Epicor. No necesarios para forecasting de consumo.
- **Unit cost** → Epicor. Opcional para ABC valuation.

### 2.3 Señales de "Parte Faltante" en GEMA

GEMA tiene TRES señales independientes de desabasto:

| Señal | Dónde | Cómo detectarla |
|---|---|---|
| **WO bloqueada por partes** | `work_orders.block_reason = 'PARTS'` | WO en estado WAPPR/APPROVED con block_reason PARTS |
| **Técnico esperando material** | `labor_records.activity_code = 'WAIT_MATERIAL'` | Sesiones activas con activity_code WAIT_MATERIAL |
| **Checklist reporta falta** | `checklist_item_responses.causa_falla = 'FALTA_REPUESTO'` | Items FAIL con causa_falla = FALTA_REPUESTO |

Cualquier modelo de predicción de stockout puede usar estas como **target variable** o como **validation signal**.

---

## 3. Use Cases

### Use Case 1: Demanda Forecasting de Partes MRO

**Qué predice:** Cantidad esperada de consumo de una parte en los próximos N días (7, 30, 90).

**Input data:**
- `inventory_transactions` donde `transaction_type IN ('ISSUE', 'DIRECT_ISSUE')` — serie temporal de consumo
- `pm_schedules` → `job_plan_materials` — demanda futura CONOCIDA (preventivos programados)
- `work_orders.created_at` por `failure_class` — demanda correctiva histórica
- `assets.criticality` — ponderador

**Algorithm approach:**

```
┌─────────────────────────────────────────────────────┐
│ Capa 1: Demanda CIERTA (PM)                         │
│   pm_schedules.next_target_date × job_plan_materials│
│   → Conocido 100%, no necesita forecasting          │
├─────────────────────────────────────────────────────┤
│ Capa 2: Demanda ESTACIONAL (correctiva histórica)   │
│   Croston's Method (intermittent demand)            │
│   Prophet (seasonal + trend)                        │
│   → Cuando hay suficientes datos históricos         │
├─────────────────────────────────────────────────────┤
│ Capa 3: Demanda CERO (partes sin histórico)         │
│   Usar partes similares (misma failure_class)       │
│   → Mean encode por categoría de activo             │
└─────────────────────────────────────────────────────┘
```

**SQL example — PM pipeline (demanda cierta):**

```sql
WITH pm_demand AS (
  SELECT
    pm.next_target_date AS due_date,
    jpm.part_num,
    jpm.planned_qty,
    'PM' AS demand_type
  FROM pm_schedules pm
  JOIN job_plans jp ON jp.id = pm.job_plan_id
  JOIN job_plan_materials jpm ON jpm.job_plan_id = jp.id
  WHERE pm.next_target_date IS NOT NULL
    AND pm.next_target_date <= CURRENT_DATE + INTERVAL '90 days'
),
weekly_pm_demand AS (
  SELECT
    date_trunc('week', due_date) AS week,
    part_num,
    SUM(planned_qty) AS pm_qty
  FROM pm_demand
  GROUP BY 1, 2
)
SELECT * FROM weekly_pm_demand ORDER BY week, part_num;
```

**SQL example — Croston-like decomposition (intermittent demand):**

```sql
WITH monthly_consumption AS (
  SELECT
    date_trunc('month', created_at) AS month,
    part_num,
    SUM(ABS(qty)) AS total_qty,
    COUNT(*) AS issue_events
  FROM inventory_transactions
  WHERE transaction_type IN ('ISSUE', 'DIRECT_ISSUE')
    AND created_at >= NOW() - INTERVAL '24 months'
  GROUP BY 1, 2
),
croston_params AS (
  SELECT
    part_num,
    AVG(total_qty) FILTER (WHERE total_qty > 0) AS avg_demand_size,
    COUNT(*) FILTER (WHERE total_qty > 0)::float / COUNT(*) AS demand_probability,
    AVG(total_qty) FILTER (WHERE total_qty > 0) * COUNT(*) FILTER (WHERE total_qty > 0)::float / COUNT(*) AS croston_forecast
  FROM monthly_consumption
  GROUP BY part_num
)
SELECT
  part_num,
  ROUND(avg_demand_size, 2) AS avg_qty_when_used,
  ROUND(demand_probability, 3) AS prob_of_use_per_month,
  ROUND(croston_forecast, 2) AS forecasted_monthly_qty
FROM croston_params
ORDER BY croston_forecast DESC;
```

**Python example (Prophet Edge Function):**

```python
# Edge function: forecast_part_demand.py
import pandas as pd
from prophet import Prophet
from supabase import create_client

def forecast_part(part_num: str, months_history: int = 24):
    rows = supabase.table("inventory_transactions") \
        .select("created_at, qty") \
        .eq("part_num", part_num) \
        .in_("transaction_type", ["ISSUE", "DIRECT_ISSUE"]) \
        .gte("created_at", f"now() - interval '{months_history} months'") \
        .execute()

    df = pd.DataFrame(rows.data)
    df["created_at"] = pd.to_datetime(df["created_at"])
    df["qty"] = df["qty"].abs()

    daily = df.groupby(pd.Grouper(key="created_at", freq="D"))["qty"].sum().reset_index()
    daily.columns = ["ds", "y"]

    model = Prophet(
        yearly_seasonality=True,
        weekly_seasonality=False,
        daily_seasonality=False,
        changepoint_prior_scale=0.05
    )
    model.fit(daily)

    future = model.make_future_dataframe(periods=90)
    forecast = model.predict(future)

    return forecast[["ds", "yhat", "yhat_lower", "yhat_upper"]].tail(90).to_dict("records")
```

**How to validate:**
- Backtest: tomar 12 meses de historia, predecir mes 13, comparar con real
- Error métricas: SMAPE (para demanda intermitente, MAPE es problemático con ceros)
- MASE (Mean Absolute Scaled Error) — recomendado para intermitente
- Para PM: validación directa — comparar forecast vs material_requests generados

**Expected impact:**
- Reducción de stockouts correctivos: 15-25%
- Reducción de inventario ocioso (partes que nunca se usan): 10-20%
- Planners pasan de reactivos a proactivos

---

### Use Case 2: Anomaly Detection en Consumo de Partes

**Qué detecta:** Picos o patrones inusuales de consumo que pueden indicar robo, error de captura, cambio de proceso, o falla recurrente no detectada.

**Input data:**
- `inventory_transactions` — serie de consumo por parte
- `work_orders.failure_class` — contexto de la falla
- `work_orders.asset_id` — activo específico

**Algorithm approach:**

```
┌────────────────────────────────────────────────────┐
│ Método 1: Z-score sobre ventana móvil (rápido)     │
│   avg_30d, std_30d → z = (consumo_hoy - avg) / std │
│   |z| > 3 → anomalía                               │
├────────────────────────────────────────────────────┤
│ Método 2: MAD (Robusto a outliers)                 │
│   modified_z = 0.6745 * (x - median) / MAD         │
│   |modified_z| > 3.5 → anomalía                    │
├────────────────────────────────────────────────────┤
│ Método 3: IQR (ventana trimestral)                 │
│   Q1 - 1.5*IQR < normal < Q3 + 1.5*IQR            │
├────────────────────────────────────────────────────┤
│ Método 4: Isolation Forest (multivariable)         │
│   Features: consumo, frecuencia, failure_class,    │
│   asset_criticality, day_of_week, mes              │
└────────────────────────────────────────────────────┘
```

**SQL example — Z-score móvil:**

```sql
WITH weekly_consumption AS (
  SELECT
    date_trunc('week', created_at) AS week,
    part_num,
    SUM(ABS(qty)) AS weekly_qty
  FROM inventory_transactions
  WHERE transaction_type IN ('ISSUE', 'DIRECT_ISSUE')
  GROUP BY 1, 2
),
stats AS (
  SELECT
    part_num,
    week,
    weekly_qty,
    AVG(weekly_qty) OVER (
      PARTITION BY part_num
      ORDER BY week
      ROWS BETWEEN 12 PRECEDING AND 1 PRECEDING
    ) AS avg_12wk,
    STDDEV(weekly_qty) OVER (
      PARTITION BY part_num
      ORDER BY week
      ROWS BETWEEN 12 PRECEDING AND 1 PRECEDING
    ) AS std_12wk
  FROM weekly_consumption
)
SELECT
  part_num,
  week,
  weekly_qty,
  ROUND(avg_12wk, 2) AS expected,
  ROUND((weekly_qty - avg_12wk) / NULLIF(std_12wk, 0), 2) AS z_score,
  CASE
    WHEN std_12wk = 0 THEN 'NO_HISTORY'
    WHEN ABS((weekly_qty - avg_12wk) / std_12wk) > 3 THEN 'ANOMALY'
    WHEN ABS((weekly_qty - avg_12wk) / std_12wk) > 2 THEN 'WARNING'
    ELSE 'NORMAL'
  END AS alert
FROM stats
WHERE week >= NOW() - INTERVAL '4 weeks'
ORDER BY z_score DESC NULLS LAST;
```

**Python example (Isolation Forest):**

```python
from sklearn.ensemble import IsolationForest
import pandas as pd
import numpy as np

def detect_anomalies(part_num: str):
    # features por semana: qty, frequency, unique_assets, failure_classes
    rows = supabase.rpc("get_part_consumption_features", {"p_part_num": part_num}).execute()

    df = pd.DataFrame(rows.data)
    feature_cols = ["weekly_qty", "issue_count", "unique_assets", "unique_failures"]

    model = IsolationForest(
        contamination=0.05,
        random_state=42,
        n_estimators=100
    )
    df["anomaly_score"] = model.fit_predict(df[feature_cols])
    df["is_anomaly"] = df["anomaly_score"] == -1

    return df[df["is_anomaly"]][["week_start", *feature_cols]].to_dict("records")
```

**False positive handling:**
- Contexto: un pico de consumo durante un shutdown programado NO es anomalía
- Regla: si el asset asociado tiene `machine_down_at` en la misma semana, reducir puntaje
- Regla: si el consumo está asociado a PM schedule conocido, NO marcar

**How to validate:**
- Revisión manual del top-20 anomalías por parte (precision@20)
- Tasa de falsos positivos < 30% en producción
- Feedback loop: botón "Descartar" / "Confirmar anomalía" en UI

**Expected impact:**
- Detección temprana de fugas de inventario (robos/extraviós)
- Identificación de partes con falla recurrente (misma failure_class, mismo asset)
- Corrección de errores de captura (DOBLE_ISSUE, qty mal ingresada)

---

### Use Case 3: Partes Recommendation / Association Rules

**Qué recomienda:** "Los técnicos que usaron la parte X también usaron Y" — al crear una WO, sugerir partes adicionales basado en patrones históricos.

**Input data:**
- `inventory_transactions` agrupado por `work_order_id` — todas las partes usadas en una misma WO
- `work_orders.failure_class`, `problem_code` — contexto de falla
- `asset_spare_parts` — BOM (partes diseñadas para ese activo)

**Algorithm approach:**

```
┌────────────────────────────────────────────────────┐
│ Basket: cada WO es un "carrito de compras"          │
│   Items: partes en inventory_transactions por WO    │
│                                                      │
│ Algoritmo A: Apriori (PG SQL, mlxtend)              │
│   - Support: partes que aparecen juntas             │
│   - Confidence: P(Y|X)                              │
│   - Lift: >1 significa correlación positiva         │
│                                                      │
│ Algoritmo B: FP-Growth (más rápido, sparse data)    │
│   - Mejor para MRO donde hay muchas partes          │
│   - Cada WO tiene pocas partes → sparse             │
│                                                      │
│ Algoritmo C: Collaborative Filtering (SVD)          │
│   - Matriz WO × parte → factorización               │
│   - Predice partes para WO nueva basado en          │
│     failure_class + asset similares                 │
└────────────────────────────────────────────────────┐
```

**SQL example — Pair frequency (Apriori sin librería):**

```sql
WITH wo_parts AS (
  SELECT DISTINCT work_order_id, part_num
  FROM inventory_transactions
  WHERE transaction_type IN ('ISSUE', 'DIRECT_ISSUE')
    AND work_order_id IS NOT NULL
    AND part_num IS NOT NULL
),
pairs AS (
  SELECT
    a.part_num AS part_a,
    b.part_num AS part_b,
    COUNT(*) AS co_occurrence
  FROM wo_parts a
  JOIN wo_parts b ON a.work_order_id = b.work_order_id
    AND a.part_num < b.part_num
  GROUP BY a.part_num, b.part_num
),
part_freq AS (
  SELECT part_num, COUNT(*) AS total_wos
  FROM wo_parts
  GROUP BY part_num
)
SELECT
  p.part_a,
  p.part_b,
  p.co_occurrence,
  ROUND(100.0 * p.co_occurrence / pf_a.total_wos, 1) AS confidence_a_to_b,
  ROUND(100.0 * p.co_occurrence / pf_b.total_wos, 1) AS confidence_b_to_a,
  ROUND(
    (p.co_occurrence::numeric / pf_a.total_wos)
    / (pf_b.total_wos::numeric / (SELECT COUNT(DISTINCT work_order_id) FROM wo_parts)),
    2
  ) AS lift
FROM pairs p
JOIN part_freq pf_a ON pf_a.part_num = p.part_a
JOIN part_freq pf_b ON pf_b.part_num = p.part_b
WHERE p.co_occurrence >= 3
  AND lift > 1.5
ORDER BY lift DESC
LIMIT 100;
```

**Python example (Apriori con mlxtend):**

```python
from mlxtend.frequent_patterns import apriori, association_rules
import pandas as pd

def get_part_recommendations(part_num: str, min_support=0.01, min_lift=1.5):
    # Matriz WO × parte (one-hot)
    rows = supabase.rpc("get_wo_part_matrix").execute()
    df = pd.DataFrame(rows.data).pivot(
        index="work_order_id", columns="part_num", values="used"
    ).fillna(0).astype(bool)

    frequent = apriori(df, min_support=min_support, use_colnames=True)
    rules = association_rules(frequent, metric="lift", min_threshold=min_lift)

    recommendations = rules[
        (rules["antecedents"] == {part_num}) |
        (rules["consequents"] == {part_num})
    ].sort_values("lift", ascending=False)

    return recommendations[["antecedents", "consequents", "support", "confidence", "lift"]].head(10).to_dict("records")
```

**How to validate:**
- A/B test: mostrar recomendaciones en UI, medir click-through rate
- Hit rate: de las veces que se recomendó una parte, ¿cuántas se agregaron realmente?
- Precision@k: de las top-5 recomendaciones, ¿cuántas se usaron en la WO?

**Expected impact:**
- Reducción de WOs bloqueadas por PARTS (técnico descubre parte faltante antes de empezar)
- Aumento de material_requests por WO (técnicos piden todo junto)
- Mejor planificación: planners ven partes relacionadas al crear job_plans

---

### Use Case 4: Stockout Prediction (Riesgo de Desabasto)

**Qué predice:** Probabilidad de que una parte crítica se agote antes de que llegue el próximo reabastecimiento.

**Input data:**
- `inventory_transactions` — consumo histórico (desde GEMA)
- `pm_schedules + job_plan_materials` — demanda futura CONOCIDA (desde GEMA)
- Stock actual + on-order + lead time (DESDE EPICOR vía sync/outbox)
- `labor_records.activity_code = 'WAIT_MATERIAL'` — señal de que YA hay desabasto
- `work_orders.block_reason = 'PARTS'` — validación

**Algorithm approach:**

```
┌──────────────────────────────────────────────────────────────┐
│ Risk Score = P(stockout) combinando:                         │
│                                                               │
│ 1. Demanda proyectada (PM known + forecasted corrective)      │
│ 2. Stock actual + on-order (desde Epicor)                     │
│ 3. Lead time (días para recibir reorden)                      │
│ 4. Criticalidad del activo que necesita la parte              │
│ 5. Historial de stockouts previos (WAIT_MATERIAL flag)        │
│                                                               │
│ Heuristic:                                                     │
│   days_until_stockout = qty_on_hand / daily_avg_consumption   │
│   risk = days_until_stockout < lead_time ? HIGH : LOW         │
│                                                               │
│ ML:                                                            │
│   XGBoost classifier: features → stockout yes/no (30d window) │
└──────────────────────────────────────────────────────────────┘
```

**SQL example — Heuristic risk score:**

```sql
WITH consumption_rate AS (
  SELECT
    part_num,
    SUM(ABS(qty)) / 90.0 AS daily_avg,
    STDDEV(ABS(qty)) AS daily_std
  FROM inventory_transactions
  WHERE transaction_type IN ('ISSUE', 'DIRECT_ISSUE')
    AND created_at >= NOW() - INTERVAL '90 days'
  GROUP BY part_num
),
pm_pipeline AS (
  SELECT
    jpm.part_num,
    SUM(jpm.planned_qty) AS planned_next_30d
  FROM pm_schedules pm
  JOIN job_plans jp ON jp.id = pm.job_plan_id
  JOIN job_plan_materials jpm ON jpm.job_plan_id = jp.id
  WHERE pm.next_target_date BETWEEN NOW() AND NOW() + INTERVAL '30 days'
  GROUP BY jpm.part_num
),
stockout_signals AS (
  SELECT
    part_num,
    COUNT(*) AS wait_material_count
  FROM labor_records lr
  JOIN work_orders wo ON wo.id = lr.work_order_id
  JOIN inventory_transactions it ON it.work_order_id = wo.id
  WHERE lr.activity_code = 'WAIT_MATERIAL'
    AND lr.created_at >= NOW() - INTERVAL '6 months'
  GROUP BY it.part_num
)
SELECT
  cr.part_num,
  cr.daily_avg,
  COALESCE(ppm.planned_next_30d, 0) AS planned_next_30d,
  COALESCE(ss.wait_material_count, 0) AS stockout_history,
  CASE
    WHEN cr.daily_avg > 0 AND (COALESCE(ppm.planned_next_30d, 0) / 30.0) > cr.daily_avg * 1.5
      THEN 'HIGH_RISK_SPIKE'
    WHEN cr.daily_avg = 0 AND COALESCE(ppm.planned_next_30d, 0) > 0
      THEN 'MODERATE_RISK_NEW'
    WHEN COALESCE(ss.wait_material_count, 0) >= 3
      THEN 'HIGH_RISK_REPEAT'
    ELSE 'LOW_RISK'
  END AS risk_category
FROM consumption_rate cr
LEFT JOIN pm_pipeline ppm ON ppm.part_num = cr.part_num
LEFT JOIN stockout_signals ss ON ss.part_num = cr.part_num
ORDER BY risk_category, stockout_history DESC;
```

**Python example (XGBoost classifier):**

```python
import xgboost as xgb
import pandas as pd
import numpy as np

def train_stockout_model():
    rows = supabase.rpc("get_stockout_features").execute()
    df = pd.DataFrame(rows.data)

    # Features
    features = [
        "daily_avg_consumption_90d",
        "daily_std_consumption_90d",
        "planned_qty_next_30d",
        "qty_on_hand",          # from Epicor sync
        "lead_time_days",
        "criticality_score",
        "failure_count_90d",
        "wait_material_count_180d",
        "unique_assets_using_90d",
        "is_pm_part"
    ]

    X = df[features]
    y = df["stockout_occurred_next_30d"]  # binary target

    model = xgb.XGBClassifier(
        n_estimators=200,
        max_depth=4,
        learning_rate=0.1,
        scale_pos_weight=(y == 0).sum() / (y == 1).sum(),  # handle imbalance
        random_state=42
    )

    model.fit(X, y)

    # Feature importance
    importance = pd.DataFrame({
        "feature": features,
        "importance": model.feature_importances_
    }).sort_values("importance", ascending=False)

    return model, importance
```

**How to validate:**
- Backtest: para cada día en el pasado, ¿el modelo predijo el stockout que ocurrió?
- Precision/Recall: ¿cuántos de los alertados realmente se quedaron sin stock?
- Lead time: comparar con la alerta temprana — días antes del stockout real

**Expected impact:**
- Reducción de WOs bloqueadas por PARTS: 30-50%
- Técnicos pasan menos tiempo esperando material
- Planners pueden reasignar inventario antes del desabasto

---

### Use Case 5: ABC Classification Automation

**Qué clasifica:** Cada parte en A (80% valor), B (15%), C (5%) según consumo + criticidad.

**Input data:**
- `inventory_transactions` — consumo anual por parte (qty × unit_cost)
- `assets.criticality` — A/B/C del activo donde se usa la parte
- `failure_class` — frecuencia de falla asociada

**Algorithm approach:**

```
┌──────────────────────────────────────────────────────────────┐
│ ABC Tradicional (un solo criterio):                          │
│   Partes rankeadas por valor de consumo anual                │
│   Top 80% acumulado = A, siguiente 15% = B, resto = C       │
│                                                               │
│ ABC Multi-Criterio (recomendado para MRO):                   │
│   Score = w1*consumo_value + w2*criticality + w3*scarcity    │
│   Donde:                                                      │
│     consumo_value = % del gasto total en la parte            │
│     criticality = max criticality de assets que la usan      │
│     scarcity = 1 / (# de suppliers OR lead_time_factor)      │
│                                                               │
│ ABC Dinámico:                                                 │
│   Recalcular cada mes (o trimestre)                          │
│   Guardar historial de cambios de clase (A→B, etc.)          │
└──────────────────────────────────────────────────────────────┘
```

**SQL example — ABC multi-criterio:**

```sql
WITH consumption_value AS (
  SELECT
    it.part_num,
    SUM(ABS(it.qty)) AS annual_qty,
    SUM(ABS(it.qty) * COALESCE(sp.unit_cost, 0)) AS annual_value
  FROM inventory_transactions it
  LEFT JOIN spare_parts sp ON sp.part_num = it.part_num
  WHERE it.transaction_type IN ('ISSUE', 'DIRECT_ISSUE')
    AND it.created_at >= NOW() - INTERVAL '365 days'
  GROUP BY it.part_num
),
part_criticality AS (
  SELECT
    asp.part_num,
    MAX(CASE a.criticality
      WHEN 'A' THEN 3 WHEN 'B' THEN 2 WHEN 'C' THEN 1
      ELSE 0
    END) AS max_criticality_score
  FROM asset_spare_parts asp
  JOIN assets a ON a.id = asp.asset_id
  GROUP BY asp.part_num
),
scored AS (
  SELECT
    cv.part_num,
    cv.annual_value,
    COALESCE(pc.max_criticality_score, 0) AS criticality_score,
    -- Normalizar a 0-1
    ROW_NUMBER() OVER (ORDER BY cv.annual_value DESC)::float /
      COUNT(*) OVER () AS value_percentile,
    pc.max_criticality_score / 3.0 AS criticality_norm,
    -- Score compuesto (pesos: 50% valor, 30% criticidad, 20% frecuencia)
    (0.5 * (1 - ROW_NUMBER() OVER (ORDER BY cv.annual_value DESC)::float /
      COUNT(*) OVER ())
    + 0.3 * COALESCE(pc.max_criticality_score, 0) / 3.0
    + 0.2 * COALESCE(cv.annual_qty / NULLIF(MAX(cv.annual_qty) OVER (), 0), 0)) AS composite_score
  FROM consumption_value cv
  LEFT JOIN part_criticality pc ON pc.part_num = cv.part_num
),
cumulative AS (
  SELECT
    part_num,
    annual_value,
    composite_score,
    SUM(annual_value) OVER (ORDER BY composite_score DESC) AS running_value,
    SUM(annual_value) OVER () AS total_value
  FROM scored
)
SELECT
  part_num,
  annual_value,
  ROUND(100.0 * running_value / NULLIF(total_value, 0), 1) AS cumulative_pct,
  composite_score,
  CASE
    WHEN running_value / NULLIF(total_value, 0) <= 0.80 THEN 'A'
    WHEN running_value / NULLIF(total_value, 0) <= 0.95 THEN 'B'
    ELSE 'C'
  END AS abc_class,
  CASE
    WHEN composite_score >= 0.7 THEN 'A'
    WHEN composite_score >= 0.4 THEN 'B'
    ELSE 'C'
  END AS abc_multicriteria
FROM cumulative
ORDER BY composite_score DESC;
```

**How to validate:**
- Comparar clasificación automática vs clasificación manual de storeroom manager
- Agreement rate (Kappa score) entre ABC automático y esperado
- Revisión trimestral: ¿las partes A están siendo contadas mensualmente?

**Expected impact:**
- Cycle counting optimizado (A cada mes, B cada trimestre, C al año)
- Enfoque de replenishment en partes A (80% del valor)
- Planners pueden priorizar partes críticas sin análisis manual

---

## 4. Architecture Options

### Option A: SQL-Only (Heuristic, Simple, Immediate)

```
┌──────────┐     ┌──────────────────┐     ┌───────────┐
│  GEMA DB │────→│ SQL Views + Fn   │────→│  GEMA UI  │
│ (PG)     │     │ (in-database AI)  │     │ (React)   │
└──────────┘     └──────────────────┘     └───────────┘
```

**Stack:**
- PostgreSQL window functions + CTEs
- Materialized views (refrescadas por cron)
- Supabase scheduled functions (pg_cron)

**Pros:**
- Cero infraestructura adicional
- Datos nunca salen de la DB
- Latencia: < 100ms (misma DB)
- Conocimiento existente: SQL lo sabe el equipo
- Time to value: 1-2 días

**Cons:**
- No maneja seasonality compleja
- No aprende de datos nuevos automáticamente
- Croston's method se aproxima pero no es exacto
- Sin detección de patrones no lineales

**Qué se puede hacer con SQL puro:**
- ABC classification ✓
- Association rules (pair frequency, support, confidence) ✓
- Anomaly detection (Z-score, IQR, MAD) ✓
- Stockout risk (heuristic) ✓
- PM pipeline demand ✓
- Consumption rate (moving average, HW) ✓

**Costo:** $0 (ya tenemos Supabase)

---

### Option B: Lightweight ML (Prophet/XGBoost as Supabase Edge Function)

```
┌──────────┐    ┌────────────────┐    ┌───────────────┐    ┌───────────┐
│  GEMA DB │───→│  Edge Function  │───→│ Prediction    │───→│  GEMA UI  │
│ (PG)     │    │  (Deno/Python)  │    │  Cache (PG)   │    │ (React)   │
└──────────┘    └────────────────┘    └───────────────┘    └───────────┘
                      │
                      ↓
                 ┌──────────┐
                 │  Epicor   │ (stock levels vía webhook)
                 └──────────┘
```

**Stack:**
- Supabase Edge Functions (Deno) o Python container
- Prophet (Facebook) para forecasting
- XGBoost para clasificación/anomalías
- scikit-learn para preprocesamiento
- PG para storage de predicciones (materialized)

**Pros:**
- ML real, no solo heurísticas
- Prophet maneja seasonality, outliers, changepoints automáticamente
- XGBoost es best-in-class para datos tabulares
- Edge Functions escalan a 0 (sin costo cuando no se usan)
- Predictions cacheadas: la UI consulta la tabla, no el modelo

**Cons:**
- Python en Edge Functions tiene cold start (~2-5s)
- Entrenamiento bajo demanda: primera llamada lenta
- Prophet necesita ~1 año de datos para seasonality anual
- Dependencia: mantener entorno Python/Deno

**Costo estimado:** ~$10-20/mes en Supabase Edge Function usage

---

### Option C: External ML Service (Separate Python Microservice)

```
┌──────────┐    ┌──────────────┐    ┌─────────────┐    ┌───────────┐
│  GEMA DB │───→│  ML Service  │───→│  Redis/DB   │───→│  GEMA UI  │
│ (PG)     │    │  (FastAPI)   │    │  (Cache)    │    │ (React)   │
└──────────┘    └──────────────┘    └─────────────┘    └───────────┘
                      │
                      ↓
                 ┌──────────┐
                 │  Epicor  │
                 └──────────┘
```

**Stack:**
- FastAPI + Celery (async training)
- MLflow para tracking de experimentos
- PostgreSQL feature store (vistas materializadas)
- Docker + Fly.io / Railway / self-hosted
- Prophet, XGBoost, scikit-learn, optuna

**Pros:**
- Separación completa de concerns
- Entrenamiento asíncrono (Celery workers)
- Feature store centralizado
- Experimentación fácil (MLflow)
- Puede servir múltiples modelos

**Cons:**
- Infraestructura adicional que mantener
- Costo operativo ($30-100/mes)
- Latencia de red entre servicios
- Overkill para el equipo actual

**Costo estimado:** ~$30-100/mes + mantenimiento

---

## 5. Recommended Approach: Fases Progresivas

### Principio: SQL First, ML Gradual

El equipo actual (~3-5 devs) no necesita ni debe saltar directo a ML. El 70% del valor de "AI de inventario" viene de agregaciones SQL bien escritas.

### Fase 0: Feature Queries (Semana 1)

| Query | Output | Tabla destino |
|---|---|---|
| Consumption rate por parte | `avg_daily, std_daily, trend` | `ai_part_consumption_stats` |
| ABC classification | `part_num, abc_class, abc_multicriteria` | `ai_part_abc` |
| PM pipeline (90d lookahead) | `part_num, week, planned_qty` | `ai_pm_demand_pipeline` |
| Pair frequency (associations) | `part_a, part_b, support, lift` | `ai_part_associations` |
| Stockout signals | `part_num, wait_material_count` | `ai_stockout_signals` |
| Anomaly Z-scores | `part_num, week, z_score, alert` | `ai_consumption_anomalies` |

SQL:

```sql
-- eschema para feature tables
CREATE SCHEMA IF NOT EXISTS ai_inventory;

-- Refresh schedule via pg_cron
SELECT cron.schedule(
  'refresh-ai-consumption-stats',
  '0 3 * * *',  -- cada día a las 3 AM
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY ai_inventory.part_consumption_stats$$
);

SELECT cron.schedule(
  'refresh-ai-abc',
  '0 4 1 * *',  -- primer día de cada mes
  $$REFRESH MATERIALIZED VIEW ai_inventory.part_abc$$
);

SELECT cron.schedule(
  'refresh-ai-associations',
  '0 5 * * 0',  -- cada domingo
  $$REFRESH MATERIALIZED VIEW ai_inventory.part_associations$$
);
```

### Fase 1: SQL Heuristics en UI (Semana 2)

| Feature UI | Fuente | Acción del usuario |
|---|---|---|
| **Partes recomendadas** al crear WO | `ai_part_associations` + context (failure_class) | Auto-sugerir en selector de partes |
| **Alertas de anomalía** en Dashboard | `ai_consumption_anomalies` | Botón "Descartar" / "Investigar" |
| **ABC badge** en catálogo de partes | `ai_part_abc` | Mostrar badge A/B/C con tooltip |
| **Riesgo de desabasto** por parte | Heuristic: daily_avg vs PM pipeline | Card amarilla/roja en detalle de parte |
| **Tendencia de consumo** (gráfico) | `ai_part_consumption_stats` | Sparkline de 12 meses |

### Fase 2: Prophet Forecasting (Semana 3-4)

- Edge Function: `forecast-part` (llamada bajo demanda + cache)
- Entrenar Prophet para top-100 partes por valor de consumo
- Cachear forecast en `ai_inventory.part_forecasts`
- UI: gráfico de forecast con bandas de confianza (yhat_lower, yhat_upper)
- Validación: backtest automático cada semana

### Fase 3: XGBoost + Optimización (Mes 2-3)

**Modelos a implementar:**
1. **Stockout classifier** → probabilidad de desabasto en 30 días
2. **Anomaly detector** → Isolation Forest o Autoencoder
3. **Demand optimizer** → EOQ sugerido basado en forecast + lead time

**Infraestructura:**
- Feature store: vistas materializadas en ai_inventory schema
- Model registry: tabla `ai_inventory.models` con metadata (version, metrics, path)
- Inference: Edge Function con ONNX runtime (modelos serializados)
- Training: cron mensual + manual trigger

---

## 6. Data Pipeline Diagram

```
                     TIEMPO REAL (CRON)
┌─────────────────────────────────────────────────────────────────────┐
│                            GEMA PostgreSQL                            │
│                                                                       │
│  ┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐   │
│  │ Raw Data      │    │ Feature Queries   │    │ AI Tables         │   │
│  │               │    │ (SQL Views/Fn)    │    │ (Materialized)    │   │
│  │ work_orders   │───→│                   │───→│ part_consumption  │   │
│  │ inv_trans     │    │ daily_consumption │    │ part_abc          │   │
│  │ mat_requests  │    │ pm_pipeline       │    │ part_associations │   │
│  │ pm_schedules  │    │ wo_context        │    │ stockout_risk     │   │
│  │ labor_records │    │ failure_features  │    │ consumption_anom  │   │
│  │ checklists    │    │                   │    │ part_forecasts    │   │
│  │ spare_parts   │    └──────────────────┘    └────────┬─────────┘   │
│  └──────────────┘                                      │              │
└────────────────────────────────────────────────────────┼──────────────┘
                                                          │
                 ┌────────────────────────────────────────┘
                 ▼
        ┌──────────────────┐          ┌──────────────────┐
        │  Phase 1: SQL    │          │  Phase 2: ML     │
        │                  │          │                  │
        │  SELECT + CTEs   │          │  Edge Function   │
        │  Window fns      │          │  Prophet         │
        │  Materialized    │          │  XGBoost         │
        │  Cron refresh    │          │  ONNX inference  │
        └────────┬─────────┘          └────────┬─────────┘
                 │                              │
                 └──────────┬───────────────────┘
                            ▼
                 ┌──────────────────────┐
                 │    GEMA UI (React)    │
                 │                      │
                 │  ┌────────────────┐  │
                 │  │ Part Detail     │  │ ← forecast graph, ABC badge, risk
                 │  │ WO Creator      │  │ ← recommended parts
                 │  │ Dashboard       │  │ ← anomalies, stockout alerts
                 │  │ ABC Report      │  │ ← classification table
                 │  └────────────────┘  │
                 └──────────────────────┘
                            │
                            ▼
                 ┌──────────────────────┐
                 │   Epicor (via outbox) │
                 │                      │
                 │  Stock levels sync   │
                 │  Reorder alerts     │
                 └──────────────────────┘
```

---

## 7. Implementation Roadmap

### Fase 0 — Feature Foundation (3 días)

| Tarea | Output | Dependencias |
|---|---|---|
| Crear schema `ai_inventory` | Schema listo | Ninguna |
| Escribir SQL de consumo diario por parte | VIEW/MATVIEW | inventory_transactions |
| Escribir SQL de PM pipeline 90d | VIEW/MATVIEW | pm_schedules, job_plan_materials |
| Escribir SQL de ABC classification | MATVIEW | inventory_transactions, spare_parts |
| Escribir SQL de association pairs | MATVIEW | inventory_transactions |
| Escribir SQL de anomaly Z-score | MATVIEW | inventory_transactions |
| Escribir SQL de stockout signals | VIEW | labor_records, work_orders |
| Configurar pg_cron refreshes | Cron jobs | Todas las MATVIEWs |
| **Esfuerzo:** 3 días / 1 dev | | |

### Fase 1 — SQL en UI (5 días)

| Tarea | Output | Dependencias |
|---|---|---|
| Componente `PartRecommendations` en WO Creator | React component | Fase 0 associations |
| Componente `AnomalyAlert` para Dashboard | React component | Fase 0 anomalies |
| Badge ABC en `SparePartCard` | React component | Fase 0 abc |
| Card de riesgo en detalle de parte | React component | Fase 0 stockout |
| Sparkline de consumo en detalle de parte | React chart | Fase 0 consumption |
| Botón de feedback (Descartar/Confirmar anomalía) | Mutation + DB col | Fase 0 anomalies |
| **Esfuerzo:** 5 días / 1 dev | | |

### Fase 2 — Prophet Forecasting (6 días)

| Tarea | Output | Dependencias |
|---|---|---|
| Edge Function `forecast-part` | Deno/Python | Supabase Edge Functions |
| Cache de forecasts en `ai_inventory.part_forecasts` | MATVIEW | Edge Function |
| Backtest automático (rolling evaluation) | CRON + log table | Forecasts |
| Gráfico de forecast con bandas de confianza | React + Recharts | Edge Function |
| Botón "Recalcular forecast" (manual trigger) | UI + Edge Fn | Edge Function |
| **Esfuerzo:** 6 días / 1 dev ML + 1 dev FE | | |

### Fase 3 — XGBoost (7 días)

| Tarea | Output | Dependencias |
|---|---|---|
| Feature store consolidado | SQL + scheduled refresh | Fase 0 |
| Stockout classifier (XGBoost) | Python model + inference | Fase 2 (forecast) |
| Anomaly detector (Isolation Forest) | Python model + inference | Fase 1 anomalies |
| Model registry table | `ai_inventory.models` | Training |
| Training pipeline (cron monthly) | Python + scheduler | Feature store |
| Feedback loop (actual vs predicted) | Monitoring dashboard | Inference |
| **Esfuerzo:** 7 días / 1 dev ML + 1 dev FE | | |

### Timeline Total

```
Semana 1 (Jul 1-5):     Fase 0 — Feature Foundation
Semana 2 (Jul 8-12):    Fase 1 — SQL en UI
Semana 3-4 (Jul 15-26): Fase 2 — Prophet Forecasting
Semana 5-6 (Jul 29-Ago 9): Fase 3 — XGBoost
                         ───────────────────
Total:                   ~6 semanas / 2 devs
                         ~$0 infra (Fase 0-1)
                         ~$10-20/mes (Fase 2+)
```

---

## 8. Feature Store Schema

```sql
-- ============================================================
-- AI/ML Feature Store — Schema: ai_inventory
-- ============================================================
CREATE SCHEMA IF NOT EXISTS ai_inventory;

-- ────────────────────────────────────────────
-- Part consumption statistics (refreshed daily)
-- ────────────────────────────────────────────
CREATE MATERIALIZED VIEW ai_inventory.part_consumption_stats AS
SELECT
  part_num,
  COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS issues_30d,
  COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '90 days') AS issues_90d,
  COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '365 days') AS issues_1y,
  SUM(ABS(qty)) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS qty_30d,
  SUM(ABS(qty)) FILTER (WHERE created_at >= NOW() - INTERVAL '90 days') AS qty_90d,
  SUM(ABS(qty)) FILTER (WHERE created_at >= NOW() - INTERVAL '365 days') AS qty_1y,
  SUM(ABS(qty)) / 90.0 AS daily_avg_90d,
  STDDEV(ABS(qty)) AS daily_std_90d,
  COUNT(DISTINCT work_order_id) FILTER (WHERE created_at >= NOW() - INTERVAL '90 days') AS wos_90d,
  COUNT(DISTINCT work_order_id) FILTER (WHERE created_at >= NOW() - INTERVAL '365 days') AS wos_1y
FROM inventory_transactions
WHERE transaction_type IN ('ISSUE', 'DIRECT_ISSUE')
GROUP BY part_num;

COMMENT ON MATERIALIZED VIEW ai_inventory.part_consumption_stats IS
  'Estadísticas de consumo por parte: volúmenes, frecuencias, y ventanas temporales. Fuente primaria para forecasting.';

CREATE UNIQUE INDEX ON ai_inventory.part_consumption_stats(part_num);

-- ────────────────────────────────────────────
-- ABC classification (refreshed monthly)
-- ────────────────────────────────────────────
CREATE MATERIALIZED VIEW ai_inventory.part_abc AS (
  -- (SQL del Use Case 5, ver arriba)
);

-- ────────────────────────────────────────────
-- Part association rules (refreshed weekly)
-- ────────────────────────────────────────────
CREATE MATERIALIZED VIEW ai_inventory.part_associations AS (
  -- (SQL del Use Case 3, ver arriba)
);

-- ────────────────────────────────────────────
-- Consumption anomalies (refreshed daily)
-- ────────────────────────────────────────────
CREATE MATERIALIZED VIEW ai_inventory.consumption_anomalies AS (
  -- (SQL del Use Case 2, ver arriba)
);

-- ────────────────────────────────────────────
-- Stockout risk (refreshed daily)
-- ────────────────────────────────────────────
CREATE MATERIALIZED VIEW ai_inventory.stockout_risk AS (
  -- (SQL del Use Case 4, ver arriba)
);

-- ────────────────────────────────────────────
-- PM demand pipeline (refreshed daily)
-- ────────────────────────────────────────────
CREATE MATERIALIZED VIEW ai_inventory.pm_demand_pipeline AS (
  SELECT
    date_trunc('week', pm.next_target_date) AS week,
    jpm.part_num,
    SUM(jpm.planned_qty) AS planned_qty
  FROM pm_schedules pm
  JOIN job_plans jp ON jp.id = pm.job_plan_id
  JOIN job_plan_materials jpm ON jpm.job_plan_id = jp.id
  WHERE pm.next_target_date IS NOT NULL
    AND pm.next_target_date <= CURRENT_DATE + INTERVAL '90 days'
  GROUP BY 1, 2
);

-- ────────────────────────────────────────────
-- Forecast cache (written by Edge Function)
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_inventory.part_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_num TEXT NOT NULL REFERENCES spare_parts(part_num),
  forecast_date DATE NOT NULL DEFAULT CURRENT_DATE,
  horizon_days INT NOT NULL DEFAULT 90,
  ds DATE NOT NULL,           -- forecasted date
  yhat NUMERIC,               -- predicted value
  yhat_lower NUMERIC,         -- lower bound (80% CI)
  yhat_upper NUMERIC,         -- upper bound (80% CI)
  model_version TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(part_num, forecast_date, ds)
);

CREATE INDEX ON ai_inventory.part_forecasts(part_num, forecast_date);

-- ────────────────────────────────────────────
-- Model registry
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_inventory.models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name TEXT NOT NULL,            -- 'stockout_xgb', 'forecast_prophet', etc.
  model_version TEXT NOT NULL,
  model_type TEXT NOT NULL,            -- 'xgboost', 'prophet', 'isolation_forest'
  status TEXT NOT NULL DEFAULT 'STAGING' CHECK (status IN ('STAGING', 'PRODUCTION', 'ARCHIVED')),
  metrics JSONB,                       -- {'precision': 0.85, 'recall': 0.72, ...}
  features TEXT[],                     -- feature names used
  training_date TIMESTAMPTZ DEFAULT NOW(),
  trained_by TEXT,
  model_artifact_path TEXT,            -- URL to model binary (Edge Function)
  feature_importance JSONB,
  notes TEXT,
  UNIQUE(model_name, model_version)
);

-- ────────────────────────────────────────────
-- Anomaly feedback loop
-- ────────────────────────────────────────────
ALTER TABLE ai_inventory.consumption_anomalies
  ADD COLUMN IF NOT EXISTS feedback TEXT CHECK (feedback IN ('CONFIRMED', 'FALSE_POSITIVE', 'IGNORED')),
  ADD COLUMN IF NOT EXISTS feedback_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS feedback_by UUID REFERENCES user_profiles(id);
```

---

## 9. Key Design Decisions

### 9.1 ¿Por qué SQL-First?

- **El equipo ya sabe SQL.** Nadie necesita aprender scikit-learn para entregar valor.
- **PostgreSQL window functions** (LAG, AVG, STDDEV sobre ventanas) cubren el 70% de los casos de forecasting y anomalías.
- **Latencia cero:** los datos no se mueven. La UI consulta MATVIEWs, no APIs de ML.
- **Costo cero:** no hay infraestructura ML que mantener en Fase 0-1.

### 9.2 ¿Por qué Prophet y no LSTM/Transformer?

- **Datos insuficientes:** para una parte MRO típica, tenemos 1-3 años de datos con demanda intermitente (muchos ceros). Las LSTMs necesitan ~10k+ puntos para superar a Prophet.
- **Interpretabilidad:** Prophet da tendencia, seasonality, changepoints. LSTM es caja negra.
- **Incertidumbre nativa:** Prophet produce bandas de confianza (yhat_lower, yhat_upper). Vital para inventory.
- **Robustez:** Prophet maneja outliers, missing data, y changepoints automáticamente.

### 9.3 ¿Y Croston's Method?

Croston es el estándar para demanda intermitente (típica en MRO). Prophet puede modelar intermitente con `seasonality_mode='multiplicative'` y changepoints. Si la demanda es extremadamente intermitente (90%+ de períodos con cero), implementar Croston como función PL/pgSQL dedicada.

Croston aproximado en SQL:

```sql
CREATE OR REPLACE FUNCTION ai_inventory.croston_forecast(
  p_part_num TEXT,
  p_periods INT DEFAULT 12  -- months
)
RETURNS TABLE (month INT, forecast NUMERIC)
LANGUAGE plpgsql AS $$
DECLARE
  v_nonzero_avg NUMERIC;
  v_probability NUMERIC;
BEGIN
  WITH monthly AS (
    SELECT
      date_trunc('month', created_at) AS month,
      SUM(ABS(qty)) AS total_qty
    FROM inventory_transactions
    WHERE part_num = p_part_num
      AND transaction_type IN ('ISSUE', 'DIRECT_ISSUE')
      AND created_at >= NOW() - INTERVAL '24 months'
    GROUP BY 1
  ),
  nonzero AS (
    SELECT AVG(total_qty) AS avg_qty, COUNT(*) AS nonzero_count
    FROM monthly WHERE total_qty > 0
  ),
  total AS (
    SELECT COUNT(*) AS total_count FROM monthly
  )
  SELECT
    COALESCE((SELECT avg_qty FROM nonzero), 0),
    COALESCE((SELECT nonzero_count::float FROM nonzero), 0) /
      GREATEST((SELECT total_count FROM total), 1)
  INTO v_nonzero_avg, v_probability;

  RETURN QUERY
  SELECT
    generate_series(1, p_periods) AS month,
    ROUND(v_nonzero_avg * v_probability, 2) AS forecast;
END;
$$;
```

### 9.4 Integración con Epicor para Stockout

La predicción de stockout necesita saber el stock actual. Dos opciones:

| Opción | Cómo | Latencia | Confiabilidad |
|---|---|---|---|
| **Pull vía outbox** | GEMA envía consulta a Epicor cada N horas | ~5 min | Alta (síncrono) |
| **Push desde Epicor** | Epicor envía webhook cuando cambia stock | ~1 min | Media (pérdida posible) |
| **Cache local** | GEMA cachea último stock conocido en `ai_inventory.epicor_stock_cache` | Variable | Depende del refresh |

Recomendación: **Cache local con push**, actualizado vía webhook de Epicor + sync diario como fallback.

---

## 10. Métricas de Éxito

| Métrica | Cómo medir | Target Fase 1 | Target Fase 3 |
|---|---|---|---|
| **Stockout accuracy** | Precision/Recall de alertas de riesgo | 60% precision | 80% precision |
| **Recommendation hit rate** | % de WOs donde se aceptó recomendación | — | 30% hit rate |
| **Anomaly false positive rate** | % de alertas descartadas por usuario | < 40% | < 20% |
| **ABC agreement** | Kappa vs clasificación manual | 0.7 | 0.85 |
| **Forecast SMAPE** | Symmetric MAPE sobre forecast de 30 días | — | < 40% |
| **User engagement** | % de WOs creadas con AI suggestions | 20% | 60% |

---

## 11. Anti-Patterns y Riesgos

1. **No forecastear partes sin histórico.** Para partes sin transacciones, no hay forecast. Usar heurística de asset_spare_parts + BOM.
2. **No usar ML para todo.** Si una regla SQL funciona (PM pipeline → demanda conocida), no la reemplaces con un modelo.
3. **No ignorar el contexto.** Un pico de consumo durante shutdown no es anomalía. Filtrar por `machine_down_at`.
4. **No sobrecargar la UI.** No muestres 20 recomendaciones. 3-5 es el máximo cognitivo.
5. **No entrenar en producción sin validación.** Siempre staging → validación → producción.
6. **No depender 100% de Epicor sync.** El cache puede estar desactualizado. Diseñar UI para mostrar "Última sincronización: hace X horas".

---

## 12. AI Inventory Intelligence — Quick Reference

```
┌─────────────────────────────────────────────────────────────────────┐
│                    AI INVENTORY REFERENCE CARD                       │
├──────────────────────┬──────────────────────┬───────────────────────┤
│ USE CASE             │ ALGORITHM            │ PHASE                 │
├──────────────────────┼──────────────────────┼───────────────────────┤
│ Demand Forecasting   │ Croston + Prophet    │ Fase 2 (Edge Fn)     │
│ PM Pipeline (known)  │ SQL: pm_schedules    │ Fase 0 (MATVIEW)     │
│ Anomaly Detection    │ Z-score + Isolation  │ Fase 0/3 (SQL/ML)    │
│ Part Recommendations │ Apriori (pair freq)  │ Fase 0 (MATVIEW)     │
│ Stockout Risk        │ Heuristic + XGBoost  │ Fase 0/3 (SQL/ML)    │
│ ABC Classification   │ Multi-criteria SQL   │ Fase 0 (MATVIEW)     │
├──────────────────────┴──────────────────────┴───────────────────────┤
│ INFRASTRUCTURE                                                      │
│   Fase 0-1: $0 (PostgreSQL + cron)                                 │
│   Fase 2: $10/mo (Edge Functions + Python)                        │
│   Fase 3: $30/mo (XGBoost + model registry)                       │
├─────────────────────────────────────────────────────────────────────┤
│ TEAM                                                                 │
│   Fase 0-1: 1 full-stack dev                                        │
│   Fase 2-3: 1 dev + 1 ML engineer (part-time)                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

*Documento generado: 2026-05-25*
*Próxima revisión: 2026-07-25 (después de Fase 0)*
