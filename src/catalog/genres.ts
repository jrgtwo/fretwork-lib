/**
 * Curated genre vocabulary for shareable content. Multi-select; stored as
 * `text[]`. Adding a new genre is a code change here (no migration).
 *
 * Keep this list intentionally broad — fine-grained sub-styles belong in
 * tags, not genres.
 */
export const GENRES = [
  'blues',
  'jazz',
  'rock',
  'metal',
  'pop',
  'folk',
  'country',
  'classical',
  'funk',
  'soul',
  'r&b',
  'hip-hop',
  'latin',
  'reggae',
  'world',
  'electronic',
  'ambient',
] as const;
export type Genre = (typeof GENRES)[number];

export const GENRE_LABELS: Record<Genre, string> = {
  blues: 'Blues',
  jazz: 'Jazz',
  rock: 'Rock',
  metal: 'Metal',
  pop: 'Pop',
  folk: 'Folk',
  country: 'Country',
  classical: 'Classical',
  funk: 'Funk',
  soul: 'Soul',
  'r&b': 'R&B',
  'hip-hop': 'Hip-Hop',
  latin: 'Latin',
  reggae: 'Reggae',
  world: 'World',
  electronic: 'Electronic',
  ambient: 'Ambient',
};

export function isGenre(value: unknown): value is Genre {
  return typeof value === 'string' && (GENRES as readonly string[]).includes(value);
}

export function filterValidGenres(values: readonly string[]): Genre[] {
  return values.filter(isGenre);
}
