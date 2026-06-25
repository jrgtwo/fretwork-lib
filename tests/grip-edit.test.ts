import { describe, it, expect } from 'vitest';
import { toggleGripCell } from '../src/components/fretboard/grip-edit';
import type { Grip } from '../src/lib/chord-voicing';

const empty: Grip = { cells: [] };

describe('toggleGripCell', () => {
  it('adds a cell on an untouched string', () => {
    const next = toggleGripCell(empty, { stringIndex: 2, fret: 3 });
    expect(next.cells).toEqual([{ stringIndex: 2, fret: 3 }]);
  });

  it('removes the cell when the same one is toggled again', () => {
    const grip: Grip = { cells: [{ stringIndex: 2, fret: 3 }] };
    const next = toggleGripCell(grip, { stringIndex: 2, fret: 3 });
    expect(next.cells).toEqual([]);
  });

  it('replaces the note when a different fret on the same string is toggled', () => {
    const grip: Grip = { cells: [{ stringIndex: 2, fret: 3 }] };
    const next = toggleGripCell(grip, { stringIndex: 2, fret: 5 });
    expect(next.cells).toEqual([{ stringIndex: 2, fret: 5 }]);
  });

  it('treats fret 0 (open) as a valid selected note', () => {
    const next = toggleGripCell(empty, { stringIndex: 0, fret: 0 });
    expect(next.cells).toEqual([{ stringIndex: 0, fret: 0 }]);
  });

  it('keeps notes on other strings untouched', () => {
    const grip: Grip = { cells: [{ stringIndex: 0, fret: 1 }, { stringIndex: 5, fret: 0 }] };
    const next = toggleGripCell(grip, { stringIndex: 2, fret: 3 });
    expect(next.cells).toContainEqual({ stringIndex: 0, fret: 1 });
    expect(next.cells).toContainEqual({ stringIndex: 5, fret: 0 });
    expect(next.cells).toContainEqual({ stringIndex: 2, fret: 3 });
  });
});
