/**
 * useConditionSources — Hook para gestión de Fuentes de Condición
 *
 * Obtiene las fuentes de condición registradas y sus capabilities desde Supabase.
 * Soporta reactive subscription vía RxDB pull-only cuando la DB está disponible.
 *
 * Responsabilidades:
 *  - Fetch condition_sources desde Supabase
 *  - Fetch condition_source_capabilities y contar por source
 *  - Construir sourceCapabilityMap: source_id → capability[]
 *  - Opcional: suscripción reactiva vía RxDB (si db está disponible)
 */
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';

// ─── Status badge colors ─────────────────────────────────────────
export const SOURCE_STATUS_COLORS = {
  active: { bg: '#e8f5e9', color: '#2e7d32', label: 'Activa' },
  field_trial: { bg: '#e3f2fd', color: '#1565c0', label: 'Prueba de campo' },
  candidate: { bg: '#fff3e0', color: '#ef6c00', label: 'Candidata' },
  draft: { bg: '#f5f5f5', color: '#616161', label: 'Borrador' },
  disabled: { bg: '#fce4ec', color: '#c62828', label: 'Deshabilitada' },
  deprecated: { bg: '#fce4ec', color: '#b71c1c', label: 'Deprecada' },
};

// ─── Helpers ─────────────────────────────────────────────────────
function calcLastSeenLabel(lastSeenAt) {
  if (!lastSeenAt) return 'Nunca';
  const diff = Date.now() - new Date(lastSeenAt).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Ahora';
  if (mins < 60) return `Hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `Hace ${days} d`;
}

/**
 * Hook principal para fuentes de condición.
 *
 * @param {Object} [options]
 * @param {boolean} [options.autoFetch=true] — Fetch automático al montar
 * @returns {Object} { sources, capabilities, sourceCapabilityMap, loading, error, refresh }
 */
export function useConditionSources(options = {}) {
  const { autoFetch = true } = options;

  const [sources, setSources] = useState([]);
  const [capabilities, setCapabilities] = useState([]);
  const [loading, setLoading] = useState(autoFetch);
  const [error, setError] = useState(null);

  // ─── Fetch ──────────────────────────────────────────────────────
  const refresh = async () => {
    setLoading(true);
    setError(null);

    try {
      const [sourcesRes, capsRes] = await Promise.all([
        supabase
          .from('condition_sources')
          .select('*')
          .order('status', { ascending: true })
          .order('name', { ascending: true }),
        supabase
          .from('condition_source_capabilities')
          .select('*')
          .order('can_produce', { ascending: true }),
      ]);

      if (sourcesRes.error) throw new Error(`Error fuentes: ${sourcesRes.error.message}`);
      if (capsRes.error) throw new Error(`Error capabilities: ${capsRes.error.message}`);

      setSources(sourcesRes.data || []);
      setCapabilities(capsRes.data || []);
    } catch (err) {
      setError(err.message);
      console.warn('[useConditionSources] Error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (autoFetch) {
      refresh();
    }
  }, [autoFetch]);

  // ─── Mapa de capabilities por source ───────────────────────────
  const sourceCapabilityMap = useMemo(() => {
    const map = {};
    for (const cap of capabilities) {
      const key = cap.source_id;
      if (!map[key]) map[key] = [];
      map[key].push(cap);
    }
    return map;
  }, [capabilities]);

  // ─── Sources con metadata enriquecida ──────────────────────────
  const enrichedSources = useMemo(() => {
    return sources.map((source) => ({
      ...source,
      capabilityCount: (sourceCapabilityMap[source.source_id] || []).length,
      capabilitiesList: sourceCapabilityMap[source.source_id] || [],
      lastSeenLabel: calcLastSeenLabel(source.last_seen_at),
      statusColor: SOURCE_STATUS_COLORS[source.status] || SOURCE_STATUS_COLORS.draft,
    }));
  }, [sources, sourceCapabilityMap]);

  return {
    sources: enrichedSources,
    capabilities,
    sourceCapabilityMap,
    loading,
    error,
    refresh,
  };
}

export default useConditionSources;
