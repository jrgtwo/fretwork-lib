import type { PlaybackPattern, PlayableCell } from '../types';

export const STRING_BY_STRING_ID = 'string-by-string';

/**
 * Walks each string fully (low fret → high) before jumping to the next string.
 * Mirrors how guitarists often practice scale-shape runs: stay on a string, exhaust it,
 * move up.
 */
export const stringByStringPattern: PlaybackPattern = {
  id: STRING_BY_STRING_ID,
  name: 'String by string',
  group: 'Walk',
  isApplicable: ({ highlights }) => highlights.length > 0,
  resolve: ({ highlights }) => {
    // Group by string, sort each group by fret, concat in string-index order (low → high).
    const byString = new Map<number, PlayableCell[]>();
    for (const h of highlights) {
      const cell = { stringIndex: h.stringIndex, fret: h.fret };
      const arr = byString.get(h.stringIndex);
      if (arr) arr.push(cell);
      else byString.set(h.stringIndex, [cell]);
    }
    const out: PlayableCell[] = [];
    const stringIndices = [...byString.keys()].sort((a, b) => a - b);
    for (const i of stringIndices) {
      const group = byString.get(i)!;
      group.sort((a, b) => a.fret - b.fret);
      out.push(...group);
    }
    return out;
  },
};
