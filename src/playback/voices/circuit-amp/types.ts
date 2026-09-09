/**
 * What a circuit amp IS, as data.
 *
 * An amp model in `amp-models.ts` is a curve plus two crossover frequencies —
 * enough to colour one fixed nine-node chain, and not enough to describe an
 * amplifier. Real amps differ in tube type, tone-network topology, phase
 * splitter, output-stage class, and whether the supply sags. A Champ has no
 * phase splitter at all; a Deluxe Reverb has tremolo and a reverb tank inside
 * the amp. So an amp here is a CIRCUIT DESCRIPTION.
 *
 * ── How a renderer reads it ─────────────────────────────────────────────────
 *
 * NOT by walking a graph. An amp DECLARES ITS TOPOLOGY — `CircuitAmpCircuit` is
 * a discriminated union on that tag — and a renderer has one assembler per
 * topology over a shared set of per-stage builders. The stages are the reuse;
 * the assembler is the part that differs, because a push-pull amp with two
 * input channels summing at one node is not a serial chain with more boxes in
 * it. A general walker over two amps would be abstraction ahead of evidence.
 *
 * ── Two renderers read this file ────────────────────────────────────────────
 *
 * The LITE one (native Tone nodes, `lite-renderer.ts`) and the FULL one (a
 * per-sample worklet, not yet built). They are allowed to differ and no test
 * asserts they match — that was decided, not discovered: the lite path exists
 * to be usable on a phone, not to be identical. What they share is this file.
 *
 * ── The pane reads it too ───────────────────────────────────────────────────
 *
 * `controls` is what the voice pane draws, so a 5F2-A gets two knobs and a
 * Deluxe will get its own set with no per-amp UI code. Adding an amp is a
 * definition plus two build functions; the pane, the preset shape and
 * `wireChain` do not change again.
 */

interface CircuitAmpControlCommon {
  /** Stable id. Becomes the key under `effects.circuitAmp.controls`.
   *
   *  ⚠ NOT NAMESPACED BY AMP. Two amps declaring one id share ONE schema row,
   *  which is what keeps a tone pot's position across an amp switch — and it
   *  means they share that row's label, range and DEFAULT whichever amp is
   *  selected. An amp that needs a different default needs a different id.
   *  `tests/circuit-amp-registry.test.ts` enforces it. */
  readonly id: string;
  readonly label: string;
  /** What this control does in THIS circuit — shown under the control. */
  readonly description: string;
}

/** A continuous control: a pot, a slider in the pane. */
export interface CircuitAmpPot extends CircuitAmpControlCommon {
  readonly kind: 'pot';
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly default: number;
  /** Suffix shown after the value. Omitted for a bare pot position. */
  readonly unit?: string;
}

export interface CircuitAmpSwitchOption {
  readonly value: string;
  readonly label: string;
  readonly description: string;
}

/** A control with named positions rather than a range — a channel selector, a
 *  standby, a rectifier choice. Stored as a STRING, so it cannot be averaged,
 *  ramped or read as a pot by mistake. */
export interface CircuitAmpSwitch extends CircuitAmpControlCommon {
  readonly kind: 'switch';
  readonly options: readonly CircuitAmpSwitchOption[];
  readonly default: string;
}

/** One control the amp actually has. */
export type CircuitAmpControl = CircuitAmpPot | CircuitAmpSwitch;

/** One 12AX7 half.
 *
 *  The gain is REAL and lives in a `Tone.Gain`; the curve is unity at small
 *  signal. Keeping those two apart is why this project's saturators stopped
 *  being gain stages wearing a shaper's name — `amp-models.ts` normalised its
 *  curves at their ENDPOINT for months, leaving +22.8 dB of small-signal gain
 *  inside a function documented as leaving level alone, where no meter in the
 *  system could see it. See `tests/amp-curves.test.ts`. */
export interface TriodeStage {
  /** dB of small-signal gain for this stage. */
  readonly gainDb: number;
  /** 0..1. How differently the two halves of the waveform bend. A triode
   *  conducts grid current on one side and runs into cutoff on the other, so
   *  this is never 0 for a real stage — and it is where the even harmonics
   *  come from. */
  readonly asymmetry: number;
  /** Hz. Coupling-capacitor high-pass into the next stage. */
  readonly couplingHpfHz: number;
  /** Hz. Miller-capacitance low-pass out of this stage. */
  readonly millerLpfHz: number;
}

/** A passive tone network. The 5F2-A's is one pot and one cap — a variable
 *  treble cut, boosting nothing — so it is fully described by the cutoff range
 *  the pot sweeps. An amp with a three-knob stack will need its own shape
 *  here; that is a change to this file, which is the point of it. */
export interface ToneNetwork {
  /** Hz at pot position 0 (darkest). */
  readonly minCutoffHz: number;
  /** Hz at pot position 1 (brightest). */
  readonly maxCutoffHz: number;
}

/** A single-ended output stage's values. Which topology it belongs to is
 *  declared by the circuit that holds it, not by this record. */
export interface PowerStage {
  readonly gainDb: number;
  /** 0..1. How much of the curve is usable before it bends. Lower breaks up
   *  earlier. */
  readonly headroom: number;
}

/** A push-pull output pair. Two tubes conducting on opposite half-cycles into
 *  one transformer, summed IN OPPOSITION — which is what cancels the even
 *  harmonics and leaves the odd ones, and most of why a push-pull amp does not
 *  sound like a single-ended one. */
