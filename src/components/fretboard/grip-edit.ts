/**
 * Pure selection logic for the chord-shape editor. A grip is at most one note
 * per string; clicking a cell toggles it, and clicking a different fret on a
 * string already in the grip replaces that string's note (you never get two
 * notes on one string). Fret 0 is a real selection (an open string).
 */
import type { Grip } from '../../lib/chord-voicing';

function sameCell(
  a: { stringIndex: number; fret: number },
  b: { stringIndex: number; fret: number },
): boolean {
  return a.stringIndex === b.stringIndex && a.fret === b.fret;
}

export function toggleGripCell(
  grip: Grip,
  cell: { stringIndex: number; fret: number },
): Grip {
  // Same exact cell → remove (toggle off).
  if (grip.cells.some((c) => sameCell(c, cell))) {
    return { cells: grip.cells.filter((c) => !sameCell(c, cell)) };
  }
  // Otherwise drop any existing note on that string, then add the new one.
  const others = grip.cells.filter((c) => c.stringIndex !== cell.stringIndex);
  return { cells: [...others, { stringIndex: cell.stringIndex, fret: cell.fret }] };
}
