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
  CathodyneInverter,
  CircuitAmp,
  CircuitAmpControl,
  InputPad,
  OutputTransformer,
  PushPullDualChannelCircuit,
  PushPullStage,
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
  sharedNodeResponse,
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

export interface PushPullDualChannelLiteNodes extends CircuitAmpLiteCommon {
  readonly topology: 'push-pull-dual-channel';
  /** The Hi/Lo jack: a pad and the treble loss that comes with it. */
  readonly inputPad: Tone.Gain;
  readonly inputPadLpf: Tone.Filter;
  /** 1 or 0, from the `bright` and `jumpered` switches together. Gates SIGNAL
   *  only — both volume pots stay in circuit either way, which is the whole
   *  point of the amp. */
  readonly channelNormalFeed: Tone.Gain;
  readonly channelBrightFeed: Tone.Gain;
  readonly channelNormal: TriodeNodes;
  readonly channelBright: TriodeNodes;
  readonly volumeNormal: Tone.Gain;
  readonly volumeBright: Tone.Gain;
  /** The .0005 bright cap. A PARALLEL treble-only path from V1b's coupling cap
   *  into the shared node — NOT a shelf on the Bright channel, and its amount
   *  tracks the TONE pot rather than the Bright volume. */
  readonly brightInjectHpf: Tone.Filter;
  readonly brightInjectGain: Tone.Gain;
  /** V2a's grid: where both channels and the bright injection sum. */
  readonly sharedNode: Tone.Gain;
  /** The tone network, as the first-order SHELF it is: a direct path at
   *  `tonePlateau` summed with a lowpass carrying `1 - tonePlateau`. One biquad
   *  cannot do this — the pole and zero can sit nine octaves apart. */
  readonly tonePlateauGain: Tone.Gain;
  readonly toneLpf: Tone.Filter;
  readonly toneRestGain: Tone.Gain;
  readonly toneSum: Tone.Gain;
  readonly triode2: TriodeNodes;
  readonly phaseInverter: TriodeNodes;
  readonly legPlate: Tone.Gain;
  readonly legCathode: Tone.Gain;
  readonly plateLegLpf: Tone.Filter;
  readonly cathodeLegLpf: Tone.Filter;
  readonly plateShaper: Tone.WaveShaper;
  readonly cathodeShaper: Tone.WaveShaper;
  readonly plateSum: Tone.Gain;
  readonly cathodeSum: Tone.Gain;
}

export type CircuitAmpLiteNodes = SingleEndedLiteNodes | PushPullDualChannelLiteNodes;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

function controlById(amp: CircuitAmp, controlId: string): CircuitAmpControl | undefined {
  return amp.controls.find((c) => c.id === controlId);
}

/** A pot's position.
 *
 *  A control the amp does not declare, or one it declares as a switch, reads
 *  0 — so a stale key left behind by an amp change cannot reach a node. A
 *  declared pot whose key is missing, or stored as the wrong type, reads its
 *  own default, so a half-written preset still builds. */
export function controlValue(
  params: CircuitAmpParams,
  amp: CircuitAmp,
  controlId: string,
): number {
  const control = controlById(amp, controlId);
  if (!control || control.kind !== 'pot') return 0;
  const raw = params.controls[controlId];
  return typeof raw === 'number' ? raw : control.default;
}

/** A switch's position.
 *
 *  Same contract as `controlValue`, and an UNRECOGNISED stored value reads the
 *  declared default rather than reaching an assembler as an unknown arm. The
 *  pane says so differently — its picker admits the value it does not know
 *  rather than silently showing the default. */
