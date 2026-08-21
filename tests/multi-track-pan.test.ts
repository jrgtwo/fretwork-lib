/**
 * Per-track pan through the real `MultiTrackPlayback` wiring (CP-19).
 *
 * The op and the diff are covered as pure functions elsewhere; what those
 * cannot see is whether the value ever reaches an audio node. This project has
 * a documented history of audio-wiring defects that only a reader caught —
 * a control that writes a value nothing is listening to looks identical from
 * the store's side. So this mocks Tone at the module boundary and asserts on
 * the graph: what got connected to what, and what each Panner was told.
 *
 * Everything below the manager (EventScheduler, CompositionTrackSource,
 * MasterBus, the Voice) is stubbed — none of it is under test here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => {
  interface FakeParam { value: number; ramps: number[] }
  interface FakeNode { id: string; connectedTo: string[]; disposed: boolean }
  const nodes: FakeNode[] = [];
  const panners: (FakeNode & { pan: FakeParam })[] = [];
  const gains: (FakeNode & { gain: FakeParam })[] = [];
  return { nodes, panners, gains };
});

vi.mock('tone', () => {
  let seq = 0;
  const param = () => {
    const p = { value: 0, ramps: [] as number[] };
    return {
      get value() { return p.value; },
      set value(v: number) { p.value = v; },
      ramps: p.ramps,
      rampTo(v: number) { p.value = v; p.ramps.push(v); },
      cancelScheduledValues() {},
      setValueAtTime() {},
      linearRampToValueAtTime() {},
    };
  };
  class MockNode {
    id = `n${seq++}`;
    connectedTo: string[] = [];
    disposed = false;
    connect(target: MockNode) { this.connectedTo.push(target.id); return this; }
    disconnect() {}
    dispose() { this.disposed = true; }
    toDestination() { return this; }
  }
  class Gain extends MockNode {
    gain = param();
    constructor(initial = 1) { super(); this.gain.value = initial; hoisted.gains.push(this as never); hoisted.nodes.push(this as never); }
  }
  class Panner extends MockNode {
    pan = param();
    constructor(initial = 0) { super(); this.pan.value = initial; hoisted.panners.push(this as never); hoisted.nodes.push(this as never); }
  }
  return {
    Gain,
    Panner,
    getTransport: () => ({ ticks: 0, bpm: { value: 120 }, scheduleOnce: () => 0, clear: () => {} }),
    getContext: () => ({ lookAhead: 0 }),
    now: () => 0,
    Frequency: () => ({ toFrequency: () => 440 }),
  };
});

vi.mock('../src/playback/voices/MasterBus', () => ({
  MasterBus: { connectVoice: () => {}, disconnectVoice: () => {} },
}));

vi.mock('../src/patterns/scheduler/EventScheduler', () => ({
  EventScheduler: class {
    setStream() {}
    restream() {}
    setInstrument() {}
    dispose() {}
  },
}));

vi.mock('../src/patterns/scheduler/CompositionTrackSource', () => ({
  CompositionTrackSource: class {},
}));

import { MultiTrackPlayback } from '../src/patterns/scheduler/MultiTrackPlayback';
import { createEmptyComposition, createEmptyPattern, addPlacement, addTrack, setTrackPan } from '../src/patterns';
import type { Composition } from '../src/patterns';

function twoTrackComp(): Composition {
  const one = addPlacement(createEmptyComposition('c'), createEmptyPattern()).composition;
  return addTrack(one, 'Track 2');
}

function build(comp: Composition) {
  return new MultiTrackPlayback({
    composition: comp,
    metronome: {} as never,
    tuning: { name: 'standard', strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] } as never,
    capo: 0,
    buildVoice: () => ({
      play: () => {},
      releaseAll: () => {},
      setRoutingTarget: () => {},
      ensureBuilt: () => {},
      dispose: () => {},
    }) as never,
  });
}

beforeEach(() => {
  hoisted.nodes.length = 0;
  hoisted.panners.length = 0;
  hoisted.gains.length = 0;
});

describe('MultiTrackPlayback — per-track pan', () => {
  it('gives every track a panner, downstream of its gain', () => {
    const mtp = build(twoTrackComp());
    // One panner per track. The master node is a Gain, so it isn't in here.
    expect(hoisted.panners).toHaveLength(2);
    // Each track gain feeds a panner, not the master directly — the assertion
    // that would fail if the panner were built but never inserted.
    const pannerIds = hoisted.panners.map((p) => p.id);
    const trackGains = hoisted.gains.filter((g) => g.connectedTo.some((id) => pannerIds.includes(id)));
    expect(trackGains).toHaveLength(2);
    mtp.dispose();
  });

  it('applies a stored pan when playback is built', () => {
    let comp = twoTrackComp();
    comp = setTrackPan(comp, comp.tracks[0].id, -0.75);
    const mtp = build(comp);
    expect(hoisted.panners[0].pan.value).toBe(-0.75);
    expect(hoisted.panners[1].pan.value).toBe(0);
    mtp.dispose();
  });

  it('ramps rather than steps, so a drag does not zipper', () => {
    const comp = twoTrackComp();
    const mtp = build(comp);
    hoisted.panners[0].pan.ramps.length = 0;
    mtp.updateComposition(setTrackPan(comp, comp.tracks[0].id, 1));
    expect(hoisted.panners[0].pan.ramps).toContain(1);
    mtp.dispose();
  });

  it('centres a track persisted before pan existed rather than passing undefined to the node', () => {
    const comp = twoTrackComp();
    // A track off disk from before CP-19: the field is absent entirely, and
    // `migrateCompositionToTracks` returns a populated composition UNCHANGED,
    // so nothing backfills it.
    const legacy = {
      ...comp,
      tracks: comp.tracks.map((t) => {
        const { pan: _pan, ...rest } = t;
        return rest;
      }),
    } as Composition;
    const mtp = build(legacy);
    expect(hoisted.panners[0].pan.value).toBe(0);
    expect(Number.isNaN(hoisted.panners[0].pan.value)).toBe(false);
    mtp.dispose();
  });

  it('disposes every panner it built', () => {
    const mtp = build(twoTrackComp());
    mtp.dispose();
    expect(hoisted.panners.every((p) => p.disposed)).toBe(true);
  });
});
