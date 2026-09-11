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
import {
  buildPhaseInverterLegs,
  plateLegCornerHz,
} from '../src/playback/voices/circuit-amp/lite-renderer';
import { getCircuitAmp } from '../src/playback/voices/circuit-amp/registry';
import { DELUXE_5E3 } from '../src/playback/voices/circuit-amp/amps/deluxe-5e3';
import { pushPullCurve } from '../src/playback/voices/circuit-amp/circuit-math';
import { harmonicOfPhase } from './harmonic';
import type { PushPullDualChannelCircuit } from '../src/playback/voices/circuit-amp/types';
import type { CircuitAmpParams } from '../src/playback/voices/types';

/** `DELUXE_5E3.circuit` is the union and `phaseInverter` lives on one arm. */
const DELUXE_5E3_CIRCUIT = DELUXE_5E3.circuit as PushPullDualChannelCircuit;

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

/** The Princeton is single-ended. Narrowed once here rather than in every
 *  test, now that `CircuitAmpLiteNodes` has a second arm. */
function buildPrinceton(p: CircuitAmpParams = params()) {
  const n = buildCircuitAmpLite(p, AMP);
  if (n.topology !== 'single-ended') throw new Error('the Princeton is single-ended');
  return n;
}

describe('buildCircuitAmpLite — topology', () => {
  it('runs the signal through both triodes in series', () => {
    const nodes = buildPrinceton();
    expect(targetsOf(nodes.triode1.gain)).toContain(tagOf(nodes.triode1.shaper));
    expect(targetsOf(nodes.triode2.gain)).toContain(tagOf(nodes.triode2.shaper));
    expect(targetsOf(nodes.toneFilter)).toContain(tagOf(nodes.triode2.gain));
    disposeCircuitAmpLite(nodes);
  });

  it('puts Volume between the first triode and the tone network, not in front of the amp', () => {
    const nodes = buildPrinceton();
    expect(targetsOf(nodes.triode1.miller)).toContain(tagOf(nodes.volumeGain));
    expect(targetsOf(nodes.volumeGain)).toContain(tagOf(nodes.toneFilter));
    expect(targetsOf(nodes.inputGain)).not.toContain(tagOf(nodes.toneFilter));
    expect(targetsOf(nodes.inputGain)).toContain(tagOf(nodes.triode1.gain));
    disposeCircuitAmpLite(nodes);
  });

  it('feeds the sag path from the signal without putting it in series', () => {
    const nodes = buildPrinceton();
    expect(targetsOf(nodes.triode2.miller)).toContain(tagOf(nodes.supply.follower));
    expect(targetsOf(nodes.supply.follower)).toContain(tagOf(nodes.supply.scale));
    // Reaches a PARAM, never an audio node.
    expect(targetsOf(nodes.supply.scale)).toEqual(['param']);
    disposeCircuitAmpLite(nodes);
  });

  it('leaves the sag gain at zero so the side chain alone drives it', () => {
    // A signal-rate connection to an AudioParam SUMS with the param's own
    // value. Starting this at 1 would make it 2 at silence — a silent +6 dB,
    // which is the class of bug this project has already paid for.
    const nodes = buildPrinceton();
    expect(nodes.supply.gain.gain.value).toBe(0);
    expect(scaleRange(nodes.supply.scale).min).toBe(1);
    expect(scaleRange(nodes.supply.scale).max).toBeCloseTo(1 - AMP.circuit.supply.sagDepth, 6);
    disposeCircuitAmpLite(nodes);
  });

  it('takes the supply time constant from the definition', () => {
    const nodes = buildPrinceton();
    expect((nodes.supply.follower as unknown as { smoothing: number }).smoothing).toBe(
      AMP.circuit.supply.smoothingSeconds,
    );
    disposeCircuitAmpLite(nodes);
  });

  it('exposes the input gain as entry and the transformer as exit', () => {
    const nodes = buildPrinceton();
    expect(nodes.entry).toBe(nodes.inputGain);
    expect(nodes.exit).toBe(nodes.transformer.hf);
    disposeCircuitAmpLite(nodes);
  });

  // ⚠ THE SAFETY PROPERTY OF THE TOPOLOGY REFACTOR. The Princeton's graph must
  // survive the union and the stage-builder extraction. Named by ROLE and
  // compared as a SET, so a builder that wires its internals in a different
  // order still passes while a genuinely different graph does not.
  it('builds the same graph for the Princeton after the topology split', () => {
    hoisted.connections.length = 0;
    const n = buildCircuitAmpLite(
      {
        enabled: true,
        ampId: 'princeton-5f2a',
        inputGainDb: 0,
        controls: { volume: 0.5, tone: 0.5 },
      },
      AMP,
    );
    if (n.topology !== 'single-ended') throw new Error('the Princeton is single-ended');

    const roles = new Map<string, string>([
      [tagOf(n.inputGain), 'inputGain'],
      [tagOf(n.triode1.gain), 'triode1.gain'],
      [tagOf(n.triode1.shaper), 'triode1.shaper'],
      [tagOf(n.triode1.coupling), 'triode1.coupling'],
      [tagOf(n.triode1.miller), 'triode1.miller'],
      [tagOf(n.volumeGain), 'volumeGain'],
      [tagOf(n.toneFilter), 'toneFilter'],
      [tagOf(n.triode2.gain), 'triode2.gain'],
      [tagOf(n.triode2.shaper), 'triode2.shaper'],
      [tagOf(n.triode2.coupling), 'triode2.coupling'],
      [tagOf(n.triode2.miller), 'triode2.miller'],
      [tagOf(n.supply.follower), 'supply.follower'],
      [tagOf(n.supply.scale), 'supply.scale'],
      [tagOf(n.supply.gain), 'supply.gain'],
      [tagOf(n.powerGain), 'powerGain'],
      [tagOf(n.powerShaper), 'powerShaper'],
      [tagOf(n.transformer.lf), 'transformer.lf'],
      [tagOf(n.transformer.shaper), 'transformer.shaper'],
      [tagOf(n.transformer.hf), 'transformer.hf'],
    ]);
    const edges = new Set(
      hoisted.connections.map(([from, to]) => `${roles.get(from) ?? from}->${roles.get(to) ?? to}`),
    );

    expect(edges).toEqual(
      new Set([
        'inputGain->triode1.gain',
        'triode1.gain->triode1.shaper',
        'triode1.shaper->triode1.coupling',
        'triode1.coupling->triode1.miller',
        'triode1.miller->volumeGain',
        'volumeGain->toneFilter',
        'toneFilter->triode2.gain',
        'triode2.gain->triode2.shaper',
        'triode2.shaper->triode2.coupling',
        'triode2.coupling->triode2.miller',
        'triode2.miller->supply.gain',
        'supply.gain->powerGain',
        'powerGain->powerShaper',
        'powerShaper->transformer.lf',
        'transformer.lf->transformer.shaper',
        'transformer.shaper->transformer.hf',
        // ⚠ THE SIDE CHAIN. Reads the signal, writes a gain PARAM, never in series.
        'triode2.miller->supply.follower',
        'supply.follower->supply.scale',
        'supply.scale->param',
      ]),
    );
    disposeCircuitAmpLite(n);
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
    const nodes = buildPrinceton(params({ controls: { volume: 0.9, tone: 0.5 } }));
    const inputBefore = nodes.inputGain.gain.value;
    const volumeBefore = nodes.volumeGain.gain.value;
    applyCircuitAmpLite(nodes, params({ controls: { volume: 0.2, tone: 0.5 } }), AMP);
    expect(nodes.volumeGain.gain.value).toBeLessThan(volumeBefore);
    expect(nodes.inputGain.gain.value).toBe(inputBefore);
    disposeCircuitAmpLite(nodes);
  });

  it('turning Tone up raises the filter cutoff', () => {
    const nodes = buildPrinceton(params({ controls: { volume: 0.5, tone: 0.1 } }));
    const dark = Number(nodes.toneFilter.frequency.value);
    applyCircuitAmpLite(nodes, params({ controls: { volume: 0.5, tone: 0.9 } }), AMP);
    expect(Number(nodes.toneFilter.frequency.value)).toBeGreaterThan(dark);
    disposeCircuitAmpLite(nodes);
  });

  it('input gain follows inputGainDb', () => {
    const nodes = buildPrinceton(params({ inputGainDb: 0 }));
    applyCircuitAmpLite(nodes, params({ inputGainDb: 12 }), AMP);
    expect(nodes.inputGain.gain.value).toBeCloseTo(Math.pow(10, 12 / 20), 4);
    disposeCircuitAmpLite(nodes);
  });
});

