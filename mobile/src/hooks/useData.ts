import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Loads data with loading / refreshing / error state and reloads when the screen regains focus,
 * so lists stay fresh after you edit something on another screen.
 */
export function useData<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const seq = useRef(0);
  const firstFocus = useRef(true);

  const run = useCallback(async (mode: "load" | "refresh" | "silent") => {
    const id = ++seq.current;
    if (mode === "load") setLoading(true);
    if (mode === "refresh") setRefreshing(true);
    try {
      const v = await loaderRef.current();
      if (id === seq.current) { setData(v); setError(null); }
    } catch (e) {
      if (id === seq.current) setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      if (id === seq.current) { setLoading(false); setRefreshing(false); }
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run("load"); }, deps);

  useFocusEffect(useCallback(() => {
    if (firstFocus.current) { firstFocus.current = false; return; }
    run("silent");
  }, [run]));

  return { data, setData, loading, refreshing, error, reload: () => run("silent"), refresh: () => run("refresh") };
}
