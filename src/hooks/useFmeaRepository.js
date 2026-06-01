/**
 * Hook personalizado para FMEA / RCM con RxDB
 * Expone datos reactivos de las 4 colecciones FMEA y operaciones CRUD
 * Sigue el mismo patrón que useLaborRecords.js y useWorkOrders.js
 */
import { useState, useEffect, useCallback } from 'react';
import { initRxDB } from '../lib/rxdb';
import {
  toComponentTypeViewModelList,
  toAssetComponentViewModelList,
  toFailureModeViewModelList,
  toFmeaAnalysisViewModelList,
  prepareAnalysisForInsert
} from '../lib/adapters/fmeaAdapter';

/**
 * Hook principal del repositorio FMEA.
 * Inicializa RxDB y expone suscripciones reactivas para las 4 colecciones.
 *
 * @returns {{
 *   loading: boolean,
 *   error: string|null,
 *   db: Object|null,
 *   useComponentTypes: () => Array,
 *   useAssetComponents: (assetId: string) => Array,
 *   useFailureModes: (componentTypeId: string) => Array,
 *   useFmeaAnalyses: (assetId: string) => Array,
 *   createAnalysis: (data: Object) => Promise<Object>,
 *   updateAnalysis: (id: string, updates: Object) => Promise<Object>,
 *   removeAnalysis: (id: string) => Promise<Object>,
 *   getPendingAnalyses: (assetId: string) => Promise<{pending: number, total: number}>
 * }}
 */
