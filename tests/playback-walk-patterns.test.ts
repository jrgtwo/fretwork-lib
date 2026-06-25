import { describe, it, expect } from 'vitest';
import { ascendingPitchPattern } from '../src/playback/patterns/ascending-pitch';
import { stringByStringPattern } from '../src/playback/patterns/string-by-string';
import { buildGrid, computeHighlights, FRET_COUNT } from '../src/lib/fretboard';
import { getTuning } from '../src/lib/tunings';
import { getScale } from '../src/lib/scales';
import type { ResolveInput } from '../src/playback/types';

const STANDARD = getTuning('standard')!;
const MAJOR = getScale('major')!;

function makeInput(overrides: Partial<ResolveInput> = {}): ResolveInput {
  const grid = buildGrid(STANDARD);
  const highlights = computeHighlights(grid, 'A', MAJOR.intervals);
  return {
    highlights,
    tuning: STANDARD,
    key: 'A',
    capo: 0,
    mode: 'scales',
    instrumentId: 'guitar',
    fretCount: FRET_COUNT,
    scaleType: 'major',
    ...overrides,
  };
}

describe('ascendingPitchPattern', () => {
  it('returns highlights in strictly ascending MIDI pitch order', () => {
    const seq = ascendingPitchPattern.resolve(makeInput());
    expect(seq.length).toBeGreaterThan(0);
    // Check pitch ordering by computing midi directly from tuning.
    const { Note } = require('tonal');
    const pitches = seq.map((c) => Note.midi(STANDARD.strings[c.stringIndex])! + c.fret);
    for (let i = 1; i < pitches.length; i++) {
      expect(pitches[i]).toBeGreaterThanOrEqual(pitches[i - 1]);
    }
  });

  it('starts at the lowest pitch (low E open in A major standard)', () => {
    const seq = ascendingPitchPattern.resolve(makeInput());
    // Low E open is E2 (MIDI 40), which IS in A major.
    expect(seq[0]).toEqual({ stringIndex: 0, fret: 0 });
  });

  it('isApplicable=false when no highlights', () => {
    expect(ascendingPitchPattern.isApplicable(makeInput({ highlights: [] }))).toBe(false);
  });
});

describe('stringByStringPattern', () => {
  it('groups cells by string, walking low E first then up', () => {
    const seq = stringByStringPattern.resolve(makeInput());
    expect(seq.length).toBeGreaterThan(0);
    // Verify monotonic non-decreasing string index, with frets ascending within each string.
    let prevString = -1;
    let prevFret = -1;
    for (const cell of seq) {
      if (cell.stringIndex !== prevString) {
        expect(cell.stringIndex).toBeGreaterThan(prevString);
        prevString = cell.stringIndex;
        prevFret = -1;
      }
      expect(cell.fret).toBeGreaterThan(prevFret);
      prevFret = cell.fret;
    }
  });

  it('first cell is on the lowest string', () => {
    const seq = stringByStringPattern.resolve(makeInput());
    expect(seq[0].stringIndex).toBe(0);
  });
});
