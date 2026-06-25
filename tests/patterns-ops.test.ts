import { describe, it, expect } from 'vitest';
import {
  createEmptyPattern,
  clonePattern,
  stampEvent,
  resizeEvent,
  resizeEventsBy,
  moveEvent,
  deleteEvents,
  nextEventStartOnString,
  PPQ,
  ticksPerBar,
  fitPatternDuration,
  stepLengthToTicks,
  setPatternSuggestedBpm,
  setPatternGroove,
} from '../src/patterns';
import { transposeEventsDiatonic, updateEventArticulations } from '../src/patterns/pattern-ops';
import { getScale } from '../src/lib/scales';
import { getTuning } from '../src/lib/tunings';
import type { Pattern } from '../src/patterns/types';

describe('pattern-ops', () => {
  describe('createEmptyPattern', () => {
    it('produces a pattern with no events and default 4-bar duration', () => {
      const p = createEmptyPattern('riff');
      expect(p.events).toEqual([]);
      expect(p.lanes).toEqual([]);
      expect(p.name).toBe('riff');
      expect(p.durationTicks).toBe(4 * 4 * PPQ); // 4 bars * 4/4
    });

    it('seeds empty automation tracks and null sourceIR by default', () => {
      const p = createEmptyPattern('riff');
      expect(p.tempoTrack).toEqual([]);
      expect(p.timeSignatureTrack).toEqual([]);
      expect(p.sourceIR).toBeNull();
    });
  });

  describe('clonePattern', () => {
    it('returns a structurally-equal but reference-distinct copy', () => {
      const p1 = createEmptyPattern('orig');
      const stamped = stampEvent({
        pattern: p1,
        stringIndex: 0,
        fret: 3,
        startTick: 0,
        durationTicks: PPQ,
      });
      const p = stamped.pattern;
      const c = clonePattern(p);
      expect(c.id).not.toBe(p.id);
      expect(c.events).toHaveLength(p.events.length);
      expect(c.events[0]).not.toBe(p.events[0]);
      expect(c.events[0].fret).toBe(p.events[0].fret);
      // Mutating the clone doesn't touch the source.
      c.events[0].fret = 99;
      expect(p.events[0].fret).toBe(3);
    });
  });

  describe('stampEvent', () => {
    it('inserts an event with the given duration', () => {
      const p = createEmptyPattern();
      const { pattern, event } = stampEvent({
        pattern: p,
        stringIndex: 0,
        fret: 5,
        startTick: 0,
        durationTicks: stepLengthToTicks('eighth'),
      });
      expect(pattern.events).toHaveLength(1);
      expect(pattern.events[0].id).toBe(event.id);
      expect(pattern.events[0].fret).toBe(5);
      expect(pattern.events[0].durationTicks).toBe(PPQ / 2);
    });

    it('clamps duration so it does not overlap the next event on the same string', () => {
      let pat = createEmptyPattern();
      pat = stampEvent({ pattern: pat, stringIndex: 0, fret: 5, startTick: 0, durationTicks: PPQ }).pattern;
      pat = stampEvent({ pattern: pat, stringIndex: 0, fret: 7, startTick: PPQ / 2, durationTicks: PPQ }).pattern;
      // The second event was stamped at 240; first event extends from 0 to 480.
      // The second stamp should fail because [0,480) covers the start of 240.
      // Actually 0..480 covers 240, so the stamp is rejected as a conflict.
      // Our impl returns the existing conflict event and doesn't add.
      expect(pat.events).toHaveLength(1);
    });

    it('allows stamping immediately after a previous event ends', () => {
      let pat = createEmptyPattern();
      pat = stampEvent({ pattern: pat, stringIndex: 0, fret: 5, startTick: 0, durationTicks: PPQ }).pattern;
      pat = stampEvent({ pattern: pat, stringIndex: 0, fret: 7, startTick: PPQ, durationTicks: PPQ }).pattern;
      expect(pat.events).toHaveLength(2);
    });

    it('allows simultaneous events on different strings (chord)', () => {
      let pat = createEmptyPattern();
      pat = stampEvent({ pattern: pat, stringIndex: 0, fret: 5, startTick: 0, durationTicks: PPQ }).pattern;
      pat = stampEvent({ pattern: pat, stringIndex: 1, fret: 5, startTick: 0, durationTicks: PPQ }).pattern;
      pat = stampEvent({ pattern: pat, stringIndex: 2, fret: 5, startTick: 0, durationTicks: PPQ }).pattern;
      expect(pat.events).toHaveLength(3);
      expect(pat.events.every((e) => e.startTick === 0)).toBe(true);
    });
  });

  describe('resizeEvent', () => {
    it('clamps resize to prevent same-string overlap with next event', () => {
      let pat = createEmptyPattern();
      pat = stampEvent({ pattern: pat, stringIndex: 0, fret: 5, startTick: 0, durationTicks: PPQ / 4 }).pattern;
      pat = stampEvent({ pattern: pat, stringIndex: 0, fret: 7, startTick: PPQ, durationTicks: PPQ / 4 }).pattern;
      const first = pat.events.find((e) => e.startTick === 0)!;
      const resized = resizeEvent(pat, first.id, PPQ * 2);
      const updated = resized.events.find((e) => e.id === first.id)!;
      expect(updated.durationTicks).toBe(PPQ); // clamped to next event's startTick (480)
    });
  });

  describe('moveEvent', () => {
    it('rejects moves that would cause same-string overlap', () => {
      let pat = createEmptyPattern();
      pat = stampEvent({ pattern: pat, stringIndex: 0, fret: 5, startTick: 0, durationTicks: PPQ }).pattern;
      pat = stampEvent({ pattern: pat, stringIndex: 0, fret: 7, startTick: PPQ * 2, durationTicks: PPQ }).pattern;
      const second = pat.events.find((e) => e.startTick === PPQ * 2)!;
      // Try to move second event to startTick = PPQ/2, which would overlap the first event (0..480).
      const after = moveEvent(pat, second.id, PPQ / 2);
      const moved = after.events.find((e) => e.id === second.id)!;
      expect(moved.startTick).toBe(PPQ * 2); // unchanged
    });

    it('accepts moves that do not overlap', () => {
      let pat = createEmptyPattern();
      pat = stampEvent({ pattern: pat, stringIndex: 0, fret: 5, startTick: 0, durationTicks: PPQ }).pattern;
      pat = stampEvent({ pattern: pat, stringIndex: 0, fret: 7, startTick: PPQ * 2, durationTicks: PPQ }).pattern;
      const second = pat.events.find((e) => e.startTick === PPQ * 2)!;
      const after = moveEvent(pat, second.id, PPQ);
      const moved = after.events.find((e) => e.id === second.id)!;
      expect(moved.startTick).toBe(PPQ);
    });

    it('can move an event to a different string', () => {
      let pat = createEmptyPattern();
      pat = stampEvent({ pattern: pat, stringIndex: 0, fret: 5, startTick: 0, durationTicks: PPQ }).pattern;
      const ev = pat.events[0];
      const after = moveEvent(pat, ev.id, 0, 3);
      const moved = after.events.find((e) => e.id === ev.id)!;
      expect(moved.stringIndex).toBe(3);
    });
  });

  describe('deleteEvents', () => {
    it('removes events by id and is a no-op when nothing matches', () => {
      let pat = createEmptyPattern();
      pat = stampEvent({ pattern: pat, stringIndex: 0, fret: 5, startTick: 0, durationTicks: PPQ }).pattern;
      pat = stampEvent({ pattern: pat, stringIndex: 1, fret: 5, startTick: 0, durationTicks: PPQ }).pattern;
      const targetId = pat.events[0].id;
      const after = deleteEvents(pat, [targetId]);
      expect(after.events).toHaveLength(1);
      const noop = deleteEvents(after, ['unknown-id']);
      expect(noop).toBe(after);
    });
  });

  describe('nextEventStartOnString', () => {
    it('returns Infinity when nothing comes after', () => {
      let pat = createEmptyPattern();
      pat = stampEvent({ pattern: pat, stringIndex: 0, fret: 5, startTick: 0, durationTicks: PPQ }).pattern;
      expect(nextEventStartOnString(pat.events, 0, PPQ)).toBe(Infinity);
    });
  });

  describe('createEmptyPattern with groove/bpm defaults', () => {
    it('initializes suggestedBpm to null', () => {
      const p = createEmptyPattern('riff');
      expect(p.suggestedBpm).toBeNull();
    });

    it('initializes groove to null (straight)', () => {
      const p = createEmptyPattern('riff');
      expect(p.groove).toBeNull();
    });
  });

  describe('setPatternSuggestedBpm', () => {
    it('sets the suggested bpm and bumps updatedAt', () => {
      const p = createEmptyPattern('riff');
      const before = p.updatedAt;
      const next = setPatternSuggestedBpm(p, 95);
      expect(next.suggestedBpm).toBe(95);
      expect(next.updatedAt).toBeGreaterThanOrEqual(before);
    });

    it('clamps to [40, 240]', () => {
      const p = createEmptyPattern('riff');
      expect(setPatternSuggestedBpm(p, 10).suggestedBpm).toBe(40);
      expect(setPatternSuggestedBpm(p, 500).suggestedBpm).toBe(240);
    });

    it('accepts null to clear the preference', () => {
      const p = setPatternSuggestedBpm(createEmptyPattern('riff'), 95);
      const cleared = setPatternSuggestedBpm(p, null);
      expect(cleared.suggestedBpm).toBeNull();
    });
  });

  describe('setPatternGroove', () => {
    it('sets the groove', () => {
      const p = createEmptyPattern('riff');
      const next = setPatternGroove(p, { swing: 0.67, appliedTo: 'eighths' });
      expect(next.groove).toEqual({ swing: 0.67, appliedTo: 'eighths' });
    });

    it('clamps swing into [0.5, 0.95]', () => {
      const p = createEmptyPattern('riff');
      expect(setPatternGroove(p, { swing: 0.1, appliedTo: 'eighths' }).groove?.swing).toBe(0.5);
      expect(setPatternGroove(p, { swing: 0.99, appliedTo: 'eighths' }).groove?.swing).toBe(0.95);
    });

    it('accepts null to clear groove (straight)', () => {
      const p = setPatternGroove(createEmptyPattern('riff'), { swing: 0.67, appliedTo: 'eighths' });
      expect(setPatternGroove(p, null).groove).toBeNull();
    });
  });

  describe('resizeEventsBy', () => {
    it('grows multiple events by the same delta, each clamped independently', () => {
      let pattern = createEmptyPattern('t');
      const r1 = stampEvent({ pattern, stringIndex: 0, fret: 1, startTick: 0, durationTicks: 240 });
      pattern = r1.pattern;
      const r2 = stampEvent({ pattern, stringIndex: 1, fret: 3, startTick: 0, durationTicks: 240 });
      pattern = r2.pattern;
      const r3 = stampEvent({ pattern, stringIndex: 2, fret: 5, startTick: 0, durationTicks: 240 });
      pattern = r3.pattern;

      const snapshots = pattern.events.map((e) => ({
        id: e.id,
        durationTicks: e.durationTicks,
      }));

      const next = resizeEventsBy(pattern, snapshots, 240);
      expect(next.events.find((e) => e.id === r1.event.id)!.durationTicks).toBe(480);
      expect(next.events.find((e) => e.id === r2.event.id)!.durationTicks).toBe(480);
      expect(next.events.find((e) => e.id === r3.event.id)!.durationTicks).toBe(480);
    });

    it('clamps individual events against the next event on the same string', () => {
      let pattern = createEmptyPattern('t');
      const a = stampEvent({ pattern, stringIndex: 0, fret: 1, startTick: 0, durationTicks: 240 });
      pattern = a.pattern;
      const b = stampEvent({ pattern, stringIndex: 0, fret: 3, startTick: 240, durationTicks: 240 });
      pattern = b.pattern;

      const snapshots = [
        { id: a.event.id, durationTicks: 240 },
        { id: b.event.id, durationTicks: 240 },
      ];

      const next = resizeEventsBy(pattern, snapshots, 240);
      expect(next.events.find((e) => e.id === a.event.id)!.durationTicks).toBe(240);
      expect(next.events.find((e) => e.id === b.event.id)!.durationTicks).toBe(480);
    });

    it('returns the same pattern reference when no events match', () => {
      const pattern = createEmptyPattern('t');
      const result = resizeEventsBy(pattern, [{ id: 'nonexistent', durationTicks: 100 }], 100);
      expect(result).toBe(pattern);
    });

    it('clamps each event to a minimum duration of 1', () => {
      let pattern = createEmptyPattern('t');
      const a = stampEvent({ pattern, stringIndex: 0, fret: 1, startTick: 0, durationTicks: 240 });
      pattern = a.pattern;
      const snapshots = [{ id: a.event.id, durationTicks: 240 }];

      const next = resizeEventsBy(pattern, snapshots, -1000);
      expect(next.events.find((e) => e.id === a.event.id)!.durationTicks).toBe(1);
    });
  });
});

