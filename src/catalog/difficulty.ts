/**
 * Difficulty levels for shareable content. Stored as plain `text` in Postgres;
 * the canonical list lives here so UI dropdowns and write-time validation
 * use the same source of truth.
 */
export const DIFFICULTY_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export type Difficulty = (typeof DIFFICULTY_LEVELS)[number];

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

export function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === 'string' && (DIFFICULTY_LEVELS as readonly string[]).includes(value);
}
