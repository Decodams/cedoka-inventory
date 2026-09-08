import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

interface QueryResult<T> {
  data: T | null;
  error: { message: string } | null;
}

interface DataState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

type Thenable<T> = PromiseLike<T>;

export function useSupabaseQuery<T>(
  queryFn: () => Thenable<QueryResult<T>>,
  deps: unknown[] = [],
): DataState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refetchCount, setRefetchCount] = useState(0);

  const refetch = useCallback(() => setRefetchCount((c) => c + 1), []);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    Promise.resolve(queryFn())
      .then((result) => {
        if (!mounted) return;
        if (result.error) {
          setError(result.error.message);
          setData(null);
        } else {
          setData(result.data);
        }
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : 'An unexpected error occurred');
        setLoading(false);
      });

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, refetchCount]);

  return { data, loading, error, refetch };
}

export { supabase };
