/**
 * Centralized cap gate for content-creation actions. If the user is at their
 * tier's limit, opens the upgrade prompt (or signup modal for anon) and returns
 * `false` so the caller can refuse the create. Returns `true` when the create
 * may proceed.
 *
 * Anon users have no Pro tier to upgrade to, so they get the SignupModal —
 * "sign up to keep going" rather than "upgrade to Pro."
 *
 * Lives in `subscription/` rather than next to any particular store because
 * it bridges multiple stores: patterns + compositions are gated from
 * `usePatternsStore`, voice variants from `useVoiceStore`. Importing this from
 * a store doesn't pull in the other stores.
 */
import { useAuthStore } from '../auth/useAuthStore';
import { canCreate } from './canCreate';
import { DEFAULT_SUBSCRIPTION } from './types';
import type { CappedKind } from './tierLimits';

export function gateCreate(kind: CappedKind, currentCount: number): boolean {
  const auth = useAuthStore.getState();
  const subscription = auth.subscription ?? DEFAULT_SUBSCRIPTION;
  const check = canCreate(subscription.tier, kind, currentCount);
  if (check.allowed) return true;
  if (auth.user === null) {
    auth.openSignupModal(`cap-${kind}`);
  } else {
    auth.openUpgradePrompt({ kind, cap: check.cap });
  }
  return false;
}