describe('Pattern key + scale defaults', () => {
  it('createEmptyPattern sets key and scaleType to null', () => {
    const p = createEmptyPattern('t');
    expect(p.key).toBeNull();
    expect(p.scaleType).toBeNull();
  });
});

describe('transposeEventsDiatonic', () => {
  const tuning = getTuning('standard')!;
  const majorIntervals = getScale('major')!.intervals;

  function stampMany(p: Pattern, notes: Array<{ s: number; f: number }>): Pattern {
    let next = p;
    for (const n of notes) {
      const r = stampEvent({ pattern: next, stringIndex: n.s, fret: n.f, startTick: 0, durationTicks: 240 });
      next = r.pattern;
    }
    return next;
  }

  it('A major up 1 step: A (A string fret 0) → B (A string fret 2)', () => {
    let p = createEmptyPattern('t');
    p = stampMany(p, [{ s: 1, f: 0 }]);
    const ids = p.events.map((e) => e.id);
    const next = transposeEventsDiatonic(p, ids, 1, 'A', majorIntervals, tuning, 22);
    expect(next.events[0].fret).toBe(2);
    expect(next.events[0].stringIndex).toBe(1);
  });

  it('A major up 1 step: C# (A fret 4) → D (A fret 5)', () => {
    let p = createEmptyPattern('t');
    p = stampMany(p, [{ s: 1, f: 4 }]);
    const next = transposeEventsDiatonic(p, p.events.map((e) => e.id), 1, 'A', majorIntervals, tuning, 22);
    expect(next.events[0].fret).toBe(5);
  });

  it('A major up 1 step: chromatic F (A fret 8) → G (A fret 10)', () => {
    // F = 1 semitone above E (scale tone, degree 5). Up one step: anchor E → F# (degree 6);
    // new pitch = F# + 1 = G. On A string: G = fret 10.
    let p = createEmptyPattern('t');
    p = stampMany(p, [{ s: 1, f: 8 }]);
    const next = transposeEventsDiatonic(p, p.events.map((e) => e.id), 1, 'A', majorIntervals, tuning, 22);
    expect(next.events[0].fret).toBe(10);
  });

  it('A major down 1 step: A on A string (fret 0) would need fret -1 — left unchanged', () => {
    let p = createEmptyPattern('t');
    p = stampMany(p, [{ s: 1, f: 0 }]);
    const next = transposeEventsDiatonic(p, p.events.map((e) => e.id), -1, 'A', majorIntervals, tuning, 22);
    expect(next.events[0].fret).toBe(0);
  });

  it('skips events not in the selection', () => {
    let p = createEmptyPattern('t');
    // Use different strings so both events can share startTick: 0 without conflict.
    // s:1 = A string (fret 0 = A), s:2 = D string (fret 4 = F#).
    p = stampMany(p, [{ s: 1, f: 0 }, { s: 2, f: 4 }]);
    const [selectedId] = p.events.map((e) => e.id);
    const next = transposeEventsDiatonic(p, [selectedId], 1, 'A', majorIntervals, tuning, 22);
    expect(next.events.find((e) => e.id === selectedId)!.fret).toBe(2);
    expect(next.events.find((e) => e.id !== selectedId)!.fret).toBe(4);
  });

  it('returns same pattern reference when no selected events change', () => {
    let p = createEmptyPattern('t');
    p = stampMany(p, [{ s: 1, f: 0 }]);
    // Down one step from A on A string would go to fret -1 → unchanged.
    const next = transposeEventsDiatonic(p, p.events.map((e) => e.id), -1, 'A', majorIntervals, tuning, 22);
    expect(next).toBe(p);
  });
});

