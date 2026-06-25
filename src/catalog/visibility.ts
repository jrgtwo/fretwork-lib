/**
 * Visibility states for shareable content (patterns, compositions, voice presets).
 * Stored as plain `text` in Postgres; canonical list lives here so UI controls and
 * write-time validation share one source of truth.
 *
 * Transitions are unrestricted in both directions — private ↔ unlisted ↔ public.
 * `publishedAt` is set when leaving private and cleared on return to private; that
 * lifecycle is owned by the store's `updatePatternMetadata` / `updateCompositionMetadata`
 * actions, not by this module.
 */
export const VISIBILITIES = ['private', 'unlisted', 'public'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  private: 'Private',
  unlisted: 'Unlisted',
  public: 'Public',
};

export const VISIBILITY_DESCRIPTIONS: Record<Visibility, string> = {
  private: 'Only you can see this.',
  unlisted: 'Anyone with the link can view.',
  public: 'Discoverable in the catalog.',
};

export function isVisibility(value: unknown): value is Visibility {
  return typeof value === 'string' && (VISIBILITIES as readonly string[]).includes(value);
}
