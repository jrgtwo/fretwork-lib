/**
 * The LITE renderer — a circuit amp built out of native Tone nodes.
 *
 * This is the low-CPU path, for phones and low-powered machines. It is NOT a
 * faithful degradation of the full per-sample renderer and no test asserts the
 * two match; that was decided rather than discovered. The lite path exists to
 * be usable, not identical. What the two share is the amp's DEFINITION — its
 * identity, its controls and its component values.
 *
 * ── How an amp is assembled ─────────────────────────────────────────────────
 *
 * Per-stage BUILDERS (`buildTriode`, `buildSupply`, `buildTransformer`) plus
 * one ASSEMBLER per topology. The stages are what every amp shares; the
 * assembler is what differs, because a push-pull amp with two input channels
 * summing at one node is not a serial chain with more boxes in it. There is no
 * graph walker, and over two amps there should not be one.
 *
 * Each builder wires its own internals and exposes `entry`/`exit`, so an
 * assembler names stages rather than nodes.
 *
 * ── What it cannot do ───────────────────────────────────────────────────────
 *
 * `Tone.WaveShaper` is memoryless: a sample in, a sample out, no state. So
 * everything in a real amp that depends on history is approximated or absent:
 *
 *   - SAG is an envelope follower driving a gain. A real 5Y3's plate voltage
 *     droops under current draw and BOTH triodes and the power stage read the
 *     same supply; here one follower attenuates the power stage only. It moves
 *     in roughly the right direction with roughly the right time constant, and
 *     that is the whole claim.
 *   - BIAS SHIFT and blocking distortion are absent entirely.
 *   - The transformer is a static shaper between two filters, so its
 *     saturation does not depend on how long the note has been sounding.
 *
 * ── The rule this file keeps ────────────────────────────────────────────────
 *
 * Every shaper is unity at small signal and every stage's real gain is an
 * explicit `Tone.Gain`. `circuit-math.ts` says why at length.
 */
import * as Tone from 'tone';
import type {
  CircuitAmp,
  CircuitAmpControl,
  OutputTransformer,
  SingleEndedCircuit,
  Supply,
  TriodeStage,
} from './types';
import type { CircuitAmpParams } from '../types';
import {
  triodeCurve,
  powerStageCurve,
  transformerCurve,
  tonePotCutoffHz,
  audioTaper,
} from './circuit-math';

/** One 12AX7 half: gain, curve, coupling cap, Miller roll-off. */
export interface TriodeNodes {
  readonly gain: Tone.Gain;
  readonly shaper: Tone.WaveShaper;
  readonly coupling: Tone.Filter;
  readonly miller: Tone.Filter;
  readonly entry: Tone.ToneAudioNode;
  readonly exit: Tone.ToneAudioNode;
}

/** The supply. NOT a stage in series — `gain` sits in the signal path, and
 *  `follower`/`scale` are a side chain that writes its param. */
export interface SupplyNodes {
  readonly follower: Tone.Follower;
  readonly scale: Tone.Scale;
  readonly gain: Tone.Gain;
}

export interface TransformerNodes {
  readonly lf: Tone.Filter;
  readonly shaper: Tone.WaveShaper;
  readonly hf: Tone.Filter;
  readonly entry: Tone.ToneAudioNode;
  readonly exit: Tone.ToneAudioNode;
}

interface CircuitAmpLiteCommon {
  /** Signal level going INTO the amp. Not the amp's Volume. */
  readonly inputGain: Tone.Gain;
  readonly supply: SupplyNodes;
  readonly transformer: TransformerNodes;
  readonly powerGain: Tone.Gain;
  /** Where the chain connects INTO this amp. */
  readonly entry: Tone.ToneAudioNode;
  /** Where the chain resumes after it. */
  readonly exit: Tone.ToneAudioNode;
}

export interface SingleEndedLiteNodes extends CircuitAmpLiteCommon {
  readonly topology: 'single-ended';
  readonly triode1: TriodeNodes;
  /** The amp's Volume — INSIDE the circuit, after the first triode. */
  readonly volumeGain: Tone.Gain;
  readonly toneFilter: Tone.Filter;
  readonly triode2: TriodeNodes;
  readonly powerShaper: Tone.WaveShaper;
}

/** One arm today. `PushPullDualChannelLiteNodes` joins it with the 5E3; the
 *  union lands now because `Voice.ts` consumes this type and the narrowing has
 *  to be in place while there is still only one thing to narrow to. */
export type CircuitAmpLiteNodes = SingleEndedLiteNodes;

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

function controlById(amp: CircuitAmp, controlId: string): CircuitAmpControl | undefined {
  return amp.controls.find((c) => c.id === controlId);
}

/** A knob's position.
 *
 *  A control the amp does not declare reads 0, so a stale key left behind by
 *  an amp change cannot reach a node; a declared control whose key is missing
 *  reads its own default, so a half-written preset still builds. */
export function controlValue(
  params: CircuitAmpParams,
  amp: CircuitAmp,
  controlId: string,
): number {
  const control = controlById(amp, controlId);
  if (!control) return 0;
  const raw = params.controls[controlId];
  return typeof raw === 'number' ? raw : control.default;
}

// ── Stage builders ──────────────────────────────────────────────────────────

export function buildTriode(stage: TriodeStage): TriodeNodes {
  const gain = new Tone.Gain(dbToGain(stage.gainDb));
  const shaper = new Tone.WaveShaper(triodeCurve(stage.asymmetry), 4096);
  const coupling = new Tone.Filter({ type: 'highpass', frequency: stage.couplingHpfHz });
  const miller = new Tone.Filter({ type: 'lowpass', frequency: stage.millerLpfHz });

  gain.connect(shaper);
  shaper.connect(coupling);
  coupling.connect(miller);

  return { gain, shaper, coupling, miller, entry: gain, exit: miller };
}

