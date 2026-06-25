/**
 * Subscription-related types. Mirrors the `subscriptions` table from migration
 * 0004; in-memory we use unix-ms for timestamps and a plain literal union for
 * `tier`.
 *
 * Stripe IDs live on the DB row but aren't exposed here — they're a write-path
 * concern (set by the future Stripe webhook handler) that the app's read paths
 * never need to look at.
 */
export const TIERS = ['free', 'pro'] as const;
export type Tier = (typeof TIERS)[number];

export interface Subscription {
  tier: Tier;
  active: boolean;
  /** Unix-ms timestamp; null = no expiry (e.g. free tier). */
  expiresAt: number | null;
}

export function isTier(value: unknown): value is Tier {
  return typeof value === 'string' && (TIERS as readonly string[]).includes(value);
}

/** The default state for anon viewers and signed-in users without a subscription
 *  row (e.g., legacy rows before migration 0005). */
export const DEFAULT_SUBSCRIPTION: Subscription = {
  tier: 'free',
  active: true,
  expiresAt: null,
};
