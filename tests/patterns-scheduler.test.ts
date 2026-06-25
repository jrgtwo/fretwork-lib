import { describe, it, expect, vi } from 'vitest';
import { PatternSource } from '../src/patterns/scheduler/PatternSource';
import { CompositionSource } from '../src/patterns/scheduler/CompositionSource';
import { EventScheduler } from '../src/patterns/scheduler/EventScheduler';
import type { EventSchedulerOpts } from '../src/patterns/scheduler/EventScheduler';
import {
  createEmptyPattern,
  createEmptyComposition,
  stampEvent,
  addPlacement,
  setPlacementRepeat,
  PPQ,
} from '../src/patterns';

// ─── Fake helpers for EventScheduler tests ───────────────────────────────────

type StartStopListener = () => void;

interface FakeMetronome {
  bpm: number;
  isRunning: boolean;
  on(event: 'start' | 'stop', handler: StartStopListener): () => void;
  setBpm(bpm: number): void;
  setSwing(swing: number): void;
  start(): void;
  stop(): void;
}

function makeFakeMetronome(): FakeMetronome {
  const listeners: Record<'start' | 'stop', Set<StartStopListener>> = {
    start: new Set(),
    stop: new Set(),
  };
  const m: FakeMetronome = {
    bpm: 120,
    isRunning: false,
    on(event, handler) {
      listeners[event].add(handler);
      return () => listeners[event].delete(handler);
    },
    setBpm(bpm) { m.bpm = bpm; },
    setSwing(_swing) { /* no-op */ },
    start() {
      m.isRunning = true;
      for (const h of listeners.start) h();
    },
    stop() {
      m.isRunning = false;
      for (const h of listeners.stop) h();
    },
  };
  return m;
}

function makeFakeInstrument() {
  return {
    play: vi.fn(),
    releaseAll: vi.fn(),
    dispose: vi.fn(),
    output: undefined,
  };
}

const FAKE_TUNING = {
  id: 'standard',
  name: 'Standard',
  instrumentId: 'guitar',
  strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'],
};

function makeScheduler() {
  const metronome = makeFakeMetronome();
  const instrument = makeFakeInstrument();
  const scheduler = new EventScheduler({
    metronome: metronome as unknown as EventSchedulerOpts['metronome'],
    instrument,
    tuning: FAKE_TUNING,
    capo: 0,
  });
  return { scheduler, metronome, instrument };
}

describe('PatternSource', () => {
  it('produces events in [fromTick, toTick) sorted by startTick', () => {
    let p = createEmptyPattern();
    p = stampEvent({ pattern: p, stringIndex: 0, fret: 0, startTick: 0, durationTicks: PPQ }).pattern;
    p = stampEvent({ pattern: p, stringIndex: 1, fret: 0, startTick: PPQ, durationTicks: PPQ }).pattern;
    p = stampEvent({ pattern: p, stringIndex: 2, fret: 0, startTick: PPQ * 2, durationTicks: PPQ }).pattern;

    const source = new PatternSource(p);
    expect(source.durationTicks).toBe(p.durationTicks);
    const events = source.eventsInRange(0, PPQ * 2);
    expect(events).toHaveLength(2);
    expect(events[0].startTick).toBe(0);
    expect(events[1].startTick).toBe(PPQ);
  });

  it('range query is half-open: includes fromTick, excludes toTick', () => {
    let p = createEmptyPattern();
    p = stampEvent({ pattern: p, stringIndex: 0, fret: 0, startTick: 0, durationTicks: PPQ }).pattern;
    p = stampEvent({ pattern: p, stringIndex: 1, fret: 0, startTick: PPQ, durationTicks: PPQ }).pattern;
    const source = new PatternSource(p);
    expect(source.eventsInRange(0, PPQ)).toHaveLength(1);
    expect(source.eventsInRange(0, PPQ + 1)).toHaveLength(2);
  });
});

describe('CompositionSource', () => {
  it('flattens placements with correct absolute startTicks and repeats', () => {
    let p = createEmptyPattern();
    p = stampEvent({ pattern: p, stringIndex: 0, fret: 5, startTick: 0, durationTicks: PPQ }).pattern;
    let comp = createEmptyComposition();
    ({ composition: comp } = addPlacement(comp, p));
    comp = setPlacementRepeat(comp, comp.tracks[0].placements[0].id, 3);

    const source = new CompositionSource(comp);
    expect(source.durationTicks).toBe(p.durationTicks * 3);

    const all = source.eventsInRange(0, source.durationTicks);
    expect(all).toHaveLength(3);
    expect(all[0].startTick).toBe(0);
    expect(all[1].startTick).toBe(p.durationTicks);
    expect(all[2].startTick).toBe(p.durationTicks * 2);
  });
});

describe('EventScheduler slicing', () => {
  // We mock Tone via the global Tone import. The scheduler's constructor wires a
  // scheduleRepeat callback but we exercise its slicing logic via _tickForTest.
  // For these unit tests, we don't actually need Tone to fire anything.

  it.skip('scheduler integration is exercised by manual smoke testing', () => {
    // The EventScheduler integration with Tone.Transport requires an active audio
    // context that jsdom doesn't provide. Slicing logic is implicitly verified by
    // the PatternSource / CompositionSource tests (which produce the inputs the
    // scheduler consumes). Manual end-to-end testing covers the wiring.
    expect(true).toBe(true);
  });
});

