import { describe, it, expect } from 'vitest';
import { upAndDownPattern, buildUpAndDown } from '../src/playback/patterns/up-and-down';
import { buildGrid, computeHighlights, FRET_COUNT, pitchOf } from '../src/lib/fretboard';
import { getTuning } from '../src/lib/tunings';
import { getScale } from '../src/lib/scales';
import type { ResolveInput } from '../src/playback/types';

const STANDARD = getTuning('standard')!;

function makeInput(overrides: Partial<ResolveInput> = {}): ResolveInput {
  const intervals = getScale('major')!.intervals;
  const grid = buildGrid(STANDARD, overrides.capo ?? 0);
  const highlights = computeHighlights(grid, overrides.key ?? 'A', intervals, overrides.capo ?? 0);
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

describe('up-and-down pattern', () => {
  it('starts and ends on the lowest-pitch cell', () => {
    const seq = upAndDownPattern.resolve(makeInput());
    expect(seq.length).toBeGreaterThan(0);
    const first = seq[0];
    const last = seq[seq.length - 1];
    const lowestPitch = Math.min(...seq.map((c) => pitchOf(c, STANDARD)));
    expect(pitchOf(first, STANDARD)).toBe(lowestPitch);
    expect(pitchOf(last, STANDARD)).toBe(lowestPitch);
  });

  it('reaches the apex exactly once in the middle', () => {
    const seq = upAndDownPattern.resolve(makeInput());
    const pitches = seq.map((c) => pitchOf(c, STANDARD));
    const max = Math.max(...pitches);
    const apexIdx = pitches.indexOf(max);
    expect(apexIdx).toBeGreaterThan(0);
    expect(apexIdx).toBeLessThan(seq.length - 1);
    expect(pitches.filter((p) => p === max).length).toBe(1);
  });

  it('asc portion sorts cells by (stringIndex, fret) ascending; desc portion is its reverse without apex', () => {
    // Up-and-down walks string-by-string (low → high), each string fret-ascending,
    // then unwinds the same path. So the FULL sequence is palindromic around the
    // apex: position (apexIdx + 1 + i) === position (apexIdx - 1 - i).
    const seq = upAndDownPattern.resolve(makeInput());
    const pitches = seq.map((c) => pitchOf(c, STANDARD));
    const max = Math.max(...pitches);
    const apexIdx = pitches.indexOf(max);
    for (let i = 0; apexIdx + 1 + i < seq.length; i++) {
      const back = seq[apexIdx + 1 + i];
      const fwd = seq[apexIdx - 1 - i];
      if (!fwd) break;
      expect(back.stringIndex).toBe(fwd.stringIndex);
      expect(back.fret).toBe(fwd.fret);
    }
  });

  it('returns empty when there are no highlights', () => {
    const seq = upAndDownPattern.resolve({ ...makeInput(), highlights: [] });
    expect(seq).toEqual([]);
  });

  it('is applicable iff there are highlights', () => {
    expect(upAndDownPattern.isApplicable(makeInput())).toBe(true);
    expect(upAndDownPattern.isApplicable({ ...makeInput(), highlights: [] })).toBe(false);
  });

  it('buildUpAndDown helper matches the pattern resolver', () => {
    const input = makeInput();
    expect(upAndDownPattern.resolve(input)).toEqual(buildUpAndDown(input.highlights));
  });
});