export function disposeTriode(nodes: TriodeNodes): void {
  nodes.gain.dispose();
  nodes.shaper.dispose();
  nodes.coupling.dispose();
  nodes.miller.dispose();
}

/**
 * The supply.
 *
 * `gain` is built at ZERO on purpose. A signal-rate connection to an
 * AudioParam SUMS with the param's own intrinsic value, so a gain built at 1
 * and driven by this side chain would sit at 2 in silence — a silent +6 dB.
 * The scale's output is the whole of this gain: 1 when the follower sees
 * nothing, falling toward `1 - sagDepth` as the amp is worked. That is why
 * Scale's range is written high-to-low.
 *
 * The assembler feeds `follower` from wherever the amp reads its load, and
 * puts `gain` in series. Neither is done here, because which node that is
 * differs by topology.
 */
export function buildSupply(supply: Supply): SupplyNodes {
  const follower = new Tone.Follower(supply.smoothingSeconds);
  const scale = new Tone.Scale(1, 1 - supply.sagDepth);
  const gain = new Tone.Gain(0);

  follower.connect(scale);
  scale.connect(gain.gain);

  return { follower, scale, gain };
}

export function disposeSupply(nodes: SupplyNodes): void {
  nodes.follower.dispose();
  nodes.scale.dispose();
  nodes.gain.dispose();
}

export function buildTransformer(ot: OutputTransformer): TransformerNodes {
  const lf = new Tone.Filter({ type: 'highpass', frequency: ot.lfCornerHz });
  const shaper = new Tone.WaveShaper(transformerCurve(ot.saturation), 4096);
  const hf = new Tone.Filter({ type: 'lowpass', frequency: ot.hfCornerHz });

  lf.connect(shaper);
  shaper.connect(hf);

  return { lf, shaper, hf, entry: lf, exit: hf };
}

export function disposeTransformer(nodes: TransformerNodes): void {
  nodes.lf.dispose();
  nodes.shaper.dispose();
  nodes.hf.dispose();
}

// ── Assemblers, one per topology ────────────────────────────────────────────

function assembleSingleEnded(
  params: CircuitAmpParams,
  amp: CircuitAmp,
  c: SingleEndedCircuit,
): SingleEndedLiteNodes {
  const inputGain = new Tone.Gain(dbToGain(params.inputGainDb));

  const triode1 = buildTriode(c.triode1);

  const volumeGain = new Tone.Gain(audioTaper(controlValue(params, amp, 'volume')));
  const toneFilter = new Tone.Filter({
    type: 'lowpass',
    frequency: tonePotCutoffHz(
      controlValue(params, amp, 'tone'),
      c.tone.minCutoffHz,
      c.tone.maxCutoffHz,
    ),
  });

  const triode2 = buildTriode(c.triode2);
  const supply = buildSupply(c.supply);

  const powerGain = new Tone.Gain(dbToGain(c.power.gainDb));
  const powerShaper = new Tone.WaveShaper(powerStageCurve(c.power.headroom), 4096);

  const transformer = buildTransformer(c.transformer);

  // Series path — the circuit, in signal order.
  inputGain.connect(triode1.entry);
  triode1.exit.connect(volumeGain);
  volumeGain.connect(toneFilter);
  toneFilter.connect(triode2.entry);
  triode2.exit.connect(supply.gain);
  supply.gain.connect(powerGain);
  powerGain.connect(powerShaper);
  powerShaper.connect(transformer.entry);

  // Side chain — reads the signal, writes a gain PARAM. Never in series.
  triode2.exit.connect(supply.follower);

  return {
    topology: 'single-ended',
    inputGain,
    triode1,
    volumeGain,
    toneFilter,
    triode2,
    supply,
    powerGain,
    powerShaper,
    transformer,
    entry: inputGain,
    exit: transformer.exit,
  };
}

export function buildCircuitAmpLite(
  params: CircuitAmpParams,
  amp: CircuitAmp,
): CircuitAmpLiteNodes {
  const c = amp.circuit;
  switch (c.topology) {
    case 'single-ended':
      return assembleSingleEnded(params, amp, c);
    default:
      throw new Error(`circuit-amp: no lite assembler for topology '${c.topology}'`);
  }
}

/** Retune in place.
 *
 *  Only the knobs and the input gain move. The circuit values come from the
 *  definition and change only when the amp does — which is a rebuild, not a
 *  retune, because a different circuit is a different node graph. */
export function applyCircuitAmpLite(
  nodes: CircuitAmpLiteNodes,
  params: CircuitAmpParams,
  amp: CircuitAmp,
): void {
  nodes.inputGain.gain.value = dbToGain(params.inputGainDb);
  switch (nodes.topology) {
    case 'single-ended':
      nodes.volumeGain.gain.value = audioTaper(controlValue(params, amp, 'volume'));
      nodes.toneFilter.frequency.value = tonePotCutoffHz(
        controlValue(params, amp, 'tone'),
        amp.circuit.tone.minCutoffHz,
        amp.circuit.tone.maxCutoffHz,
      );
      return;
  }
}

export function disposeCircuitAmpLite(nodes: CircuitAmpLiteNodes): void {
  nodes.inputGain.dispose();
  disposeSupply(nodes.supply);
  nodes.powerGain.dispose();
  disposeTransformer(nodes.transformer);
  switch (nodes.topology) {
    case 'single-ended':
      disposeTriode(nodes.triode1);
      nodes.volumeGain.dispose();
      nodes.toneFilter.dispose();
      disposeTriode(nodes.triode2);
      nodes.powerShaper.dispose();
      return;
  }
}
