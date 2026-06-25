import { describe, it, expect } from 'vitest';
import { createEmptyPattern, stampEvent, PPQ } from '../src/patterns';
import { patternFootprint } from '../src/patterns/pattern-footprint';

describe('patternFootprint', () => {
  it('returns an empty footprint for a pattern with no events', () => {
    expect(patternFootprint(createEmptyPattern('empty'))).toEqual([]);
  });

  it('maps each event to its {stringIndex, fret} cell', () => {
    let p = createEmptyPattern('riff');
    p = stampEvent({ pattern: p, stringIndex: 5, fret: 3, startTick: 0, durationTicks: PPQ }).pattern;
    p = stampEvent({ pattern: p, stringIndex: 4, fret: 5, startTick: PPQ, durationTicks: PPQ }).pattern;
    expect(patternFootprint(p)).toEqual([
      { stringIndex: 5, fret: 3 },
      { stringIndex: 4, fret: 5 },
    ]);
  });

  it('dedupes cells visited more than once, first occurrence wins order', () => {
    let p = createEmptyPattern('repeat');
    p = stampEvent({ pattern: p, stringIndex: 5, fret: 3, startTick: 0, durationTicks: PPQ }).pattern;
    p = stampEvent({ pattern: p, stringIndex: 4, fret: 5, startTick: 0, durationTicks: PPQ }).pattern;
    // Same cell as the first event, later in time → deduped away.
    p = stampEvent({ pattern: p, stringIndex: 5, fret: 3, startTick: 2 * PPQ, durationTicks: PPQ }).pattern;
    expect(patternFootprint(p)).toEqual([
      { stringIndex: 5, fret: 3 },
      { stringIndex: 4, fret: 5 },
    ]);
  });

  it('keeps the open string (fret 0) as a distinct cell', () => {
    let p = createEmptyPattern('open');
    p = stampEvent({ pattern: p, stringIndex: 5, fret: 0, startTick: 0, durationTicks: PPQ }).pattern;
    p = stampEvent({ pattern: p, stringIndex: 5, fret: 1, startTick: PPQ, durationTicks: PPQ }).pattern;
    expect(patternFootprint(p)).toEqual([
      { stringIndex: 5, fret: 0 },
      { stringIndex: 5, fret: 1 },
    ]);
  });
});
