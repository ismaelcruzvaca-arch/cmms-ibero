/**
 * Constantes compartidas para el asistente de análisis FMEA guiado.
 *
 * Incluye:
 *  - Mapas simplificados S/O/D (Nivel 1 — Rápido)
 *  - Tablas estándar AIAG/VDA (Nivel 2 — Experto / Nivel 3 — Ingeniería)
 *  - Preguntas y estrategias RCM
 *  - Matriz de prioridad de acción (AP) según AIAG/VDA 2019
 *  - Definiciones de niveles del wizard
 *  - Funciones helper para mapeo, formato y colores
 */

// ──────────────────────────────────────────────
// 1. Simplified S/O/D maps — Nivel Rápido
// ──────────────────────────────────────────────

/**
 * Mapa simplificado de SEVERIDAD.
 * Agrupa los 10 niveles en 3 categorías cualitativas.
 * @type {Object<string, {label: string, value: number, range: number[]}>}
 */
export const SEVERITY_SIMPLIFIED = {
  BAJO:     { label: 'Bajo',     value: 2, range: [1, 3] },
  MEDIO:    { label: 'Medio',    value: 5, range: [4, 7] },
  ALTO:     { label: 'Alto',     value: 9, range: [8, 10] },
};

/**
 * Mapa simplificado de OCURRENCIA.
 * Agrupa los 10 niveles en 4 categorías cualitativas.
 * @type {Object<string, {label: string, value: number, range: number[]}>}
 */
export const OCCURRENCE_SIMPLIFIED = {
  NUNCA:     { label: 'Nunca',      value: 1, range: [1, 2] },
  RARA_VEZ:  { label: 'Rara vez',   value: 4, range: [3, 5] },
  SEGUIDO:   { label: 'Seguido',    value: 7, range: [6, 8] },
  SIEMPRE:   { label: 'Siempre',    value: 10, range: [9, 10] },
};

/**
 * Mapa simplificado de DETECCIÓN.
 * Agrupa los 10 niveles en 3 categorías cualitativas.
 * @type {Object<string, {label: string, value: number, range: number[]}>}
 */
export const DETECTION_SIMPLIFIED = {
  SIEMPRE: { label: 'Siempre',  value: 2, range: [1, 2] },
  A_VECES: { label: 'A veces',  value: 5, range: [3, 6] },
  NO:      { label: 'No',       value: 9, range: [7, 10] },
};

// ──────────────────────────────────────────────
// 2. AIAG/VDA Standard Tables — Nivel Experto e Ingeniería
// ──────────────────────────────────────────────

/**
 * Tabla estándar de SEVERIDAD (AIAG/VDA).
 * @type {Array<{value: number, label: string, description: string}>}
 */
export const SEVERITY_STANDARD = [
  { value: 1,  label: 'Sin efecto',           description: 'No perceptible, no afecta operación' },
  { value: 2,  label: 'Muy menor',            description: 'Solo lo nota un usuario experto' },
  { value: 3,  label: 'Menor',                description: 'Ligera degradación, sin parada' },
  { value: 4,  label: 'Bajo',                 description: 'Degradación notable, requiere atención' },
  { value: 5,  label: 'Moderado',             description: 'Pérdida parcial de función secundaria' },
  { value: 6,  label: 'Significativo',        description: 'Pérdida total de función secundaria' },
  { value: 7,  label: 'Mayor',                description: 'Pérdida parcial de función primaria' },
  { value: 8,  label: 'Extremo',              description: 'Pérdida total de función primaria' },
  { value: 9,  label: 'Peligroso con aviso',  description: 'Puede causar lesiones, hay warning' },
  { value: 10, label: 'Peligroso sin aviso',  description: 'Puede causar fatalidades, sin advertencia' },
];

/**
 * Tabla estándar de OCURRENCIA (AIAG/VDA).
 * @type {Array<{value: number, label: string, description: string}>}
 */
