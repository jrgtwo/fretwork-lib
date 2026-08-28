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
  /** Every value a `Tone.Gain` was constructed with, in build order. Counting
   *  constructors is not enough for AF-03's source trim: the trim's whole
   *  content IS its value, and a node built at unity looks identical to one
   *  built correctly if you only count them. */
  const gainValues: number[] = [];
  function reset() {
    for (const k of Object.keys(calls) as (keyof typeof calls)[]) calls[k] = 0;
    gainValues.length = 0;
  }
  return { calls, reset, gainValues };
});

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

  /** Tone.Frequency utility — supports `Tone.Frequency(note).transpose(N).toNote()`.
   *  We don't model real semitone math; transpose just returns the same note. The
   *  tests don't rely on accurate transposition. */
  function frequencyShim(note: string) {
    return {
      transpose: (_n: number) => frequencyShim(note),
      toNote: () => note,
      toMidi: () => 60,
      // `Voice.play` converts to Hz so it can apply the humanize detune in cents
      // (Voice.ts:327). A fixed value is fine — nothing here asserts pitch, and the
      // detune is randomised anyway.
      toFrequency: () => 440,
    };
  }

  class MockSampler extends MockNode {
    triggerAttackRelease = noop;
    constructor(_opts: { urls: Record<string, string>; release?: number }) {
      super();
      hoisted.calls.samplerCtor++;
    }
    override dispose = () => { hoisted.calls.samplerDispose++; };
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
    Convolver: class extends MockNode {},
    JCReverb: class extends MockNode {},
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
    loaded: async () => undefined,
    now: () => 0,
    dbToGain: (db: number) => Math.pow(10, db / 20),
    gainToDb: (g: number) => 20 * Math.log10(Math.max(0.0001, g)),
  };
});

import { Voice } from '../src/playback/voices/Voice';
import { _resetMasterBusForTests, MasterBus } from '../src/playback/voices/MasterBus';
import {
  ACOUSTIC_GUITAR_PRESET,
  ELECTRIC_GUITAR_PRESET,
  ACOUSTIC_BASS_PRESET,
  ACOUSTIC_UKULELE_PRESET,
} from '../src/playback/voices/presets';
import { REFERENCE_LEVEL_DBFS, SAMPLE_PACK_PEAK_DBFS } from '../src/playback/voices/levels';

beforeEach(() => {
  hoisted.reset();
  vi.clearAllMocks();
  _resetMasterBusForTests();
});

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
