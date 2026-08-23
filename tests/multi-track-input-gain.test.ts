/**
 * Per-track input gain, through the real `MultiTrackPlayback` wiring.
 *
 * The op and the diff are pure and covered below on their own. What neither can
 * see is whether the value ever reaches the VOICE — and that is the whole defect
 * this field exists to close, so it is the part worth asserting on. A control
 * that writes a number nothing listens to looks identical from the model's side.
 *
 * Everything under the manager is stubbed; none of it is under test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => {
  const inputGainCalls: (number | undefined)[] = [];
  const voicesBuilt: { calls: (number | undefined)[] }[] = [];
  return { inputGainCalls, voicesBuilt };
});

vi.mock('tone', () => {
  const param = () => ({
    value: 0,
    rampTo(v: number) {
      this.value = v;
    },
    cancelScheduledValues() {},
    setValueAtTime() {},
    linearRampToValueAtTime() {},
  });
  class MockNode {
    connect() {
      return this;
    }
    disconnect() {}
    dispose() {}
    toDestination() {
      return this;
    }
  }
  class Gain extends MockNode {
    gain = param();
  }
  class Panner extends MockNode {
    pan = param();
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
    setTuning() {}
    setLoop() {}
    setLoopRegion() {}
    dispose() {}
  },
}));

vi.mock('../src/patterns/scheduler/CompositionTrackSource', () => ({
  CompositionTrackSource: class {},
}));

import { MultiTrackPlayback } from '../src/patterns/scheduler/MultiTrackPlayback';
import {
  createEmptyComposition,
  createEmptyPattern,
  addPlacement,
  addTrack,
  setTrackInputGainDb,
  setTrackVolumeDb,
  TRACK_INPUT_GAIN_RANGE_DB,
} from '../src/patterns';
import { diffTracks } from '../src/patterns/scheduler/track-diff';
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
    buildVoice: () => {
      const record = { calls: [] as (number | undefined)[] };
      hoisted.voicesBuilt.push(record);
      return {
        play: () => {},
        releaseAll: () => {},
        setRoutingTarget: () => {},
        ensureBuilt: () => {},
        dispose: () => {},
        updateInputGain: (db: number | undefined) => {
          record.calls.push(db);
          hoisted.inputGainCalls.push(db);
        },
      } as never;
    },
  });
}

beforeEach(() => {
  hoisted.inputGainCalls.length = 0;
  hoisted.voicesBuilt.length = 0;
});

describe('MultiTrackPlayback — per-track input gain', () => {
  it('pushes a stored input gain into the voice when playback is built', () => {
    let comp = twoTrackComp();
    comp = setTrackInputGainDb(comp, comp.tracks[0].id, -18);

    const mtp = build(comp);

    expect(hoisted.voicesBuilt[0].calls).toContain(-18);
    mtp.dispose();
  });

  it('passes UNDEFINED through for a track that has never set one', () => {
    const mtp = build(twoTrackComp());

    // Not `?? 0`. Undefined means "the preset decides"; 0 means "unity, whatever
    // the preset said". Coercing here would silently override every preset's own
    // input level with unity on every track that had never been touched.
    expect(hoisted.voicesBuilt[0].calls).toEqual([undefined]);
    mtp.dispose();
  });

  it('pushes a live change without rebuilding the voice', () => {
    const comp = twoTrackComp();
    const mtp = build(comp);
    const voicesAtStart = hoisted.voicesBuilt.length;

    mtp.updateComposition(setTrackInputGainDb(comp, comp.tracks[0].id, -9));

    expect(hoisted.voicesBuilt[0].calls).toContain(-9);
    // A rebuild would reload the sampler's banks and cut every note still
    // ringing — for a fader move.
    expect(hoisted.voicesBuilt).toHaveLength(voicesAtStart);
    mtp.dispose();
  });

  it('re-applies the track’s value after the voice is swapped', () => {
    let comp = twoTrackComp();
    comp = setTrackInputGainDb(comp, comp.tracks[0].id, -24);
    const mtp = build(comp);

    mtp.setTrackVoice(comp.tracks[0].id);

    // The replacement voice starts at its PRESET's input gain. Without putting
    // the track's value back, changing the amp silently resets the input level
    // — the exact defect this field exists to fix, at the moment the user is
    // most likely to hit it.
    const replacement = hoisted.voicesBuilt[hoisted.voicesBuilt.length - 1];
    expect(replacement.calls).toContain(-24);
    mtp.dispose();
  });

  it('does not fall over on an instrument that has no updateInputGain', () => {
    let comp = twoTrackComp();
    comp = setTrackInputGainDb(comp, comp.tracks[0].id, -12);

    expect(() =>
      new MultiTrackPlayback({
        composition: comp,
        metronome: {} as never,
        tuning: { name: 'standard', strings: ['E2'] } as never,
        capo: 0,
        buildVoice: () =>
          ({
            play: () => {},
            releaseAll: () => {},
            setRoutingTarget: () => {},
            ensureBuilt: () => {},
            dispose: () => {},
          }) as never,
      }).dispose(),
    ).not.toThrow();
  });
});

describe('setTrackInputGainDb', () => {
  it('clamps to the voice’s own range', () => {
    const comp = twoTrackComp();
    const id = comp.tracks[0].id;

    expect(setTrackInputGainDb(comp, id, 999).tracks[0].inputGainDb).toBe(
      TRACK_INPUT_GAIN_RANGE_DB.max,
    );
    expect(setTrackInputGainDb(comp, id, -999).tracks[0].inputGainDb).toBe(
      TRACK_INPUT_GAIN_RANGE_DB.min,
    );
  });

  it('collapses a non-finite value to unity rather than passing NaN on', () => {
    const comp = twoTrackComp();

    // A NaN reaching a gain node is silent and never recovers.
    expect(setTrackInputGainDb(comp, comp.tracks[0].id, NaN).tracks[0].inputGainDb).toBe(0);
  });

  it('leaves the other tracks alone', () => {
    const comp = twoTrackComp();
    const next = setTrackInputGainDb(comp, comp.tracks[0].id, -30);

    expect(next.tracks[1].inputGainDb).toBeUndefined();
  });
});

describe('diffTracks — input gain', () => {
  it('classifies an input-gain change as a gain-state change, not a voice rebuild', () => {
    const comp = twoTrackComp();
    const next = setTrackInputGainDb(comp, comp.tracks[0].id, -6);

    expect(diffTracks(comp, next)[0].action).toBe('gain');
  });

  it('reports no change for a track that never had one', () => {
    const comp = twoTrackComp();

    // `?? 0` on both sides — a composition loaded from before this field existed
    // must not bill a gain op for every track on its first update.
    expect(diffTracks(comp, { ...comp }).every((d) => d.action === 'none')).toBe(true);
  });

  it('still reports a plain volume change, so the buckets have not been confused', () => {
    const comp = twoTrackComp();
    const next = setTrackVolumeDb(comp, comp.tracks[0].id, -6);

    expect(diffTracks(comp, next)[0].action).toBe('gain');
  });
});
