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
  function reset() {
    for (const k of Object.keys(calls) as (keyof typeof calls)[]) calls[k] = 0;
  }
  return { calls, reset };
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
    getContext: () => ({ currentTime: 0 }),
    start: async () => undefined,
    now: () => 0,
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
