import { describe, it, expect } from 'vitest';
import {
  createEmptyComposition,
  createEmptyPattern,
  addPlacementToTrack,
  resizePlacement,
  setPlacementRepeat,
  mergeTrackPlacementsAutomation,
  PPQ,
} from '../src/patterns';
import type { Composition, Pattern, TempoEvent, TimeSignatureEvent, Track } from '../src/patterns';

/** Test-helper: build a pattern with explicit automation tracks. The
 *  baseline pattern has no tempoTrack / tsTrack, suggestedBpm 120, 4/4. */
function pat(opts: {
  name?: string;
  suggestedBpm?: number | null;
  ts?: { numerator: number; denominator: number };
  tempoTrack?: TempoEvent[];
  tsTrack?: TimeSignatureEvent[];
  durationTicks?: number;
} = {}): Pattern {
  const base = createEmptyPattern(opts.name ?? 'p');
  base.suggestedBpm = opts.suggestedBpm === undefined ? 120 : opts.suggestedBpm;
  if (opts.ts) base.timeSignature = { ...opts.ts };
  base.tempoTrack = opts.tempoTrack ?? [];
  base.timeSignatureTrack = opts.tsTrack ?? [];
  if (opts.durationTicks !== undefined) base.durationTicks = opts.durationTicks;
  return base;
}

/** Helper: assemble a single-track composition where the lone track holds
 *  the given patterns back-to-back. Returns the track for direct inspection. */
function trackOf(patterns: Pattern[]): { track: Track; composition: Composition } {
  let comp = createEmptyComposition();
  for (const p of patterns) {
    const r = addPlacementToTrack(comp, comp.tracks[0].id, p);
    comp = r.composition;
  }
  return { track: comp.tracks[0], composition: comp };
}

