/**
 * What a circuit amp IS, as data.
 *
 * An amp model in `amp-models.ts` is a curve plus two crossover frequencies —
 * enough to colour one fixed nine-node chain, and not enough to describe an
 * amplifier. Real amps differ in tube type, tone-network topology, phase
 * splitter, output-stage class, and whether the supply sags. A Champ has no
 * phase splitter at all; a Deluxe Reverb has tremolo and a reverb tank inside
 * the amp. So an amp here is a CIRCUIT DESCRIPTION, and a renderer walks it.
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

/** One knob the amp actually has. */
export interface CircuitAmpControl {
  /** Stable id. Becomes the key under `effects.circuitAmp.controls`. */
  readonly id: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly default: number;
  /** Suffix shown after the value. Omitted for a bare pot position. */
  readonly unit?: string;
  /** What this knob does in THIS circuit — shown under the control. */
  readonly description: string;
}

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

/** Single-ended output stage. No matched pair, so nothing cancels the even
 *  harmonics — the asymmetry is the sound. */
export interface PowerStage {
  readonly gainDb: number;
  /** 0..1. How much of the curve is usable before it bends. Lower breaks up
   *  earlier. */
  readonly headroom: number;
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
export interface CircuitAmpCircuit {
  readonly triode1: TriodeStage;
  readonly triode2: TriodeStage;
  readonly tone: ToneNetwork;
  readonly power: PowerStage;
  readonly supply: Supply;
  readonly transformer: OutputTransformer;
}

export interface CircuitAmp {
  readonly id: string;
  readonly name: string;
  /** Shown under the picker — what this amp is and what it is good for. */
  readonly description: string;
  readonly controls: readonly CircuitAmpControl[];
  readonly circuit: CircuitAmpCircuit;
}
