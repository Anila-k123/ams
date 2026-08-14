import { useState, useEffect, useCallback, useRef } from "react";

export default function usePagination({ defaultSize = 20, resetOn = [] } = {}) {
  const [page, setPageState] = useState(0);
  const [size, setSize] = useState(defaultSize);
  const prevDeps = useRef(resetOn);

  const resetPage = useCallback(() => setPageState(0), []);

  useEffect(() => {
    const prev = prevDeps.current;
    const changed = resetOn.some((dep, i) => dep !== prev[i]);
    if (changed) {
      setPageState(0);
      prevDeps.current = resetOn;
    }
  }, resetOn);

  const setPage = useCallback((fn) => {
    setPageState((p) => {
      const next = typeof fn === "function" ? fn(p) : fn;
      return Math.max(0, next);
    });
  }, []);

  return { page, setPage, size, setSize, resetPage };
}
