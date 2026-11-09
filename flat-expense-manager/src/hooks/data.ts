import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useRef, useState } from 'react';

import { useDataVersion } from '../data/context';
import type { Db } from '../db/client';

export function useDb(): Db {
  return useSQLiteContext();
}

interface AsyncState<T> {
  data: T | undefined;
  loading: boolean;
  error: string | undefined;
}

/**
 * Loads data from the database and reloads it every time the screen gains focus and
 * whenever data changes, so lists always reflect the latest records.
 */
export function useAsyncData<T>(loader: (db: Db) => Promise<T>, deps: readonly unknown[]) {
  const db = useDb();
  // Reload when shared data changes (another phone saved something, or a sync finished).
  const version = useDataVersion();
  const [state, setState] = useState<AsyncState<T>>({ data: undefined, loading: true, error: undefined });
  const [refreshing, setRefreshing] = useState(false);
  const requestId = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setState((s) => ({ ...s, loading: s.data === undefined, error: undefined }));
    try {
      const data = await loaderRef.current(db);
      if (id === requestId.current) setState({ data, loading: false, error: undefined });
    } catch (e) {
      if (id === requestId.current) {
        setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) }));
      }
    }
    // `deps` are the caller's loader inputs; the loader itself is read from a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version, ...deps]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return { ...state, reload: load, refresh, refreshing };
}

/** Guards an async action against double taps: a second call while one is running is ignored. */
export function useSubmit() {
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <R,>(task: () => Promise<R>): Promise<R | undefined> => {
    if (running.current) return undefined;
    running.current = true;
    setBusy(true);
    try {
      return await task();
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);
  return { run, busy };
}