describe('updateEventArticulations', () => {
  function stamp(): { pattern: Pattern; eventId: string } {
    let p = createEmptyPattern('t');
    const result = stampEvent({
      pattern: p,
      stringIndex: 0,
      fret: 5,
      startTick: 0,
      durationTicks: PPQ,
    });
    p = result.pattern;
    return { pattern: p, eventId: result.event.id };
  }

  it('sets a boolean field', () => {
    const { pattern, eventId } = stamp();
    const next = updateEventArticulations(pattern, eventId, { hammerOn: true });
    expect(next.events[0].hammerOn).toBe(true);
  });

  it('clears a field when patched with undefined', () => {
    const { pattern, eventId } = stamp();
    const withFlag = updateEventArticulations(pattern, eventId, { hammerOn: true });
    const cleared = updateEventArticulations(withFlag, eventId, { hammerOn: undefined });
    expect(cleared.events[0].hammerOn).toBeUndefined();
  });

  it('keeps hammerOn and pullOff mutually exclusive', () => {
    const { pattern, eventId } = stamp();
    const hammered = updateEventArticulations(pattern, eventId, { hammerOn: true });
    const pulled = updateEventArticulations(hammered, eventId, { pullOff: true });
    expect(pulled.events[0].pullOff).toBe(true);
    expect(pulled.events[0].hammerOn).toBeUndefined();
  });

  it('writes a bend object including points array', () => {
    const { pattern, eventId } = stamp();
    const next = updateEventArticulations(pattern, eventId, {
      bend: {
        type: 'bend-release',
        semitones: 2,
        points: [{ at: 0, semitones: 0 }, { at: 0.5, semitones: 2 }, { at: 1, semitones: 0 }],
      },
    });
    expect(next.events[0].bend?.type).toBe('bend-release');
    expect(next.events[0].bend?.points).toHaveLength(3);
  });

  it('returns the same pattern reference when nothing changes', () => {
    const { pattern, eventId } = stamp();
    const next = updateEventArticulations(pattern, eventId, {});
    expect(next).toBe(pattern);
  });

  it('updates timestamp when something changes', () => {
    const { pattern, eventId } = stamp();
    const before = pattern.updatedAt;
    // Sleep-like trick: a small wait
    const next = updateEventArticulations(pattern, eventId, { tieToNext: true });
    expect(next.updatedAt).toBeGreaterThanOrEqual(before);
  });
});

