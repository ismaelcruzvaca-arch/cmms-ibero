# Spec: Data Readiness Levels
**Domain**: data-readiness-levels
**SDD**: 6 (condition-monitoring-performance-improvement)

## Requirements

### DRL-D6-001: DRL scale definition
- **Description**: Define DRL 0-6 scale: 0=no data / no signals configured, 1=mock/synthetic data only, 2=real data without confirmed events, 3=real data with stable baseline established, 4=real data with events and technician feedback, 5=real data with confirmed failures, 6=sufficient data for validated statistical model (Weibull/Gamma/Wiener-grade). Scale documented in system metadata or spec references.
- **Rationale**: Every model declares minimum DRL. This scale prevents activating models without sufficient data foundation.
- **Acceptance**: Scale documented, referenced by min_data_readiness_level in condition_degradation_models

### DRL-D6-002: DRL per model
- **Description**: condition_degradation_models.min_data_readiness_level column documents the required DRL for each model. Function assess_data_readiness(p_asset_id UUID) RETURNS INT evaluates current DRL for an asset based on signal history, events, and confirmed outcomes.
- **Rationale**: Models display their requirement; system can assess whether an asset's data supports a given model.
- **Acceptance**: Column populated for all 6 seeded models with correct values. Function exists and returns valid DRL 0-6.

### DRL-D6-003: DRL assessment view
- **Description**: CREATE OR REPLACE VIEW condition_data_readiness AS SELECT asset_id, asset_class, COUNT(*) as total_windows, SUM(CASE WHEN quality='G0' THEN 1 ELSE 0 END)::NUMERIC / NULLIF(COUNT(*),0) as g0_ratio, has_events BOOLEAN, has_feedback BOOLEAN, has_confirmed_outcomes BOOLEAN, CASE WHEN ... END as drl_level. Logic: DRL 0 if no windows, DRL 1 if all synthetic, DRL 2 if real data exists, DRL 3 if baseline stable, DRL 4 if events+feedback, DRL 5 if confirmed failures, DRL 6 if sufficient samples for statistics.
- **Rationale**: Operators need to know what level of analytics their data supports at a glance.
- **Acceptance**: View exists, returns correct DRL per asset, handles empty data gracefully (returns 0)
