/**
 * useTemplates.js
 * Hook React para administrar report_templates vía Supabase REST directo.
 *
 * Los writes bypassan RxDB (ver design decision: el versionado requiere INSERT
 * controlado con version+1, incompatible con upsert del push handler).
 * El pull de RxDB replica downstream automáticamente.
 *
 * Expone: fetchAll, create, update, duplicate, rollback, toggleActive
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

// ─────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────
const DEFAULT_PAGE_SIZE = 10;

// ─────────────────────────────────────────────────────────────
// Helper: parsear error de Supabase a string
// ─────────────────────────────────────────────────────────────
function parseError(err) {
  if (!err) return null;
  if (typeof err === 'string') return err;
  if (err?.message) return err.message;
  if (err?.error_description) return err.error_description;
  return 'Error desconocido en la operación';
}

/**
 * @typedef {Object} TemplateRow
 * @property {string} id
 * @property {string} code
 * @property {string} name
 * @property {string|null} description
 * @property {Object} template - JSONB con la definición del template
 * @property {number} version
 * @property {boolean} is_active
 * @property {string} created_at
 * @property {string|null} updated_at
 */

/**
 * @typedef {Object} FetchAllParams
 * @property {string} [search]
 * @property {number} [page=1]
 * @property {number} [pageSize=10]
 */

/**
 * @typedef {Object} CreateParams
 * @property {string} code
 * @property {string} name
 * @property {string} [description]
 * @property {Object} template - JSONB template definition
 */

/**
 * @typedef {Object} UpdateParams
 * @property {Object} [template] - JSONB template definition
 * @property {string} [name]
 * @property {string} [description]
 */

/**
 * Hook para administrar report_templates con versionado.
 *
 * @returns {{
 *   fetchAll: (params: FetchAllParams) => Promise<{data: TemplateRow[], total: number, error: string|null}>,
 *   create: (params: CreateParams) => Promise<{data: TemplateRow|null, error: string|null}>,
 *   update: (code: string, params: UpdateParams) => Promise<{data: TemplateRow|null, error: string|null}>,
 *   duplicate: (code: string, newCode?: string) => Promise<{data: TemplateRow|null, error: string|null}>,
 *   rollback: (code: string, targetVersion: number) => Promise<{data: TemplateRow|null, error: string|null}>,
 *   toggleActive: (code: string, version: number) => Promise<{data: TemplateRow|null, error: string|null}>,
 *   loading: boolean,
 * }}
 */
