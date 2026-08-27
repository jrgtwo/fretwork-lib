/**
 * The gain structure's reference point: what a note is worth before anything
 * shapes it.
 *
 * ── The defect this exists to fix ────────────────────────────────────────────
 *
 * A sample file is mastered to -1 dBFS true peak, a note with no dynamics fires
 * at full velocity, and the node they converge on is a `Tone.Gain(1)`. So a
 * SINGLE note arrives at the amp at nearly full scale and there is nothing left
 * for a second one. The six notes of a chord are scheduled on the same tick, so
 * their attack transients land on the same audio sample and add coherently —
 * +15.6 dB — which puts them 14 dB past full scale before the amp has done
 * anything. A real strum spreads over 20-40 ms and never does this.
 *
 * *"a 6x volume spike between a note and a chord … that doesnt happen in real
 * life."*
 *
 * ── Why the reference is -18 dBFS ────────────────────────────────────────────
 *
 * Not a preference — a constraint. `Tone.WaveShaper` samples its curve over
 * exactly [-1, +1] and Web Audio clamps past that BEFORE the lookup, turning a
 * soft-clip into a flat chop. So `chord peak + preGainDb ≤ 0 dBFS`, and with a
 * chord sitting +15.6 dB over a single note:
 *
 *     reference   chord peak   max preGainDb any preset may carry
 *     -12 dBFS      +3.6         -3.6   clamps before any amp gain at all
 *     -18 dBFS      -2.4         +2.4
 *     -24 dBFS      -8.4         +8.4
 *
 * -18 is the standard digital operating level and the only candidate leaving
 * room for a positive pre-gain. Changing it is one line here; everything else
 * derives.
 *
 * ── Why samplers and synths are handled differently ─────────────────────────
 *
 * The packs' mastering level is a documented fact about the FILES. That is what
 * makes a library-level constant the right shape — and why it does not belong on
 * a preset, where it would be copied into fourteen of them and every new preset
 * would start broken. AU-03 settled that distinction for `inputGainDb`; this is
 * the same one.
 *
 * A synth has no equivalent fact. What a `Tone.FMSynth` peaks at depends on its
 * modulation index, its harmonicity and its envelope — a property of the params,
 * not of the source kind. So synth sources are trimmed by nothing and reported
 * as UNMEASURED, visibly, rather than given a plausible number this module
 * cannot stand behind. Measuring them is a real task: play each synth preset and
 * read AF-01's IN meter, which is exactly the instrument for it.
 */
import type { VoiceSource } from './types';

/**
 * The level a single note at unity input gain is calibrated to arrive at, in
 * dBFS. The whole chain's headroom budget is stated from here.
 */
export const REFERENCE_LEVEL_DBFS = -18;

/**
 * True peak the bundled sample packs are mastered to, in dBFS.
 *
 * A fact about the files, not a setting. If a pack is ever added that is
 * mastered differently, this stops being one number and becomes a per-pack
 * field on `SamplePack` — measure before assuming they match.
 */
export const SAMPLE_PACK_PEAK_DBFS = -1;

/**
 * Whether this source's trim is backed by a measured fact.
 *
 * `false` means the source passes at unity because nothing has measured it, NOT
 * because unity was chosen. Kept separate from the trim itself so a caller can
 * tell "calibrated to 0 dB" from "not calibrated" — two states that look
 * identical at a call site, which is how a wrong claim survives.
 */
export function isSourceCalibrated(source: VoiceSource): boolean {
  return source.kind === 'sampler';
}

/**
 * Gain to apply at the source so a single note lands at {@link
 * REFERENCE_LEVEL_DBFS}, in dB.
 *
 * Derived from the reference and the source's peak rather than written down, so
 * moving the reference moves the trim and the two cannot drift apart.
 */
export function sourceTrimDb(source: VoiceSource): number {
  if (!isSourceCalibrated(source)) return 0;
  return trimForPeakDb(SAMPLE_PACK_PEAK_DBFS);
}

/**
 * Gain that brings a source peaking at `peakDb` down to the reference, in dB.
 *
 * Split out and parameterised so the RELATIONSHIP is testable, not just the one
 * number it currently produces: with the constants where they are, `-17` and
 * `REFERENCE_LEVEL_DBFS - SAMPLE_PACK_PEAK_DBFS` are indistinguishable at a call
 * site, and a test asserting "the trim is derived" that cannot tell them apart
 * is not testing what it says.
 *
 * It is also the seam for the case the constant's own doc names: a pack mastered
 * to something other than -1 dBFS needs its own peak, not its own trim.
 */
export function trimForPeakDb(peakDb: number, referenceDb: number = REFERENCE_LEVEL_DBFS): number {
  return referenceDb - peakDb;
}
