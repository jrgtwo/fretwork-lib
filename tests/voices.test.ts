/**
 * Voice + MasterBus tests. Tone.js is fully mocked because jsdom has no
 * AudioContext. The mocks track method calls so we can assert that:
 *   - Constructing a Voice doesn't build the synth (lazy on first play()).
 *   - play() builds the synth, connects it through the effects chain, and routes
 *     the chain exit into the MasterBus.
 *   - updateSynthParams() mutates the existing synth in place rather than
 *     rebuilding it (no extra dispose() calls).
 *   - updateEffects() with the same shape mutates effect nodes in place; adding
 *     or removing a node forces a chain rebuild.
 *   - dispose() releases every node and disconnects from MasterBus.
 *
 * Samplers are built EMPTY and filled from `sample-store` (see "Sample fills" in
 * Voice.ts), so the store is mocked too — every `loadAudioBuffer` call parks a
 * resolver in `store.pending` and a test decides when, and whether, it lands.
 * That is what makes the fill's ordering assertable at all. What it CANNOT
 * prove, because Tone is mocked: that `add()` produces sound, that the transport
 * really waits, or that an unfilled Sampler repitches rather than falling
 * silent. Those are browser checks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => {
  const calls = {
    pluckCtor: 0,
    fmCtor: 0,
    samplerCtor: 0,
    distortionCtor: 0,
    chorusCtor: 0,
    delayCtor: 0,
    eqCtor: 0,
    reverbCtor: 0,
    gainCtor: 0,
    filterCtor: 0,
    compressorCtor: 0,
    volumeCtor: 0,
    pannerCtor: 0,
    pluckDispose: 0,
    fmDispose: 0,
    samplerDispose: 0,
    chorusStart: 0,
  };
  /** Every `Tone.Sampler` the mock built, in build order. The fill has to be
   *  observable per INSTANCE, not just as a count: "the new sampler was filled
   *  and the disposed one was not" is the whole content of the generation
   *  guard. */
  const samplers: Array<{
    urls: Record<string, string>;
    /** The OTHER constructor options. Switching to `urls: {}` is the whole
     *  change, and it is one edit away from dropping these with it — a Sampler
     *  built without its release tail or its 5 ms attack sounds wrong in a way
     *  no shape assertion notices. */
    release: number | undefined;
    attack: number | undefined;
    added: string[];
    triggers: number;
    disposed: boolean;
  }> = [];
  /** Every `Tone.Convolver` the mock built, in build order. */
  const convolvers: Array<{ normalize: boolean; url: unknown; buffer: unknown }> = [];
  /** Every value a `Tone.Gain` was constructed with, in build order. Counting
   *  constructors is not enough for AF-03's source trim: the trim's whole
   *  content IS its value, and a node built at unity looks identical to one
   *  built correctly if you only count them. */
  const gainValues: number[] = [];
  function reset() {
    for (const k of Object.keys(calls) as (keyof typeof calls)[]) calls[k] = 0;
    gainValues.length = 0;
    samplers.length = 0;
    convolvers.length = 0;
  }
  return { calls, reset, gainValues, samplers, convolvers };
});

/** Control surface for the mocked sample store. */
const store = vi.hoisted(() => {
  /** One entry per `loadAudioBuffer` call, in call order, with its resolver.
   *  Nothing resolves until a test says so — the point of the fill design is
   *  what happens in the window BEFORE the buffers land.
   *
   *  `reject` is here because "the fill must never reject" is a rule about a
   *  contract with ANOTHER module: `loadAudioBuffer` is documented not to, and
   *  the fill is written not to trust that. A mock that can only resolve cannot
   *  tell whether the distrust is still wired up. */
  const pending: Array<{
    url: string;
    resolve: (buffer: unknown) => void;
    reject: (err: unknown) => void;
  }> = [];
  return { pending };
});

vi.mock('../src/playback/voices/sample-store', () => ({
  loadAudioBuffer: (url: string) =>
    new Promise((resolve, reject) => {
      store.pending.push({ url, resolve, reject });
    }),
  // `sample-packs` warms a pack through this on every voice selection. Inert
  // here; `sample-store`'s own tests cover it.
  warmUrls: () => {},
}));

