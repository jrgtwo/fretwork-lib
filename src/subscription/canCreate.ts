/**
 * Cap-check helper used by store actions and UI buttons. Returns the decision
 * plus the cap (so callers can render a precise upgrade prompt without
 * duplicating the lookup).
 */
import { getCap, type CappedKind } from './tierLimits';
import type { Tier } from './types';

export interface CapCheck {
  allowed: boolean;
  cap: number;
  /** Hard-cap values render as Infinity in the limits table; UI should treat
   *  Infinity as "no limit" rather than display the number. */
  isUnlimited: boolean;
}

export function canCreate(tier: Tier, kind: CappedKind, currentCount: number): CapCheck {
  const cap = getCap(tier, kind);
  return {
    allowed: currentCount < cap,
    cap,
    isUnlimited: !Number.isFinite(cap),
  };
}
