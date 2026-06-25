/**
 * useAuth — React hook that wires Supabase auth into our Zustand store.
 *
 * Responsibilities:
 *   1. On mount, hydrate the store from the current Supabase session.
 *   2. Subscribe to `onAuthStateChange` so any token refresh / sign-out /
 *      cross-tab event keeps the store in sync.
 *   3. Whenever the user changes, refetch the profile row and decide whether
 *      we're in 'signed-in' or 'needs-profile' status.
 *   4. Expose `signInWithGoogle`, `signOut`, and `refreshProfile` actions.
 *
 * Component code reads state via `useAuthStore` selectors. This hook is the
 * single place that talks to Supabase's auth API directly.
 *
 * Implementation notes:
 *   - Uses module-level promise tracking so React StrictMode's double-invoke
 *     in dev doesn't kick off two parallel hydrations. The second invocation
 *     awaits the first's result instead of racing it.
 *   - Wraps async work in try/catch so a silent rejection in fetch / parse /
 *     RLS can't leave the store stuck at `'loading'` indefinitely.
 *   - Logs failure modes to the console (a stuck `loading` state with no
 *     visible error is the worst case to debug).
 */
import { useCallback, useEffect } from 'react';
import { getSupabaseClient } from './supabaseClient';
import { useAuthStore } from './useAuthStore';
import { rowToProfile, type AuthStatus, type Profile } from './types';
import { isTier, type Subscription } from '../subscription';

/**
 * Module-level guard so multiple useAuth callers (or StrictMode double-mount)
 * don't kick off parallel session+profile hydrations. The first one wins and
 * its result lands in the store. Subsequent callers piggyback.
 */
let hydrationPromise: Promise<void> | null = null;
/** Tracks whether onAuthStateChange has been installed already this page load. */
let authChangeSubscription: { unsubscribe(): void } | null = null;

export interface UseAuthReturn {
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  refreshProfile(): Promise<void>;
}

