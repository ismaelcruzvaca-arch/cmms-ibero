/**
 * useUrlParams.js
 * Simple URL search params hook — mirrors useSearchParams from react-router-dom.
 * Reads/writes window.location.search via history.replaceState.
 *
 * Returns: [searchParams, setSearchParams]
 *   searchParams: URLSearchParams (read only)
 *   setSearchParams: (nextInit) => void — merges or replaces params
 */
import { useState, useCallback } from 'react';

function getCurrentParams() {
  return new URLSearchParams(window.location.search);
}

export function useUrlParams() {
  const [params, setParamsState] = useState(() => getCurrentParams());

  const setSearchParams = useCallback((nextInit) => {
    const next = new URLSearchParams(window.location.search);

    if (typeof nextInit === 'function') {
      nextInit = nextInit(next);
    }

    // Clear all existing and set new
    if (nextInit instanceof URLSearchParams) {
      const newParams = new URLSearchParams();
      for (const [key, val] of nextInit.entries()) {
        newParams.set(key, val);
      }
      const url = `${window.location.pathname}?${newParams.toString()}`;
      window.history.replaceState(null, '', url);
      setParamsState(newParams);
    } else {
      // nextInit is a Record<string, string>
      // First, only update entries present in nextInit
      for (const [key, val] of Object.entries(nextInit)) {
        next.set(key, val);
      }
      const url = `${window.location.pathname}?${next.toString()}`;
      window.history.replaceState(null, '', url);
      setParamsState(next);
    }
  }, []);

  return [params, setSearchParams];
}

export default useUrlParams;