vi.mock('tone', () => {
  // Mock classes defined inside the factory (vi.mock is hoisted, so top-level
  // references would TDZ). Plain functions for spies — we count via `hoisted.calls`
  // so we don't need vi.fn here.
  const noop = () => {};

  class MockNode {
    connect = noop;
    disconnect = noop;
    toDestination() { return this; }
    dispose = noop;
    wet = { rampTo: noop as any, value: 0 };
  }

  class MockPluckSynth extends MockNode {
    attackNoise: number;
    dampening: number;
    resonance: number;
    release: number;
    triggerAttackRelease = noop;
    constructor(opts: { attackNoise: number; dampening: number; resonance: number; release: number }) {
      super();
      hoisted.calls.pluckCtor++;
      this.attackNoise = opts.attackNoise;
      this.dampening = opts.dampening;
      this.resonance = opts.resonance;
      this.release = opts.release;
    }
    override dispose = () => { hoisted.calls.pluckDispose++; };
  }

  class MockFMSynth extends MockNode {
    harmonicity = { value: 1 };
    modulationIndex = { value: 1 };
    detune = { value: 0 };
    oscillator = { type: 'sine' };
    modulation = { type: 'sine' };
    envelope = { attack: 0, decay: 0, sustain: 0, release: 0 };
    modulationEnvelope = { attack: 0, decay: 0, sustain: 0, release: 0 };
    triggerAttackRelease = noop;
    constructor(_opts: any) {
      super();
      hoisted.calls.fmCtor++;
    }
    override dispose = () => { hoisted.calls.fmDispose++; };
  }

  class MockDistortion extends MockNode {
    distortion: number;
    constructor(opts: { distortion: number; wet: number }) {
      super();
      hoisted.calls.distortionCtor++;
      this.distortion = opts.distortion;
      this.wet.value = opts.wet;
    }
  }

  class MockChorus extends MockNode {
    frequency = { value: 1 };
    depth: number;
    feedback = { rampTo: noop, value: 0 };
    delayTime = 0;
    spread = 0;
    constructor(opts: { frequency: number; depth: number; wet: number }) {
      super();
      hoisted.calls.chorusCtor++;
      this.frequency.value = opts.frequency;
      this.depth = opts.depth;
      this.wet.value = opts.wet;
    }
    start() {
      hoisted.calls.chorusStart++;
      return this;
    }
  }

  class MockFeedbackDelay extends MockNode {
    delayTime = { rampTo: noop, value: 0 };
    feedback = { rampTo: noop, value: 0 };
    constructor(opts: { delayTime: number; feedback: number; wet: number }) {
      super();
      hoisted.calls.delayCtor++;
      this.delayTime.value = opts.delayTime;
      this.feedback.value = opts.feedback;
      this.wet.value = opts.wet;
    }
  }

  class MockEQ3 extends MockNode {
    low = { rampTo: noop, value: 0 };
    mid = { rampTo: noop, value: 0 };
    high = { rampTo: noop, value: 0 };
    lowFrequency = { rampTo: noop, value: 0 };
    highFrequency = { rampTo: noop, value: 0 };
    constructor(opts: { low: number; high: number; mid: number; lowFrequency?: number; highFrequency?: number }) {
      super();
      hoisted.calls.eqCtor++;
      this.low.value = opts.low;
      this.high.value = opts.high;
      this.mid.value = opts.mid;
    }
  }

  class MockReverb extends MockNode {
    decay: number;
    override wet = { rampTo: noop as any, value: 0 };
    constructor(opts: { decay: number; wet: number }) {
      super();
      hoisted.calls.reverbCtor++;
      this.decay = opts.decay;
      this.wet.value = opts.wet;
    }
    async generate() { return this; }
  }

  class MockGain extends MockNode {
    gain = { rampTo: noop, value: 1 };
    constructor(value: number = 1) {
      super();
      hoisted.calls.gainCtor++;
      hoisted.gainValues.push(value);
      this.gain.value = value;
    }
  }

  class MockFilter extends MockNode {
    frequency = {
      rampTo: noop,
      cancelScheduledValues: noop,
      setValueAtTime: noop,
      linearRampToValueAtTime: noop,
      value: 0,
    };
    Q = { rampTo: noop, value: 0 };
    constructor(_opts: any) {
      super();
      hoisted.calls.filterCtor++;
    }
  }

  class MockCompressor extends MockNode {
    threshold = { rampTo: noop, value: 0 };
    ratio = { rampTo: noop, value: 0 };
    attack = { rampTo: noop, value: 0 };
    release = { rampTo: noop, value: 0 };
    knee = { rampTo: noop, value: 0 };
    constructor(_opts: any) {
      super();
      hoisted.calls.compressorCtor++;
    }
  }

  class MockVolume extends MockNode {
    volume = { rampTo: noop, value: 0 };
    constructor(_v: number) {
      super();
      hoisted.calls.volumeCtor++;
    }
  }

  class MockPanner extends MockNode {
    pan = { rampTo: noop, value: 0 };
    constructor(_v: number) {
      super();
      hoisted.calls.pannerCtor++;
    }
  }

  class MockFrequencyEnvelope extends MockNode {
    attack = 0;
    decay = 0;
    sustain = 0;
    release = 0;
    baseFrequency = 0;
    octaves = 0;
    triggerAttackRelease = noop;
    constructor(_opts: any) {
      super();
    }
  }

  class MockAutoWah extends MockNode {
    baseFrequency = 0;
    octaves = 0;
    sensitivity = 0;
    Q = { rampTo: noop, value: 0 };
    gain = { rampTo: noop, value: 0 };
    constructor(_opts: any) {
      super();
    }
  }

  const SEMITONE: Record<string, number> = {
    C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6,
    Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
  };
  /** Real note→MIDI, unlike the rest of this mock. The resident-note guard in
   *  `canSound` compares midi DISTANCES, so a constant here would make every
   *  note equidistant and the guard's test vacuous. */
  function midiOf(note: string): number {
    const parsed = /^([A-G][#b]?)(-?\d+)$/.exec(note);
    if (!parsed) return 60;
    return (Number(parsed[2]) + 1) * 12 + SEMITONE[parsed[1]];
  }

  /** Tone.Frequency utility — supports `Tone.Frequency(note).transpose(N).toNote()`.
   *  We don't model real semitone math for `transpose`; it just returns the same
   *  note. The tests don't rely on accurate transposition. */
  function frequencyShim(note: string) {
    return {
      transpose: (_n: number) => frequencyShim(note),
      toNote: () => note,
      toMidi: () => midiOf(note),
      // `Voice.play` converts to Hz so it can apply the humanize detune in cents
      // (Voice.ts:327). A fixed value is fine — nothing here asserts pitch, and the
      // detune is randomised anyway.
      toFrequency: () => 440,
    };
  }

  class MockSampler extends MockNode {
    /** What it was CONSTRUCTED with — `{}` now, because the buffers arrive
     *  through `add`. */
    readonly urls: Record<string, string>;
    readonly release: number | undefined;
    readonly attack: number | undefined;
    /** Note keys handed to `add`, in arrival order. */
    readonly added: string[] = [];
    triggers = 0;
    disposed = false;
    triggerAttackRelease = () => { this.triggers++; };
    constructor(opts: { urls: Record<string, string>; release?: number; attack?: number }) {
      super();
      hoisted.calls.samplerCtor++;
      this.urls = opts.urls;
      this.release = opts.release;
      this.attack = opts.attack;
      hoisted.samplers.push(this);
    }
    add(note: string, _buffer: unknown) {
      this.added.push(note);
      return this;
    }
    override dispose = () => {
      hoisted.calls.samplerDispose++;
      this.disposed = true;
    };
  }

  class MockVibrato extends MockNode {
    frequency = {
      cancelScheduledValues: noop,
      setValueAtTime: noop,
      linearRampToValueAtTime: noop,
      value: 5.5,
    };
    depth = {
      cancelScheduledValues: noop,
      setValueAtTime: noop,
      linearRampToValueAtTime: noop,
      value: 0,
    };
    constructor(_opts: any) {
      super();
    }
  }
  class MockPitchShift extends MockNode {
    pitch = 0;
    constructor(_opts: any) {
      super();
    }
  }

  /** The cab IR. Records what it was built with and what was later assigned,
   *  because "built with no url, buffer set afterwards" is the change. */
  class MockConvolver extends MockNode {
    normalize: boolean;
    url: unknown;
    buffer: unknown = null;
    constructor(opts?: { normalize?: boolean; url?: unknown }) {
      super();
      this.normalize = opts?.normalize ?? true;
      this.url = opts?.url;
      hoisted.convolvers.push(this);
    }
  }

  /** Only the static `downloads` array matters here: it is the one thing
   *  `Tone.loaded()` drains, and registering the fills on it is what keeps the
   *  transport's existing await honest. */
  class MockToneAudioBuffer {
    static downloads: Array<Promise<void>> = [];
  }

  return {
    PluckSynth: MockPluckSynth,
    FMSynth: MockFMSynth,
    Sampler: MockSampler,
    Distortion: MockDistortion,
    Chorus: MockChorus,
    FeedbackDelay: MockFeedbackDelay,
    EQ3: MockEQ3,
    Reverb: MockReverb,
    Gain: MockGain,
    Filter: MockFilter,
    Compressor: MockCompressor,
    Volume: MockVolume,
    Panner: MockPanner,
    FrequencyEnvelope: MockFrequencyEnvelope,
    AutoWah: MockAutoWah,
    Vibrato: MockVibrato,
    PitchShift: MockPitchShift,
    Frequency: frequencyShim,
    // Added after this mock was written, and all reached through code the Voice tests
    // already exercise: `Convolver` is the cab IR, `JCReverb` the per-voice spring,
    // `WaveShaper` the amp saturators, and `Meter` + `Limiter` are MasterBus (which
    // `Voice` connects its output to). Plain nodes on purpose — these tests assert
    // Voice's chain wiring, not Tone's DSP.
    Convolver: MockConvolver,
    JCReverb: class extends MockNode {},
    // The circuit amp's supply side chain. Plain nodes -- these tests assert
    // that a knob reaches a node, not what a rectifier does.
    Follower: class extends MockNode {
      constructor(public smoothing?: number) { super(); }
    },
    Scale: class extends MockNode {
      constructor(public min: number, public max: number) { super(); }
    },
    WaveShaper: class extends MockNode {
      constructor(_curve?: unknown, _size?: number) { super(); }
      oversample = 'none';
      setMap = noop;
    },
    Limiter: class extends MockNode {},
    Meter: class extends MockNode {
      constructor(_opts?: unknown) { super(); }
      getValue() { return -Infinity; }
    },
    // Returns a real waveform buffer rather than a canned dB figure. The RMS-vs-
    // peak bug survived a whole suite partly because the old Meter mock handed
    // back a number and every test agreed with it; a mock that returns SAMPLES
    // makes the getters run the arithmetic they ship with.
    Analyser: class extends MockNode {
      readonly size: number;
      samples: Float32Array;
      constructor(opts?: { size?: number }) {
        super();
        this.size = opts?.size ?? 1024;
        this.samples = new Float32Array(this.size);
      }
      getValue() { return this.samples; }
    },
    getContext: () => ({ currentTime: 0, lookAhead: 0.1 }),
    start: async () => undefined,
    ToneAudioBuffer: MockToneAudioBuffer,
    // Copied from Tone's own implementation (`ToneAudioBuffer.js:337-345`)
    // rather than stubbed to resolve, so a test can assert that an outstanding
    // fill actually HOLDS it — which is the whole reason the fills are
    // registered there.
    loaded: async () => {
      await Promise.resolve();
      while (MockToneAudioBuffer.downloads.length) {
        await MockToneAudioBuffer.downloads[0];
      }
    },
    now: () => 0,
    dbToGain: (db: number) => Math.pow(10, db / 20),
    gainToDb: (g: number) => 20 * Math.log10(Math.max(0.0001, g)),
  };
});

import * as Tone from 'tone';
import { Voice, SAMPLE_FILL_GATE_MS, buildChainNodesForTest } from '../src/playback/voices/Voice';
import { _resetMasterBusForTests, MasterBus } from '../src/playback/voices/MasterBus';
import {
  ACOUSTIC_GUITAR_PRESET,
  ELECTRIC_GUITAR_PRESET,
  ACOUSTIC_BASS_PRESET,
  ACOUSTIC_UKULELE_PRESET,
} from '../src/playback/voices/presets';
import { REFERENCE_LEVEL_DBFS, SAMPLE_PACK_PEAK_DBFS } from '../src/playback/voices/levels';
import type { VoicePreset } from '../src/playback/voices/types';

beforeEach(() => {
  hoisted.reset();
  vi.clearAllMocks();
  _resetMasterBusForTests();
  store.pending.length = 0;
  // A fill left outstanding by an earlier test would hang the next drain.
  Tone.ToneAudioBuffer.downloads.length = 0;
});

/** A decoded buffer, shaped the way `loadAudioBuffer` resolves one. Only
 *  `loaded` is read: the fill skips a buffer that never arrived. */
function decoded(): unknown {
  return { loaded: true };
}

/** Let every already-queued microtask run. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Resolve every load asked for so far, then let the fill's own chain run. */
async function settleLoads(buffer: unknown = decoded()): Promise<void> {
  for (const load of store.pending.splice(0)) load.resolve(buffer);
  await tick();
}

/** Fail every load asked for so far, the way the store promises never to. */
async function rejectLoads(): Promise<void> {
  for (const load of store.pending.splice(0)) load.reject(new Error('load blew up'));
  await tick();
}

/** Fail exactly one URL's load. */
async function rejectLoad(url: string): Promise<void> {
  const at = store.pending.findIndex((load) => load.url === url);
  expect(at).toBeGreaterThanOrEqual(0);
  store.pending.splice(at, 1)[0].reject(new Error('load blew up'));
  await tick();
}

/** Resolve exactly one URL's load. */
async function settleLoad(url: string, buffer: unknown = decoded()): Promise<void> {
  const at = store.pending.findIndex((load) => load.url === url);
  expect(at).toBeGreaterThanOrEqual(0);
  store.pending.splice(at, 1)[0].resolve(buffer);
  await tick();
}

/** A3 + C4 in one bank — small enough to reason about, and three semitones
 *  apart so a repitch is distinguishable from an exact match. */
const A3 = '/pack/A3.mp3';
const C4 = '/pack/C4.mp3';
function twoNotePreset(extra: Partial<VoicePreset> = {}): VoicePreset {
  return {
    ...ACOUSTIC_GUITAR_PRESET,
    source: { kind: 'sampler', samples: [{ A3, C4 }], release: 1 },
    ...extra,
  };
}

describe('Voice — construction is lazy', () => {
  it('does not build any synth in the constructor', () => {
    new Voice(ACOUSTIC_GUITAR_PRESET);
    expect(hoisted.calls.fmCtor).toBe(0);
    expect(hoisted.calls.pluckCtor).toBe(0);
  });

  it('builds the synth on first play()', () => {
    const v = new Voice(ACOUSTIC_GUITAR_PRESET);
    v.play('A3', '4n', 0);
    // Acoustic guitar (v4 retune) is a Sampler — Philharmonia samples, no layer.
    expect(hoisted.calls.samplerCtor).toBeGreaterThan(0);
  });
});

describe('Voice — primary-synth construction by preset', () => {
  it.each([
    ACOUSTIC_BASS_PRESET,
    ACOUSTIC_UKULELE_PRESET,
  ])('FM-primary preset $id builds an FMSynth on play()', (preset) => {
    const v = new Voice(preset);
    v.play('A3', '4n', 0);
    expect(hoisted.calls.fmCtor).toBeGreaterThanOrEqual(1);
    v.dispose();
  });

  it('Pluck-primary preset electric-guitar builds a PluckSynth on play()', () => {
    const v = new Voice(ELECTRIC_GUITAR_PRESET);
    v.play('A3', '4n', 0);
    expect(hoisted.calls.pluckCtor).toBeGreaterThanOrEqual(1);
    v.dispose();
  });

  it('Sampler-primary preset acoustic-guitar builds a Sampler on play()', () => {
    const v = new Voice(ACOUSTIC_GUITAR_PRESET);
    v.play('A3', '4n', 0);
    expect(hoisted.calls.samplerCtor).toBeGreaterThanOrEqual(1);
    v.dispose();
  });

  it('routes through distortion + EQ for the electric guitar preset', () => {
    const v = new Voice(ELECTRIC_GUITAR_PRESET);
    v.play('A3', '4n', 0);
    expect(hoisted.calls.distortionCtor).toBe(1);
    expect(hoisted.calls.eqCtor).toBe(1);
    v.dispose();
  });
});

describe('Voice — sub-body layer', () => {
  it('builds the layer synth alongside the primary when present', () => {
    // Acoustic bass has an FM primary + FM layer.
    const v = new Voice(ACOUSTIC_BASS_PRESET);
    v.play('A2', '4n', 0);
    expect(hoisted.calls.fmCtor).toBe(2);
    v.dispose();
  });

  it('does not build a layer when none is present', () => {
    // Electric guitar is PluckSynth primary with no layer.
    const v = new Voice(ELECTRIC_GUITAR_PRESET);
    v.play('A3', '4n', 0);
    expect(hoisted.calls.pluckCtor).toBe(1);
    expect(hoisted.calls.fmCtor).toBe(0);
    v.dispose();
  });
});

describe('Voice — updateSynthParams mutates in place', () => {
  it('does not construct a new synth when params change', () => {
    const v = new Voice(ACOUSTIC_BASS_PRESET);
    v.play('A2', '4n', 0);
    const fmBefore = hoisted.calls.fmCtor;
    v.updateSynthParams(ACOUSTIC_BASS_PRESET.source.kind === 'fm-synth'
      ? { ...ACOUSTIC_BASS_PRESET.source.params, harmonicity: 2 }
      : ACOUSTIC_BASS_PRESET.source as any);
    expect(hoisted.calls.fmCtor).toBe(fmBefore); // unchanged
    expect(hoisted.calls.fmDispose).toBe(0);
  });
});

describe('Voice — updateEffects', () => {
  it('mutates in place when shape is the same', () => {
    const v = new Voice(ELECTRIC_GUITAR_PRESET);
    v.play('A3', '4n', 0);
    const distortionsBefore = hoisted.calls.distortionCtor;
    v.updateEffects({
      ...(ELECTRIC_GUITAR_PRESET.effects as any),
      distortion: { drive: 0.6, wet: 0.5 },
    });
    expect(hoisted.calls.distortionCtor).toBe(distortionsBefore); // no rebuild
  });

  it('rebuilds the chain when an effect is added', () => {
    // Acoustic bass ships with no effects, so adding distortion exercises the
    // "build new effect node" path cleanly.
    const v = new Voice({ ...ACOUSTIC_BASS_PRESET });
    v.play('A2', '4n', 0);
    expect(hoisted.calls.distortionCtor).toBe(0);
    v.updateEffects({ distortion: { drive: 0.3, wet: 0.25, oversample: '4x' } });
    expect(hoisted.calls.distortionCtor).toBe(1);
  });

  it('rebuilds the chain when an effect is removed', () => {
    const v = new Voice(ELECTRIC_GUITAR_PRESET);
    v.play('A3', '4n', 0);
    const distortionsBefore = hoisted.calls.distortionCtor;
    v.updateEffects({}); // remove all effects
    // Removing an effect rebuilds, but does not construct a new distortion.
    expect(hoisted.calls.distortionCtor).toBe(distortionsBefore);
  });
});

describe('Voice — dispose', () => {
  it('releases an FM-primary voice on dispose', () => {
    const noLayer: typeof ACOUSTIC_BASS_PRESET = { ...ACOUSTIC_BASS_PRESET, layer: undefined };
    const v = new Voice(noLayer);
    v.play('A2', '4n', 0);
    expect(hoisted.calls.fmDispose).toBe(0);
    v.dispose();
    expect(hoisted.calls.fmDispose).toBe(1);
  });

  it('releases primary + layer when both are present', () => {
    // Acoustic bass: FM primary + FM layer.
    const v = new Voice(ACOUSTIC_BASS_PRESET);
    v.play('A2', '4n', 0);
    v.dispose();
    expect(hoisted.calls.fmDispose).toBe(2);
  });
});

describe('Voice — acoustic presets without effects build no effect nodes', () => {
  // Acoustic guitar ships with a compressor + EQ baked in (it's where most of the
  // body shape lives), so it's excluded here. The other two acoustic presets are
  // pure synth + layer with no effects.
  it.each([
    ACOUSTIC_BASS_PRESET,
    ACOUSTIC_UKULELE_PRESET,
  ])('preset $id has no effect nodes built', (preset) => {
    const v = new Voice(preset);
    v.play('A3', '4n', 0);
    expect(hoisted.calls.distortionCtor).toBe(0);
    expect(hoisted.calls.chorusCtor).toBe(0);
    expect(hoisted.calls.delayCtor).toBe(0);
    expect(hoisted.calls.eqCtor).toBe(0);
    v.dispose();
  });
});

describe('MasterBus — reverb', () => {
  it('constructs a single reverb on first connectVoice', () => {
    expect(hoisted.calls.reverbCtor).toBe(0);
    const v = new Voice(ACOUSTIC_GUITAR_PRESET);
    v.play('A3', '4n', 0);
    expect(hoisted.calls.reverbCtor).toBe(1);
  });

  it('does not rebuild the reverb on every voice', () => {
    new Voice(ACOUSTIC_GUITAR_PRESET).play('A3', '4n', 0);
    const reverbsAfterFirst = hoisted.calls.reverbCtor;
    new Voice(ACOUSTIC_BASS_PRESET).play('A2', '4n', 0);
    expect(hoisted.calls.reverbCtor).toBe(reverbsAfterFirst);
  });

  it('updates wet via rampTo when settings change', () => {
    const v = new Voice(ACOUSTIC_GUITAR_PRESET);
    v.play('A3', '4n', 0);
    MasterBus.setReverbSettings({ enabled: true, decay: 1.5, preDelay: 0.01, wet: 0.5 });
    // Can't easily assert on the mock from here, but reaching this point without
    // throwing is enough — we cover behaviour exhaustively in the integration test.
    expect(MasterBus.settings.wet).toBe(0.5);
  });

  it('rebuilds the impulse response when decay changes', () => {
    const v = new Voice(ACOUSTIC_GUITAR_PRESET);
    v.play('A3', '4n', 0);
    expect(MasterBus.settings.decay).toBeCloseTo(1.5);
    MasterBus.setReverbSettings({ enabled: true, decay: 3.0, preDelay: 0.01, wet: 0.2 });
    expect(MasterBus.settings.decay).toBe(3);
  });
});

describe('Voice.swapPreset — source changes rebuild rather than strand the voice', () => {
  /** ACOUSTIC_GUITAR_PRESET is sampler-backed; ELECTRIC_GUITAR_PRESET is pluck-synth. */
  it('rebuilds on a source-KIND change instead of leaving a disposed voice', () => {
    const v = new Voice(ACOUSTIC_GUITAR_PRESET);
    v.play('A3', '4n', 0);
    expect(hoisted.calls.samplerCtor).toBeGreaterThan(0);

    v.swapPreset(ELECTRIC_GUITAR_PRESET);

    // The old source is torn down AND a new one stands up. Before this fix
    // swapPreset disposed and returned, so the pluck was never constructed and
    // every subsequent note was silent with nothing thrown.
    expect(hoisted.calls.samplerDispose).toBeGreaterThan(0);
    expect(hoisted.calls.pluckCtor).toBe(1);

    // Still playable — the point of the fix.
    expect(() => v.play('A3', '4n', 0)).not.toThrow();
    v.dispose();
  });

  it('rebuilds the samplers when the pack changes, not just the kind', () => {
    const v = new Voice(ACOUSTIC_GUITAR_PRESET);
    v.play('A3', '4n', 0);
    const buildsAfterFirst = hoisted.calls.samplerCtor;
    expect(buildsAfterFirst).toBeGreaterThan(0);

    const otherPack = {
      ...ACOUSTIC_GUITAR_PRESET,
      source: { kind: 'sampler' as const, samples: [{ A3: '/other/A3.mp3' }] },
    };
    v.swapPreset(otherPack);

    // Banks are baked into the constructed Tone.Samplers, so a different pack needs
    // new ones. swapPreset used to compare only `kind`, accept this as an in-place
    // edit, and apply it to nothing — the previous samples kept sounding.
    expect(hoisted.calls.samplerCtor).toBeGreaterThan(buildsAfterFirst);
    v.dispose();
  });

  it('leaves a never-played voice unbuilt — a swap must not create an audio graph', () => {
    const v = new Voice(ACOUSTIC_GUITAR_PRESET);
    v.swapPreset(ELECTRIC_GUITAR_PRESET);
    expect(hoisted.calls.samplerCtor).toBe(0);
    expect(hoisted.calls.pluckCtor).toBe(0);
    v.dispose();
  });

  it('still applies a same-source edit in place, with no rebuild', () => {
    const v = new Voice(ELECTRIC_GUITAR_PRESET);
    v.play('A3', '4n', 0);
    const buildsAfterFirst = hoisted.calls.pluckCtor;

    v.swapPreset({ ...ELECTRIC_GUITAR_PRESET, level: { volumeDb: -6, pan: 0.2 } });

    expect(hoisted.calls.pluckCtor).toBe(buildsAfterFirst);
    v.dispose();
  });
});


describe('Voice — source calibration (AF-03)', () => {
  /** -17 dB: the packs are mastered to -1 dBFS true peak and the reference is
   *  -18 dBFS. Derived here the same way `levels.ts` derives it, so a change to
   *  either constant moves the expectation with the code. */
  const SAMPLER_TRIM = Math.pow(10, (REFERENCE_LEVEL_DBFS - SAMPLE_PACK_PEAK_DBFS) / 20);

  function builtGain(value: number): boolean {
    return hoisted.gainValues.some((v) => Math.abs(v - value) < 1e-9);
  }

  it('trims a sampled source to the reference level', () => {
    // The defect in one line: without this, one note off a -1 dBFS sample lands
    // at the amp at nearly full scale and a six-note chord is 14 dB past it.
    const v = new Voice(ACOUSTIC_GUITAR_PRESET);
    v.play('A3', '4n', 0);
    expect(builtGain(SAMPLER_TRIM)).toBe(true);
  });

  it('leaves a synth source at unity, because nothing has measured its peak', () => {
    // `ELECTRIC_GUITAR_PRESET` is a PluckSynth. What a synth peaks at is a
    // property of its params, not of its source kind, so trimming it by the
    // sample packs' mastering level would be inventing a fact.
    const v = new Voice(ELECTRIC_GUITAR_PRESET);
    v.play('A3', '4n', 0);
    expect(builtGain(SAMPLER_TRIM)).toBe(false);
  });

  it('calibrates a layer by ITS OWN source, not the primary\'s', () => {
    // The reason the trim is its own node instead of sitting on the mixer: the
    // layer feeds the mixer too. A synth layer under a sampled primary that
    // inherited the packs' -17 dB would be silently 17 dB under its mix level,
    // and `gainDb` — a relative mix control — would stop meaning what it says.
    const layered = {
      ...ACOUSTIC_GUITAR_PRESET,
      id: 'layered-test',
      layer: {
        source: ELECTRIC_GUITAR_PRESET.source,
        gainDb: -6,
        octaveOffset: -1,
        detuneCents: 0,
      },
    };
    const v = new Voice(layered);
    v.play('A3', '4n', 0);

    expect(builtGain(Math.pow(10, -6 / 20))).toBe(true);
    expect(builtGain(Math.pow(10, (-6 + REFERENCE_LEVEL_DBFS - SAMPLE_PACK_PEAK_DBFS) / 20))).toBe(false);
  });

  it('disposes the trim node with the rest of the chain', () => {
    const v = new Voice(ACOUSTIC_GUITAR_PRESET);
    v.play('A3', '4n', 0);
    const before = hoisted.calls.gainCtor;
    v.dispose();
    v.play('A3', '4n', 0);
    // A rebuild constructs the same set again — if the trim had leaked instead
    // of being disposed, this count would not include it a second time.
    expect(hoisted.calls.gainCtor).toBeGreaterThan(before);
    expect(builtGain(SAMPLER_TRIM)).toBe(true);
  });
});


describe('Voice — the level taps report PEAK, not RMS', () => {
  /** The regression test that did not exist. Every meter in this library was a
   *  `Tone.Meter`, which returns RMS; on a plucked note that sits 12-20 dB below
   *  the peak, so the app showed comfortable numbers while the audio clipped
   *  audibly. Nothing caught it because the old mock returned a canned dB value
   *  and every assertion agreed with the mock rather than with the arithmetic. */
  function spikyBuffer(size: number, peak: number): Float32Array {
    // Quiet almost everywhere, one large excursion — a pluck transient. RMS of
    // this is tiny; the peak is what decides whether the next stage clamps.
    const buffer = new Float32Array(size);
    buffer.fill(0.01);
    buffer[Math.floor(size / 2)] = peak;
    return buffer;
  }

  function analyserFor(v: Voice, key: 'inputMeter' | 'driveMeter' | 'outputMeter') {
    return (v as unknown as { _chain: Record<string, { samples: Float32Array; size: number }> })
      ._chain[key];
  }

  it.each([
    ['getInputLevelDb', 'inputMeter'],
    ['getDriveLevelDb', 'driveMeter'],
    ['getOutputLevelDb', 'outputMeter'],
  ] as const)('%s returns the largest sample in the window', (getter, key) => {
    const v = new Voice(ACOUSTIC_GUITAR_PRESET);
    v.play('A3', '4n', 0);
    const node = analyserFor(v, key);
    node.samples = spikyBuffer(node.size, 0.9);

    // RMS of this buffer is about 0.02 (-34 dB). The peak is 0.9 (-0.9 dB).
    expect(v[getter]()).toBeCloseTo(20 * Math.log10(0.9), 6);
  });

  it('reports a level ABOVE full scale rather than pinning at 0 dB', () => {
    // The single reading these exist to show. A meter that clamps at full scale
    // hides exactly the condition being hunted.
    const v = new Voice(ACOUSTIC_GUITAR_PRESET);
    v.play('A3', '4n', 0);
    const node = analyserFor(v, 'driveMeter');
    node.samples = spikyBuffer(node.size, 1.8);

    expect(v.getDriveLevelDb()).toBeCloseTo(20 * Math.log10(1.8), 6);
    expect(v.getDriveLevelDb()).toBeGreaterThan(0);
  });

  it('reads silence as -Infinity', () => {
    const v = new Voice(ACOUSTIC_GUITAR_PRESET);
    v.play('A3', '4n', 0);
    expect(v.getOutputLevelDb()).toBe(-Infinity);
  });
});

describe('Voice.swapPreset — a 5E3 switch is a retune, never a rebuild', () => {
  /**
   * ⚠ THE PROPERTY THE WHOLE SWITCH DESIGN RESTS ON. A 5E3's channel selector
   * gates SIGNAL — it does not take a pot out of the circuit — so flipping it
   * must move gains on an existing graph. A switch that quietly rebuilt would
   * cut every ringing note, which is the defect `setTrackVoice`'s release tail
   * was supposed to cover and does not.
   *
   * `sameEffectsShape` is module-private, so this asserts it the way the tests
   * above do: through `swapPreset`, with a constructor call-counter.
   */
  const BASE: Record<string, number | string> = {
    input: 'hi',
    bright: 'off',
    jumpered: 'off',
    volumeNormal: 0.5,
    volumeBright: 0.5,
    tone: 0.5,
    inverter: 'split',
  };

  function deluxe(overrides: Record<string, number | string> = {}) {
    return {
      ...ELECTRIC_GUITAR_PRESET,
      effects: {
        ...ELECTRIC_GUITAR_PRESET.effects,
        circuitAmp: {
          ampId: 'deluxe-5e3',
          inputGainDb: 0,
          controls: { ...BASE, ...overrides },
        },
      },
    };
  }

  interface DeluxeNodes {
    inputPad: { gain: { value: number } };
    channelNormalFeed: { gain: { value: number } };
    channelBrightFeed: { gain: { value: number } };
    plateLegLpf: { frequency: { value: number } };
    cathodeLegLpf: { frequency: { value: number } };
  }

  function nodesOf(v: Voice): DeluxeNodes {
    const chain = (v as unknown as { _chain: { circuitAmp?: DeluxeNodes } })._chain;
    if (!chain.circuitAmp) throw new Error('no circuit amp in the chain');
    return chain.circuitAmp;
  }

  it('flips the channel switches without constructing a node', () => {
    const v = new Voice(deluxe());
    v.play('A3', '4n', 0);
    const built = hoisted.calls.gainCtor;

    v.swapPreset(deluxe({ bright: 'on' }));
    expect([
      nodesOf(v).channelNormalFeed.gain.value,
      nodesOf(v).channelBrightFeed.gain.value,
    ]).toEqual([0, 1]);

    // Jumpered wins over Bright — both fed, still no rebuild.
    v.swapPreset(deluxe({ bright: 'on', jumpered: 'on' }));
    expect([
      nodesOf(v).channelNormalFeed.gain.value,
      nodesOf(v).channelBrightFeed.gain.value,
    ]).toEqual([1, 1]);

    expect(hoisted.calls.gainCtor).toBe(built);
    v.dispose();
  });

  it('pads and darkens on the Lo jack without constructing a node', () => {
    const v = new Voice(deluxe());
    v.play('A3', '4n', 0);
    v.swapPreset(deluxe({ input: 'hi' }));
    const hi = nodesOf(v).inputPad.gain.value;
    const built = hoisted.calls.gainCtor;

    v.swapPreset(deluxe({ input: 'lo' }));

    expect(nodesOf(v).inputPad.gain.value).toBeLessThan(hi);
    expect(hoisted.calls.gainCtor).toBe(built);
    v.dispose();
  });

  it('flattens the inverter legs without constructing a node', () => {
    // ⚠ ONLY THE PLATE LEG MOVES, and that is the design: the cathode leg's
    // corner is the triode's own Miller roll-off, fixed at build time, and
    // `legSpread` walks the PLATE leg away from it. So this reads the plate
    // corner across the switch rather than comparing the two nodes — the
    // Filter mock ignores its constructor options, so the cathode node's
    // value here is the mock's and not the circuit's.
    const v = new Voice(deluxe());
    v.play('A3', '4n', 0);

    v.swapPreset(deluxe({ inverter: 'split' }));
    const split = Number(nodesOf(v).plateLegLpf.frequency.value);
    const built = hoisted.calls.gainCtor;

    v.swapPreset(deluxe({ inverter: 'composed' }));
    const composed = Number(nodesOf(v).plateLegLpf.frequency.value);

    // Split takes the plate leg DOWN from the cathode leg's corner — it is the
    // high-impedance output and rolls off first.
    expect(split).toBeLessThan(composed);
    expect(hoisted.calls.gainCtor).toBe(built);
    v.dispose();
  });
});

describe('Voice.swapPreset — a circuit amp retunes in place', () => {
  /**
   * The circuit amp was wired into the chain BUILDER and never into the update
   * path: `sameEffectsShape` did not compare it and `updateEffects` did not
   * apply it. So its knobs were written onto the preset and reached no node,
   * silently -- and the only change that moved the sound was a source change,
   * which rebuilds the whole graph for its own reasons.
   *
   * That is why a knob turn on the composition page had to rebuild the entire
   * voice, which re-downloads the sample pack.
   */
  const CIRCUIT = { ampId: 'princeton-5f2a', inputGainDb: 0 };

  function circuitPreset(controls: Record<string, number>, ampId = CIRCUIT.ampId) {
    return {
      ...ELECTRIC_GUITAR_PRESET,
      effects: { ...ELECTRIC_GUITAR_PRESET.effects, circuitAmp: { ...CIRCUIT, ampId, controls } },
    };
  }

  interface Pots {
    volumeGain: { gain: { value: number } };
    toneFilter: { frequency: { value: number } };
  }

  function pots(v: Voice): Pots {
    const chain = (v as unknown as { _chain: { circuitAmp?: Pots } })._chain;
    if (!chain.circuitAmp) throw new Error('no circuit amp in the chain');
    return chain.circuitAmp;
  }

  it('moves the volume pot, without rebuilding the chain', () => {
    const v = new Voice(circuitPreset({ volume: 0.2, tone: 0.5 }));
    v.play('A3', '4n', 0);
    const quiet = pots(v).volumeGain.gain.value;
    const nodesBuiltSoFar = hoisted.calls.gainCtor;

    v.swapPreset(circuitPreset({ volume: 0.9, tone: 0.5 }));

    expect(pots(v).volumeGain.gain.value).toBeGreaterThan(quiet);
    // The point of the whole exercise: retuned, not rebuilt.
    expect(hoisted.calls.gainCtor).toBe(nodesBuiltSoFar);
    v.dispose();
  });

  it('moves the tone pot', () => {
    const v = new Voice(circuitPreset({ volume: 0.5, tone: 0.5 }));
    v.play('A3', '4n', 0);

    // Both readings are taken AFTER a swap, so this measures the update path
    // rather than the builder -- the Filter mock ignores its constructor
    // options, so a value read at build time would prove nothing.
    v.swapPreset(circuitPreset({ volume: 0.5, tone: 0.1 }));
    const dark = pots(v).toneFilter.frequency.value;
    v.swapPreset(circuitPreset({ volume: 0.5, tone: 0.9 }));

    expect(pots(v).toneFilter.frequency.value).toBeGreaterThan(dark);
    v.dispose();
  });

  it('rebuilds the chain when the amp itself changes', () => {
    const v = new Voice(circuitPreset({ volume: 0.5, tone: 0.5 }));
    v.play('A3', '4n', 0);
    const nodesBuiltSoFar = hoisted.calls.gainCtor;

    // A different circuit is a different node graph -- the stages and their
    // component values are read off the amp's definition at build time -- so
    // this one case must NOT take the in-place path.
    v.swapPreset(circuitPreset({ volume: 0.5, tone: 0.5 }, 'some-other-amp'));

    expect(hoisted.calls.gainCtor).toBeGreaterThan(nodesBuiltSoFar);
    v.dispose();
  });
});

/**
 * The empty-build trade. `_ensureBuilt` is synchronous and the sample store is
 * not, so every Sampler is constructed with no urls and filled as buffers land.
 *
 * Tone is mocked, so these prove ORDERING and BOOKKEEPING — that `add` is
 * called, on which instance, and whether the promise reached
 * `ToneAudioBuffer.downloads`. Whether the resulting graph makes the right
 * sound is a browser check and is not asserted anywhere in this file.
 */
describe('Voice — samplers are built empty and filled from the sample store', () => {
  it('constructs the Sampler with no urls and asks the store for every one', () => {
    const v = new Voice(twoNotePreset());
    v.play('A3', '4n', 0);

    // The bank's urls do NOT go to Tone any more. If they did, Tone would fetch
    // them itself and the store — and therefore the cache — would be bypassed.
    expect(hoisted.samplers).toHaveLength(1);
    expect(hoisted.samplers[0].urls).toEqual({});
    expect(store.pending.map((load) => load.url).sort()).toEqual([A3, C4]);
    // Emptying `urls` must not take the rest of the constructor with it: the
    // release tail is the preset's, and the 5 ms attack is what keeps an mp3's
    // encoder-delay edge from clicking on every pluck.
    expect(hoisted.samplers[0].release).toBe(1);
    expect(hoisted.samplers[0].attack).toBe(0.005);
    v.dispose();
  });

  it('adds each buffer to the Sampler as the store resolves it', async () => {
    const v = new Voice(twoNotePreset());
    v.play('A3', '4n', 0);
    expect(hoisted.samplers[0].added).toEqual([]);

    await settleLoads();

    expect(hoisted.samplers[0].added.sort()).toEqual(['A3', 'C4']);
    v.dispose();
  });

  it('does not add a buffer that failed to load', async () => {
    const v = new Voice(twoNotePreset());
    v.play('A3', '4n', 0);

    // What the store resolves to when it gave up: an empty buffer. Added, it
    // would become the nearest sample for its neighbours and silence them too.
    await settleLoads({ loaded: false });

    expect(hoisted.samplers[0].added).toEqual([]);
    v.dispose();
  });

  it('holds Tone.loaded() until the fill lands, then leaves the queue empty', async () => {
    const v = new Voice(twoNotePreset());
    v.play('A3', '4n', 0);

    // THE load-bearing assertion of this whole change. Nothing on the playback
    // path awaits `Voice.ready()`; `Metronome.start()` awaits `Tone.loaded()`,
    // which drains `ToneAudioBuffer.downloads` and nothing else. A buffer handed
    // to `Sampler.add()` already decoded never registers there by itself, so
    // without the explicit registration the transport starts on empty samplers.
    expect(Tone.ToneAudioBuffer.downloads.length).toBeGreaterThan(0);
    const raced = await Promise.race([
      Tone.loaded().then(() => 'resolved'),
      tick().then(() => 'still waiting'),
    ]);
    expect(raced).toBe('still waiting');

    await settleLoads();
    await Tone.loaded();

    // Spliced out in a `finally`, as Tone does for its own loads: `loaded()`
    // drains with `while (downloads.length) yield downloads[0]`, so a promise
    // that never leaves the array makes every later await spin forever.
    expect(Tone.ToneAudioBuffer.downloads).toHaveLength(0);
    v.dispose();
  });

  it('resolves Tone.loaded() even when every load failed', async () => {
    const v = new Voice(twoNotePreset());
    v.play('A3', '4n', 0);

    // The fill must not REJECT: `Metronome.start()` awaits `Tone.loaded()` after
    // setting itself running, so a rejection throws inside a started transport.
    // Note this is a RESOLUTION with an empty buffer, which is what the store
    // promises to do. The test below is the one that distrusts that promise.
    await settleLoads({ loaded: false });
    await expect(Tone.loaded()).resolves.toBeUndefined();
    v.dispose();
  });

  it('survives a load that rejects, and still waits for the rest of the bank', async () => {
    const v = new Voice(twoNotePreset());
    v.play('A3', '4n', 0);

    await rejectLoad(A3);

    // One dead load must not release the gate: the other 143 files in a real
    // pack are still coming, and `Metronome.start()` is holding on this.
    const raced = await Promise.race([
      Tone.loaded().then(() => 'resolved'),
      tick().then(() => 'still waiting'),
    ]);
    expect(raced).toBe('still waiting');

    await settleLoad(C4);

    expect(hoisted.samplers[0].added).toEqual(['C4']);
    await expect(Tone.loaded()).resolves.toBeUndefined();
    expect(Tone.ToneAudioBuffer.downloads).toHaveLength(0);
    v.dispose();
  });

  it('gives up holding Tone.loaded() rather than freezing a started transport', async () => {
    vi.useFakeTimers();
    try {
      const v = new Voice(twoNotePreset());
      v.play('A3', '4n', 0);
      expect(Tone.ToneAudioBuffer.downloads.length).toBeGreaterThan(0);

      // Nothing lands. The store retries a refused URL four times with backoff
      // inside a six-wide pool, so a cold 144-file pack against a rate-limiting
      // origin holds `Metronome.start()` for over a minute — AFTER it has set
      // itself running, with nothing in the console.
      await vi.advanceTimersByTimeAsync(SAMPLE_FILL_GATE_MS);
      await Tone.loaded();

      expect(Tone.ToneAudioBuffer.downloads).toHaveLength(0);
      // What expired is the WAIT, not the load: the fill is still outstanding
      // and its buffers will still be added when they arrive.
      expect(store.pending).toHaveLength(2);
      // And giving up degrades to silence rather than to garbage, which is the
      // only reason giving up is allowed at all.
      v.play('A3', '4n', 0);
      expect(hoisted.samplers[0].triggers).toBe(0);
      v.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Voice — the resident-note guard (silence, never a repitch)', () => {
  it('drops a note while the bank is still empty', () => {
    const v = new Voice(twoNotePreset());
    v.play('A3', '4n', 0);

    // An empty `Tone.Sampler` does not fall silent — `_findClosest` searches ±96
    // semitones and repitches from whatever landed first. Before the store, a
    // sample the origin refused was silence; it has to stay silence.
    expect(hoisted.samplers[0].triggers).toBe(0);
  });

  it('plays the note once its own sample has landed', async () => {
    const v = new Voice(twoNotePreset());
    v.play('A3', '4n', 0);
    await settleLoads();

    v.play('A3', '4n', 0);

    expect(hoisted.samplers[0].triggers).toBe(1);
    v.dispose();
  });

  it('drops a note whose exact sample is outstanding, even with a sibling resident', async () => {
    const v = new Voice(twoNotePreset());
    v.play('A3', '4n', 0);
    await settleLoad(C4);

    // A3 is three semitones from the only resident sample. A finished sampler
    // would use A3's own file, so repitching from C4 is a bigger shift than this
    // voice will ever make once loaded — which is the mid-fill garbage the guard
    // exists to stop.
    v.play('A3', '4n', 0);

    expect(hoisted.samplers[0].triggers).toBe(0);
    v.dispose();
  });

  it('still plays a note the finished sampler would repitch anyway', async () => {
    const v = new Voice(twoNotePreset());
    v.play('A3', '4n', 0);
    await settleLoad(C4);

    // B3 is unsampled: C4 is its nearest neighbour whether the fill is finished
    // or not, so the guard has no reason to drop it. The guard is "no worse than
    // the finished sampler", not "exact match only" — too strict here would mute
    // every pitch between samples for the length of the fill.
    v.play('B3', '4n', 0);

    expect(hoisted.samplers[0].triggers).toBe(1);
    v.dispose();
  });

  it('stops guarding once the fill is finished', async () => {
    const v = new Voice(twoNotePreset());
    v.play('A3', '4n', 0);
    await settleLoads();

    // Both sides of the same coin as the test above: every pitch plays now,
    // including the ones no file covers.
    v.play('F2', '4n', 0);
    v.play('E5', '4n', 0);

    expect(hoisted.samplers[0].triggers).toBe(2);
    v.dispose();
  });

  it('goes on guarding a note whose file never arrives', async () => {
    const v = new Voice(twoNotePreset());
    v.play('A3', '4n', 0);

    // The fill has SETTLED — nothing is outstanding — but A3 was refused. A
    // "the promise finished" flag would switch the guard off here and hand every
    // A3 for the rest of this voice's life to C4's file instead, which is the
    // loud-and-wrong outcome the guard exists to prevent, made permanent. What
    // a refused sample sounded like before the store was silence, and one pitch
    // of silence is still the right answer.
    await settleLoad(C4);
    await settleLoad(A3, { loaded: false });
    await expect(Tone.loaded()).resolves.toBeUndefined();

    v.play('A3', '4n', 0);
    expect(hoisted.samplers[0].triggers).toBe(0);

    // And it is one PITCH, not the voice: everything C4's file legitimately
    // covers still sounds.
    v.play('C4', '4n', 0);
    v.play('D4', '4n', 0);
    expect(hoisted.samplers[0].triggers).toBe(2);
    v.dispose();
  });

  it('never repitches across octaves from the one file that landed', async () => {
    const E2 = '/pack/E2.mp3';
    const C6 = '/pack/C6.mp3';
    const v = new Voice(twoNotePreset({
      source: { kind: 'sampler', samples: [{ E2, C6 }], release: 1 },
    }));
    v.play('E2', '4n', 0);
    await settleLoad(C6);

    // The shape of the 429 storm: one file in the bank lands and the rest are
    // refused. `_findClosest` searches ±96 semitones, so an E2 triggered against
    // a lone resident C6 plays at nearly four octaves of rate.
    v.play('E2', '4n', 0);
    expect(hoisted.samplers[0].triggers).toBe(0);

    await settleLoad(E2);
    v.play('E2', '4n', 0);
    expect(hoisted.samplers[0].triggers).toBe(1);
    v.dispose();
  });
});

/**
 * The picker's half of the resident guard. `_samplerBankUrls` says what a bank
 * WILL hold once its fill finishes; mid-fill that makes it a lie, and trusting
 * it alone routes the note to a bank holding nothing while a sibling already has
 * the sample. Single-bank presets cannot catch this — with one bank the pool is
 * `[0]` whether the intersection is there or not.
 */
describe('Voice — _pickBankFor routes to the bank that actually has the sample', () => {
  const B0_A3 = '/b0/A3.mp3';
  const B0_C4 = '/b0/C4.mp3';
  const B1_A3 = '/b1/A3.mp3';
  const B1_C4 = '/b1/C4.mp3';
  const twoBankPreset: VoicePreset = {
    ...ACOUSTIC_GUITAR_PRESET,
    source: {
      kind: 'sampler',
      samples: [{ A3: B0_A3, C4: B0_C4 }, { A3: B1_A3, C4: B1_C4 }],
      release: 1,
    },
  };

  it('sends every trigger to the resident bank while the sibling is outstanding', async () => {
    const v = new Voice(twoBankPreset);
    v.play('A3', '4n', 0);
    expect(hoisted.samplers).toHaveLength(2);

    await settleLoad(B1_A3);

    // Deterministic despite the random rotation: the exact-match pool has one
    // member, so there is nothing to rotate between. Ten triggers because
    // without the intersection the pool is both banks and bank 0 — which holds
    // nothing — would be picked about half the time and dropped by `canSound`.
    for (let i = 0; i < 10; i++) v.play('A3', '4n', 0);

    expect(hoisted.samplers[1].triggers).toBe(10);
    expect(hoisted.samplers[0].triggers).toBe(0);
    v.dispose();
  });

  it('resumes rotating across both banks once both have the sample', async () => {
    const v = new Voice(twoBankPreset);
    v.play('A3', '4n', 0);
    await settleLoad(B1_A3);
    await settleLoad(B0_A3);

    // Random-no-repeat over a two-bank pool alternates strictly, so ten
    // triggers cannot land on one bank.
    for (let i = 0; i < 10; i++) v.play('A3', '4n', 0);

    expect(hoisted.samplers[0].triggers).toBeGreaterThan(0);
    expect(hoisted.samplers[1].triggers).toBeGreaterThan(0);
    expect(hoisted.samplers[0].triggers + hoisted.samplers[1].triggers).toBe(10);
    v.dispose();
  });
});

describe('Voice — the generation guard', () => {
  it('abandons a fill whose Sampler was disposed', async () => {
    const v = new Voice(twoNotePreset());
    v.play('A3', '4n', 0);
    v.dispose();

    await settleLoads();

    // `Sampler.add` on a disposed instance does NOT throw — it decodes quietly
    // into a cleared map and pins the PCM alive. Silent, and ~100 MB a voice.
    expect(hoisted.samplers[0].added).toEqual([]);
  });

  it('fills the new samplers and not the old ones after a pack change', async () => {
    const v = new Voice(twoNotePreset());
    v.play('A3', '4n', 0);
    const first = hoisted.samplers[0];

    // A source change tears the graph down and rebuilds it, while the first
    // fill is still holding references to the samplers it is filling.
    v.swapPreset(twoNotePreset({
      source: { kind: 'sampler', samples: [{ A3: '/other/A3.mp3' }], release: 1 },
    }));
    await settleLoads();

    expect(first.added).toEqual([]);
    expect(hoisted.samplers[1].added).toEqual(['A3']);
    v.dispose();
  });

  it('does NOT abandon the primary fill when only the chain is rebuilt', async () => {
    const v = new Voice(twoNotePreset({
      compressor: { threshold: -16, ratio: 3, attack: 0.01, release: 0.1, knee: 4 },
    }));
    v.play('A3', '4n', 0);

    // Removing a stage rebuilds the chain — and the samplers survive a chain
    // rebuild untouched. One generation counter for the whole voice would abort
    // this fill here, leaving a LIVE voice permanently half-loaded: silent
    // notes, which is the exact failure this work exists to end.
    v.updateCompressor(undefined);
    await settleLoads();

    expect(hoisted.samplers[0].added.sort()).toEqual(['A3', 'C4']);
    v.dispose();
  });

  it('does NOT abandon the primary fill when only the layer is replaced', async () => {
    const v = new Voice(twoNotePreset({
      layer: {
        source: { kind: 'pluck-synth', params: { attackNoise: 1, dampening: 4000, resonance: 0.8, release: 0.5 } },
        gainDb: -8,
        octaveOffset: -1,
        detuneCents: 0,
      },
    }));
    v.play('A3', '4n', 0);

    v.updateLayer(undefined);
    await settleLoads();

    expect(hoisted.samplers[0].added.sort()).toEqual(['A3', 'C4']);
    v.dispose();
  });
});

describe('Voice — a sampler LAYER fills the same way', () => {
  const layerPreset: VoicePreset = {
    ...ELECTRIC_GUITAR_PRESET,
    layer: {
      source: { kind: 'sampler', samples: [{ A3: '/layer/A3.mp3' }], release: 1 },
      gainDb: -8,
      octaveOffset: 0,
      detuneCents: 0,
    },
  };

  it('builds the layer sampler empty and fills it from the store', async () => {
    // `buildSynth`'s sampler branch is reached only through the layer path — a
    // sampler PRIMARY always goes down the multi-bank branch in `_ensureBuilt`.
    const v = new Voice(layerPreset);
    v.play('A3', '4n', 0);

    expect(hoisted.samplers).toHaveLength(1);
    expect(hoisted.samplers[0].urls).toEqual({});
    // The other constructor options, pinned at this site too — it is a separate
    // `new Tone.Sampler` from the multi-bank one and can lose them on its own.
    expect(hoisted.samplers[0].release).toBe(1);
    expect(hoisted.samplers[0].attack).toBe(0.005);
    expect(store.pending.map((load) => load.url)).toEqual(['/layer/A3.mp3']);

    await settleLoads();
    expect(hoisted.samplers[0].added).toEqual(['A3']);
    v.dispose();
  });

  it('abandons the layer fill when the layer is disposed', async () => {
    const v = new Voice(layerPreset);
    v.play('A3', '4n', 0);

    v.updateLayer(undefined);
    await settleLoads();

    expect(hoisted.samplers[0].added).toEqual([]);
    v.dispose();
  });

  it('skips the layer trigger while its sampler is empty', () => {
    const v = new Voice(layerPreset);

    // Not just for the layer's own sake: an unfilled sampler THROWS out of
    // `triggerAttackRelease`, and the catch around the trigger block would then
    // swallow palm-mute, the pitch curve and the vibrato for a note whose
    // primary sounded fine.
    v.play('A3', '4n', 0);

    expect(hoisted.samplers[0].triggers).toBe(0);
    v.dispose();
  });
});

describe('Voice — the cabinet IR', () => {
  const IR_URL = '/cabs/1x12.wav';
  const cabPreset: VoicePreset = {
    ...ELECTRIC_GUITAR_PRESET,
    effects: { ...ELECTRIC_GUITAR_PRESET.effects, cabIR: { url: IR_URL, makeupDb: 3 } },
  };

  it('builds the Convolver with no url and assigns the buffer when it resolves', async () => {
    const v = new Voice(cabPreset);
    v.play('A3', '4n', 0);

    expect(hoisted.convolvers).toHaveLength(1);
    expect(hoisted.convolvers[0].url).toBeUndefined();
    // `normalize: false` is applied at construction and the setter does not
    // re-apply it, so the buffer assignment below must be the FIRST one.
    expect(hoisted.convolvers[0].normalize).toBe(false);
    expect(store.pending.map((load) => load.url)).toEqual([IR_URL]);
    expect(hoisted.convolvers[0].buffer).toBeNull();

    await settleLoads();

    expect(hoisted.convolvers[0].buffer).not.toBeNull();
    v.dispose();
  });

  it('never lets a stale IR land on a rebuilt Convolver', async () => {
    const v = new Voice(cabPreset);
    v.play('A3', '4n', 0);
    v.updateCompressor(undefined);

    // The rebuild re-armed the fill — which it must, or `Tone.loaded()` resolves
    // early after every retune — so there are two loads outstanding for one URL.
    expect(hoisted.convolvers).toHaveLength(2);
    await settleLoads();

    expect(hoisted.convolvers[0].buffer).toBeNull();
    expect(hoisted.convolvers[1].buffer).not.toBeNull();
    v.dispose();
  });

  it('leaves the Convolver alone when the IR fails to load', async () => {
    const v = new Voice(cabPreset);
    v.play('A3', '4n', 0);

    // Assigning the store's empty buffer hands the ConvolverNode a null buffer,
    // and the cab stage then passes NOTHING rather than passing the signal
    // through undarkened.
    await settleLoads({ loaded: false });

    expect(hoisted.convolvers[0].buffer).toBeNull();
    v.dispose();
  });

  it('holds Tone.loaded() until the IR lands', async () => {
    const v = new Voice(cabPreset);
    v.play('A3', '4n', 0);

    // The IR's own half of the registration, and the severe one: a Convolver
    // holding a null buffer does not pass the signal through undarkened, it
    // passes NOTHING — starting the transport before the IR lands mutes every
    // track that has one. The electric preset's primary is a PluckSynth, so this
    // one download is the IR's and nothing else's.
    expect(Tone.ToneAudioBuffer.downloads).toHaveLength(1);
    const raced = await Promise.race([
      Tone.loaded().then(() => 'resolved'),
      tick().then(() => 'still waiting'),
    ]);
    expect(raced).toBe('still waiting');

    await settleLoads();
    await Tone.loaded();

    expect(Tone.ToneAudioBuffer.downloads).toHaveLength(0);
    expect(hoisted.convolvers[0].buffer).not.toBeNull();
    v.dispose();
  });

  it('re-arms Tone.loaded() when a retune rebuilds the chain', async () => {
    const v = new Voice(cabPreset);
    v.play('A3', '4n', 0);
    await settleLoads();
    expect(Tone.ToneAudioBuffer.downloads).toHaveLength(0);

    // `buildChain` runs from `_rebuildChain` as well as `_ensureBuilt`. Arming
    // the gate only on the build path leaves every retune starting the transport
    // against a fresh Convolver with no buffer.
    v.updateCompressor(undefined);

    expect(Tone.ToneAudioBuffer.downloads).toHaveLength(1);
    const raced = await Promise.race([
      Tone.loaded().then(() => 'resolved'),
      tick().then(() => 'still waiting'),
    ]);
    expect(raced).toBe('still waiting');

    await settleLoads();
    expect(hoisted.convolvers[1].buffer).not.toBeNull();
    v.dispose();
  });

  it('resolves Tone.loaded() when the IR load rejects', async () => {
    const v = new Voice(cabPreset);
    v.play('A3', '4n', 0);

    await rejectLoads();

    await expect(Tone.loaded()).resolves.toBeUndefined();
    expect(Tone.ToneAudioBuffer.downloads).toHaveLength(0);
    expect(hoisted.convolvers[0].buffer).toBeNull();
    v.dispose();
  });

  it('never fetches an IR from the test-only chain builder', () => {
    // `buildChainNodesForTest` is handed an already-stale guard, so a preset with
    // a cabIR builds the Convolver without asking the store for anything.
    // `tests/circuit-amp-chain` mocks `tone` but not `sample-store`: without this
    // the helper would fire a real network fetch out of vitest.
    const nodes = buildChainNodesForTest(cabPreset);

    expect(nodes.cabIR).toBeDefined();
    expect(store.pending).toHaveLength(0);
    expect(Tone.ToneAudioBuffer.downloads).toHaveLength(0);
  });
});
