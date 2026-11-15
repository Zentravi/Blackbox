"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};

/** True after the first client mount — used to defer chart rendering (SSR-safe). */
export function useMounted(): boolean {
  // Server snapshot false, client snapshot true — no setState-in-effect.
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
