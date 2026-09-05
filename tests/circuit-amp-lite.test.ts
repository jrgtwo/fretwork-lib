/**
 * The lite renderer's graph, asserted through a Tone mock.
 *
 * What is worth holding here is not that Tone works — it is that the TOPOLOGY
 * is the circuit's:
 *
 *   - the signal passes through both triode stages in series,
 *   - the Volume sits BETWEEN the first triode and the tone network, not in
 *     front of the amp (that is the input gain, and they are different
 *     controls that sound different at matched output level),
 *   - the sag path is a SIDE CHAIN feeding a gain's param, not a box in the
 *     signal path. A rectifier's droop is a supply the stages read, not a
 *     stage they pass through, and getting that wrong makes every future
 *     tube-rectified amp wrong the same way.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({ connections: [] as Array<[string, string]> }));

vi.mock('tone', () => {
  let counter = 0;
  const param = (initial = 1) => ({
    value: initial,
    rampTo(v: number) {
      this.value = v;
    },
  });
  class MockNode {
    readonly tag: string;
    constructor(tag: string) {
      this.tag = `${tag}#${counter++}`;
    }
    connect(target: { tag?: string }) {
      hoisted.connections.push([this.tag, target?.tag ?? 'param']);
      return this;
    }
    disconnect() {}
    dispose() {}
  }
  class Gain extends MockNode {
    gain = param();
    constructor(value?: number) {
      super('Gain');
      if (typeof value === 'number') this.gain.value = value;
    }
  }
  class Filter extends MockNode {
    frequency = param(1000);
    Q = param(0.7);
    type = 'lowpass';
    constructor(options?: { type?: string; frequency?: number }) {
      super('Filter');
      if (options?.type) this.type = options.type;
      if (typeof options?.frequency === 'number') this.frequency.value = options.frequency;
    }
  }
  class WaveShaper extends MockNode {
    constructor(public mapping?: unknown) {
      super('WaveShaper');
    }
  }
  class Follower extends MockNode {
    smoothing: number;
    constructor(smoothing?: number) {
      super('Follower');
      this.smoothing = typeof smoothing === 'number' ? smoothing : 0.05;
    }
  }
  class Scale extends MockNode {
    constructor(
      public min: number,
      public max: number,
    ) {
      super('Scale');
    }
  }
  return { Gain, Filter, WaveShaper, Follower, Scale };
});

import {
  buildCircuitAmpLite,
  applyCircuitAmpLite,
  disposeCircuitAmpLite,
  controlValue,
} from '../src/playback/voices/circuit-amp/lite-renderer';
import { getCircuitAmp } from '../src/playback/voices/circuit-amp/registry';
import type { CircuitAmpParams } from '../src/playback/voices/types';

const AMP = getCircuitAmp('princeton-5f2a');

function params(overrides: Partial<CircuitAmpParams> = {}): CircuitAmpParams {
  return {
    ampId: 'princeton-5f2a',
    inputGainDb: 0,
    controls: { volume: 0.5, tone: 0.5 },
    ...overrides,
  };
}

beforeEach(() => {
  hoisted.connections.length = 0;
});

/** The mock gives every node a `tag`; the real Tone types do not, so reads of
 *  mock-only fields go through these rather than sprinkling casts. */
function tagOf(node: unknown): string {
  return (node as { tag: string }).tag;
}

function scaleRange(node: unknown): { min: number; max: number } {
  return node as { min: number; max: number };
}

function targetsOf(node: unknown): string[] {
  const tag = tagOf(node);
  return hoisted.connections.filter(([from]) => from === tag).map(([, to]) => to);
}