export const OCCURRENCE_STANDARD = [
  { value: 1,  label: 'Casi nunca',  description: '< 1 en 1,500,000 — nunca en vida del equipo' },
  { value: 2,  label: 'Remoto',      description: '1 en 150,000 — cada 10+ años' },
  { value: 3,  label: 'Muy bajo',    description: '1 en 15,000 — cada 1-2 años' },
  { value: 4,  label: 'Bajo',        description: '1 en 2,000 — cada 6 meses' },
  { value: 5,  label: 'Medio bajo',  description: '1 en 400 — por trimestre' },
  { value: 6,  label: 'Medio',       description: '1 en 80 — mensual' },
  { value: 7,  label: 'Medio alto',  description: '1 en 20 — semanal' },
  { value: 8,  label: 'Alto',        description: '1 en 8 — cada pocos días' },
  { value: 9,  label: 'Muy alto',    description: '1 en 3 — diario' },
  { value: 10, label: 'Extremo',     description: '> 1 en 2 — varias veces al día' },
];

/**
 * Tabla estándar de DETECCIÓN (AIAG/VDA).
 * @type {Array<{value: number, label: string, description: string}>}
 */
export const DETECTION_STANDARD = [
  { value: 1,  label: 'Casi seguro',      description: 'Detectado automáticamente por sensores' },
  { value: 2,  label: 'Muy alto',         description: 'Monitoreo en tiempo real' },
  { value: 3,  label: 'Alto',            description: 'Inspección visual programada' },
  { value: 4,  label: 'Medio alto',      description: 'Pruebas funcionales periódicas' },
  { value: 5,  label: 'Medio',           description: 'Análisis específico (vibraciones, etc.)' },
  { value: 6,  label: 'Bajo',            description: 'Solo con desarme parcial' },
  { value: 7,  label: 'Muy bajo',        description: 'Solo con desarme total' },
  { value: 8,  label: 'Remoto',          description: 'Solo pruebas destructivas' },
  { value: 9,  label: 'Muy remoto',      description: 'Solo si el usuario lo reporta' },
  { value: 10, label: 'Casi imposible',  description: 'Imposible de detectar hasta que ocurre' },
];

// ──────────────────────────────────────────────
// 3. RCM Questions & Strategies
// ──────────────────────────────────────────────

/**
 * Preguntas del árbol de decisión RCM — Nivel Rápido (lenguaje taller).
 * @type {Array<{id: string, label: string, shortLabel: string}>}
 */
export const RCM_QUESTIONS_QUICK = [
  { id: 'q1', label: '¿La falla es evidente para el operador?', shortLabel: '¿Es evidente?' },
  { id: 'q2', label: '¿Afecta seguridad o medio ambiente?', shortLabel: '¿Afecta seguridad?' },
  { id: 'q3', label: '¿Se puede detectar con inspección sensorial?', shortLabel: '¿Inspección sensorial?' },
  { id: 'q4', label: '¿El componente es crítico para producción?', shortLabel: '¿Crítico producción?' },
  { id: 'q5', label: '¿Existe una tarea de mantenimiento efectiva?', shortLabel: '¿Tarea efectiva?' },
];

/**
 * Preguntas del árbol de decisión RCM — Nivel Experto/Ingeniería (estándar confiabilidad).
 * @type {Array<{id: string, label: string, shortLabel: string}>}
 */
export const RCM_QUESTIONS_EXPERT = [
  { id: 'q1', label: '¿La falla es evidente para el operador durante sus tareas normales?', shortLabel: '¿Evidente operador?' },
  { id: 'q2', label: '¿La falla tiene un efecto adverso directo en seguridad o medio ambiente?', shortLabel: '¿Afecta seguridad?' },
  { id: 'q3', label: '¿La falla se puede detectar mediante inspección sensorial (visual, sonido, vibración)?', shortLabel: '¿Detección sensorial?' },
  { id: 'q4', label: '¿El componente es crítico para la producción (la falla detiene el proceso)?', shortLabel: '¿Crítico producción?' },
  { id: 'q5', label: '¿Existe una tarea de mantenimiento efectiva que prevenga o mitigue la falla?', shortLabel: '¿Tarea efectiva?' },
];

/** Alias: RCM_QUESTIONS apunta a Expert por defecto (backward compat) */
export const RCM_QUESTIONS = RCM_QUESTIONS_EXPERT;

/**
 * Estrategias RCM con etiqueta, descripción y color.
 * @type {Object<string, {label: string, description: string, color: string}>}
 */