export function switchValue(
  params: CircuitAmpParams,
  amp: CircuitAmp,
  controlId: string,
): string {
  const control = controlById(amp, controlId);
  if (!control || control.kind !== 'switch') return '';
  const raw = params.controls[controlId];
  return typeof raw === 'string' && control.options.some((o) => o.value === raw)
    ? raw
    : control.default;
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

// ── The cathodyne, as arithmetic ────────────────────────────────────────────

/** The inverter's two legs, plus the pure arithmetic they implement — so the
 *  split can be measured against `pushPullCurve` with no audio context. */
export interface PhaseInverterLegs {
  /** The plate leg's WaveShaper table. */
  readonly plateCurve: (x: number) => number;
  /** The cathode leg's WaveShaper table. Its input arrives ALREADY inverted by
   *  `legCathode`, which is why this is not a mirror of `plateCurve`. */
  readonly cathodeCurve: (x: number) => number;
  /** The summing node's output for a stage input of `x`, with the cathodyne's
   *  inversion and the transformer's opposition both applied —
   *  `plateCurve(x) - cathodeCurve(-x)`. Pure JS: it does NOT model Web Audio's
   *  ±1 input clamp, so it proves the ARITHMETIC and not the graph. */
  readonly summedCurveAt: (x: number) => number;
}

/**
 * The two 6V6 halves, as the two curve tables the split path needs.
 *
 * Composed, these ARE `pushPullCurve` — the test that says so is what justifies
 * building a split at all. The split earns its place only through the legs'
 * different pre-shaper FILTERS, which no single curve can express.
 *
 * ⚠ `k = 1/headroom` LIVES INSIDE BOTH TABLES, not in a gain in front of them.
 * With `k` in a gain the legs would meet Web Audio's ±1 input clamp at half the
 * drive the composed shaper does, and the two paths would diverge by over a dB
 * at the shipped operating point.
 */
export function buildPhaseInverterLegs(
  inverter: CathodyneInverter,
  power: PushPullStage,
): PhaseInverterLegs {
  const tube = triodeCurve(inverter.stage.asymmetry);
  const k = 1 / Math.max(0.05, clamp01(power.headroom));
  const m = 1 + clamp01(power.imbalance);
  const slope = k * (1 + m);

  const plateCurve = (x: number) => tube(x * k) / slope;
  const cathodeCurve = (x: number) => tube(x * k * m) / slope;
  return {
    plateCurve,
    cathodeCurve,
    summedCurveAt: (x) => plateCurve(x) - cathodeCurve(-x),
  };
}

/**
 * The plate leg's roll-off, interpolated logarithmically from the cathode
 * leg's corner at `legSpread` 0 to `plateLegLpfHz` at 1.
 *
 * ⚠ The PLATE leg is the DARK one. It is the high-impedance output — roughly
 * the anode resistor against the cathode leg's `Rk ‖ 1/gm` — so it rolls off
 * first and its corner is the LOWER of the two. Both legs are loaded equally on
 * a 5E3 (56 kΩ plate, 56 kΩ tail), so source impedance is the whole of the
 * difference.
 */
export function plateLegCornerHz(inverter: CathodyneInverter, legSpread: number): number {
  const from = inverter.stage.millerLpfHz;
  return from * Math.pow(inverter.plateLegLpfHz / from, clamp01(legSpread));
}

/** Which channels receive signal. ⚠ `jumpered` WINS: with it on both are fed
 *  whatever `bright` says, which is what a patch cable does. */
function channelFeeds(params: CircuitAmpParams, amp: CircuitAmp): {
  normal: number;
  bright: number;
} {
  if (switchValue(params, amp, 'jumpered') === 'on') return { normal: 1, bright: 1 };
  const bright = switchValue(params, amp, 'bright') === 'on';
  return { normal: bright ? 0 : 1, bright: bright ? 1 : 0 };
}

/** The Hi/Lo jack. The pad alone would be `inputGainDb - 6`; the corner is what
 *  makes it a control of its own. */
function inputPadFor(
  params: CircuitAmpParams,
  amp: CircuitAmp,
  pad: InputPad,
): { gain: number; cornerHz: number } {
  const lo = switchValue(params, amp, 'input') === 'lo';
  return {
    gain: lo ? dbToGain(pad.loPadDb) : 1,
    cornerHz: lo ? pad.loCornerHz : pad.hiCornerHz,
  };
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


function assemblePushPullDualChannel(
  params: CircuitAmpParams,
  amp: CircuitAmp,
  c: PushPullDualChannelCircuit,
): PushPullDualChannelLiteNodes {
  const inputGain = new Tone.Gain(dbToGain(params.inputGainDb));

  const pad = inputPadFor(params, amp, c.inputPad);
  const inputPad = new Tone.Gain(pad.gain);
  const inputPadLpf = new Tone.Filter({ type: 'lowpass', frequency: pad.cornerHz });

  const feeds = channelFeeds(params, amp);
  const channelNormalFeed = new Tone.Gain(feeds.normal);
  const channelBrightFeed = new Tone.Gain(feeds.bright);

  const channelNormal = buildTriode(c.channelNormal);
  const channelBright = buildTriode(c.channelBright);

  // ⚠ ONE CALL FOR FIVE NODES. Both volumes, the tone shelf and the bright
  // injection are one network on this amp — see `sharedNodeResponse`.
  const r = sharedNodeResponse(
    controlValue(params, amp, 'volumeNormal'),
    controlValue(params, amp, 'volumeBright'),
    controlValue(params, amp, 'tone'),
    c.coupling,
  );

  const volumeNormal = new Tone.Gain(r.normal);
  const volumeBright = new Tone.Gain(r.bright);
  const brightInjectHpf = new Tone.Filter({ type: 'highpass', frequency: r.brightCornerHz });
  const brightInjectGain = new Tone.Gain(r.brightInjection);
  const sharedNode = new Tone.Gain(1);

  const tonePlateauGain = new Tone.Gain(r.tonePlateau);
  const toneLpf = new Tone.Filter({ type: 'lowpass', frequency: r.toneCornerHz });
  const toneRestGain = new Tone.Gain(1 - r.tonePlateau);
  const toneSum = new Tone.Gain(1);

  const triode2 = buildTriode(c.triode2);
  const phaseInverter = buildTriode(c.phaseInverter.stage);

  const legs = buildPhaseInverterLegs(c.phaseInverter, c.power);
  const legPlate = new Tone.Gain(1);
  const legCathode = new Tone.Gain(-1);
  const plateLegLpf = new Tone.Filter({
    type: 'lowpass',
    frequency: plateLegCornerHz(c.phaseInverter, legSpreadFor(params, amp, c)),
  });
  const cathodeLegLpf = new Tone.Filter({
    type: 'lowpass',
    frequency: c.phaseInverter.stage.millerLpfHz,
  });
  const plateShaper = new Tone.WaveShaper(legs.plateCurve, 4096);
  const cathodeShaper = new Tone.WaveShaper(legs.cathodeCurve, 4096);
  const plateSum = new Tone.Gain(1);
  const cathodeSum = new Tone.Gain(-1);

  const supply = buildSupply(c.supply);
  const powerGain = new Tone.Gain(dbToGain(c.power.gainDb));
  const transformer = buildTransformer(c.transformer);

  // The fork: one input, two channel triodes.
  inputGain.connect(inputPad);
  inputPad.connect(inputPadLpf);
  inputPadLpf.connect(channelNormalFeed);
  inputPadLpf.connect(channelBrightFeed);
  channelNormalFeed.connect(channelNormal.entry);
  channelBrightFeed.connect(channelBright.entry);

  // Into the shared node — V2a's grid. Three edges: both volume pots, and the
  // bright cap's path AROUND the Bright pot, tapped at the channel's exit.
  channelNormal.exit.connect(volumeNormal);
  channelBright.exit.connect(volumeBright);
  channelBright.exit.connect(brightInjectHpf);
  brightInjectHpf.connect(brightInjectGain);
  volumeNormal.connect(sharedNode);
  volumeBright.connect(sharedNode);
  brightInjectGain.connect(sharedNode);

  // The tone network, as a first-order shelf: flat below the corner, falling to
  // `tonePlateau` above it. A lone lowpass would kill everything with the tone
  // up, where the corner falls below the audible band.
  sharedNode.connect(tonePlateauGain);
  sharedNode.connect(toneLpf);
  toneLpf.connect(toneRestGain);
  tonePlateauGain.connect(toneSum);
  toneRestGain.connect(toneSum);

  toneSum.connect(triode2.entry);
  triode2.exit.connect(phaseInverter.entry);

  // The cathodyne, and THREE sign flips. The split is anti-phase, each tube
  // shapes, and the transformer's opposed windings re-invert one leg on the way
  // in. Drop that third flip and the stage sums instead of opposing — it would
  // cancel the odd harmonics and keep the even ones, exactly backwards.
  phaseInverter.exit.connect(legPlate);
  phaseInverter.exit.connect(legCathode);
  legPlate.connect(plateLegLpf);
  legCathode.connect(cathodeLegLpf);
  plateLegLpf.connect(plateShaper);
  cathodeLegLpf.connect(cathodeShaper);
  plateShaper.connect(plateSum);
  cathodeShaper.connect(cathodeSum);
  plateSum.connect(supply.gain);
  cathodeSum.connect(supply.gain);

  supply.gain.connect(powerGain);
  powerGain.connect(transformer.entry);

  // Side chain — reads the signal, writes a gain PARAM. Never in series. It
  // taps the last single-signal node before the power stage, NOT the shared
  // node, which sits behind the volume pots and would make sagDepth mean
  // nothing at a low volume setting.
  phaseInverter.exit.connect(supply.follower);

  return {
    topology: 'push-pull-dual-channel',
    inputGain,
    inputPad,
    inputPadLpf,
    channelNormalFeed,
    channelBrightFeed,
    channelNormal,
    channelBright,
    volumeNormal,
    volumeBright,
    brightInjectHpf,
    brightInjectGain,
    sharedNode,
    tonePlateauGain,
    toneLpf,
    toneRestGain,
    toneSum,
    triode2,
    phaseInverter,
    legPlate,
    legCathode,
    plateLegLpf,
    cathodeLegLpf,
    plateShaper,
    cathodeShaper,
    plateSum,
    cathodeSum,
    supply,
    powerGain,
    transformer,
    entry: inputGain,
    exit: transformer.exit,
  };
}

/** ⚠ EVALUATION CONTROL. `composed` flattens the legs so the split provably
 *  reduces to one shaper; it is not a 5E3 part and closes at milestone 6. */
function legSpreadFor(
  params: CircuitAmpParams,
  amp: CircuitAmp,
  c: PushPullDualChannelCircuit,
): number {
  return switchValue(params, amp, 'inverter') === 'composed' ? 0 : c.phaseInverter.legSpread;
}

export function buildCircuitAmpLite(
  params: CircuitAmpParams,
  amp: CircuitAmp,
): CircuitAmpLiteNodes {
  const c = amp.circuit;
  switch (c.topology) {
    case 'single-ended':
      return assembleSingleEnded(params, amp, c);
    case 'push-pull-dual-channel':
      return assemblePushPullDualChannel(params, amp, c);
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
    case 'single-ended': {
      // The nodes and the circuit narrow independently — `nodes.topology` says
      // nothing to the compiler about `amp.circuit`. They cannot disagree in
      // practice: the nodes were built from this circuit.
      const c = amp.circuit;
      if (c.topology !== 'single-ended') return;
      nodes.volumeGain.gain.value = audioTaper(controlValue(params, amp, 'volume'));
      nodes.toneFilter.frequency.value = tonePotCutoffHz(
        controlValue(params, amp, 'tone'),
        c.tone.minCutoffHz,
        c.tone.maxCutoffHz,
      );
      return;
    }
    case 'push-pull-dual-channel': {
      const c = amp.circuit;
      if (c.topology !== 'push-pull-dual-channel') return;

      const pad = inputPadFor(params, amp, c.inputPad);
      nodes.inputPad.gain.value = pad.gain;
      nodes.inputPadLpf.frequency.value = pad.cornerHz;

      const feeds = channelFeeds(params, amp);
      nodes.channelNormalFeed.gain.value = feeds.normal;
      nodes.channelBrightFeed.gain.value = feeds.bright;

      // ⚠ ONE CALL. Both volumes, the tone shelf and the bright injection come
      // from the same network, so they cannot be retuned independently without
      // the four of them disagreeing about what the node impedance is.
      const r = sharedNodeResponse(
        controlValue(params, amp, 'volumeNormal'),
        controlValue(params, amp, 'volumeBright'),
        controlValue(params, amp, 'tone'),
        c.coupling,
      );
      nodes.volumeNormal.gain.value = r.normal;
      nodes.volumeBright.gain.value = r.bright;
      nodes.toneLpf.frequency.value = r.toneCornerHz;
      nodes.tonePlateauGain.gain.value = r.tonePlateau;
      nodes.toneRestGain.gain.value = 1 - r.tonePlateau;
      nodes.brightInjectHpf.frequency.value = r.brightCornerHz;
      nodes.brightInjectGain.gain.value = r.brightInjection;

      nodes.plateLegLpf.frequency.value = plateLegCornerHz(
        c.phaseInverter,
        legSpreadFor(params, amp, c),
      );
      return;
    }
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
    case 'push-pull-dual-channel':
      nodes.inputPad.dispose();
      nodes.inputPadLpf.dispose();
      nodes.channelNormalFeed.dispose();
      nodes.channelBrightFeed.dispose();
      disposeTriode(nodes.channelNormal);
      disposeTriode(nodes.channelBright);
      nodes.volumeNormal.dispose();
      nodes.volumeBright.dispose();
      nodes.brightInjectHpf.dispose();
      nodes.brightInjectGain.dispose();
      nodes.sharedNode.dispose();
      nodes.tonePlateauGain.dispose();
      nodes.toneLpf.dispose();
      nodes.toneRestGain.dispose();
      nodes.toneSum.dispose();
      disposeTriode(nodes.triode2);
      disposeTriode(nodes.phaseInverter);
      nodes.legPlate.dispose();
      nodes.legCathode.dispose();
      nodes.plateLegLpf.dispose();
      nodes.cathodeLegLpf.dispose();
      nodes.plateShaper.dispose();
      nodes.cathodeShaper.dispose();
      nodes.plateSum.dispose();
      nodes.cathodeSum.dispose();
      return;
  }
}
