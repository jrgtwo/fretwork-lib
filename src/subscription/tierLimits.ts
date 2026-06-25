/**
 * Per-tier caps on content creation. The numbers are deliberately generous on
 * the Free side — strategy is "real product experience, then a paid upgrade for
 * heavy users + future feature unlocks" rather than "tight trial cap."
 *
 * Folders are uncapped (cheap metadata, no value-prop reason to limit).
 */
import type { Tier } from './types';

export type CappedKind = 'patterns' | 'compositions' | 'voiceVariants';

export interface TierLimits {
  patterns: number;
  compositions: number;
  voiceVariants: number;
}

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  // Bumped temporarily while a known cloud-sync-duplicates-sessionStorage
  // bug exists — without headroom users hit cap + storage-quota issues
  // simultaneously during testing. Walk these back when the storage layer
  // for signed-in users is rewritten to bypass sessionStorage.
  free: { patterns: 1000, compositions: 500, voiceVariants: 100 },
  pro: { patterns: Infinity, compositions: Infinity, voiceVariants: Infinity },
};

export const KIND_LABELS: Record<CappedKind, string> = {
  patterns: 'patterns',
  compositions: 'compositions',
  voiceVariants: 'voice variants',
};

export function getCap(tier: Tier, kind: CappedKind): number {
  return TIER_LIMITS[tier][kind];
}