describe('the cathodyne split', () => {
  // ⚠ THE JUSTIFICATION FOR THE SPLIT, and the trap in it.
  //
  // A WaveShaper is memoryless, so split -> shape -> sum-in-opposition is
  // EXACTLY `pushPullCurve` per sample, and two shapers would buy nothing. The
  // split earns its place only through the legs' different pre-shaper FILTERS,
  // which are not composable into one curve. At legSpread 0 the filters match
  // and the built path must reduce to the composed curve.
  //
  // ⚠ THIS PROVES THE ARITHMETIC, NOT THE GRAPH. `summedCurveAt` is pure JS and
  // never clamps; Web Audio clamps a WaveShaper's INPUT at +/-1. That is why
  // `k` lives inside each leg's curve table rather than in a gain in front.
  it('reduces to the composed push-pull curve at legSpread 0', () => {
    const inverter = { ...DELUXE_5E3_CIRCUIT.phaseInverter, legSpread: 0 };
    const power = DELUXE_5E3_CIRCUIT.power;
    const composed = pushPullCurve(inverter.stage.asymmetry, power.headroom, power.imbalance);
    const legs = buildPhaseInverterLegs(inverter, power);
    for (const x of [-0.9, -0.4, -0.05, 0.05, 0.4, 0.9]) {
      expect(legs.summedCurveAt(x)).toBeCloseTo(composed(x), 9);
    }
  });

  it('separates the legs at legSpread 1', () => {
    const inverter = DELUXE_5E3_CIRCUIT.phaseInverter;
    expect(plateLegCornerHz(inverter, 1)).toBeCloseTo(inverter.plateLegLpfHz, 6);
    expect(plateLegCornerHz(inverter, 0)).toBeCloseTo(inverter.stage.millerLpfHz, 6);
    // ⚠ The PLATE leg is the dark one — it is the high-impedance output.
    expect(plateLegCornerHz(inverter, 1)).toBeLessThan(inverter.stage.millerLpfHz);
  });
});

