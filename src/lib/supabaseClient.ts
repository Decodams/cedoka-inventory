import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Vite requires VITE_ prefix. Accept both Vite and Next.js naming for flexibility
// and both anon JWT and new publishable key (sb_publishable_...) formats.
const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ??
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL;

const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

// NOTE: never throw at import time. On hosts like Vercel the env vars live in
// the dashboard (never in the repo), and a throw here used to crash the whole
// app to a blank white screen. main.tsx renders <ConfigErrorScreen /> instead.
export const supabaseConfigError: string | null =
  !supabaseUrl || !supabaseAnonKey
    ? 'Missing Supabase environment variables. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your hosting dashboard (e.g. Vercel → Settings → Environment Variables) and redeploy.'
    : null;

export function isSupabaseConfigured(): boolean {
  return supabaseConfigError === null;
}

// Placeholder values keep createClient() from throwing at import time when the
// app is misconfigured. The app refuses to render past ConfigErrorScreen in
// that state, so this client is never actually used.
export const supabase: SupabaseClient = createClient(
  supabaseUrl ?? 'https://placeholder.supabase.co',
  supabaseAnonKey ?? 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);
