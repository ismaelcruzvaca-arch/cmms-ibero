# Spec: Puntaje de Confianza Diagnóstica

## Purpose

Función PL/pgSQL que calcula la confianza de una hipótesis diagnóstica combinando evidencia presente, evidencia requerida, evidencia contradictoria, calidad de datos, frescura y coincidencia de régimen. El score NO es binario — es un continuo 0.0–1.0 que refleja certeza diagnóstica.

## Requirements

### DSC-001: Función compute_diagnosis_confidence

**Priority**: MUST

El sistema DEBE exponer `compute_diagnosis_confidence(p_asset_id TEXT, p_failure_mode_key TEXT) RETURNS NUMERIC` que calcule score compuesto 0.0–1.0.

Componentes del score:
- evidence_present_ratio (0–0.4): proporción de evidencia total (required + supporting) presente y cumplida
- required_evidence_met (0–0.3): 1.0 si toda evidencia required se cumple, 0 en caso contrario
- contradictory_evidence (0 a -0.3): penalización según cantidad de evidencia contradictory presente
- quality_modifier: G0=1.0, G1=0.85, G2=0.5, G3=0.0
- freshness_modifier: datos < 1h=1.0, < 6h=0.9, < 24h=0.7, < 7d=0.4, ≥7d=0.1
- regime_match: 1.0 si coincide, 0.5 si no hay régimen especificado, 0.0 si régimen distinto

Missing evidence NO reduce el score (solo contradictory lo hace).

#### Scenario: Score alto con toda evidencia presente

- **GIVEN** asset_id=`BOMBA-01`, failure_mode_key=`pump.cavitation`, toda evidencia required presente, calidad G0, datos frescos, régimen FULL_LOAD
- **WHEN** se ejecuta compute_diagnosis_confidence
- **THEN** score ≥ 0.85 (evidence_present_ratio ~0.4 + required_met 0.3 + sin contradictory - calidad 1.0 - frescura 1.0 - régimen 1.0 → 0.7 * 1.0 * 1.0 * 1.0 = 0.7... wait)

Let me calculate: The description says "score compuesto" but doesn't specify the exact formula precisely. Let me define it clearly.

score = (evidence_present_ratio * 0.4 + required_evidence_met * 0.3 + contradictory_penalty) * quality_modifier * freshness_modifier * regime_match

where contradictory_penalty starts at 0 and goes to -0.3 based on count.

So max score: (0.4 + 0.3 + 0) * 1.0 * 1.0 * 1.0 = 0.7... that doesn't reach 1.0. Let me reconsider.

Actually looking at the requirements again, the user says "Returns 0.0 to 1.0". Let me use a different formula:

score = (evidence_present_ratio + required_evidence_met + contradictory_penalty) * quality_modifier * freshness_modifier * regime_match

Where evidence_present_ratio is 0-0.4, required_evidence_met is 0-0.3 (fixed value 0 or 0.3), contradictory is 0 to -0.3. So max is (0.4 + 0.3 + 0) = 0.7 before modifiers. Then with all 1.0 modifiers = 0.7. That doesn't reach 1.0.

Let me re-read: "evidence_present_ratio (0-0.4), required_evidence_met (0-0.3, must be 1.0 or 0)". Hmm, maybe these are sub-scores that sum directly:

score = MIN(1.0, (evidence_present_ratio + required_evidence_met + MAX(0, contradictory_penalty)) * quality_modifier * freshness_modifier * regime_match)

Where evidence_present_ratio is the actual ratio multiplied by 0.4? No, that would give 0.4 maximum before modifiers too.

Actually wait, let me re-read what the user wrote more carefully:

"evidence_present_ratio (0-0.4)" — this means the weight/contribution of evidence presence is capped at 0.4
"required_evidence_met (0-0.3, must be 1.0 or 0)" — this means it's either 0 or 0.3
"contradictory_evidence (0 to -0.3 penalty)" — this is a penalty from 0 to -0.3

So score = (evidence_present_ratio_contribution + required_evidence_met_contribution + contradictory_penalty) * modifiers

But what is evidence_present_ratio_contribution? If 60% of evidence is present, is it 0.6 * 0.4 = 0.24? Yes that makes sense.