export const RCM_STRATEGIES = {
  BCM:      { label: 'Basado en Condición',  description: 'Monitoreo continuo',         color: '#4caf50' },
  PM:       { label: 'Preventivo',           description: 'Mantenimiento programado',   color: '#2196f3' },
  RTF:      { label: 'Run-to-Failure',       description: 'Operar hasta falla',         color: '#ff9800' },
  REDESIGN: { label: 'Rediseño',             description: 'Requiere cambio de diseño',  color: '#f44336' },
};

/**
 * Árbol de decisión RCM con las 8 ramas completas.
 * Cada rama define la combinación de respuestas (q1–q5) que lleva a una estrategia.
 * @type {{branches: Array<{q1: boolean, q2?: boolean, q3?: boolean, q4?: boolean, q5?: boolean, strategy: string}>}}
 */
export const RCM_DECISION_TREE = {
  branches: [
    { q1: true,                                                             strategy: 'BCM' },
    { q1: false, q2: true,                                       q4: true,  strategy: 'PM' },
    { q1: false, q2: true,                                       q4: false, q5: true,  strategy: 'BCM' },
    { q1: false, q2: true,                                       q4: false, q5: false, strategy: 'REDESIGN' },
    { q1: false, q2: false, q3: true,                            q4: true,  strategy: 'PM' },
    { q1: false, q2: false, q3: true,                            q4: false, q5: true,  strategy: 'BCM' },
    { q1: false, q2: false, q3: true,                            q4: false, q5: false, strategy: 'RTF' },
    { q1: false, q2: false, q3: false,                                                        strategy: 'RTF' },
  ],
};

// ──────────────────────────────────────────────
// 4. Action Priority Matrix (AIAG/VDA 2019)
// ──────────────────────────────────────────────

/**
 * Niveles de prioridad de acción (AP).
 * @type {Object<string, {label: string, description: string, color: string}>}
 */
export const ACTION_PRIORITY = {
  HIGH:   { label: 'Alta',   description: 'Requiere acción inmediata',    color: '#f44336' },
  MEDIUM: { label: 'Media',  description: 'Requiere acción planificada',  color: '#ff9800' },
  LOW:    { label: 'Baja',   description: 'Aceptable, monitorear',        color: '#4caf50' },
};

/**
 * Computa la Prioridad de Acción (AP) según AIAG/VDA 2019
 * basada en la combinación de Severidad, Ocurrencia y Detección.
 *
 * @param {number} severity   Valor de severidad (1–10)
 * @param {number} occurrence Valor de ocurrencia (1–10)
 * @param {number} detection  Valor de detección (1–10)
 * @returns {'HIGH'|'MEDIUM'|'LOW'} Nivel de prioridad
 */
export function computeActionPriority(severity, occurrence, detection) {
  if (severity >= 9) return 'HIGH';
  if (severity >= 7 && occurrence >= 6) return 'HIGH';
  if (severity >= 7 && detection >= 7) return 'HIGH';
  if (severity >= 4 && occurrence >= 7 && detection >= 5) return 'HIGH';
  if (severity >= 4 && occurrence >= 4) return 'MEDIUM';
  return 'LOW';
}

// ──────────────────────────────────────────────
// 5. Wizard Level Definitions
// ──────────────────────────────────────────────

/**
 * Definiciones de los 3 niveles del wizard FMEA.
 * @type {Object<string, {id: string, label: string, description: string, minMinutes: number}>}
 */
export const WIZARD_LEVELS = {
  QUICK:       { id: 'quick',       label: 'Rápido',      description: 'Para mecánicos y supervisores',        minMinutes: 2 },
  EXPERT:      { id: 'expert',      label: 'Experto',     description: 'Para planners',                       minMinutes: 5 },
  ENGINEERING: { id: 'engineering', label: 'Ingeniería',  description: 'Para analistas de confiabilidad',     minMinutes: 10 },
};

// ──────────────────────────────────────────────
// 6. Helper Functions
// ──────────────────────────────────────────────

/**
 * Busca un valor en un mapa simplificado y retorna el valor numérico
 * del primer rango que contiene el valor dado.
 *
 * @param {Object<string, {label: string, value: number, range: number[]}>} map
 * @param {number} numericValue Valor 1–10 a buscar en los rangos
 * @returns {number} Valor mapeado correspondiente
 */