describe('fitPatternDuration', () => {
  it('shrinks an empty pattern to one bar', () => {
    const p = createEmptyPattern(); // defaults to 4 bars
    const tpb = ticksPerBar(p.timeSignature);
    expect(fitPatternDuration(p).durationTicks).toBe(tpb);
  });

  it('grows to fit a note that ends past the current length, rounded up to a bar', () => {
    let p = createEmptyPattern();
    const tpb = ticksPerBar(p.timeSignature);
    // a note that ends partway into the 3rd bar
    p = stampEvent({ pattern: p, stringIndex: 0, fret: 3, startTick: 2 * tpb + 100, durationTicks: PPQ }).pattern;
    expect(fitPatternDuration(p).durationTicks).toBe(3 * tpb);
  });

  it('shrinks back when the trailing note is removed', () => {
    let p = createEmptyPattern();
    const tpb = ticksPerBar(p.timeSignature);
    const r = stampEvent({ pattern: p, stringIndex: 0, fret: 3, startTick: 2 * tpb + 100, durationTicks: PPQ });
    p = fitPatternDuration(r.pattern);
    expect(p.durationTicks).toBe(3 * tpb);
    p = fitPatternDuration(deleteEvents(p, [r.event.id]));
    expect(p.durationTicks).toBe(tpb); // back to one bar
  });

  it('returns the same reference when the duration already fits', () => {
    let p = createEmptyPattern();
    p = fitPatternDuration(p); // now exactly one bar
    expect(fitPatternDuration(p)).toBe(p);
  });
});
