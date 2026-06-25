/**
 * Singleton Supabase client.
 *
 * Constructed lazily on first access so:
 *   - jsdom-based tests can import lib code without crashing when env vars
 *     aren't set
 *   - the AudioContext / browser environment is fully alive before any auth
 *     request fires
 *
 * Provider-agnostic by design: nothing in this module reaches into Google-
 * specific fields. Code consumes the generic `SupabaseClient` / `User` /
 * `Session` types and stays decoupled from the auth provider behind them.
 *
 * Reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from `import.meta.env`.
 * The anon key is a publishable client key (safe to bundle into the browser);
 * row-level security policies are what actually protect user data. The
 * service-role key MUST NOT be used here — it's a server-only secret.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

/**
 * Returns the singleton Supabase client, constructing it on first access.
 * Throws if the required env vars are not set — call this only from code paths
 * that genuinely need auth/database access.
 */
export function getSupabaseClient(): SupabaseClient {
  if (_client) return _client;

  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  if (!url || !anonKey) {
    throw new Error(
      'Supabase client cannot be constructed: VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing. ' +
        'Copy example/.env.example to example/.env.local and fill in the real values.',
    );
  }

  _client = createClient(url, anonKey, {
    auth: {
      // Persist the session to localStorage so a page reload doesn't sign the user out.
      // The auth token is per-user and not personal content — distinct from our policy
      // that USER CONTENT (patterns, etc.) uses sessionStorage for anon users.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return _client;
}

/**
 * Cheap probe — returns true if Supabase env vars are present, without
 * attempting to construct the client. Useful for guarding UI affordances
 * that only make sense when auth is wired up.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY,
  );
}

/** Test-only escape hatch. Drops the singleton so a fresh client is built next call. */
export function _resetSupabaseClientForTests(): void {
  _client = null;
}
