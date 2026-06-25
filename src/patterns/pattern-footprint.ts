import type { Pattern } from './types';

/** A fretboard cell: which string, which fret. */
export interface FootprintCell {
  stringIndex: number;
  fret: number;
}

/**
 * The set of fretboard cells a pattern visits — its "footprint" on the neck.
 *
 * Used by Practice's Pattern mode as the dim context layer (the territory the
 * pattern's route traces through). Deliberately makes NO theory claim: it's the
 * pattern's literal cells, deduped, so it's always correct even when the pattern
 * doesn't map cleanly to a single scale.
 *
 * Pure and order-stable (first occurrence wins), so it's cheap to memoize and
 * straightforward to test.
 */
export function patternFootprint(pattern: Pattern): FootprintCell[] {
  const seen = new Set<string>();
  const out: FootprintCell[] = [];
  for (const e of pattern.events) {
    const key = `${e.stringIndex}:${e.fret}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ stringIndex: e.stringIndex, fret: e.fret });
  }
  return out;
}
