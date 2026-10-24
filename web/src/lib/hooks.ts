import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from './api';

export interface Loaded<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
  reload: () => Promise<void>;
}

/** GETs a path and re-fetches when it changes. Pass null to skip. */
export function useApi<T = any>(path: string | null, opts: { pollMs?: number } = {}): Loaded<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(!!path);
  const current = useRef(path);
  current.current = path;

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      const d = await get<T>(path);
      if (current.current === path) {
        setData(d);
        setError(undefined);
      }
    } catch (e: any) {
      if (current.current === path) setError(e.message);
    } finally {
      if (current.current === path) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setLoading(!!path);
    reload();
  }, [reload, path]);

  useEffect(() => {
    if (!opts.pollMs || !path) return;
    const t = setInterval(reload, opts.pollMs);
    return () => clearInterval(t);
  }, [opts.pollMs, path, reload]);

  return { data, error, loading, reload };
}

/** Wraps an async action with busy and error state for buttons and forms. */
export function useAction<A extends any[], R>(fn: (...args: A) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      setBusy(true);
      setError(undefined);
      try {
        return await fn(...args);
      } catch (e: any) {
        setError(e.message ?? String(e));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [fn],
  );
  return { run, busy, error, setError };
}
