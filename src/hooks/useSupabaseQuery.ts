import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

// Raw shape accepted from query builders. Supabase infers a narrow row type
// for column-trimmed selects (e.g. select('id,name)')); accepting `unknown`
// here keeps every call site compiling while the hook still exposes typed T.
interface RawQueryResult {
  data: unknown;
  error: { message: string } | null;
}

interface DataState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

type Thenable<T> = PromiseLike<T>;

export interface QueryCacheOptions {
  /** Stable key identifying this query (must include every filter value). Enables stale-while-revalidate caching. */
  cacheKey?: string;
  /** Freshness window in ms. Fresh hits serve with zero network requests. Defaults to 30s. */
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 30_000;

interface CacheEntry {
  data: unknown;
  at: number;
}

// Module-level cache shared across all hook instances: repeat page visits
// paint instantly instead of refetching reference data on every mount.
const queryCache = new Map<string, CacheEntry>();
// In-flight dedup: mounts racing for the same key share one request.
const inflight = new Map<string, Promise<RawQueryResult>>();

export function clearQueryCache(prefix?: string): void {
  if (!prefix) {
    queryCache.clear();
    inflight.clear();
    return;
  }
  for (const key of queryCache.keys()) {
    if (key.startsWith(prefix)) queryCache.delete(key);
  }
  for (const key of inflight.keys()) {
    if (key.startsWith(prefix)) inflight.delete(key);
  }
}

function readCachedData<T>(key: string): T | null {
  const entry = queryCache.get(key);
  if (!entry) return null;
  return entry.data as T | null;
}

export function useSupabaseQuery<T>(
  queryFn: (() => Thenable<RawQueryResult>) | null,
  deps: unknown[] = [],
  opts: QueryCacheOptions = {},
): DataState<T> {
  const { cacheKey, ttlMs = DEFAULT_TTL_MS } = opts;
  const keyRef = useRef(cacheKey);
  keyRef.current = cacheKey;
  const ttlRef = useRef(ttlMs);
  ttlRef.current = ttlMs;

  const [data, setData] = useState<T | null>(() => {
    if (queryFn === null || !cacheKey) return null;
    return readCachedData<T>(cacheKey);
  });
  const [loading, setLoading] = useState<boolean>(() => {
    if (queryFn === null) return false;
    if (cacheKey && queryCache.get(cacheKey)) return false;
    return true;
  });
  const [error, setError] = useState<string | null>(null);
  const [refetchCount, setRefetchCount] = useState(0);

  const refetch = useCallback(() => {
    const key = keyRef.current;
    if (key) {
      queryCache.delete(key);
      inflight.delete(key);
    }
    setRefetchCount((c) => c + 1);
  }, []);

  useEffect(() => {
    if (queryFn === null) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let mounted = true;
    const key = keyRef.current;
    const ttl = ttlRef.current;

    if (key) {
      const entry = queryCache.get(key);
      const fresh = entry !== undefined && Date.now() - entry.at < ttl;
      if (entry && mounted) {
        setData(entry.data as T | null);
        setError(null);
      }
      if (fresh) {
        setLoading(false);
        return;
      }
      // Stale or missing: show cached data (if any) while revalidating in background.
      if (entry) setLoading(false);
      else {
        setLoading(true);
        setError(null);
      }
    } else {
      setLoading(true);
      setError(null);
    }

    let request: Promise<RawQueryResult>;
    if (key && inflight.has(key)) {
      request = inflight.get(key) as Promise<RawQueryResult>;
    } else {
      request = Promise.resolve(queryFn());
      if (key) inflight.set(key, request);
    }

    request
      .then((result) => {
        if (!mounted) return;
        if (result.error) {
          setError(result.error.message);
        } else {
          setError(null);
          setData(result.data as T | null);
          if (key) queryCache.set(key, { data: result.data, at: Date.now() });
        }
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : 'An unexpected error occurred');
        setLoading(false);
      })
      .finally(() => {
        if (key && inflight.get(key) === request) inflight.delete(key);
      });

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, refetchCount]);

  return { data, loading, error, refetch };
}

export { supabase };