export function useFmeaRepository() {
  const [db, setDb] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        console.log('[useFmeaRepository] Iniciando...');
        const database = await initRxDB();

        if (cancelled) return;

        // Verificar que las colecciones existen
        const requiredCollections = [
          'component_types',
          'asset_components',
          'failure_mode_catalog',
          'fmea_rcm_analysis'
        ];

        const missing = requiredCollections.filter(c => !database[c]);
        if (missing.length > 0) {
          console.error('[useFmeaRepository] Colecciones faltantes:', missing);
          setError(new Error(`Colecciones FMEA no encontradas: ${missing.join(', ')}`));
          setLoading(false);
          return;
        }

        setDb(database);
        setLoading(false);
        console.log('[useFmeaRepository] Inicializado correctamente');
      } catch (err) {
        console.error('[useFmeaRepository] Error de inicialización:', err);
        if (!cancelled) {
          setError(err.message || 'Error al inicializar FMEA Repository');
          setLoading(false);
        }
      }
    };

    init();
    return () => { cancelled = true; };
  }, []);

  // ─── Subscripciones reactivas ───

  /**
   * Retorna todos los tipos de componente (catálogo pull-only).
   * @returns {Array} Lista de view models de component_types
   */
  const useComponentTypes = useCallback(() => {
    const [types, setTypes] = useState([]);

    useEffect(() => {
      if (!db) return;

      const sub = db.component_types.find().$.subscribe({
        next: (docs) => {
          try {
            const active = docs
              .map(d => d.toJSON())
              .filter(d => !d._deleted);
            setTypes(toComponentTypeViewModelList(active));
          } catch (e) {
            console.error('[useFmeaRepository] Error en sub component_types:', e);
          }
        },
        error: (err) => {
          console.error('[useFmeaRepository] Error sub component_types:', err);
        }
      });

      return () => sub.unsubscribe();
    }, [db]);

    return types;
  }, [db]);

  /**
   * Retorna los componentes de un activo (catálogo pull-only, filtrado).
   * @param {string} assetId - ID del activo
   * @returns {Array} Lista de view models de asset_components
   */
  const useAssetComponents = useCallback((assetId) => {
    const [components, setComponents] = useState([]);

    useEffect(() => {
      if (!db || !assetId) {
        setComponents([]);
        return;
      }

      const sub = db.asset_components.find({
        selector: { asset_id: assetId, _deleted: false }
      }).$.subscribe({
        next: (docs) => {
          try {
            const active = docs
              .map(d => d.toJSON())
              .filter(d => !d._deleted);
            setComponents(toAssetComponentViewModelList(active));
          } catch (e) {
            console.error('[useFmeaRepository] Error en sub asset_components:', e);
          }
        },
        error: (err) => {
          console.error('[useFmeaRepository] Error sub asset_components:', err);
        }
      });

      return () => sub.unsubscribe();
    }, [db, assetId]);

    return components;
  }, [db]);

  /**
   * Retorna los modos de falla para un tipo de componente (catálogo pull-only).
   * @param {string} componentTypeId - ID del tipo de componente
   * @returns {Array} Lista de view models de failure_mode_catalog
   */
  const useFailureModes = useCallback((componentTypeId) => {
    const [modes, setModes] = useState([]);

    useEffect(() => {
      if (!db || !componentTypeId) {
        setModes([]);
        return;
      }

      const sub = db.failure_mode_catalog.find({
        selector: { component_type_id: componentTypeId, _deleted: false }
      }).$.subscribe({
        next: (docs) => {
          try {
            const active = docs
              .map(d => d.toJSON())
              .filter(d => !d._deleted);
            setModes(toFailureModeViewModelList(active));
          } catch (e) {
            console.error('[useFmeaRepository] Error en sub failure_mode_catalog:', e);
          }
        },
        error: (err) => {
          console.error('[useFmeaRepository] Error sub failure_mode_catalog:', err);
        }
      });

      return () => sub.unsubscribe();
    }, [db, componentTypeId]);

    return modes;
  }, [db]);

  /**
   * Retorna los análisis FMEA para un activo.
   * @param {string} assetId - ID del activo
   * @returns {Array} Lista de view models de fmea_rcm_analysis
   */
  const useFmeaAnalyses = useCallback((assetId) => {
    const [analyses, setAnalyses] = useState([]);

    useEffect(() => {
      if (!db || !assetId) {
        setAnalyses([]);
        return;
      }

      const sub = db.fmea_rcm_analysis.find({
        selector: { asset_id: assetId, _deleted: false }
      }).$.subscribe({
        next: (docs) => {
          try {
            const active = docs
              .map(d => d.toJSON())
              .filter(d => !d._deleted);
            setAnalyses(toFmeaAnalysisViewModelList(active));
          } catch (e) {
            console.error('[useFmeaRepository] Error en sub fmea_rcm_analysis:', e);
          }
        },
        error: (err) => {
          console.error('[useFmeaRepository] Error sub fmea_rcm_analysis:', err);
        }
      });

      return () => sub.unsubscribe();
    }, [db, assetId]);

    return analyses;
  }, [db]);

  // ─── Operaciones CRUD ───

  /**
   * Crea un nuevo análisis FMEA (upsert).
   * @param {Object} data - Datos del análisis (camelCase o snake_case)
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  const createAnalysis = useCallback(async (data) => {
    if (!db) return { error: 'DB no inicializada' };

    try {
      const id = data.id || (crypto.randomUUID
        ? crypto.randomUUID()
        : 'fmea-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));

      const doc = prepareAnalysisForInsert({ ...data, id });

      await db.fmea_rcm_analysis.upsert(doc);
      return { success: true, id };
    } catch (err) {
      console.error('[useFmeaRepository] Error creando análisis:', err);
      return { error: err.message };
    }
  }, [db]);

  /**
   * Actualiza un análisis FMEA existente.
   * @param {string} id - ID del análisis
   * @param {Object} updates - Campos a actualizar (camelCase o snake_case)
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  const updateAnalysis = useCallback(async (id, updates) => {
    if (!db) return { error: 'DB no inicializada' };

    try {
      const doc = await db.fmea_rcm_analysis.findOne(id).exec();
      if (!doc) {
        return { error: 'Análisis no encontrado' };
      }

      // Mapear camelCase a snake_case si es necesario
      const fieldMap = {
        assetId: 'asset_id',
        componentId: 'component_id',
        failureModeId: 'failure_mode_id',
        recommendedStrategy: 'recommended_strategy',
        failureCause: 'failure_cause',
        analyzedBy: 'analyzed_by',
        createdAt: 'created_at'
      };

      const setFields = { updated_at: Date.now() };
      Object.entries(updates).forEach(([key, value]) => {
        const dbKey = fieldMap[key] || key;
        if (value !== undefined) {
          setFields[dbKey] = value;
        }
      });

      await doc.update({ $set: setFields });
      return { success: true };
    } catch (err) {
      console.error('[useFmeaRepository] Error actualizando análisis:', err);
      return { error: err.message };
    }
  }, [db]);

  /**
   * Elimina (soft delete) un análisis FMEA.
   * @param {string} id - ID del análisis
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  const removeAnalysis = useCallback(async (id) => {
    if (!db) return { error: 'DB no inicializada' };

    try {
      const doc = await db.fmea_rcm_analysis.findOne(id).exec();
      if (!doc) {
        return { error: 'Análisis no encontrado' };
      }

      await doc.update({ $set: { _deleted: true, updated_at: Date.now() } });
      return { success: true };
    } catch (err) {
      console.error('[useFmeaRepository] Error eliminando análisis:', err);
      return { error: err.message };
    }
  }, [db]);

  /**
   * Cuenta análisis pendientes vs total esperado para un activo.
   * Un análisis se considera "completado" si tiene recommended_strategy definido.
   * @param {string} assetId - ID del activo
   * @returns {Promise<{pending: number, total: number, expected: number}>}
   */
  const getPendingAnalyses = useCallback(async (assetId) => {
    if (!db || !assetId) {
      return { pending: 0, total: 0, expected: 0 };
    }

    try {
      // Obtener todos los análisis para este activo
      const allDocs = await db.fmea_rcm_analysis.find({
        selector: { asset_id: assetId, _deleted: false }
      }).exec();

      const total = allDocs.length;
      const pending = allDocs.filter(d => !d.get('recommended_strategy')).length;

      // Estimar el número esperado: total de modos de falla para los componentes del activo
      // Se obtienen los componentes del activo para calcular expected
      const compDocs = await db.asset_components.find({
        selector: { asset_id: assetId, _deleted: false }
      }).exec();

      let expected = 0;
      if (compDocs.length > 0) {
        const typeIds = [...new Set(compDocs.map(c => c.get('component_type_id')))];
        const fmDocs = await db.failure_mode_catalog.find({
          selector: {
            component_type_id: { $in: typeIds },
            _deleted: false
          }
        }).exec();
        expected = fmDocs.length;
      }

      return { pending, total, expected };
    } catch (err) {
      console.error('[useFmeaRepository] Error en getPendingAnalyses:', err);
      return { pending: 0, total: 0, expected: 0 };
    }
  }, [db]);

  return {
    loading,
    error,
    db,
    useComponentTypes,
    useAssetComponents,
    useFailureModes,
    useFmeaAnalyses,
    createAnalysis,
    updateAnalysis,
    removeAnalysis,
    getPendingAnalyses
  };
}

export default useFmeaRepository;
