# Delta for competency-engine

## MODIFIED Requirements

### Requirement: Automatic Level Calculation

The system MUST calculate `technician_skills.current_level` as the MAX of all achieved levels per technician+module pair. Level 3 count SHALL use SUM(trust_score) instead of COUNT(*) for weighted qualification. Evidence with `causa_falla_id` IN (FALTA_HERRAMIENTA, FALTA_REPUESTO, ERROR_DOCUMENTACION) SHALL NOT count against competence (status=false is filtered from FAIL count but PASS evidence is unaffected).

Achievement rules:
- Level 1 if `technician_module_progress.induccion_completada = true`
- Level 2 if EXISTS any evidence with `nivel_evaluado=2 AND status=true`
- Level 3 if SUM(trust_score) for evidence with `nivel_evaluado=3 AND status=true` >= 5
- Level 4 if EXISTS any evidence with `nivel_evaluado=4 AND status=true`
- Level 5 if `technician_module_progress.autor_estandar = true`

FAIL filtering: Evidence with `status=false AND causa_falla_id IN (FALTA_HERRAMIENTA, FALTA_REPUESTO, ERROR_DOCUMENTACION)` SHALL be excluded entirely from level 3 SUM calculation. All other FAILs (BRECHA_CONOCIMIENTO, DESVIACION_DISCIPLINARIA, NULL causa_falla) SHALL count as regular FAILs (not added to SUM).

(Previously: Level 3 required COUNT of evidence with `nivel_evaluado=3 AND status=true >= 5`. No trust_score weighting. No causa_falla filtering.)

#### Scenario: Level 3 with trust_score weighting

- GIVEN a technician has 10 PASS evidence at nivel_evaluado=3, all with `trust_score=0.5` (SELF)
- WHEN level calculation triggers
- THEN `SUM(trust_score) = 5.0` which is >= 5
- AND `technician_skills.current_level = 3`

#### Scenario: Level 3 threshold not met with low trust

- GIVEN a technician has 8 PASS evidence at nivel_evaluado=3, all with `trust_score=0.5` (SELF)
- WHEN level calculation triggers
- THEN `SUM(trust_score) = 4.0` which is < 5
- AND `technician_skills.current_level` is NOT 3

#### Scenario: FAIL with FALTA_HERRAMIENTA excluded from count

- GIVEN a technician has 5 PASS evidence at nivel_evaluado=3 (trust_score=1.0 each)
- AND 3 FAIL evidence at nivel_evaluado=3 with causa_falla=FALTA_HERRAMIENTA
- WHEN level calculation triggers
- THEN `SUM(trust_score) = 5.0` (FAILs excluded)
- AND `technician_skills.current_level = 3`

#### Scenario: FAIL with BRECHA_CONOCIMIENTO counts as regular FAIL

- GIVEN a technician has 5 PASS evidence at nivel_evaluado=3 (trust_score=1.0 each)
- AND 2 FAIL evidence with causa_falla=BRECHA_CONOCIMIENTO
- WHEN level calculation triggers
- THEN `SUM(trust_score) = 5.0` (BRECHA_CONOCIMIENTO FAILs do not add to SUM)
- AND the BRECHA_CONOCIMIENTO FAILs are recorded but do not reduce the SUM

#### Scenario: Legacy NULL trust_score treated as 1.0

- GIVEN a technician has 5 PASS evidence at nivel_evaluado=3 with `trust_score IS NULL` (legacy)
- WHEN level calculation triggers
- THEN `SUM(trust_score)` treats each NULL as 1.0
- AND `SUM(trust_score) = 5.0`
- AND `technician_skills.current_level = 3`

#### Scenario: Legacy NULL causa_falla counts as regular FAIL

- GIVEN a technician has 5 PASS evidence at nivel_evaluado=3
- AND 1 FAIL evidence at nivel_evaluado=3 with `causa_falla_id IS NULL` (legacy)
- WHEN level calculation triggers
- THEN `SUM(trust_score) = 5.0` (legacy FAIL with NULL causa_falla is a regular FAIL — not added to SUM)
- AND `technician_skills.current_level = 3`

#### Scenario: NO_APLICA evidence counts as PASS

- GIVEN a checklist item_response with `status='FAIL'` and `causa_falla_id=NO_APLICA`
- WHEN `trg_checklist_to_evidence` fires
- THEN the evidence row has `status=true`
- AND when level calculation triggers, this counts toward PASS SUM

### Requirement: Proficiency Levels Catalog

No change to the 5-level catalog. Level 3 description SHALL be updated to reflect trust-weighted calculation:

| Level | Name | Trigger Description |
|-------|------|---------------------|
| 3 | Independent | SUM(trust_score) >= 5 in Block B evidence |

(Previously: "Bloque B (Ejecución) consistente en 5+ OTs")
