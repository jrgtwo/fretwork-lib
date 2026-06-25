/**
 * Curated tag vocabulary. Tags describe the pattern's role or context
 * (solo, backing-track, intro, …) rather than musical style — style lives
 * in genres. Multi-select; stored as `text[]`.
 */
export const TAGS = [
  // role
  'solo',
  'backing-track',
  'intro',
  'outro',
  'verse',
  'chorus',
  'bridge',
  'fill',
  'riff',
  'lick',
  'song',
  // purpose
  'practice',
  'warm-up',
  'exercise',
  'drill',
  'ear-training',
] as const;
export type Tag = (typeof TAGS)[number];

export const TAG_LABELS: Record<Tag, string> = {
  solo: 'Solo',
  'backing-track': 'Backing Track',
  intro: 'Intro',
  outro: 'Outro',
  verse: 'Verse',
  chorus: 'Chorus',
  bridge: 'Bridge',
  fill: 'Fill',
  riff: 'Riff',
  lick: 'Lick',
  song: 'Song',
  practice: 'Practice',
  'warm-up': 'Warm-up',
  exercise: 'Exercise',
  drill: 'Drill',
  'ear-training': 'Ear Training',
};

export function isTag(value: unknown): value is Tag {
  return typeof value === 'string' && (TAGS as readonly string[]).includes(value);
}

export function filterValidTags(values: readonly string[]): Tag[] {
  return values.filter(isTag);
}
