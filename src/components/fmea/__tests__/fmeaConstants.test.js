/**
 * Tests unitarios para funciones puras de fmeaConstants.js
 *
 * Cubre todas las funciones helper del wizard FMEA:
 * - computeActionPriority (matriz AIAG/VDA 2019)
 * - fn_determine_rcm_strategy (árbol de decisión RCM — 8 ramas)
 * - formatRPN, mapSimplifiedValue, computeSimplifiedSOD
 * - getStrategyColor, getSeverityColor, getAPColor
 */
import { describe, it, expect } from 'vitest';
import {
  computeActionPriority,
  fn_determine_rcm_strategy,
  formatRPN,
  mapSimplifiedValue,
  computeSimplifiedSOD,
  getStrategyColor,
  getSeverityColor,
  getAPColor,
  SEVERITY_SIMPLIFIED,
  OCCURRENCE_SIMPLIFIED,
  DETECTION_SIMPLIFIED,
  RCM_STRATEGIES,
  RCM_DECISION_TREE,
} from '../fmeaConstants';

// ═══════════════════════════════════════════
// computeActionPriority
// ═══════════════════════════════════════════

describe('computeActionPriority', () => {
  // WIZARD-ENGG-05: HIGH scenarios
  it('returns HIGH when severity >= 9 (no matter O/D)', () => {
    expect(computeActionPriority(9, 1, 1)).toBe('HIGH');
    expect(computeActionPriority(10, 10, 10)).toBe('HIGH');
    expect(computeActionPriority(9, 5, 3)).toBe('HIGH');
  });

  it('returns HIGH when severity >= 7 AND occurrence >= 6', () => {
    expect(computeActionPriority(7, 6, 1)).toBe('HIGH');
    expect(computeActionPriority(8, 8, 2)).toBe('HIGH');
    expect(computeActionPriority(7, 10, 5)).toBe('HIGH');
  });

  it('returns HIGH when severity >= 7 AND detection >= 7', () => {
    expect(computeActionPriority(7, 1, 7)).toBe('HIGH');
    expect(computeActionPriority(8, 3, 9)).toBe('HIGH');
  });

  it('returns HIGH when severity >= 4 AND occurrence >= 7 AND detection >= 5', () => {
    expect(computeActionPriority(4, 7, 5)).toBe('HIGH');
    expect(computeActionPriority(6, 9, 7)).toBe('HIGH');
    expect(computeActionPriority(5, 8, 6)).toBe('HIGH');
  });

  // WIZARD-ENGG-05: MEDIUM scenarios
  it('returns MEDIUM when severity >= 4 AND occurrence >= 4 (and not HIGH)', () => {
    expect(computeActionPriority(4, 4, 1)).toBe('MEDIUM');
    expect(computeActionPriority(6, 6, 4)).toBe('MEDIUM');
    expect(computeActionPriority(4, 7, 4)).toBe('MEDIUM');
  });

  // Boundary: severity=4, occ=4, det=1 → MEDIUM (not HIGH because det<5)
  it('returns MEDIUM for severity=4 occ=4 det=1', () => {
    expect(computeActionPriority(4, 4, 1)).toBe('MEDIUM');
  });

  // WIZARD-ENGG-05: LOW scenarios
  it('returns LOW for low S/O/D values', () => {
    expect(computeActionPriority(1, 1, 1)).toBe('LOW');
    expect(computeActionPriority(3, 3, 3)).toBe('LOW');
    expect(computeActionPriority(2, 5, 2)).toBe('LOW');
    expect(computeActionPriority(3, 6, 3)).toBe('LOW');
  });

  it('returns LOW when severity >= 4 but occurrence < 4 and detection < 7', () => {
    expect(computeActionPriority(4, 1, 1)).toBe('LOW');
    expect(computeActionPriority(6, 3, 1)).toBe('LOW');
  });

  // Edge cases
  it('handles boundary values correctly', () => {
    // severity=7, occ=5, det=5 → not HIGH (occ<6, det<7, not s>=4&occ>=7)
    // severity >= 4, occ >= 4 → MEDIUM
    expect(computeActionPriority(7, 5, 5)).toBe('MEDIUM');

    // severity=7, occ=6, det=1 → HIGH (s>=7 && occ>=6)
    expect(computeActionPriority(7, 6, 1)).toBe('HIGH');

    // severity=4, occ=7, det=4 → MEDIUM (not HIGH because det<5)
    expect(computeActionPriority(4, 7, 4)).toBe('MEDIUM');

    // severity=4, occ=7, det=5 → HIGH (s>=4 && occ>=7 && det>=5)
    expect(computeActionPriority(4, 7, 5)).toBe('HIGH');
  });
});

// ═══════════════════════════════════════════
// fn_determine_rcm_strategy
// ═══════════════════════════════════════════

