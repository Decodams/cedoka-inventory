/**
 * Extract a human-readable message from a Supabase Edge Function invocation
 * error. `functions.invoke` surfaces non-2xx responses as a generic
 * "Edge Function returned a non-2xx status code" error while the real
 * message lives in the response body — this helper unwraps it.
 */
export async function edgeErrorMessage(err: unknown, fallback: string): Promise<string> {
  try {
    const context = (err as { context?: unknown } | null)?.context;
    if (typeof Response !== 'undefined' && context instanceof Response) {
      const payload = (await context.clone().json().catch(() => null)) as { error?: unknown } | null;
      if (payload && typeof payload.error === 'string' && payload.error.trim()) {
        return payload.error;
      }
    }
    const data = (err as { data?: unknown } | null)?.data as { error?: unknown } | null;
    if (data && typeof data.error === 'string' && data.error.trim()) {
      return data.error;
    }
    const message = (err as { message?: unknown } | null)?.message;
    if (typeof message === 'string' && message.trim() && !message.includes('non-2xx')) {
      return message;
    }
  } catch {
    // fall through to fallback
  }
  return fallback;
}
