import type { PlaybackPattern, PlayableCell } from '../types';
import { cellsEqual } from '../types';

export const UP_AND_DOWN_ID = 'up-and-down';

/**
 * Up-and-down walk: ascending string-by-string (low → high, each string's cells
 * in fret-ascending order), then descending string-by-string (high → low, each
 * string's cells in fret-descending order). The apex (last note of asc =
 * first note of desc) is played only once.
 *
 * This was previously embedded in CAGED patterns. Lifting it out so any cell
 * scope (full scale, CAGED shape, future custom selections) can be walked
 * up-and-down explicitly via `pattern = up-and-down`.
 */
export const upAndDownPattern: PlaybackPattern = {
  id: UP_AND_DOWN_ID,
  name: 'Up and down',
  group: 'Walk',
  isApplicable: ({ highlights }) => highlights.length > 0,
  resolve: ({ highlights }) => buildUpAndDown(highlights),
};

/** Build an up-and-down playback order from any cell shape with `stringIndex`
 *  and `fret` — works for `Highlight`, `AbsoluteCell`, etc. Pure function, no
 *  Tone deps. */
export function buildUpAndDown<T extends { stringIndex: number; fret: number }>(
  cells: readonly T[],
): PlayableCell[] {
  if (cells.length === 0) return [];

  const byString = new Map<number, T[]>();
  for (const c of cells) {
    const arr = byString.get(c.stringIndex);
    if (arr) arr.push(c);
    else byString.set(c.stringIndex, [c]);
  }
  for (const arr of byString.values()) {
    arr.sort((a, b) => a.fret - b.fret);
  }

  const stringIndices = [...byString.keys()].sort((a, b) => a - b);

  const asc: PlayableCell[] = [];
  for (const i of stringIndices) {
    for (const c of byString.get(i)!) {
      asc.push({ stringIndex: c.stringIndex, fret: c.fret });
    }
  }

  const desc: PlayableCell[] = [];
  for (let k = stringIndices.length - 1; k >= 0; k--) {
    const i = stringIndices[k];
    const list = byString.get(i)!;
    for (let j = list.length - 1; j >= 0; j--) {
      const c = list[j];
      desc.push({ stringIndex: c.stringIndex, fret: c.fret });
    }
  }

  // Drop the apex from desc to avoid playing it twice.
  if (desc.length > 0 && asc.length > 0) {
    const apex = asc[asc.length - 1];
    if (cellsEqual(desc[0], apex)) {
      desc.shift();
    }
  }

  return [...asc, ...desc];
}