describe('fn_determine_rcm_strategy', () => {
  // Verify all 8 branches of the RCM decision tree
  const branches = RCM_DECISION_TREE.branches;

  it('has exactly 8 branches in the decision tree', () => {
    expect(branches).toHaveLength(8);
  });

  // Branch 1: q1=true → BCM
  it('Branch 1: q1=true → BCM', () => {
    expect(fn_determine_rcm_strategy({ q1: true })).toBe('BCM');
    expect(fn_determine_rcm_strategy({ q1: true, q2: false, q3: true })).toBe('BCM');
  });

  // Branch 2: q1=false, q2=true, q4=true → PM
  it('Branch 2: q1=false q2=true q4=true → PM', () => {
    expect(fn_determine_rcm_strategy({ q1: false, q2: true, q4: true })).toBe('PM');
    expect(fn_determine_rcm_strategy({ q1: false, q2: true, q3: true, q4: true, q5: true })).toBe('PM');
  });

  // Branch 3: q1=false, q2=true, q4=false, q5=true → BCM
  it('Branch 3: q1=false q2=true q4=false q5=true → BCM', () => {
    expect(fn_determine_rcm_strategy({ q1: false, q2: true, q4: false, q5: true })).toBe('BCM');
    expect(fn_determine_rcm_strategy({ q1: false, q2: true, q3: false, q4: false, q5: true })).toBe('BCM');
  });

  // Branch 4: q1=false, q2=true, q4=false, q5=false → REDESIGN
  it('Branch 4: q1=false q2=true q4=false q5=false → REDESIGN', () => {
    expect(fn_determine_rcm_strategy({ q1: false, q2: true, q4: false, q5: false })).toBe('REDESIGN');
  });

  // Branch 5: q1=false, q2=false, q3=true, q4=true → PM
  it('Branch 5: q1=false q2=false q3=true q4=true → PM', () => {
    expect(fn_determine_rcm_strategy({ q1: false, q2: false, q3: true, q4: true })).toBe('PM');
  });

  // Branch 6: q1=false, q2=false, q3=true, q4=false, q5=true → BCM
  it('Branch 6: q1=false q2=false q3=true q4=false q5=true → BCM', () => {
    expect(fn_determine_rcm_strategy({ q1: false, q2: false, q3: true, q4: false, q5: true })).toBe('BCM');
  });

  // Branch 7: q1=false, q2=false, q3=true, q4=false, q5=false → RTF
  it('Branch 7: q1=false q2=false q3=true q4=false q5=false → RTF', () => {
    expect(fn_determine_rcm_strategy({ q1: false, q2: false, q3: true, q4: false, q5: false })).toBe('RTF');
  });

  // Branch 8: q1=false, q2=false, q3=false → RTF
  it('Branch 8: q1=false q2=false q3=false → RTF', () => {
    expect(fn_determine_rcm_strategy({ q1: false, q2: false, q3: false })).toBe('RTF');
    expect(fn_determine_rcm_strategy({ q1: false, q2: false, q3: false, q4: true, q5: true })).toBe('RTF');
  });

  // Default fallback
  it('returns RTF for unknown combinations', () => {
    // This should never happen if the tree is complete, but test the fallback
    const result = fn_determine_rcm_strategy({});
    expect(result).toBe('RTF');
  });

  // WIZARD-EXPERT-03 scenario: q1=No, q2=Yes, q3=No, q4=Yes, q5=Yes
  it('WIZARD-EXPERT-03 scenario: mixed Yes/No triggers correct strategy', () => {
    // q1=false(F), q2=true(T), q3=false(F), q4=true(T), q5=true(T)
    // Matches Branch 2: q1=false, q2=true, q4=true → PM
    expect(fn_determine_rcm_strategy({
      q1: false, q2: true, q3: false, q4: true, q5: true
    })).toBe('PM');
  });

  // null/undefined values should be treated as "not answered" → match skip
  it('handles null/undefined values gracefully', () => {
    expect(fn_determine_rcm_strategy({ q1: null, q2: undefined })).toBe('RTF');
    expect(fn_determine_rcm_strategy({ q1: true, q2: null })).toBe('BCM');
  });
});

// ═══════════════════════════════════════════
// formatRPN
// ═══════════════════════════════════════════

describe('formatRPN', () => {
  it('formats numbers with locale separators', () => {
    expect(formatRPN(144)).toBe('144');
    expect(formatRPN(1000)).toBe('1,000');
  });

  it('returns "—" for non-numeric values', () => {
    expect(formatRPN(null)).toBe('—');
    expect(formatRPN(undefined)).toBe('—');
    expect(formatRPN('abc')).toBe('—');
    expect(formatRPN(NaN)).toBe('—');
  });

  it('returns "—" for 0 or falsy numeric edge', () => {
    expect(formatRPN(0)).toBe('0');
  });
});