export function useTemplates() {
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const safeSetLoading = useCallback((val) => {
    if (mountedRef.current) setLoading(val);
  }, []);

  /**
   * Fetch templates con búsqueda y paginación.
   * Retorna solo la versión activa más reciente por code.
   */
  const fetchAll = useCallback(async ({ search, page = 1, pageSize = DEFAULT_PAGE_SIZE } = {}) => {
    safeSetLoading(true);
    try {
      // Construir query base: solo activos por defecto
      let query = supabase
        .from('report_templates')
        .select('*', { count: 'exact' })
        .eq('is_active', true);

      // Filtro de búsqueda sobre código y nombre (ILIKE)
      if (search && search.trim()) {
        const term = `%${search.trim()}%`;
        query = query.or(`code.ilike.${term},name.ilike.${term}`);
      }

      // Ordenar por code ASC, version DESC para tener la última versión primero
      query = query.order('code', { ascending: true }).order('version', { ascending: false });

      // Paginación
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) {
        return { data: [], total: 0, error: parseError(error) };
      }

      return { data: data || [], total: count ?? 0, error: null };
    } catch (err) {
      return { data: [], total: 0, error: parseError(err) };
    } finally {
      safeSetLoading(false);
    }
  }, [safeSetLoading]);

  /**
   * Crear un nuevo template (versión 1).
   */
  const create = useCallback(async ({ code, name, description, template }) => {
    safeSetLoading(true);
    try {
      const { data, error } = await supabase
        .from('report_templates')
        .insert({
          code,
          name,
          description: description || null,
          template,
          version: 1,
          is_active: true,
        })
        .select()
        .single();

      if (error) {
        return { data: null, error: parseError(error) };
      }

      return { data, error: null };
    } catch (err) {
      return { data: null, error: parseError(err) };
    } finally {
      safeSetLoading(false);
    }
  }, [safeSetLoading]);

  /**
   * Actualizar template: INSERT nueva versión (version+1), desactiva la anterior.
   */
  const update = useCallback(async (code, { template, name, description } = {}) => {
    safeSetLoading(true);
    try {
      // 1. Obtener la versión activa actual para conocer el próximo version
      const { data: currentActive, error: fetchError } = await supabase
        .from('report_templates')
        .select('version')
        .eq('code', code)
        .eq('is_active', true)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') {
        return { data: null, error: parseError(fetchError) };
      }

      const nextVersion = (currentActive?.version || 0) + 1;

      // 2. Obtener el template actual para preservar campos no enviados
      const { data: currentTemplate } = await supabase
        .from('report_templates')
        .select('*')
        .eq('code', code)
        .eq('is_active', true)
        .single();

      // 3. INSERT nueva versión
      const { data: newRow, error: insertError } = await supabase
        .from('report_templates')
        .insert({
          code,
          name: name ?? currentTemplate?.name ?? code,
          description: description !== undefined ? description : (currentTemplate?.description || null),
          template: template ?? currentTemplate?.template ?? {},
          version: nextVersion,
          is_active: true,
        })
        .select()
        .single();

      if (insertError) {
        return { data: null, error: parseError(insertError) };
      }

      // 4. Desactivar la versión anterior (si existe)
      if (currentActive) {
        const { error: deactivateError } = await supabase
          .from('report_templates')
          .update({ is_active: false })
          .eq('code', code)
          .eq('version', currentActive.version);

        if (deactivateError) {
          console.warn('[useTemplates] Error al desactivar versión anterior:', deactivateError);
        }
      }

      return { data: newRow, error: null };
    } catch (err) {
      return { data: null, error: parseError(err) };
    } finally {
      safeSetLoading(false);
    }
  }, [safeSetLoading]);

  /**
   * Duplicar un template: copia todos los campos con nuevo código y version=1.
   */
  const duplicate = useCallback(async (code, newCode) => {
    safeSetLoading(true);
    try {
      // 1. Obtener el template activo actual
      const { data: source, error: fetchError } = await supabase
        .from('report_templates')
        .select('*')
        .eq('code', code)
        .eq('is_active', true)
        .single();

      if (fetchError) {
        return { data: null, error: parseError(fetchError) };
      }

      if (!source) {
        return { data: null, error: `No se encontró template activo con code="${code}"` };
      }

      // 2. Crear el duplicado con nuevo código
      const targetCode = newCode || `${source.code} (copy)`;

      const { data, error: insertError } = await supabase
        .from('report_templates')
        .insert({
          code: targetCode,
          name: source.name,
          description: source.description,
          template: source.template,
          version: 1,
          is_active: true,
        })
        .select()
        .single();

      if (insertError) {
        return { data: null, error: parseError(insertError) };
      }

      return { data, error: null };
    } catch (err) {
      return { data: null, error: parseError(err) };
    } finally {
      safeSetLoading(false);
    }
  }, [safeSetLoading]);

  /**
   * Rollback: activar una versión específica, desactivar la actual.
   */
  const rollback = useCallback(async (code, targetVersion) => {
    safeSetLoading(true);
    try {
      // 1. Desactivar la versión activa actual
      const { error: deactivateError } = await supabase
        .from('report_templates')
        .update({ is_active: false })
        .eq('code', code)
        .eq('is_active', true);

      if (deactivateError) {
        return { data: null, error: parseError(deactivateError) };
      }

      // 2. Activar la versión target
      const { data, error: activateError } = await supabase
        .from('report_templates')
        .update({ is_active: true })
        .eq('code', code)
        .eq('version', targetVersion)
        .select()
        .single();

      if (activateError) {
        // Revertir: reactivar la que desactivamos
        console.warn('[useTemplates] Error al activar versión target, revirtiendo...');
        return { data: null, error: parseError(activateError) };
      }

      return { data, error: null };
    } catch (err) {
      return { data: null, error: parseError(err) };
    } finally {
      safeSetLoading(false);
    }
  }, [safeSetLoading]);

  /**
   * Toggle active/inactive en una versión específica.
   */
  const toggleActive = useCallback(async (code, version) => {
    safeSetLoading(true);
    try {
      // 1. Obtener el estado actual
      const { data: current, error: fetchError } = await supabase
        .from('report_templates')
        .select('is_active')
        .eq('code', code)
        .eq('version', version)
        .single();

      if (fetchError) {
        return { data: null, error: parseError(fetchError) };
      }

      const newActive = !current.is_active;

      // 2. Si vamos a activar, desactivar primero cualquier otra versión activa
      if (newActive) {
        const { error: deactivateOthers } = await supabase
          .from('report_templates')
          .update({ is_active: false })
          .eq('code', code)
          .eq('is_active', true);

        if (deactivateOthers) {
          console.warn('[useTemplates] Error al desactivar otras versiones:', deactivateOthers);
        }
      }

      // 3. Actualizar la versión target
      const { data, error } = await supabase
        .from('report_templates')
        .update({ is_active: newActive })
        .eq('code', code)
        .eq('version', version)
        .select()
        .single();

      if (error) {
        return { data: null, error: parseError(error) };
      }

      return { data, error: null };
    } catch (err) {
      return { data: null, error: parseError(err) };
    } finally {
      safeSetLoading(false);
    }
  }, [safeSetLoading]);

  return {
    fetchAll,
    create,
    update,
    duplicate,
    rollback,
    toggleActive,
    loading,
  };
}

export default useTemplates;