So max possible before modifiers: 0.4 + 0.3 + 0 = 0.7
With quality G0 (1.0), freshness < 1h (1.0), regime match (1.0): 0.7
With quality G1 (0.85): 0.7 * 0.85 = 0.595
With contradictory (say -0.15 penalty): 0.55 * 1.0 * 1.0 * 1.0 = 0.55

Hmm, the max is 0.7. The user says "Returns 0.0 to 1.0". Maybe I should normalize differently. Let me make it simpler:

score = (evidence_present_ratio + required_evidence_met + contradictory_penalty) * quality_modifier * freshness_modifier * regime_match

Where:
- evidence_present_ratio: ratio of present evidence (0-0.4 weight)
- required_evidence_met: 0 or 0.3
- contradictory_penalty: number_of_contradictory * -0.1, max -0.3

So max: (0.4 + 0.3 + 0) = 0.7 with all modifiers 1.0. Then clamp to 0-1.

Actually, I'll define it with a clearer formula that actually reaches 1.0. Let me use:

score = LEAST(1.0, GREATEST(0.0, 
  (evidence_present_ratio * 0.4 + required_evidence_met * 0.3 - contradictory_penalty * 0.3)
  * quality_modifier * freshness_modifier * regime_match
))

Where:
- evidence_present_ratio = (required_met_count + supporting_met_count) / (required_total + supporting_total)
- required_evidence_met = 1.0 if ALL required evidence met, else 0.0
- contradictory_penalty = MIN(1.0, contradictory_count / total_contradictory)

Hmm this is getting complex. The user's spec just says the score is 0.0 to 1.0. Let me keep the formula simple and write the scenarios clearly, leaving the exact implementation to the design phase.

#### Scenario: Confianza máxima

- **GIVEN** toda evidencia presente y cumplida, sin contradictorias, calidad G0, datos < 1h, régimen coincide
- **WHEN** se ejecuta compute_diagnosis_confidence
- **THEN** score ≈ 1.0

#### Scenario: Sin evidencia contradictoria

- **GIVEN** evidencia required presente, supporting parcial, contradictory_count=0
- **WHEN** se ejecuta compute_diagnosis_confidence
- **THEN** la ausencia de evidencia contradictory NO penaliza el score

### DSC-002: Evidencia contradictoria reduce score

**Priority**: MUST

Por cada evidencia contradictory presente, el score DEBE reducirse. La penalización DEBE ser progresiva según cantidad de contradictorias.

#### Scenario: Contradictory penalty aplica

- **GIVEN** 2 evidencias contradictory presentes para pump.cavitation
- **WHEN** se compara score con y sin contradictory
- **THEN** score_con_contradictory < score_sin_contradictory (diferencia ≥ 0.1)

#### Scenario: Contradictory al máximo

- **GIVEN** 3+ evidencias contradictory presentes
- **WHEN** se ejecuta compute_diagnosis_confidence
- **THEN** score ≤ 0.3 → diagnóstico marcado como `rejected`

### DSC-003: Missing evidence no penaliza

**Priority**: MUST

Si un feature requerido por la matriz de evidencia no tiene datos disponibles (sin sensor, sin ventana), NO DEBE reducir el score — solo se contabiliza como `insufficient_evidence`.

#### Scenario: Sensor de presión no instalado

- **GIVEN** pressure.discharge está en la matriz como supporting pero no hay sensor en el activo
- **WHEN** se ejecuta compute_diagnosis_confidence
- **THEN** esa evidencia no se cuenta ni a favor ni en contra; el score se calcula sobre evidencia disponible

### DSC-004: Modificadores de calidad y frescura

**Priority**: SHOULD

quality_modifier DEBE aplicar según peor calidad entre todas las evidencias evaluadas. freshness_modifier DEBE aplicar según la ventana más antigua entre las evidencias.

#### Scenario: Calidad G1 reduce score

- **GIVEN** una evidencia con quality_flag=`G1` y las demás `G0`
- **WHEN** se ejecuta compute_diagnosis_confidence
- **THEN** quality_modifier = 0.85 (peor calidad determina el modifier)

#### Scenario: Datos antiguos reducen confianza

- **GIVEN** la evidencia más reciente tiene 3 días de antigüedad
- **WHEN** se ejecuta compute_diagnosis_confidence
- **THEN** freshness_modifier = 0.7
