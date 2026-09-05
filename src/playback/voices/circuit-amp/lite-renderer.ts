/**
 * The LITE renderer — a circuit amp built out of native Tone nodes.
 *
 * This is the low-CPU path, for phones and low-powered machines. It is NOT a
 * faithful degradation of the full per-sample renderer and no test asserts the
 * two match; that was decided rather than discovered. The lite path exists to
 * be usable, not identical. What the two share is the amp's DEFINITION — its
 * identity, its controls and its component values.
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
import type { CircuitAmp, CircuitAmpControl } from './types';
import type { CircuitAmpParams } from '../types';
import {
  triodeCurve,
  powerStageCurve,
  transformerCurve,
  tonePotCutoffHz,
  audioTaper,
} from './circuit-math';

export interface CircuitAmpLiteNodes {
  /** Signal level going INTO the amp. Not the amp's Volume. */
  readonly inputGain: Tone.Gain;
  readonly triode1Gain: Tone.Gain;
  readonly triode1Shaper: Tone.WaveShaper;
  readonly triode1Coupling: Tone.Filter;
  readonly triode1Miller: Tone.Filter;
  /** The amp's Volume — INSIDE the circuit, after the first triode. */
  readonly volumeGain: Tone.Gain;
  readonly toneFilter: Tone.Filter;
  readonly triode2Gain: Tone.Gain;
  readonly triode2Shaper: Tone.WaveShaper;
  readonly triode2Coupling: Tone.Filter;
  readonly triode2Miller: Tone.Filter;
  /** Side chain: follows the signal and droops the supply gain. */
  readonly sagFollower: Tone.Follower;
  readonly sagScale: Tone.Scale;
  readonly sagGain: Tone.Gain;
  readonly powerGain: Tone.Gain;
  readonly powerShaper: Tone.WaveShaper;
  readonly transformerLf: Tone.Filter;
  readonly transformerShaper: Tone.WaveShaper;
  readonly transformerHf: Tone.Filter;
  /** Where the chain connects INTO this amp. */
  readonly entry: Tone.ToneAudioNode;
  /** Where the chain resumes after it. */
  readonly exit: Tone.ToneAudioNode;
}

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

export function buildCircuitAmpLite(
  params: CircuitAmpParams,
  amp: CircuitAmp,
): CircuitAmpLiteNodes {
  const c = amp.circuit;

  const inputGain = new Tone.Gain(dbToGain(params.inputGainDb));

  const triode1Gain = new Tone.Gain(dbToGain(c.triode1.gainDb));
  const triode1Shaper = new Tone.WaveShaper(triodeCurve(c.triode1.asymmetry), 4096);
  const triode1Coupling = new Tone.Filter({
    type: 'highpass',
    frequency: c.triode1.couplingHpfHz,
  });
  const triode1Miller = new Tone.Filter({ type: 'lowpass', frequency: c.triode1.millerLpfHz });

  const volumeGain = new Tone.Gain(audioTaper(controlValue(params, amp, 'volume')));
  const toneFilter = new Tone.Filter({
    type: 'lowpass',
    frequency: tonePotCutoffHz(
      controlValue(params, amp, 'tone'),
      c.tone.minCutoffHz,
      c.tone.maxCutoffHz,
    ),
  });

  const triode2Gain = new Tone.Gain(dbToGain(c.triode2.gainDb));
  const triode2Shaper = new Tone.WaveShaper(triodeCurve(c.triode2.asymmetry), 4096);
  const triode2Coupling = new Tone.Filter({
    type: 'highpass',
    frequency: c.triode2.couplingHpfHz,
  });
  const triode2Miller = new Tone.Filter({ type: 'lowpass', frequency: c.triode2.millerLpfHz });

  // The supply.
  //
  // `sagGain` is built at ZERO on purpose. A signal-rate connection to an
  // AudioParam SUMS with the param's own intrinsic value, so a gain built at 1
  // and driven by this side chain would sit at 2 in silence — a silent +6 dB.
  // The scale's output is the whole of this gain: 1 when the follower sees
  // nothing, falling toward `1 - sagDepth` as the amp is worked. That is why
  // Scale's range is written high-to-low.
  const sagFollower = new Tone.Follower(c.supply.smoothingSeconds);
  const sagScale = new Tone.Scale(1, 1 - c.supply.sagDepth);
  const sagGain = new Tone.Gain(0);

  const powerGain = new Tone.Gain(dbToGain(c.power.gainDb));
  const powerShaper = new Tone.WaveShaper(powerStageCurve(c.power.headroom), 4096);

  const transformerLf = new Tone.Filter({ type: 'highpass', frequency: c.transformer.lfCornerHz });
  const transformerShaper = new Tone.WaveShaper(transformerCurve(c.transformer.saturation), 4096);
  const transformerHf = new Tone.Filter({ type: 'lowpass', frequency: c.transformer.hfCornerHz });

  // Series path — the circuit, in signal order.
  inputGain.connect(triode1Gain);
  triode1Gain.connect(triode1Shaper);
  triode1Shaper.connect(triode1Coupling);
  triode1Coupling.connect(triode1Miller);
  triode1Miller.connect(volumeGain);
  volumeGain.connect(toneFilter);
  toneFilter.connect(triode2Gain);
  triode2Gain.connect(triode2Shaper);
  triode2Shaper.connect(triode2Coupling);
  triode2Coupling.connect(triode2Miller);
  triode2Miller.connect(sagGain);
  sagGain.connect(powerGain);
  powerGain.connect(powerShaper);
  powerShaper.connect(transformerLf);
  transformerLf.connect(transformerShaper);
  transformerShaper.connect(transformerHf);

  // Side chain — reads the signal, writes a gain PARAM. Never in series.
  triode2Miller.connect(sagFollower);
  sagFollower.connect(sagScale);
  sagScale.connect(sagGain.gain);

  return {
    inputGain,
    triode1Gain,
    triode1Shaper,
    triode1Coupling,
    triode1Miller,
    volumeGain,
    toneFilter,
    triode2Gain,
    triode2Shaper,
    triode2Coupling,
    triode2Miller,
    sagFollower,
    sagScale,
    sagGain,
    powerGain,
    powerShaper,
    transformerLf,
    transformerShaper,
    transformerHf,
    entry: inputGain,
    exit: transformerHf,
  };
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
  nodes.volumeGain.gain.value = audioTaper(controlValue(params, amp, 'volume'));
  nodes.toneFilter.frequency.value = tonePotCutoffHz(
    controlValue(params, amp, 'tone'),
    amp.circuit.tone.minCutoffHz,
    amp.circuit.tone.maxCutoffHz,
  );
}

export function disposeCircuitAmpLite(nodes: CircuitAmpLiteNodes): void {
  nodes.inputGain.dispose();
  nodes.triode1Gain.dispose();
  nodes.triode1Shaper.dispose();
  nodes.triode1Coupling.dispose();
  nodes.triode1Miller.dispose();
  nodes.volumeGain.dispose();
  nodes.toneFilter.dispose();
  nodes.triode2Gain.dispose();
  nodes.triode2Shaper.dispose();
  nodes.triode2Coupling.dispose();
  nodes.triode2Miller.dispose();
  nodes.sagFollower.dispose();
  nodes.sagScale.dispose();
  nodes.sagGain.dispose();
  nodes.powerGain.dispose();
  nodes.powerShaper.dispose();
  nodes.transformerLf.dispose();
  nodes.transformerShaper.dispose();
  nodes.transformerHf.dispose();
}
