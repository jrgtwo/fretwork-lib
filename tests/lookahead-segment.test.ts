import { describe, it, expect } from 'vitest';
import { segmentEvents, type SegmentEvent } from '../src/lookahead/segment';
import { getTuning } from '../src/lib/tunings';
import type { TuningDef } from '../src/types';

const standard = getTuning('standard') as TuningDef;

function ev(stringIndex: number, fret: number, startTick: number, extra: Partial<SegmentEvent> = {}): SegmentEvent {
  return { stringIndex, fret, startTick, durationTicks: 240, ...extra };
}

describe('segmentEvents', () => {
  it('treats simultaneous notes as one named chord segment', () => {
    // open C: x 3 2 0 1 0, all at tick 0
    const events = [ev(1, 3, 0), ev(2, 2, 0), ev(3, 0, 0), ev(4, 1, 0), ev(5, 0, 0)];
    const segs = segmentEvents(events, standard);
    expect(segs).toHaveLength(1);
    expect(segs[0].kind).toBe('chord');
    expect(segs[0].chordName).toBe('C');
    expect(segs[0].cells).toHaveLength(5);
  });

  it('treats sequential single notes as one run segment', () => {
    const events = [ev(5, 0, 0), ev(5, 2, 240), ev(5, 3, 480)];
    const segs = segmentEvents(events, standard);
    expect(segs).toHaveLength(1);
    expect(segs[0].kind).toBe('run');
    expect(segs[0].cells.map((c) => c.fret)).toEqual([0, 2, 3]);
  });

  it('splits a chord followed by a run into two ordered segments', () => {
    const events = [
      ev(1, 3, 0), ev(2, 2, 0), ev(3, 0, 0), // C chord at 0
      ev(5, 5, 480), ev(5, 7, 720), // run after
    ];
    const segs = segmentEvents(events, standard);
    expect(segs.map((s) => s.kind)).toEqual(['chord', 'run']);
    expect(segs[0].startTick).toBeLessThan(segs[1].startTick);
  });

  it('keeps an explicitly-tagged group as one chord even when strummed wide', () => {
    // same chordId, spread far apart in time (> cluster window) — tagging overrides timing
    const events = [
      ev(1, 0, 0, { chordId: 'g1', chordName: 'Gsus' }),
      ev(2, 0, 200, { chordId: 'g1', chordName: 'Gsus' }),
      ev(3, 0, 400, { chordId: 'g1', chordName: 'Gsus' }),
    ];
    const segs = segmentEvents(events, standard);
    expect(segs).toHaveLength(1);
    expect(segs[0].kind).toBe('chord');
    expect(segs[0].chordName).toBe('Gsus');
  });
});
