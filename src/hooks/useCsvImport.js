/**
 * useCsvImport — Hook para Importación CSV de Condición
 *
 * Pipeline client-side de importación masiva de datos de condición vía CSV.
 * Usa Papa Parse para parsing, auto-detección de columnas, validación de filas,
 * creación de batches en staging e ingesta bulk vía ingest-condition EF.
 *
 * Responsabilidades:
 *  - Papa Parse: detección de delimitador, headers, filas
 *  - Columna auto-detect: fuzzy-match headers → feature_key/value/measured_at/unit/asset_id
 *  - Validación de filas: feature_key en catálogo, value numérico, measured_at parseable
 *  - Batch creation: INSERT condition_import_batches + condition_import_rows
 *  - Bulk ingest: POST a ingest-condition por fila válida
 *  - Seguimiento de progreso
 */
import { useState, useCallback } from 'react';
import Papa from 'papaparse';
import { supabase } from '../lib/supabaseClient';

// ─── Constantes ──────────────────────────────────────────────────
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const VALIDATE_CHUNK_SIZE = 50;
const SOURCE_ID = 'csv_import';
const SOURCE_TYPE = 'csv';
const INGEST_EF_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ingest-condition`;

// ─── Column name heuristics ──────────────────────────────────────
const COLUMN_PATTERNS = {
  feature_key: [
    /^feature[_\s-]?key$/i,
    /^feature$/i,
    /^variable$/i,
    /^parametro$/i,
    /^medida$/i,
    /^indicador$/i,
  ],
  value: [
    /^val(or)?$/i,
    /^value$/i,
    /^lectura$/i,
    /^medicion$/i,
    /^dato$/i,
    /^resultado$/i,
  ],
  measured_at: [
    /^fecha$/i,
    /^fecha[_\s-]?medicion$/i,
    /^timestamp$/i,
    /^measured[_\s-]?at$/i,
    /^hora$/i,
    /^date$/i,
    /^fecha[_\s-]?hora$/i,
  ],
  unit: [
    /^unidad$/i,
    /^unit$/i,
    /^um$/i,
    /^uom$/i,
  ],
  asset_id: [
    /^equipo$/i,
    /^activo$/i,
    /^asset$/i,
    /^asset[_\s-]?id$/i,
    /^equipment$/i,
    /^maquina$/i,
  ],
};

// ─── Known feature keys (se cargan en runtime) ──────────────────
let _featureCatalogCache = null;
async function loadFeatureCatalog() {
  if (_featureCatalogCache) return _featureCatalogCache;
  const { data, error } = await supabase
    .from('condition_feature_definitions')
    .select('feature_key,unit,category');
  if (error) throw new Error(`Error cargando catálogo: ${error.message}`);
  _featureCatalogCache = data || [];
  return _featureCatalogCache;
}

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Auto-detecta el mapping de columnas del CSV → campos FeatureSet
 * usando heurísticas fuzzy-match sobre los headers.
 *
 * @param {string[]} headers — Array de headers del CSV
 * @returns {Object} mapping — { [csvHeader]: targetField }
 */
export function autoDetectColumns(headers) {
  const mapping = {};
  const usedFields = new Set();

  // Intentar fuzzy-match para cada header
  for (const header of headers) {
    const normalized = header.trim();
    let bestMatch = null;
    let bestScore = 0;

    for (const [field, patterns] of Object.entries(COLUMN_PATTERNS)) {
      // Saltar campos ya asignados
      if (usedFields.has(field)) continue;

      for (const pattern of patterns) {
        if (pattern.test(normalized)) {
          // Penalizar coincidencias muy genéricas para field vs value
          let score = 1;
          if (field === 'value' && /^val(or)?$/i.test(normalized)) score = 0.8;

          if (score > bestScore) {
            bestScore = score;
            bestMatch = field;
          }
          break; // Ya coincidió con un patrón de este field
        }
      }
    }

    if (bestMatch && bestScore > 0) {
      mapping[header] = bestMatch;
      usedFields.add(bestMatch);
    }
  }

  return mapping;
}

/**
 * Valida una fila de datos de importación CSV.
 *
 * @param {Object} mappedRow — Fila mapeada con campos FeatureSet
 * @param {Object[]} featureCatalog — Catálogo de feature_keys disponibles
 * @returns {string[]} validationErrors — Lista de errores (vacío = válida)
 */
export function validateImportRow(mappedRow, featureCatalog = []) {
  const errors = [];

  // feature_key es obligatorio
  if (!mappedRow.feature_key || String(mappedRow.feature_key).trim() === '') {
    errors.push('feature_key vacío');
  } else if (
    featureCatalog.length > 0 &&
    !featureCatalog.find((f) => f.feature_key === mappedRow.feature_key?.trim())
  ) {
    errors.push(`Feature "${mappedRow.feature_key}" no está en el catálogo`);
  }

  // value debe ser numérico
  if (mappedRow.value === undefined || mappedRow.value === null || mappedRow.value === '') {
    errors.push('Valor vacío');
  } else if (isNaN(Number(mappedRow.value))) {
    errors.push(`Valor no numérico: "${mappedRow.value}"`);
  }

  // measured_at debe ser parseable como fecha
  if (mappedRow.measured_at && mappedRow.measured_at !== '') {
    const d = new Date(mappedRow.measured_at);
    if (isNaN(d.getTime())) {
      errors.push(`Fecha no válida: "${mappedRow.measured_at}"`);
    }
  } else {
    errors.push('Fecha de medición vacía');
  }

  // asset_id opcional pero si está presente, validar
  if (mappedRow.asset_id && String(mappedRow.asset_id).trim() === '') {
    delete mappedRow.asset_id; // vacío → eliminar
  }

  return errors;
}

/**
 * Parsea un archivo CSV usando Papa Parse.
 *
 * @param {File} file — Archivo CSV
 * @returns {Promise<{ headers: string[], rows: Object[], delimiter: string, rowCount: number }>}
 */
export async function parseCSVFile(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      encoding: 'UTF-8',
      complete: (results) => {
        const { data, meta } = results;
        const headers = meta.fields || [];
        const rows = data.filter((row) => {
          // Filtrar filas completamente vacías
          return Object.values(row).some((v) => v !== '' && v !== null && v !== undefined);
        });
        resolve({
          headers,
          rows,
          delimiter: meta.delimiter || ',',
          rowCount: rows.length,
        });
      },
      error: (err) => {
        reject(new Error(`Error parseando CSV: ${err.message}`));
      },
    });
  });
}

/**
 * Calcula hash SHA-256 del contenido de un archivo.
 *
 * @param {File} file
 * @returns {Promise<string>} Hash hexadecimal
 */
async function computeFileHash(file) {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ─── Hook principal ──────────────────────────────────────────────

/**
 * Hook de importación CSV con pipeline de staging.
 *
 * @returns {Object} {
 *   parseState, mapping, mappedRows, validationResults, batch,
 *   ingestProgress, loading, error,
 *   handleFileSelected, applyMapping, validateRows, confirmImport, reset
 * }
 */
export function useCsvImport() {
  // ─── Estados del pipeline ────────────────────────────────────
  const [state, setState] = useState('idle'); // idle|parsing|parsed|mapping|validating|validated|confirming|done|error
  const [parseResult, setParseResult] = useState(null); // { headers, rows, delimiter, rowCount, file, fileHash }
  const [mapping, setMapping] = useState({}); // { csvHeader: targetField }
  const [mappedRows, setMappedRows] = useState([]); // Array de { rowNumber, rawData, mappedData, validationErrors, status }
  const [validationSummary, setValidationSummary] = useState({ valid: 0, invalid: 0, total: 0 });
  const [batch, setBatch] = useState(null); // Batch creado en staging
  const [ingestProgress, setIngestProgress] = useState({ total: 0, done: 0, errors: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // ─── Step 1: File Selected → Parse ───────────────────────────
  const handleFileSelected = useCallback(async (file) => {
    setError(null);
    setLoading(true);
    setState('parsing');

    try {
      // Validar extensión
      if (!file.name.toLowerCase().endsWith('.csv')) {
        throw new Error('El archivo debe tener extensión .csv');
      }

      // Validar tamaño
      if (file.size > MAX_FILE_SIZE) {
        throw new Error(`El archivo excede el tamaño máximo de ${MAX_FILE_SIZE / 1024 / 1024} MB`);
      }

      // Parsear con Papa Parse
      const parsed = await parseCSVFile(file);

      if (parsed.rowCount === 0) {
        throw new Error('El archivo CSV está vacío (no contiene filas de datos)');
      }

      // Calcular hash
      const fileHash = await computeFileHash(file);

      // Auto-detectar columnas
      const autoMapping = autoDetectColumns(parsed.headers);

      setParseResult({ ...parsed, file, fileHash });
      setMapping(autoMapping);
      setState('parsed');
    } catch (err) {
      setError(err.message);
      setState('error');
    } finally {
      setLoading(false);
    }
  }, []);

  // ─── Step 2: Apply column mapping → Build mapped rows ────────
  const applyMapping = useCallback(
    async (customMapping) => {
      if (!parseResult) return;

      setError(null);
      setLoading(true);
      setState('mapping');

      try {
        const finalMapping = customMapping || mapping;
        setMapping(finalMapping);

        // Cargar catálogo de features
        const featureCatalog = await loadFeatureCatalog();

        // Aplicar mapping a cada fila
        const rows = parseResult.rows.map((rawRow, index) => {
          const mapped = {};
          for (const [csvHeader, targetField] of Object.entries(finalMapping)) {
            if (targetField && csvHeader in rawRow) {
              mapped[targetField] = rawRow[csvHeader]?.trim?.() || rawRow[csvHeader];
            }
          }

          return {
            rowNumber: index + 1,
            rawData: rawRow,
            mappedData: mapped,
            validationErrors: [],
            status: 'pending',
          };
        });

        setMappedRows(rows);
        setState('mapped');
      } catch (err) {
        setError(err.message);
        setState('error');
      } finally {
        setLoading(false);
      }
    },
    [parseResult, mapping]
  );

  // ─── Step 3: Validate rows contra catálogo ───────────────────
  const validateRows = useCallback(async () => {
    if (!mappedRows.length) return;

    setError(null);
    setLoading(true);
    setState('validating');

    try {
      const featureCatalog = await loadFeatureCatalog();

      let valid = 0;
      let invalid = 0;
      const validated = mappedRows.map((row) => {
        const errors = validateImportRow(row.mappedData, featureCatalog);
        return {
          ...row,
          validationErrors: errors,
          status: errors.length === 0 ? 'valid' : 'invalid',
        };
      });

      // Contar en chunks para feedback rápido
      for (const row of validated) {
        if (row.status === 'valid') valid++;
        else invalid++;
      }

      setMappedRows(validated);
      setValidationSummary({ valid, invalid, total: validated.length });
      setState('validated');
    } catch (err) {
      setError(err.message);
      setState('error');
    } finally {
      setLoading(false);
    }
  }, [mappedRows]);

  // ─── Step 4: Confirm & Ingest ─────────────────────────────────
  const confirmImport = useCallback(async () => {
    const validRows = mappedRows.filter((r) => r.status === 'valid');
    if (!validRows.length) {
      setError('No hay filas válidas para importar');
      return;
    }

    setError(null);
    setLoading(true);
    setState('confirming');

    try {
      // A) Crear batch en staging
      const batchId = `csv_import:${new Date().toISOString()}:${parseResult.fileHash?.slice(0, 8)}`;
      const { data: batchData, error: batchError } = await supabase
        .from('condition_import_batches')
        .insert({
          batch_id: batchId,
          file_name: parseResult.file.name,
          file_hash: parseResult.fileHash,
          row_count: parseResult.rowCount,
          valid_rows: validationSummary.valid,
          invalid_rows: validationSummary.invalid,
          source_id: SOURCE_ID,
          status: 'validated',
          column_mapping: mapping,
          created_by: 'csv-user', // Override si hay sesión
        })
        .select()
        .single();

      if (batchError) throw new Error(`Error creando batch: ${batchError.message}`);
      setBatch(batchData);

      // B) Insertar filas en staging
      const rowInserts = mappedRows.map((row) => ({
        batch_id: batchData.id,
        row_number: row.rowNumber,
        raw_data: row.rawData,
        mapped_data: row.mappedData,
        validation_errors: row.validationErrors,
        status: row.status === 'valid' ? 'valid' : 'invalid',
      }));

      // Chunked insert (por si son muchas filas)
      for (let i = 0; i < rowInserts.length; i += VALIDATE_CHUNK_SIZE) {
        const chunk = rowInserts.slice(i, i + VALIDATE_CHUNK_SIZE);
        const { error: rowError } = await supabase
          .from('condition_import_rows')
          .insert(chunk);
        if (rowError) {
          console.warn(`[CSV Import] Error insertando chunk ${i}:`, rowError);
          throw new Error(`Error insertando filas: ${rowError.message}`);
        }
      }

      // C) Ingresar filas válidas una por una al EF
      const tokenResp = await supabase.auth.getSession();
      const token = tokenResp.data?.session?.access_token;
      if (!token) throw new Error('No hay sesión activa para enviar la ingesta');

      let ingested = 0;
      let ingestErrors = 0;

      for (const row of validRows) {
        try {
          const featureValue = Number(row.mappedData.value);
          const measuredAt =
            row.mappedData.measured_at || new Date().toISOString();
          const featureKey = row.mappedData.feature_key?.trim();
          const assetId = row.mappedData.asset_id?.trim() || null;

          const payload = {
            external_window_id: `csv_${batchData.id}_${row.rowNumber}`,
            asset_id: assetId || 'UNKNOWN',
            source_id: SOURCE_ID,
            source_type: SOURCE_TYPE,
            window_start: measuredAt,
            window_end: measuredAt,
            pipeline_version: 'csv-import-v1',
            idempotency_key: `${batchId}:${row.rowNumber}`,
            batch_id: batchId,
            row_number: row.rowNumber,
            features: [
              {
                feature_key: featureKey,
                value: featureValue,
                unit: row.mappedData.unit || '',
                quality_flag: 'G2',
                method_key: 'csv_import',
                method_version: '1.0',
                measured_at: measuredAt,
                entered_at: new Date().toISOString(),
              },
            ],
          };

          // Limpiar campos null/undefined
          if (!payload.asset_id || payload.asset_id === 'UNKNOWN') {
            delete payload.asset_id;
          }

          const response = await fetch(INGEST_EF_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
          });

          if (!response.ok) {
            ingestErrors++;
            // Actualizar fila en staging como error
            await supabase
              .from('condition_import_rows')
              .update({ status: 'error', notes: `HTTP ${response.status}` })
              .eq('batch_id', batchData.id)
              .eq('row_number', row.rowNumber);
          } else {
            ingested++;
            const respData = await response.json().catch(() => ({}));
            // Actualizar fila como imported
            await supabase
              .from('condition_import_rows')
              .update({
                status: 'imported',
                window_id: respData.window_id || null,
                feature_value_id: respData.feature_value_id || null,
              })
              .eq('batch_id', batchData.id)
              .eq('row_number', row.rowNumber);
          }
        } catch (ingestErr) {
          ingestErrors++;
          console.warn(`[CSV Import] Error en fila ${row.rowNumber}:`, ingestErr);
        }

        setIngestProgress({
          total: validRows.length,
          done: ingested + ingestErrors,
          errors: ingestErrors,
        });
      }

      // D) Actualizar batch status
      const finalStatus = ingestErrors > 0 ? 'imported' : 'imported';
      await supabase
        .from('condition_import_batches')
        .update({
          status: finalStatus,
          error_summary: ingestErrors > 0 ? { import_errors: ingestErrors } : null,
        })
        .eq('id', batchData.id);

      setIngestProgress({
        total: validRows.length,
        done: ingested + ingestErrors,
        errors: ingestErrors,
      });
      setState('done');
    } catch (err) {
      setError(err.message);
      setState('error');
    } finally {
      setLoading(false);
    }
  }, [mappedRows, parseResult, mapping, validationSummary]);

  // ─── Reset ────────────────────────────────────────────────────
  const reset = useCallback(() => {
    setState('idle');
    setParseResult(null);
    setMapping({});
    setMappedRows([]);
    setValidationSummary({ valid: 0, invalid: 0, total: 0 });
    setBatch(null);
    setIngestProgress({ total: 0, done: 0, errors: 0 });
    setLoading(false);
    setError(null);
  }, []);

  return {
    state,
    parseResult,
    mapping,
    mappedRows,
    validationSummary,
    batch,
    ingestProgress,
    loading,
    error,
    handleFileSelected,
    setMapping: (newMapping) => {
      setMapping(newMapping);
      applyMapping(newMapping);
    },
    validateRows,
    confirmImport,
    reset,
  };
}

export default useCsvImport;