describe('the cathodyne split, measured', () => {
  /** One leg's first-order lowpass, evaluated analytically for a sine at `hz`.
   *  Magnitude AND phase — the phase difference between the legs is most of
   *  what stops the split from cancelling the way the composed curve does. */
  const legAt = (hz: number, cornerHz: number) => {
    const w = hz / cornerHz;
    return { gain: 1 / Math.sqrt(1 + w * w), phase: -Math.atan(w) };
  };

  /** The summing node, driven at `hz`, with each leg behind its own filter. */
  const summedAt = (hz: number, legSpread: number, drive = 0.8) => {
    const c = DELUXE_5E3_CIRCUIT;
    const legs = buildPhaseInverterLegs(c.phaseInverter, c.power);
    const plate = legAt(hz, plateLegCornerHz(c.phaseInverter, legSpread));
    const cathode = legAt(hz, c.phaseInverter.stage.millerLpfHz);
    return (t: number) =>
      legs.plateCurve(drive * plate.gain * Math.sin(t + plate.phase)) -
      legs.cathodeCurve(-drive * cathode.gain * Math.sin(t + cathode.phase));
  };

  // ⚠ WHY THIS IS NOT `summedCurveAt`. That function is pure arithmetic and
  // `legSpread` moves only the legs' FILTERS, which it cannot see — comparing
  // two of them at different spreads compares the same function twice and
  // reports a difference of exactly zero. The split's whole effect is
  // frequency-dependent, so it has to be measured per frequency.
  it('records how far the split departs from the composed legs, per frequency', () => {
    const rows = [80, 220, 660, 2000, 4000].map((hz) => {
      const split = summedAt(hz, 1);
      const flat = summedAt(hz, 0);
      const rel = (g: (t: number) => number, n: number) =>
        20 * Math.log10(harmonicOfPhase(g, n) / harmonicOfPhase(g, 1));
      return {
        hz,
        h2Split: rel(split, 2).toFixed(1),
        h2Flat: rel(flat, 2).toFixed(1),
        h3Split: rel(split, 3).toFixed(1),
        h3Flat: rel(flat, 3).toFixed(1),
      };
    });
    // eslint-disable-next-line no-console
    console.table(rows);

    // The one thing that IS asserted: matched legs cancel the even harmonics,
    // and the split does not. If these ever agree the five extra nodes are noise.
    const matched = harmonicOfPhase(summedAt(2000, 0), 2);
    const split = harmonicOfPhase(summedAt(2000, 1), 2);
    expect(split).toBeGreaterThan(matched * 2);
  });
});