export interface PushPullStage {
  readonly gainDb: number;
  /** 0..1. How much of the curve is usable before it bends. Lower breaks up
   *  earlier. */
  readonly headroom: number;
  /** 0..1. How unmatched the pair is. 0 cancels every even harmonic, which no
   *  real pair does. A FINE TRIM, not a character control: at 0.08 the second
   *  harmonic sits about 62 dB below the third. */
  readonly imbalance: number;
}

/**
 * Two volume pots whose wipers tie to ONE node at the next stage's grid.
 *
 * The 5E3's jumper interaction and its "coupled tone" behaviour are the same
 * mechanism seen twice. `coupledChannelGains` in `circuit-math.ts` carries the
 * shape and the warning that goes with it — the loading is NOT monotonic in
 * either pot.
 */
export interface SharedNodeCoupling {
  /** 0..1. How hard the two volume pots load each other. 0 = independent. */
  readonly loadingStrength: number;
  /** Hz at both pots down / both pots up — what the tone network sees. */
  readonly minCornerHz: number;
  readonly maxCornerHz: number;
  /** 0..1. The bright channel's treble bypass at pot minimum. */
  readonly brightCapDepth: number;
  /** Hz. Where that bypass starts lifting. */
  readonly brightCapCornerHz: number;
}

/** A cathodyne (split-load) phase inverter — one triode producing two
 *  opposed outputs, one off the plate and one off the cathode. */
export interface CathodyneInverter {
  readonly stage: TriodeStage;
  /** Hz. The PLATE leg's ceiling at full spread. The plate is the
   *  HIGH-IMPEDANCE output — roughly the anode resistor, tens of kΩ, against
   *  the cathode leg's `Rk ‖ 1/gm` of a few hundred Ω — so it rolls off FIRST
   *  and this is the LOWER of the two corners. The cathode leg uses
   *  `stage.millerLpfHz`. Getting the direction backwards is the easy mistake
   *  and the first draft of this plan made it. */
  readonly plateLegLpfHz: number;
  /** 0..1. How far toward `plateLegLpfHz` the plate leg is actually taken,
   *  logarithmically. At 0 the legs match and the split provably reduces to
   *  one composed curve — the ONLY reason the renderer builds a real split is
   *  that at anything above 0 they do not. This one number carries the whole
   *  difference. */
  readonly legSpread: number;
}

/**
 * The rectifier and its reservoir.
 *
 * NOT A STAGE IN SERIES, and this is the architectural point of the whole
 * engine. A tube rectifier's plate voltage droops under current draw, and the
 * preamp and the power stage both read the SAME supply. Model sag as a box in
 * the signal path and every future tube-rectified amp is wrong the same way,
 * and a Deluxe's "does it sag" difference becomes inexpressible.
 *
 * In the lite renderer this is an envelope follower driving a gain — an
 * approximation, documented as one where it is built. The full renderer makes
 * it real.
 */
export interface Supply {
  /** 0..1. How far the supply droops when fully loaded. 0 = a solid-state
   *  rectifier, which does not sag. */
  readonly sagDepth: number;
  /** Seconds. The reservoir's time constant — how fast the droop follows. */
  readonly smoothingSeconds: number;
}

/** The output transformer. A small OT saturates its core before the tube runs
 *  out of swing, which is most of why a 5 W amp sounds loose rather than
 *  merely quiet. */
export interface OutputTransformer {
  /** 0..1. Core saturation amount at full drive. */
  readonly saturation: number;
  /** Hz. Below this the core starts to saturate. */
  readonly lfCornerHz: number;
  /** Hz. Bandwidth ceiling. */
  readonly hfCornerHz: number;
}

/**
 * The component-derived values the renderers build from.
 *
 * ⚠ EVERY NUMBER IN A `circuit` BLOCK IS PROVISIONAL until the amp has been
 * played and the values confirmed. They live here, and only here, so that
 * tuning one is a single-line data edit rather than a change to a renderer.
 * If an amp sounds wrong, the number is what moves — never the renderer.
 */
export type CircuitTopology = 'single-ended' | 'push-pull-dual-channel';

/** One preamp chain into a single-ended output stage. No phase splitter, so
 *  nothing cancels the even harmonics — the asymmetry is the sound. */
export interface SingleEndedCircuit {
  readonly topology: 'single-ended';
  readonly triode1: TriodeStage;
  readonly triode2: TriodeStage;
  readonly tone: ToneNetwork;
  readonly power: PowerStage;
  readonly supply: Supply;
  readonly transformer: OutputTransformer;
}

/** Two input channels summing at one wiper-tied node, then a shared second
 *  stage, a cathodyne inverter and a push-pull pair. Not a serial chain with
 *  more boxes in it — the shared node is what makes the two channels interact,
 *  and `coupling` is where that lives. */
export interface PushPullDualChannelCircuit {
  readonly topology: 'push-pull-dual-channel';
  readonly channelNormal: TriodeStage;
  readonly channelBright: TriodeStage;
  readonly coupling: SharedNodeCoupling;
  readonly triode2: TriodeStage;
  readonly tone: ToneNetwork;
  readonly phaseInverter: CathodyneInverter;
  readonly power: PushPullStage;
  readonly supply: Supply;
  readonly transformer: OutputTransformer;
}

export type CircuitAmpCircuit = SingleEndedCircuit | PushPullDualChannelCircuit;

export interface CircuitAmp {
  readonly id: string;
  readonly name: string;
  /** Shown under the picker — what this amp is and what it is good for. */
  readonly description: string;
  readonly controls: readonly CircuitAmpControl[];
  readonly circuit: CircuitAmpCircuit;
}