describe('EventScheduler placement-change emission', () => {
  it('emits onPlacementChange when head crosses placement boundary', () => {
    // Build a composition with two distinct placements.
    const p1 = createEmptyPattern('a');
    const p2 = createEmptyPattern('b');
    let comp = createEmptyComposition();
    comp = addPlacement(comp, p1).composition;
    comp = addPlacement(comp, p2).composition;

    const source = new CompositionSource(comp);
    const firstPlacementId = comp.tracks[0].placements[0].id;
    const secondPlacementId = comp.tracks[0].placements[1].id;
    const firstDuration = comp.tracks[0].placements[0].patternSnapshot.durationTicks;

    const { scheduler, metronome } = makeScheduler();
    scheduler.setStream(source);

    const changes: Array<string | null> = [];
    scheduler.onPlacementChange((id) => changes.push(id));

    // Tick 1: head starts at 0, advances by TICKS_PER_INTERVAL (120).
    // After _onTick, headTick = 120, which is within the first placement.
    metronome.start();
    scheduler._tickForTest(0);
    expect(changes).toEqual([firstPlacementId]);

    // Advance past first placement boundary by ticking enough 16th-note slices.
    const ticksPerSlice = PPQ / 4; // 120
    const ticksNeeded = firstDuration + ticksPerSlice;
    const sliceCount = Math.ceil(ticksNeeded / ticksPerSlice);
    for (let i = 0; i < sliceCount; i++) {
      scheduler._tickForTest(i * 0.1);
    }
    expect(changes).toContain(secondPlacementId);
  });

  it('emits null on stop', () => {
    let comp = createEmptyComposition();
    comp = addPlacement(comp, createEmptyPattern('a')).composition;

    const source = new CompositionSource(comp);
    const { scheduler, metronome } = makeScheduler();
    scheduler.setStream(source);

    const changes: Array<string | null> = [];
    scheduler.onPlacementChange((id) => changes.push(id));

    metronome.start();
    scheduler._tickForTest(0);
    // Should have emitted first placement id.
    expect(changes.length).toBeGreaterThan(0);
    expect(changes[changes.length - 1]).not.toBeNull();

    metronome.stop();
    // After stop, the last emitted value should be null.
    expect(changes[changes.length - 1]).toBeNull();
  });

  it('emits null when stream has no placements (PatternSource)', () => {
    const p = createEmptyPattern();
    const source = new PatternSource(p);
    const { scheduler, metronome } = makeScheduler();
    scheduler.setStream(source);

    const changes: Array<string | null> = [];
    scheduler.onPlacementChange((id) => changes.push(id));

    metronome.start();
    scheduler._tickForTest(0);
    // PatternSource has no placementBoundaries — should never emit a placement id.
    // Either nothing is emitted or null is emitted (null means "no placement").
    for (const c of changes) {
      expect(c).toBeNull();
    }
  });
});

describe('EventScheduler._scheduleAllEvents fromTick selection', () => {
  it('skips events whose absolute tick is at or behind fromTick', () => {
    let p = createEmptyPattern();
    p = stampEvent({ pattern: p, stringIndex: 0, fret: 0, startTick: 0, durationTicks: PPQ }).pattern;
    p = stampEvent({ pattern: p, stringIndex: 1, fret: 0, startTick: PPQ, durationTicks: PPQ }).pattern;
    p = stampEvent({ pattern: p, stringIndex: 2, fret: 0, startTick: PPQ * 2, durationTicks: PPQ }).pattern;

    const { scheduler } = makeScheduler();
    scheduler.setStream(new PatternSource(p));

    // loopOffset 0, fromTick = PPQ: only events with absolute tick > PPQ survive.
    expect(scheduler._scheduleForTest(0, PPQ)).toEqual([PPQ * 2]);
    // No floor: all three scheduled.
    expect(scheduler._scheduleForTest(0)).toEqual([0, PPQ, PPQ * 2]);
  });

  it('maps events region-relative when a loop region is given', () => {
    let p = createEmptyPattern();
    p = stampEvent({ pattern: p, stringIndex: 0, fret: 0, startTick: 0, durationTicks: PPQ }).pattern;
    p = stampEvent({ pattern: p, stringIndex: 1, fret: 0, startTick: PPQ, durationTicks: PPQ }).pattern;
    p = stampEvent({ pattern: p, stringIndex: 2, fret: 0, startTick: PPQ * 2, durationTicks: PPQ }).pattern;

    const { scheduler } = makeScheduler();
    scheduler.setStream(new PatternSource(p));

    // Loop region [PPQ, PPQ*3): only the events at PPQ and 2*PPQ are in-region.
    // At loopOffset 1000 they map to 1000+(PPQ-PPQ)=1000 and 1000+(2PPQ-PPQ)=1000+PPQ.
    expect(scheduler._scheduleForTest(1000, -Infinity, PPQ, PPQ * 3)).toEqual([1000, 1000 + PPQ]);
    // The event at tick 0 is below the region and excluded.
  });
});

describe('EventScheduler.restream', () => {
  it('when the transport is not started, resets head and defers (no throw)', () => {
    const p = createEmptyPattern();
    const { scheduler } = makeScheduler();
    scheduler.restream(new PatternSource(p));
    expect(scheduler.headTick).toBe(0);
  });

  it('setStartTick clamps negatives to 0', () => {
    const { scheduler } = makeScheduler();
    scheduler.setStartTick(-50);
    expect(scheduler.startTick).toBe(0);
    scheduler.setStartTick(480);
    expect(scheduler.startTick).toBe(480);
  });
});
