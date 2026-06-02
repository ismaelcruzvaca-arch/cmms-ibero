/**
 * Tests unitarios para useFeatureTrends — data fetching y shape
 *
 * Cubre:
 *  - Shape del retorno (hiData, featureData, baseline, events, isLoading, error)
 *  - Data loading desde Supabase REST mock
 *  - Estado vacío sin assetId
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// ─── Helper factory (disponible en toda la suite) ──────────────
const { createBuilder } = vi.hoisted(() => {
  /**
   * Crea un builder thenable estilo Supabase:
   * cada método retorna el builder, y el builder es thenable.
   */
  function createBuilder(resolve) {
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      gte: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      single: vi.fn(() => builder),
      then: (onFulfilled, onRejected) =>
        Promise.resolve(resolve).then(onFulfilled, onRejected),
      catch: (onRejected) => Promise.resolve(resolve).catch(onRejected),
    };
    return builder;
  }
  return { createBuilder };
});

vi.mock('../../lib/supabaseClient', () => {
  return {
    supabase: {
      from: vi.fn(() => createBuilder({ data: [], error: null })),
    },
  };
});

// ─── Hook bajo test ───────────────────────────────────────────
import { supabase } from '../../lib/supabaseClient';
import { useFeatureTrends } from '../useFeatureTrends';

describe('useFeatureTrends', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna shape correcto con valores por defecto', () => {
    const { result } = renderHook(() => useFeatureTrends({ assetId: null }));
    expect(result.current).toHaveProperty('hiData');
    expect(result.current).toHaveProperty('featureData');
    expect(result.current).toHaveProperty('baseline');
    expect(result.current).toHaveProperty('events');
    expect(result.current).toHaveProperty('isLoading');
    expect(result.current).toHaveProperty('error');
    expect(result.current).toHaveProperty('refresh');
    expect(Array.isArray(result.current.hiData)).toBe(true);
    expect(Array.isArray(result.current.featureData)).toBe(true);
    expect(Array.isArray(result.current.events)).toBe(true);
    expect(typeof result.current.isLoading).toBe('boolean');
  });

  it('carga datos de health_index desde Supabase', async () => {
    const mockHiData = [
      {
        id: 'hi-1',
        asset_id: 'ASSET-001',
        analysis_type: 'health_index',
        result_value: 85.5,
        window_end: '2026-06-01T10:00:00Z',
      },
    ];

    supabase.from.mockImplementation((table) => {
      if (table === 'condition_analysis_results') {
        return createBuilder({ data: mockHiData, error: null });
      }
      return createBuilder({ data: [], error: null });
    });

    const { result } = renderHook(() =>
      useFeatureTrends({ assetId: 'ASSET-001', featureKey: null, days: 30 })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.hiData).toEqual(mockHiData);
  });

  it('carga datos sin featureKey (modo HI)', async () => {
    const mockHiData = [
      { id: 'hi-1', result_value: 90, window_end: '2026-06-01T10:00:00Z' },
    ];

    supabase.from.mockImplementation((table) => {
      if (table === 'condition_analysis_results') {
        return createBuilder({ data: mockHiData, error: null });
      }
      return createBuilder({ data: [], error: null });
    });

    const { result } = renderHook(() =>
      useFeatureTrends({ assetId: 'ASSET-001', featureKey: null, days: 7 })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.hiData).toHaveLength(1);
  });

  it('filtra por featureKey cuando se proporciona', async () => {
    supabase.from.mockImplementation((table) => {
      if (table === 'condition_feature_definitions') {
        return createBuilder({ data: { id: 'def-001' }, error: null });
      }
      return createBuilder({ data: [], error: null });
    });

    const { result } = renderHook(() =>
      useFeatureTrends({ assetId: 'ASSET-001', featureKey: 'vibration.rms', days: 30 })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(supabase.from).toHaveBeenCalledWith('condition_feature_definitions');
  });

  it('maneja error de Supabase correctamente', async () => {
    // Solo condition_analysis_results falla; los otros builders funcionan
    const emptyBuilder = createBuilder({ data: [], error: null });

    supabase.from.mockImplementation((table) => {
      if (table === 'condition_analysis_results') {
        // Builder que rechaza al ser await
        const failBuilder = createBuilder({ data: null, error: null });
        failBuilder.then = (_, onRejected) => {
          const err = new Error('Error de red');
          onRejected(err);
          return new Promise(() => {}); // pending — evita unhandled rejection
        };
        return failBuilder;
      }
      return emptyBuilder;
    });

    const { result } = renderHook(() =>
      useFeatureTrends({ assetId: 'ASSET-001', days: 30 })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
  });

  it('retorna datos vacíos cuando no hay assetId', () => {
    const { result } = renderHook(() => useFeatureTrends({ assetId: null }));

    expect(result.current.hiData).toEqual([]);
    expect(result.current.featureData).toEqual([]);
    expect(result.current.baseline).toBeNull();
    expect(result.current.events).toEqual([]);
  });
});