describe('mergeTrackPlacementsAutomation', () => {
  it('returns empty arrays for an empty track', () => {
    const { track } = trackOf([]);
    const out = mergeTrackPlacementsAutomation(track);
    expect(out.tempoEvents).toEqual([]);
    expect(out.tsEvents).toEqual([]);
  });

  it('synthesizes a leading boundary event from each pattern\'s static values', () => {
    const a = pat({ suggestedBpm: 100, ts: { numerator: 4, denominator: 4 }, durationTicks: PPQ * 4 });
    const b = pat({ suggestedBpm: 140, ts: { numerator: 3, denominator: 4 }, durationTicks: PPQ * 4 });
    const { track } = trackOf([a, b]);
    const out = mergeTrackPlacementsAutomation(track);
    // a at startTick 0 → 100 bpm + 4/4. b at startTick PPQ*4 → 140 bpm + 3/4.
    expect(out.tempoEvents).toEqual([
      { atTick: 0, bpm: 100, interpolation: 'step' },
      { atTick: PPQ * 4, bpm: 140, interpolation: 'step' },
    ]);
    expect(out.tsEvents).toEqual([
      { atTick: 0, numerator: 4, denominator: 4 },
      { atTick: PPQ * 4, numerator: 3, denominator: 4 },
    ]);
  });

  it('offsets pattern automation events into composition-tick space', () => {
    const a = pat({
      suggestedBpm: 120,
      durationTicks: PPQ * 4,
      tempoTrack: [
        { atTick: 0, bpm: 120, interpolation: 'step' },
        { atTick: PPQ * 2, bpm: 90, interpolation: 'linear' },
      ],
    });
    const b = pat({ suggestedBpm: 120, durationTicks: PPQ * 4 });
    const { track } = trackOf([a, b]);
    const out = mergeTrackPlacementsAutomation(track);
    // a contributes its in-pattern events at composition ticks (0, PPQ*2).
    // b contributes a single boundary event at PPQ*4 (its suggestedBpm).
    expect(out.tempoEvents).toEqual([
      { atTick: 0, bpm: 120, interpolation: 'step' },
      { atTick: PPQ * 2, bpm: 90, interpolation: 'linear' },
      { atTick: PPQ * 4, bpm: 120, interpolation: 'step' },
    ]);
  });

  it('suppresses the synthesized leader when pattern.tempoTrack[0] is at atTick 0', () => {
    // If the pattern's own automation already covers the boundary tick,
    // we shouldn't emit a redundant leader at the same spot.
    const a = pat({
      suggestedBpm: 200, // would-be leader, but tempoTrack[0] takes the boundary slot
      durationTicks: PPQ * 4,
      tempoTrack: [{ atTick: 0, bpm: 110, interpolation: 'step' }],
    });
    const { track } = trackOf([a]);
    const out = mergeTrackPlacementsAutomation(track);
    expect(out.tempoEvents).toEqual([{ atTick: 0, bpm: 110, interpolation: 'step' }]);
  });

  it('expands repeat across cycles', () => {
    const a = pat({
      suggestedBpm: 100,
      durationTicks: PPQ * 4,
      tempoTrack: [{ atTick: PPQ, bpm: 130, interpolation: 'step' }],
    });
    let comp = createEmptyComposition();
    const trackId = comp.tracks[0].id;
    const r = addPlacementToTrack(comp, trackId, a);
    comp = r.composition;
    comp = setPlacementRepeat(comp, r.placement!.id, 3);
    const out = mergeTrackPlacementsAutomation(comp.tracks[0]);
    // Three cycles, each contributing a leader (100 bpm) at the cycle base
    // and the in-pattern event (130 bpm) at cycleBase + PPQ.
    expect(out.tempoEvents).toEqual([
      { atTick: 0, bpm: 100, interpolation: 'step' },
      { atTick: PPQ, bpm: 130, interpolation: 'step' },
      { atTick: PPQ * 4, bpm: 100, interpolation: 'step' },
      { atTick: PPQ * 4 + PPQ, bpm: 130, interpolation: 'step' },
      { atTick: PPQ * 8, bpm: 100, interpolation: 'step' },
      { atTick: PPQ * 8 + PPQ, bpm: 130, interpolation: 'step' },
    ]);
  });

  it('drops events past placement.lengthTicks truncation', () => {
    const a = pat({
      suggestedBpm: 100,
      durationTicks: PPQ * 8,
      tempoTrack: [
        { atTick: 0, bpm: 100, interpolation: 'step' },
        { atTick: PPQ * 2, bpm: 130, interpolation: 'step' },
        // This event is past the truncation we're about to apply (PPQ*4).
        { atTick: PPQ * 6, bpm: 90, interpolation: 'step' },
      ],
    });
    let comp = createEmptyComposition();
    const trackId = comp.tracks[0].id;
    const r = addPlacementToTrack(comp, trackId, a);
    comp = r.composition;
    comp = resizePlacement(comp, r.placement!.id, PPQ * 4);
    const out = mergeTrackPlacementsAutomation(comp.tracks[0]);
    // Only the first two events survive.
    expect(out.tempoEvents).toEqual([
      { atTick: 0, bpm: 100, interpolation: 'step' },
      { atTick: PPQ * 2, bpm: 130, interpolation: 'step' },
    ]);
  });

  it('skips the synthesized leader when pattern has no suggestedBpm', () => {
    // A pattern with suggestedBpm: null and no automation contributes nothing
    // → tempo lingers from prior placement.
    const a = pat({ suggestedBpm: 100, durationTicks: PPQ * 4 });
    const b = pat({ suggestedBpm: null, durationTicks: PPQ * 4 });
    const { track } = trackOf([a, b]);
    const out = mergeTrackPlacementsAutomation(track);
    expect(out.tempoEvents).toEqual([
      { atTick: 0, bpm: 100, interpolation: 'step' },
      // No boundary event for `b` — its tempo intentionally inherits.
    ]);
  });

  it('TS leader is always emitted (patterns always have a static timeSignature)', () => {
    const a = pat({ ts: { numerator: 4, denominator: 4 }, durationTicks: PPQ * 4 });
    const b = pat({ ts: { numerator: 6, denominator: 8 }, durationTicks: PPQ * 4 });
    const { track } = trackOf([a, b]);
    const out = mergeTrackPlacementsAutomation(track);
    expect(out.tsEvents).toEqual([
      { atTick: 0, numerator: 4, denominator: 4 },
      { atTick: PPQ * 4, numerator: 6, denominator: 8 },
    ]);
  });

  it('TS leader is suppressed when pattern.timeSignatureTrack[0] is at atTick 0', () => {
    const a = pat({
      ts: { numerator: 4, denominator: 4 },
      durationTicks: PPQ * 4,
      tsTrack: [{ atTick: 0, numerator: 7, denominator: 8 }],
    });
    const { track } = trackOf([a]);
    const out = mergeTrackPlacementsAutomation(track);
    expect(out.tsEvents).toEqual([{ atTick: 0, numerator: 7, denominator: 8 }]);
  });

  it('sorts events chronologically (stable for ties)', () => {
    // Two placements meeting at the same boundary: the trailing
    // tempoTrack event of A would land at the same tick as the leader
    // of B. The merger sorts and the result is a clean ascending series.
    const a = pat({
      suggestedBpm: 100,
      durationTicks: PPQ * 4,
      // No tempo event at atTick === effLen (those are dropped); use one
      // just before so we get adjacent ticks 1919 and 1920.
      tempoTrack: [{ atTick: PPQ * 4 - 1, bpm: 95, interpolation: 'step' }],
    });
    const b = pat({ suggestedBpm: 130, durationTicks: PPQ * 4 });
    const { track } = trackOf([a, b]);
    const out = mergeTrackPlacementsAutomation(track);
    const ticks = out.tempoEvents.map((e) => e.atTick);
    const sorted = [...ticks].sort((x, y) => x - y);
    expect(ticks).toEqual(sorted);
  });
});