export function mapSimplifiedValue(map, numericValue) {
  const entry = Object.values(map).find(
    (item) => numericValue >= item.range[0] && numericValue <= item.range[1]
  );
  return entry ? entry.value : numericValue;
}

/**
 * Computa los valores S/O/D según el nivel del wizard.
 *
 * - Nivel 'quick': usa los mapas simplificados (categórico → numérico)
 * - Niveles 'expert' y 'engineering': usa los valores directos 1–10
 *
 * @param {'quick'|'expert'|'engineering'} level Nivel del wizard
 * @param {number} severity   Valor de severidad
 * @param {number} occurrence Valor de ocurrencia
 * @param {number} detection  Valor de detección
 * @returns {{ severity: number, occurrence: number, detection: number }}
 */
export function computeSimplifiedSOD(level, severity, occurrence, detection) {
  if (level === 'quick') {
    return {
      severity: mapSimplifiedValue(SEVERITY_SIMPLIFIED, severity),
      occurrence: mapSimplifiedValue(OCCURRENCE_SIMPLIFIED, occurrence),
      detection: mapSimplifiedValue(DETECTION_SIMPLIFIED, detection),
    };
  }
  return { severity, occurrence, detection };
}

/**
 * Formatea un número RPN (Risk Priority Number) para mostrar.
 * Retorna el número en formato legible.
 *
 * @param {number} rpn Número RPN (1–1000)
 * @returns {string} RPN formateado
 */
export function formatRPN(rpn) {
  if (typeof rpn !== 'number' || isNaN(rpn)) return '—';
  return rpn.toLocaleString('es-MX');
}

/**
 * Retorna el color asociado a una estrategia RCM.
 *
 * @param {string} strategy Identificador de la estrategia (BCM, PM, RTF, REDESIGN)
 * @returns {string} Color en formato hexadecimal
 */
export function getStrategyColor(strategy) {
  const entry = RCM_STRATEGIES[strategy];
  return entry ? entry.color : '#9e9e9e';
}

/**
 * Retorna un color en gradiente verde → amarillo → rojo
 * según el valor de severidad (1–10).
 *
 * @param {number} value Valor de severidad (1–10)
 * @returns {string} Color en formato hexadecimal
 */
export function getSeverityColor(value) {
  if (value <= 3) return '#4caf50';   // Verde — bajo
  if (value <= 6) return '#ff9800';   // Naranja — medio
  return '#f44336';                    // Rojo — alto
}

/**
 * Retorna el color asociado a un nivel de Prioridad de Acción.
 *
 * @param {'HIGH'|'MEDIUM'|'LOW'} ap Nivel de prioridad de acción
 * @returns {string} Color en formato hexadecimal
 */
export function getAPColor(ap) {
  const entry = ACTION_PRIORITY[ap];
  return entry ? entry.color : '#9e9e9e';
}

/**
 * Determina la estrategia RCM según el árbol de decisión definido en RCM_DECISION_TREE.
 *
 * Evalúa las respuestas q1–q5 contra cada rama del árbol.
 * La primera rama que coincida determina la estrategia.
 *
 * @param {{ q1?: boolean, q2?: boolean, q3?: boolean, q4?: boolean, q5?: boolean }} values
 *   Respuestas a las 5 preguntas RCM. Cada valor puede ser true, false, o null/undefined (sin responder).
 * @returns {string} Clave de la estrategia determinada: 'BCM', 'PM', 'RTF', o 'REDESIGN'
 */
export function fn_determine_rcm_strategy(values) {
  const { q1, q2, q3, q4, q5 } = values;

  for (const branch of RCM_DECISION_TREE.branches) {
    if (
      (branch.q1 === undefined || branch.q1 === q1) &&
      (branch.q2 === undefined || branch.q2 === q2) &&
      (branch.q3 === undefined || branch.q3 === q3) &&
      (branch.q4 === undefined || branch.q4 === q4) &&
      (branch.q5 === undefined || branch.q5 === q5)
    ) {
      return branch.strategy;
    }
  }

  return 'RTF';
}