describe('the 5E3 lite graph', () => {
  const build = (controls: Record<string, number | string>) => {
    hoisted.connections.length = 0;
    const n = buildCircuitAmpLite(
      { enabled: true, ampId: 'deluxe-5e3', inputGainDb: 0, controls }, DELUXE_5E3,
    );
    if (n.topology !== 'push-pull-dual-channel') throw new Error('wrong topology');
    return n;
  };
  const DEFAULTS = {
    input: 'hi', bright: 'off', jumpered: 'off',
    volumeNormal: 0.5, volumeBright: 0.5, tone: 0.5, inverter: 'split',
  };

  // The fork is the point of this amp: two input triodes, both fed from the
  // input pad, both arriving at one summing node — plus the bright cap's
  // parallel path, which is the THIRD edge in and is easy to leave out.
  it('forks into two channels and sums them, with the bright cap, at one node', () => {
    const n = build({ ...DEFAULTS, jumpered: 'on' });
    const into = hoisted.connections.filter(([, to]) => to === tagOf(n.sharedNode));
    expect(into.map(([from]) => from).sort()).toEqual(
      [tagOf(n.volumeNormal), tagOf(n.volumeBright), tagOf(n.brightInjectGain)].sort(),
    );
  });

  // ⚠ THE BRIGHT CAP TAPS V1b's PLATE, NOT THE VOLUME POT'S OUTPUT. It is a
  // path AROUND the Bright volume pot, so its source is the channel triode's
  // exit and never `volumeBright`.
  it('feeds the bright cap from the channel triode, around the volume pot', () => {
    const n = build(DEFAULTS);
    expect(hoisted.connections).toContainEqual([
      tagOf(n.channelBright.exit), tagOf(n.brightInjectHpf),
    ]);
    expect(hoisted.connections).not.toContainEqual([
      tagOf(n.volumeBright), tagOf(n.brightInjectHpf),
    ]);
  });

  // ⚠ THE TONE NETWORK IS A SHELF AND TAKES TWO PATHS. A lone lowpass would
  // kill everything with the tone up (its corner falls to ~30 Hz there) and a
  // lone biquad highshelf cannot span a nine-octave pole/zero gap. Direct path
  // plus lowpass, summed.
  it('builds the tone network as a shelf, not a lowpass', () => {
    const n = build(DEFAULTS);
    const into = hoisted.connections.filter(([, to]) => to === tagOf(n.toneSum));
    expect(into.map(([from]) => from).sort())
      .toEqual([tagOf(n.tonePlateauGain), tagOf(n.toneRestGain)].sort());
    expect(n.tonePlateauGain.gain.value + n.toneRestGain.gain.value).toBeCloseTo(1, 9);
  });

  // ⚠ THE PROPERTY THAT MAKES IT A CIRCUIT. Selecting a channel gates SIGNAL;
  // it does not take a pot out of the node. Both volumes stay live, so a
  // switch change is a retune and never a rebuild.
  it('keeps both volume pots in circuit whichever channel is selected', () => {
    const n = build({ ...DEFAULTS, bright: 'off', volumeBright: 0.9 });
    expect(n.channelBrightFeed.gain.value).toBe(0);
    expect(n.volumeBright.gain.value).toBeGreaterThan(0);
  });

  // The three switches are not three independent gates: `jumpered` WINS.
  it('feeds the channels from the bright and jumpered switches together', () => {
    const feeds = (c: Record<string, number | string>) => {
      const n = build({ ...DEFAULTS, ...c });
      return [n.channelNormalFeed.gain.value, n.channelBrightFeed.gain.value];
    };
    expect(feeds({ bright: 'off', jumpered: 'off' })).toEqual([1, 0]);
    expect(feeds({ bright: 'on', jumpered: 'off' })).toEqual([0, 1]);
    expect(feeds({ bright: 'off', jumpered: 'on' })).toEqual([1, 1]);
    expect(feeds({ bright: 'on', jumpered: 'on' })).toEqual([1, 1]);
  });

  // ⚠ Lo MUST DIFFER FROM Hi BY MORE THAN A PAD, or it duplicates the input
  // gain slider and the backlog row was right to defer it.
  it('pads and darkens on the Lo jack', () => {
    const hi = build({ ...DEFAULTS, input: 'hi' });
    const lo = build({ ...DEFAULTS, input: 'lo' });
    expect(lo.inputPad.gain.value).toBeLessThan(hi.inputPad.gain.value);
    expect(Number(lo.inputPadLpf.frequency.value))
      .toBeLessThan(Number(hi.inputPadLpf.frequency.value));
  });

  // ⚠ PUSH-PULL IS THREE SIGN FLIPS. The cathodyne splits in anti-phase, each
  // tube shapes, and the OT's opposed windings re-invert one leg on the way
  // in. Drop that third flip and the stage SUMS instead of opposing: measured,
  // slope -0.16 at the origin (no fundamental at all), h2 0.119, h3 killed —
  // it cancels the odd harmonics and keeps the even ones, exactly backwards.
  it('inverts twice on the cathode leg — split, then again at the transformer', () => {
    const n = build(DEFAULTS);
    expect(Math.sign(n.legPlate.gain.value)).toBe(1);
    expect(Math.sign(n.legCathode.gain.value)).toBe(-1);
    expect(Math.sign(n.plateSum.gain.value)).toBe(1);
    expect(Math.sign(n.cathodeSum.gain.value)).toBe(-1);
  });

  // The supply is a side chain here exactly as on the Princeton — the
  // architectural rule the whole engine exists to keep, and a second topology
  // is where it would be quietly broken. It taps the last single-signal node
  // before the power stage, the phase inverter's output — NOT the shared node,
  // which sits behind the volume pots and would make sagDepth mean nothing.
  it('keeps the supply out of the series path and taps it before the power stage', () => {
    const n = build(DEFAULTS);
    expect(hoisted.connections.filter(([from]) => from === tagOf(n.supply.scale)))
      .toEqual([[tagOf(n.supply.scale), 'param']]);
    expect(hoisted.connections)
      .toContainEqual([tagOf(n.phaseInverter.miller), tagOf(n.supply.follower)]);
  });

  // ⚠ `apply` IS THE WHOLE POINT OF THE SWITCHES BEING RETUNES. An arm that
  // silently does nothing looks identical until a control is moved, and every
  // one of these nodes is driven from `applyCircuitAmpLite` rather than rebuilt.
  it('retunes the node network and the feeds in place', () => {
    const n = build(DEFAULTS);
    const volumeBefore = n.volumeNormal.gain.value;
    applyCircuitAmpLite(
      n,
      {
        enabled: true,
        ampId: 'deluxe-5e3',
        inputGainDb: 0,
        controls: { ...DEFAULTS, volumeNormal: 1, volumeBright: 0, jumpered: 'on', input: 'lo' },
      },
      DELUXE_5E3,
    );
    expect(n.volumeNormal.gain.value).toBeGreaterThan(volumeBefore);
    expect(n.volumeBright.gain.value).toBe(0);
    expect([n.channelNormalFeed.gain.value, n.channelBrightFeed.gain.value]).toEqual([1, 1]);
    expect(n.inputPad.gain.value).toBeLessThan(1);
    expect(n.tonePlateauGain.gain.value + n.toneRestGain.gain.value).toBeCloseTo(1, 9);
  });

  it('flattens the legs when the inverter switch says composed', () => {
    const split = build({ ...DEFAULTS, inverter: 'split' });
    expect(Number(split.plateLegLpf.frequency.value))
      .not.toBeCloseTo(Number(split.cathodeLegLpf.frequency.value), 3);
    const composed = build({ ...DEFAULTS, inverter: 'composed' });
    expect(Number(composed.plateLegLpf.frequency.value))
      .toBeCloseTo(Number(composed.cathodeLegLpf.frequency.value), 6);
  });
});
