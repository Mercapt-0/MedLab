import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

/** Load data from the API; returns { data, error, loading, reload }. Optional polling interval (ms). */
export function useApi(path, { interval, skip } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!skip);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    if (skip || !path) return;
    try {
      const d = await api.get(path);
      if (alive.current) { setData(d); setError(null); }
    } catch (e) {
      if (alive.current) setError(e);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [path, skip]);

  useEffect(() => {
    alive.current = true;
    setLoading(!skip);
    reload();
    let t;
    if (interval) t = setInterval(reload, interval);
    return () => { alive.current = false; clearInterval(t); };
  }, [reload, interval, skip]);

  return { data, error, loading, reload, setData };
}

/** Wrap an async action with busy/error state. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e.message);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

export const fmt = (d) => (d ? new Date(d).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const ago = (d) => {
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return fmt(d);
};
