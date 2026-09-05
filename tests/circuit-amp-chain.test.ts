/**
 * The chain-level rules: one amp or the other, and a tap that sees the amp
 * alone.
 *
 * ── Why the fourth meter exists ─────────────────────────────────────────────
 *
 * The three taps already in `Voice` cannot answer "is the amp itself peaking".
 * `inputMeter` sits on the input gain, ahead of the whole pedalboard;
 * `driveMeter` sits in FRONT of the amp; `outputMeter` sits on the panner,
 * with the cab, the final EQ and the voice volume already applied. So the amp
 * is bracketed and never measured.
 *
 * It is also how a circuit amp reports what it did to level at all.
 * `gain-structure.ts` is arithmetic over a preset — it reads gain nodes' dB and
 * probes shapers' curves near the origin — and a circuit amp's gain is a
 * product of several stages that varies with playing strength once the supply
 * sags. So the amp's contribution is MEASURED, not derived: the difference
 * between the drive tap and this one.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('tone', () => {
  const param = (initial = 1) => ({
    value: initial,
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
    constructor(value?: number) {
      super();
      if (typeof value === 'number') this.gain.value = value;
    }
  }
  class Filter extends MockNode {
    frequency = param(1000);
    Q = param(0.7);
    gain = param(0);
    type = 'lowpass';
    constructor(options?: { type?: string; frequency?: number }) {
      super();
      if (options?.type) this.type = options.type;
      if (typeof options?.frequency === 'number') this.frequency.value = options.frequency;
    }
  }
  class WaveShaper extends MockNode {
    oversample = 'none';
    constructor(public mapping?: unknown) {
      super();
    }
    setMap(mapping: unknown) {
      this.mapping = mapping;
      return this;
    }
  }
  class Follower extends MockNode {
    constructor(public smoothing?: number) {
      super();
    }
  }
  class Scale extends MockNode {
    constructor(
      public min: number,
      public max: number,
    ) {
      super();
    }
  }
  class EQ3 extends MockNode {
    low = param(0);
    mid = param(0);
    high = param(0);
    lowFrequency = param(400);
    highFrequency = param(2500);
  }
  class Analyser extends MockNode {
    getValue() {
      return new Float32Array(64);
    }
  }
  class Volume extends MockNode {
    volume = param(0);
  }
  class Panner extends MockNode {
    pan = param(0);
  }
  return { Gain, Filter, WaveShaper, Follower, Scale, EQ3, Analyser, Volume, Panner };
});

import { buildChainNodesForTest } from '../src/playback/voices/Voice';
import type { AmpParams, CircuitAmpParams, VoicePreset } from '../src/playback/voices/types';

function presetWith(effects: VoicePreset['effects']): VoicePreset {
  return {
    id: 'test',
    name: 'test',
    instrumentId: 'guitar',
    family: 'electric',
    source: { kind: 'pluck-synth', attackNoise: 1, dampening: 4000, resonance: 0.9 },
    level: { volumeDb: 0, pan: 0 },
    effects,
  } as unknown as VoicePreset;
}

const CIRCUIT: CircuitAmpParams = {
  ampId: 'princeton-5f2a',
  inputGainDb: 0,
  controls: { volume: 0.5, tone: 0.5 },
};

const CLASSIC: AmpParams = {
  preGainDb: 0,
  preDrive: 0.3,
  bass: 0,
  mid: 0,
  treble: 0,
  presence: 0,
  powerDrive: 0.2,
  outputDb: 0,
};

describe('one amp or the other', () => {
  it('builds the circuit amp and skips the classic one when both are present', () => {
    const nodes = buildChainNodesForTest(presetWith({ amp: CLASSIC, circuitAmp: CIRCUIT }));
    expect(nodes.circuitAmp).toBeDefined();
    expect(nodes.ampPreGain).toBeUndefined();
    expect(nodes.ampTone).toBeUndefined();
    expect(nodes.ampPreDist).toBeUndefined();
  });

  it('builds the classic amp when the circuit amp is disabled', () => {
    const nodes = buildChainNodesForTest(
      presetWith({ amp: CLASSIC, circuitAmp: { ...CIRCUIT, enabled: false } }),
    );
    expect(nodes.circuitAmp).toBeUndefined();
    expect(nodes.ampPreGain).toBeDefined();
  });

  it('builds the circuit amp on its own when there is no classic amp', () => {
    const nodes = buildChainNodesForTest(presetWith({ circuitAmp: CIRCUIT }));
    expect(nodes.circuitAmp).toBeDefined();
    expect(nodes.ampPreGain).toBeUndefined();
  });

  it('builds neither when the preset has no amp at all', () => {
    const nodes = buildChainNodesForTest(presetWith({}));
    expect(nodes.circuitAmp).toBeUndefined();
    expect(nodes.ampPreGain).toBeUndefined();
  });
});

describe('the amp-output meter', () => {
  it('exists whenever a circuit amp is built', () => {
    const nodes = buildChainNodesForTest(presetWith({ circuitAmp: CIRCUIT }));
    expect(nodes.circuitAmpMeter).toBeDefined();
  });

  it('does not exist when there is no circuit amp', () => {
    const nodes = buildChainNodesForTest(presetWith({ amp: CLASSIC }));
    expect(nodes.circuitAmpMeter).toBeUndefined();
  });
});