// ═══════════════════════════════════════════
// mapSimplifiedValue
// ═══════════════════════════════════════════

describe('mapSimplifiedValue', () => {
  it('maps severity values correctly', () => {
    expect(mapSimplifiedValue(SEVERITY_SIMPLIFIED, 1)).toBe(2);  // BAJO
    expect(mapSimplifiedValue(SEVERITY_SIMPLIFIED, 4)).toBe(5);  // MEDIO
    expect(mapSimplifiedValue(SEVERITY_SIMPLIFIED, 9)).toBe(9);  // ALTO
  });

  it('maps occurrence values correctly', () => {
    expect(mapSimplifiedValue(OCCURRENCE_SIMPLIFIED, 1)).toBe(1);   // NUNCA
    expect(mapSimplifiedValue(OCCURRENCE_SIMPLIFIED, 4)).toBe(4);   // RARA_VEZ
    expect(mapSimplifiedValue(OCCURRENCE_SIMPLIFIED, 7)).toBe(7);   // SEGUIDO
    expect(mapSimplifiedValue(OCCURRENCE_SIMPLIFIED, 10)).toBe(10); // SIEMPRE
  });

  it('maps detection values correctly', () => {
    expect(mapSimplifiedValue(DETECTION_SIMPLIFIED, 1)).toBe(2); // SIEMPRE
    expect(mapSimplifiedValue(DETECTION_SIMPLIFIED, 5)).toBe(5); // A_VECES
    expect(mapSimplifiedValue(DETECTION_SIMPLIFIED, 9)).toBe(9); // NO
  });

  it('returns the same value if no range matches', () => {
    expect(mapSimplifiedValue(SEVERITY_SIMPLIFIED, 99)).toBe(99);
  });
});

// ═══════════════════════════════════════════
// computeSimplifiedSOD
// ═══════════════════════════════════════════

describe('computeSimplifiedSOD', () => {
  // WIZARD-QUICK-02 scenario
  it('WIZARD-QUICK-02: Severity=ALTO(9), Occurrence=SEGUIDO(7), Detection=A_VECES(5) → RPN=144', () => {
    const result = computeSimplifiedSOD('quick', 9, 7, 5);
    // ALTO → value=9, SEGUIDO → value=7, A_VECES → value=5
    expect(result.severity).toBe(9);
    expect(result.occurrence).toBe(7);
    expect(result.detection).toBe(5);
    expect(result.severity * result.occurrence * result.detection).toBe(315);
  });

  it('passes through values for expert level', () => {
    const result = computeSimplifiedSOD('expert', 7, 5, 4);
    expect(result).toEqual({ severity: 7, occurrence: 5, detection: 4 });
  });

  it('passes through values for engineering level', () => {
    const result = computeSimplifiedSOD('engineering', 8, 3, 6);
    expect(result).toEqual({ severity: 8, occurrence: 3, detection: 6 });
  });
});

// ═══════════════════════════════════════════
// Color helpers
// ═══════════════════════════════════════════

describe('getSeverityColor', () => {
  it('returns green for values <= 3', () => {
    expect(getSeverityColor(1)).toBe('#4caf50');
    expect(getSeverityColor(3)).toBe('#4caf50');
  });

  it('returns orange for values 4-6', () => {
    expect(getSeverityColor(4)).toBe('#ff9800');
    expect(getSeverityColor(6)).toBe('#ff9800');
  });

  it('returns red for values >= 7', () => {
    expect(getSeverityColor(7)).toBe('#f44336');
    expect(getSeverityColor(10)).toBe('#f44336');
  });
});

describe('getStrategyColor', () => {
  it('returns color for known strategies', () => {
    expect(getStrategyColor('BCM')).toBe(RCM_STRATEGIES.BCM.color);
    expect(getStrategyColor('PM')).toBe(RCM_STRATEGIES.PM.color);
    expect(getStrategyColor('RTF')).toBe(RCM_STRATEGIES.RTF.color);
    expect(getStrategyColor('REDESIGN')).toBe(RCM_STRATEGIES.REDESIGN.color);
  });

  it('returns gray for unknown strategies', () => {
    expect(getStrategyColor('UNKNOWN')).toBe('#9e9e9e');
  });
});

describe('getAPColor', () => {
  it('returns color for known AP levels', () => {
    expect(getAPColor('HIGH')).toBe('#f44336');
    expect(getAPColor('MEDIUM')).toBe('#ff9800');
    expect(getAPColor('LOW')).toBe('#4caf50');
  });

  it('returns gray for unknown levels', () => {
    expect(getAPColor('NONE')).toBe('#9e9e9e');
  });
});
