/**
 * The manager's side of the per-track debug line (AF-01).
 *
 * The tap itself is a `Tone.Meter` connected to a node — there is nothing to
 * test about it in jsdom that would not just be testing Tone. What CAN fail
 * silently, and what this file holds, is everything around it:
 *
 *  - a voice that has no meters at all (a test double, a bare PluckSynth) must
 *    read as silence rather than throw or report a plausible zero,
 *  - the post-fader figure must actually include the fader — the arithmetic is
 *    the only reason that number is not just a duplicate of `out`,
 *  - a disposed engine must stop being polled, or the debug line holds voices
 *    that no longer exist,
 *
 * The line's own formatting and peak-holding live in
 * `audio-debug-track-line.test.ts`, which cannot share a file with this one:
 * these tests mock `audio-debug` away to capture what the manager hands it.
 *
 * Everything under the manager is stubbed; none of it is under test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  registered: [] as (null | (() => readonly unknown[]))[],
}));

vi.mock('tone', () => {
  const param = () => ({
    value: 1,
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
  MasterBus: { connectVoice: () => {}, disconnectVoice: () => {}, getOutputPeakDb: () => -12 },
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

vi.mock('../src/playback/audio-debug', () => ({
  noteTriggered: () => {},
  registerTrackLevelSource: (s: null | (() => readonly unknown[])) => {
    hoisted.registered.push(s);
  },
}));

import { MultiTrackPlayback } from '../src/patterns/scheduler/MultiTrackPlayback';
import type { TrackLevels } from '../src/playback/audio-debug';
import {
  createEmptyComposition,
  createEmptyPattern,
  addPlacement,
  setTrackVolumeDb,
  setTrackMuted,
} from '../src/patterns';
import type { Composition } from '../src/patterns';

interface VoiceStub {
  getInputLevelDb?: () => number;
  getDriveLevelDb?: () => number;
  getOutputLevelDb?: () => number;
}

function oneTrackComp(): Composition {
  return addPlacement(createEmptyComposition('c'), createEmptyPattern()).composition;
}

function build(comp: Composition, meters: VoiceStub) {
  return new MultiTrackPlayback({
    composition: comp,
    metronome: {} as never,
    tuning: { name: 'standard', strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] } as never,
    capo: 0,
    buildVoice: () =>
      ({
        play: () => {},
        releaseAll: () => {},
        setRoutingTarget: () => {},
        ensureBuilt: () => {},
        dispose: () => {},
        ...meters,
      }) as never,
  });
}

/** The source the manager handed to `audio-debug`, called once. */
function readLevels(): readonly TrackLevels[] {
  const source = hoisted.registered.filter(Boolean).at(-1);
  if (!source) throw new Error('no track level source was registered');
  return source() as readonly TrackLevels[];
}

beforeEach(() => {
  hoisted.registered.length = 0;
});

describe('MultiTrackPlayback — the debug level source', () => {
  it('reports all four taps for a track', () => {
    const mtp = build(oneTrackComp(), {
      getInputLevelDb: () => -14,
      getDriveLevelDb: () => -3,
      getOutputLevelDb: () => -9,
    });

    const [level] = readLevels();
    expect(level.inDb).toBe(-14);
    expect(level.driveDb).toBe(-3);
    expect(level.outDb).toBe(-9);
    mtp.dispose();
  });

  it('adds the track fader to the output tap, read off the gain node', () => {
    // The voice's taps are INSIDE the voice and the fader is outside it, so the
    // measured output cannot see it. One linear gain in between means adding its
    // value in dB is exact, not an approximation — and reading the NODE rather
    // than the Track means a mid-ramp fader reports where it actually is.
    let comp = oneTrackComp();
    comp = setTrackVolumeDb(comp, comp.tracks[0].id, -6);
    const mtp = build(comp, {
      getInputLevelDb: () => -14,
      getDriveLevelDb: () => -3,
      getOutputLevelDb: () => -9,
    });

    const [level] = readLevels();
    expect(level.outDb).toBe(-9);
    expect(level.faderDb).toBeCloseTo(-15, 4);
    mtp.dispose();
  });

  it('a muted track reads -80 dB below its output tap, not silence', () => {
    // The lib mutes to a FINITE `NEG_INF_GAIN = 0.0001`. A muted track really
    // does still pass -80 dB, and a debug line that rounded that to silence
    // would tell a more comfortable story than the audio does.
    let comp = oneTrackComp();
    comp = setTrackMuted(comp, comp.tracks[0].id, true);
    const mtp = build(comp, { getOutputLevelDb: () => -9 });

    const [level] = readLevels();
    expect(level.faderDb).toBeCloseTo(-89, 0);
    mtp.dispose();
  });

  it('a voice with no meters reads as silence rather than zero', () => {
    // A bare PluckSynth or a test double is a valid instrument. `-Infinity` says
    // "there is no tap here"; 0 would say "this stage is at full scale".
    const mtp = build(oneTrackComp(), {});
    const [level] = readLevels();
    expect(level.inDb).toBe(-Infinity);
    expect(level.driveDb).toBe(-Infinity);
    expect(level.outDb).toBe(-Infinity);
    expect(level.faderDb).toBe(-Infinity);
    mtp.dispose();
  });

  it('a voice with meters but no amp reads silence at the drive tap only', () => {
    // `getDriveLevelDb` returns -Infinity when the preset builds no amp stage:
    // the meter exists but nothing is connected to it. The other two still read.
    const mtp = build(oneTrackComp(), {
      getInputLevelDb: () => -14,
      getDriveLevelDb: () => -Infinity,
      getOutputLevelDb: () => -9,
    });
    const [level] = readLevels();
    expect(level.driveDb).toBe(-Infinity);
    expect(level.inDb).toBe(-14);
    mtp.dispose();
  });

  it('unregisters on dispose, so a torn-down engine is never polled', () => {
    const mtp = build(oneTrackComp(), { getOutputLevelDb: () => -9 });
    expect(hoisted.registered.at(-1)).toBeTypeOf('function');
    mtp.dispose();
    expect(hoisted.registered.at(-1)).toBeNull();
  });

  it('names the track, so the line is readable with several playing', () => {
    const mtp = build(oneTrackComp(), { getOutputLevelDb: () => -9 });
    const [level] = readLevels();
    expect(level.name).toBe(oneTrackComp().tracks[0].name);
    mtp.dispose();
  });
});
