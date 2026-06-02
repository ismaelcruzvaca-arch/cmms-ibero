/**
 * useConditionCapture — Hook para Captura Manual de Condición
 *
 * Construye el payload FeatureSet v0.2 client-side y realiza
 * POST a ingest-condition Edge Function con Bearer token.
 *
 * Responsabilidades:
 *  - Construcción de FeatureSet v0.2 con external_window_id,
 *    window_start/end, operational_context y feature payload.
 *  - Validación client-side: feature en catálogo, value > 0,
 *    quality_flag válido, campos obligatorios completos.
 *  - POST con token de autenticación.
 *  - Manejo de respuesta: 200/400/409/500.
 *
 * Sin offline queue en este slice (deferido a Slice 2c).
 */

import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

// Constantes de configuración
const INGEST_EF_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ingest-condition`;
const DEFAULT_SOURCE_ID = 'manual_route_001';
const DEFAULT_SOURCE_TYPE = 'manual';
const DEFAULT_METHOD_KEY = 'manual_observation';
const DEFAULT_METHOD_VERSION = '1.0';
const DEFAULT_QUALITY_FLAG = 'G2';
const VALID_QUALITY_FLAGS = ['G0', 'G1', 'G2', 'G3'];

/**
 * Construye un FeatureSet v0.2 completo a partir de los datos del formulario.
 *
 * @param {Object} formData — Datos del formulario de captura
 * @param {string} formData.assetId
 * @param {string} formData.featureKey
 * @param {number} formData.value
 * @param {string} formData.unit
 * @param {string} formData.qualityFlag
 * @param {string} formData.methodKey
 * @param {string} [formData.measuredAt]
 * @param {string} [formData.instrumentRef]
 * @param {string} [formData.notes]
 * @param {Object} [formData.operationalContext]
 * @param {string} [formData.sourceId]
 * @returns {Object} Payload FeatureSet v0.2
 */
export function buildFeatureSetV2(formData) {
  const now = new Date().toISOString();
  const measuredAt = formData.measuredAt || now;
  const sourceId = formData.sourceId || DEFAULT_SOURCE_ID;
  const windowId = `manual_${sourceId}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  const feature = {
    feature_key: formData.featureKey,
    value: Number(formData.value),
    unit: formData.unit,
    quality_flag: formData.qualityFlag || DEFAULT_QUALITY_FLAG,
    method_key: formData.methodKey,
    method_version: DEFAULT_METHOD_VERSION,
    measured_at: measuredAt,
    entered_at: now,
    measured_by: formData.measuredBy || null,
    entered_by: formData.enteredBy || null,
    instrument_ref: formData.instrumentRef || null,
    notes: formData.notes || null,
  };

  // Limpiar campos null/undefined para payload limpio
  Object.keys(feature).forEach((k) => {
    if (feature[k] === null || feature[k] === undefined) {
      delete feature[k];
    }
  });

  return {
    external_window_id: windowId,
    asset_id: formData.assetId,
    source_id: sourceId,
    source_type: DEFAULT_SOURCE_TYPE,
    window_start: measuredAt,
    window_end: measuredAt,
    pipeline_version: 'manual-capture-v1',
    operational_context: formData.operationalContext || {},
    features: [feature],
  };
}

/**
 * Valida los campos del formulario antes de construir el FeatureSet.
 *
 * @param {Object} formData
 * @param {Array} featureCatalog — Catálogo de feature_keys disponibles
 * @returns {Object} { valid: boolean, errors: string[] }
 */
export function validateCaptureForm(formData, featureCatalog = []) {
  const errors = [];

  if (!formData.assetId || formData.assetId.trim() === '') {
    errors.push('Debe seleccionar un activo');
  }

  if (!formData.featureKey || formData.featureKey.trim() === '') {
    errors.push('Debe seleccionar un feature de condición');
  } else if (featureCatalog.length > 0 && !featureCatalog.includes(formData.featureKey)) {
    errors.push(`Feature desconocido: "${formData.featureKey}" no está en el catálogo`);
  }

  if (formData.value === undefined || formData.value === null || formData.value === '') {
    errors.push('Debe ingresar un valor numérico');
  } else if (isNaN(Number(formData.value))) {
    errors.push('El valor debe ser numérico');
  } else if (Number(formData.value) < 0) {
    errors.push('El valor debe ser positivo');
  }

  if (formData.qualityFlag && !VALID_QUALITY_FLAGS.includes(formData.qualityFlag)) {
    errors.push(`Quality flag inválido: "${formData.qualityFlag}". Use G0, G1, G2 o G3`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Hook principal de captura manual de condición.
 *
 * @param {Object} [options]
 * @param {string} [options.sourceId] — source_id de la fuente (default: manual_route_001)
 * @returns {Object} { submitCapture, loading, result, error, reset }
 */
export function useConditionCapture(options = {}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const reset = useCallback(() => {
    setLoading(false);
    setResult(null);
    setError(null);
  }, []);

  /**
   * Envía un FeatureSet v0.2 a ingest-condition.
   *
   * @param {Object} payload — FeatureSet v0.2 completo
   * @returns {Promise<{ success: boolean, data?: Object, error?: string }>}
   */
  const submitCapture = useCallback(async (payload) => {
    setLoading(true);
    setResult(null);
    setError(null);

    try {
      // Obtener token de sesión activa
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('No hay sesión activa. Inicie sesión para capturar datos.');
      }

      const response = await fetch(INGEST_EF_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      });

      const responseData = await response.json().catch(() => ({}));

      if (!response.ok) {
        const msg = responseData.error || responseData.message || `Error HTTP ${response.status}`;
        setResult({ success: false, status: response.status, data: responseData });
        setError(msg);
        return { success: false, error: msg, status: response.status };
      }

      setResult({ success: true, status: response.status, data: responseData });
      return {
        success: true,
        data: responseData,
        window_id: responseData.window_id,
        features_ingested: responseData.features_ingested,
      };
    } catch (err) {
      const msg = err.message || 'Error de red al enviar la captura';
      setResult({ success: false, error: msg });
      setError(msg);
      return { success: false, error: msg };
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    submitCapture,
    loading,
    result,
    error,
    reset,
  };
}