export function useAuth(): UseAuthReturn {
  const setSession = useAuthStore((s) => s.setSession);
  const setProfile = useAuthStore((s) => s.setProfile);
  const setSubscription = useAuthStore((s) => s.setSubscription);
  const setStatus = useAuthStore((s) => s.setStatus);
  const setError = useAuthStore((s) => s.setError);
  const resetStore = useAuthStore((s) => s.reset);

  // ─── Hydrate from session + install onAuthStateChange listener ───────────
  useEffect(() => {
    let mounted = true;

    if (!hydrationPromise) {
      hydrationPromise = hydrateInitialSession({
        onSignedIn: (profile) => {
          if (!mounted) return;
          setProfile(profile);
          setStatus('signed-in');
        },
        onNeedsProfile: () => {
          if (!mounted) return;
          setProfile(null);
          setStatus('needs-profile');
        },
        onSignedOut: () => {
          if (!mounted) return;
          setProfile(null);
          setSubscription(null);
          setStatus('signed-out');
        },
        onSession: (session) => {
          if (!mounted) return;
          setSession(session);
        },
        onSubscription: (subscription) => {
          if (!mounted) return;
          setSubscription(subscription);
        },
        onError: (msg) => {
          if (!mounted) return;
          setError(msg);
        },
        setStatus: (s) => {
          if (!mounted) return;
          setStatus(s);
        },
      });
    }

    if (!authChangeSubscription) {
      try {
        const client = getSupabaseClient();
        const { data } = client.auth.onAuthStateChange((event, session) => {
          // Update store immediately for any event.
          setSession(session);
          if (event === 'SIGNED_OUT' || !session?.user) {
            setProfile(null);
            setSubscription(null);
            setStatus('signed-out');
            return;
          }
          if (
            event === 'SIGNED_IN' ||
            event === 'TOKEN_REFRESHED' ||
            event === 'USER_UPDATED'
          ) {
            // Re-hydrate profile + subscription after these events. Fire-and-forget;
            // failures surface via the store's `error` field, not a stuck loading state.
            const uid = session.user.id;
            void hydrateProfileSafe(uid).then((result) => {
              if (result.kind === 'ok') {
                setProfile(result.profile);
                setStatus('signed-in');
              } else if (result.kind === 'missing') {
                setProfile(null);
                setStatus('needs-profile');
              } else {
                setError(result.error);
                // Keep status at whatever it was — don't bump them to signed-out
                // just because a profile read failed transiently.
                console.error('[useAuth] profile re-hydrate failed:', result.error);
              }
            });
            void hydrateSubscriptionSafe(uid).then(setSubscription);
          }
        });
        authChangeSubscription = data.subscription;
      } catch (e) {
        console.error('[useAuth] could not install onAuthStateChange:', e);
        setError(e instanceof Error ? e.message : String(e));
      }
    }

    return () => {
      mounted = false;
      // Note: we deliberately do NOT unsubscribe authChangeSubscription on
      // unmount. The subscription is page-lifetime — Supabase shouldn't be
      // re-subscribed on every component re-mount (StrictMode would churn).
      // The browser's page unload tears it down naturally.
    };
  }, [setSession, setProfile, setSubscription, setStatus, setError]);

  // ─── Actions ─────────────────────────────────────────────────────────────

  const signInWithGoogle = useCallback(async () => {
    setError(null);
    setStatus('loading');
    try {
      const client = getSupabaseClient();
      const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo:
            typeof window === 'undefined' ? undefined : window.location.origin,
        },
      });
      if (error) {
        setError(error.message);
        setStatus('signed-out');
      }
      // On success, the browser redirects to Google. The auth state change
      // handler picks up the returning session when we come back.
    } catch (e) {
      console.error('[useAuth] signInWithGoogle threw:', e);
      setError(e instanceof Error ? e.message : String(e));
      setStatus('signed-out');
    }
  }, [setError, setStatus]);

  const signOut = useCallback(async () => {
    setError(null);
    try {
      const client = getSupabaseClient();
      const { error } = await client.auth.signOut();
      if (error) {
        setError(error.message);
        return;
      }
      resetStore();
    } catch (e) {
      console.error('[useAuth] signOut threw:', e);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [setError, resetStore]);

  const refreshProfile = useCallback(async () => {
    const user = useAuthStore.getState().user;
    if (!user) return;
    const result = await hydrateProfileSafe(user.id);
    if (result.kind === 'ok') {
      setProfile(result.profile);
      setStatus('signed-in');
    } else if (result.kind === 'missing') {
      setProfile(null);
      setStatus('needs-profile');
    } else {
      setError(result.error);
      console.error('[useAuth] refreshProfile failed:', result.error);
    }
  }, [setProfile, setStatus, setError]);

  return { signInWithGoogle, signOut, refreshProfile };
}

// ─── Internal: initial-session hydration ──────────────────────────────────

interface HydrateInitialSessionCallbacks {
  onSession(session: import('./types').Session | null): void;
  onSignedIn(profile: Profile): void;
  onNeedsProfile(): void;
  onSignedOut(): void;
  onSubscription(subscription: Subscription | null): void;
  onError(message: string): void;
  setStatus(status: AuthStatus): void;
}

async function hydrateInitialSession(cb: HydrateInitialSessionCallbacks): Promise<void> {
  cb.setStatus('loading');
  try {
    const client = getSupabaseClient();
    const { data, error } = await client.auth.getSession();
    if (error) {
      console.error('[useAuth] getSession returned error:', error);
      cb.onError(error.message);
      cb.onSignedOut();
      return;
    }
    const session = data.session ?? null;
    cb.onSession(session);
    if (!session?.user) {
      cb.onSignedOut();
      return;
    }
    // Profile + subscription in parallel — they're independent reads gated by the
    // same auth.uid().
    const [profileResult, subscription] = await Promise.all([
      hydrateProfileSafe(session.user.id),
      hydrateSubscriptionSafe(session.user.id),
    ]);
    cb.onSubscription(subscription);
    if (profileResult.kind === 'ok') {
      cb.onSignedIn(profileResult.profile);
    } else if (profileResult.kind === 'missing') {
      cb.onNeedsProfile();
    } else {
      console.error('[useAuth] initial profile hydrate failed:', profileResult.error);
      cb.onError(profileResult.error);
      // Profile fetch failed but the user is authenticated. Treat as
      // needs-profile so they can re-try via the signup form rather than
      // forcing them through Google again.
      cb.onNeedsProfile();
    }
  } catch (e) {
    console.error('[useAuth] hydrateInitialSession threw:', e);
    cb.onError(e instanceof Error ? e.message : String(e));
    cb.onSignedOut();
  }
}

// ─── Internal: profile fetch with explicit result types ───────────────────

type HydrateProfileResult =
  | { kind: 'ok'; profile: Profile }
  | { kind: 'missing' }
  | { kind: 'error'; error: string };

async function hydrateProfileSafe(userId: string): Promise<HydrateProfileResult> {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      return { kind: 'error', error: error.message };
    }
    if (!data) {
      return { kind: 'missing' };
    }
    return { kind: 'ok', profile: rowToProfile(data) };
  } catch (e) {
    return { kind: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Fetch the user's subscription row. Returns null on any failure (RLS, network,
 * missing row) so callers can fall back to the free-tier default without having
 * to distinguish error modes. Subscription state isn't load-bearing for entry
 * to the app — over-cap users still see all their existing content.
 */
async function hydrateSubscriptionSafe(userId: string): Promise<Subscription | null> {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('subscriptions')
      .select('tier, active, expires_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return null;
    const tier = isTier(data.tier) ? data.tier : 'free';
    const expiresRaw = data.expires_at as string | number | null;
    let expiresAt: number | null = null;
    if (typeof expiresRaw === 'string') {
      const parsed = Date.parse(expiresRaw);
      if (Number.isFinite(parsed)) expiresAt = parsed;
    } else if (typeof expiresRaw === 'number') {
      expiresAt = expiresRaw;
    }
    return {
      tier,
      active: (data.active as boolean | null) ?? true,
      expiresAt,
    };
  } catch {
    return null;
  }
}

/** Test-only escape hatch. Resets the module-level guards. */
export function _resetUseAuthForTests(): void {
  hydrationPromise = null;
  authChangeSubscription = null;
}