describe('buildCircuitAmpLite — topology', () => {
  it('runs the signal through both triodes in series', () => {
    const nodes = buildCircuitAmpLite(params(), AMP);
    expect(targetsOf(nodes.triode1Gain)).toContain(tagOf(nodes.triode1Shaper));
    expect(targetsOf(nodes.triode2Gain)).toContain(tagOf(nodes.triode2Shaper));
    expect(targetsOf(nodes.toneFilter)).toContain(tagOf(nodes.triode2Gain));
    disposeCircuitAmpLite(nodes);
  });

  it('puts Volume between the first triode and the tone network, not in front of the amp', () => {
    const nodes = buildCircuitAmpLite(params(), AMP);
    expect(targetsOf(nodes.triode1Miller)).toContain(tagOf(nodes.volumeGain));
    expect(targetsOf(nodes.volumeGain)).toContain(tagOf(nodes.toneFilter));
    expect(targetsOf(nodes.inputGain)).not.toContain(tagOf(nodes.toneFilter));
    expect(targetsOf(nodes.inputGain)).toContain(tagOf(nodes.triode1Gain));
    disposeCircuitAmpLite(nodes);
  });

  it('feeds the sag path from the signal without putting it in series', () => {
    const nodes = buildCircuitAmpLite(params(), AMP);
    expect(targetsOf(nodes.triode2Miller)).toContain(tagOf(nodes.sagFollower));
    expect(targetsOf(nodes.sagFollower)).toContain(tagOf(nodes.sagScale));
    // Reaches a PARAM, never an audio node.
    expect(targetsOf(nodes.sagScale)).toEqual(['param']);
    disposeCircuitAmpLite(nodes);
  });

  it('leaves the sag gain at zero so the side chain alone drives it', () => {
    // A signal-rate connection to an AudioParam SUMS with the param's own
    // value. Starting this at 1 would make it 2 at silence — a silent +6 dB,
    // which is the class of bug this project has already paid for.
    const nodes = buildCircuitAmpLite(params(), AMP);
    expect(nodes.sagGain.gain.value).toBe(0);
    expect(scaleRange(nodes.sagScale).min).toBe(1);
    expect(scaleRange(nodes.sagScale).max).toBeCloseTo(1 - AMP.circuit.supply.sagDepth, 6);
    disposeCircuitAmpLite(nodes);
  });

  it('takes the supply time constant from the definition', () => {
    const nodes = buildCircuitAmpLite(params(), AMP);
    expect((nodes.sagFollower as unknown as { smoothing: number }).smoothing).toBe(
      AMP.circuit.supply.smoothingSeconds,
    );
    disposeCircuitAmpLite(nodes);
  });

  it('exposes the input gain as entry and the transformer as exit', () => {
    const nodes = buildCircuitAmpLite(params(), AMP);
    expect(nodes.entry).toBe(nodes.inputGain);
    expect(nodes.exit).toBe(nodes.transformerHf);
    disposeCircuitAmpLite(nodes);
  });
});

describe('controlValue', () => {
  it('reads a declared control', () => {
    expect(controlValue(params({ controls: { volume: 0.8, tone: 0.2 } }), AMP, 'volume')).toBe(0.8);
  });

  it('falls back to the control default when the key is missing', () => {
    expect(controlValue(params({ controls: {} }), AMP, 'tone')).toBe(0.5);
  });

  it('returns 0 for a control this amp does not declare', () => {
    expect(controlValue(params(), AMP, 'presence')).toBe(0);
  });
});

describe('applyCircuitAmpLite — knobs move the right nodes', () => {
  it('turning Volume down lowers the volume gain, not the input gain', () => {
    const nodes = buildCircuitAmpLite(params({ controls: { volume: 0.9, tone: 0.5 } }), AMP);
    const inputBefore = nodes.inputGain.gain.value;
    const volumeBefore = nodes.volumeGain.gain.value;
    applyCircuitAmpLite(nodes, params({ controls: { volume: 0.2, tone: 0.5 } }), AMP);
    expect(nodes.volumeGain.gain.value).toBeLessThan(volumeBefore);
    expect(nodes.inputGain.gain.value).toBe(inputBefore);
    disposeCircuitAmpLite(nodes);
  });

  it('turning Tone up raises the filter cutoff', () => {
    const nodes = buildCircuitAmpLite(params({ controls: { volume: 0.5, tone: 0.1 } }), AMP);
    const dark = Number(nodes.toneFilter.frequency.value);
    applyCircuitAmpLite(nodes, params({ controls: { volume: 0.5, tone: 0.9 } }), AMP);
    expect(Number(nodes.toneFilter.frequency.value)).toBeGreaterThan(dark);
    disposeCircuitAmpLite(nodes);
  });

  it('input gain follows inputGainDb', () => {
    const nodes = buildCircuitAmpLite(params({ inputGainDb: 0 }), AMP);
    applyCircuitAmpLite(nodes, params({ inputGainDb: 12 }), AMP);
    expect(nodes.inputGain.gain.value).toBeCloseTo(Math.pow(10, 12 / 20), 4);
    disposeCircuitAmpLite(nodes);
  });
});
