/**
 * The arithmetic behind a circuit amp.
 *
 * No Tone import, no audio context — every function here is a pure mapping, so
 * the circuit's claims are testable without playing anything. That is what
 * makes a claim about a circuit hold: a comment saying a curve is normalised
 * is not evidence, and this project has twice paid for treating one as such.
 *
 * ── The rule every curve keeps ──────────────────────────────────────────────
 *
 * UNITY SLOPE AT THE ORIGIN. A curve here shapes; it does not amplify. Each
 * stage's real gain is an explicit `Tone.Gain` in the renderer, where
 * `gain-structure.ts` can read it and a meter can see it.
 *
 * This is not a style preference. `amp-models.ts` normalised its curves at
 * their ENDPOINT — `tanh(x·k) / tanh(k)`, which pins output to 1 for an input
 * of 1 and says nothing about anything quieter. Its slope at the origin is
 * `k / tanh(k)`: +22.8 dB on Modern High-Gain. A saturator that amplifies
 * quiet signals by 22 dB is a gain stage wearing a shaper's name, and because
 * each curve normalised its own output the stage handed back an ordinary
 * looking level however hard it was hit — invisible from both meters that
 * bracket it. `tests/circuit-amp-math.test.ts` holds this file to the rule.
 */

/**
 * One triode half's transfer curve.
 *
 * A tube is asymmetric by construction: it conducts grid current on one side
 * and runs into cutoff on the other, so the two halves of the waveform bend by
 * different amounts. That asymmetry produces even harmonics — the "warm" part
 * of a small single-ended amp, and why a Champ sounds like one where a
 * push-pull amp, whose matched pair cancels them, does not.
 *
 * Each lobe is normalised by its OWN slope. Normalising both by one figure
 * gives the two halves different small-signal gain, which is a standing DC
 * offset at every level including a whisper — `asymmetricSoftClip` in
 * `amp-models.ts` shipped exactly that for months.
 *
 * @param asymmetry 0..1. 0 gives a symmetric curve (odd harmonics only).
 */
export function triodeCurve(asymmetry: number): (x: number) => number {
  const a = clamp01(asymmetry);
  const kPositive = 1 + a * 2.5;
  const kNegative = 1 + a * 0.6;
  return (x) =>
    x >= 0 ? Math.tanh(x * kPositive) / kPositive : Math.tanh(x * kNegative) / kNegative;
}

/**
 * A single-ended output stage.
 *
 * Single-ended means no matched pair, so nothing cancels the even harmonics
 * and the stage compresses as it runs out of swing.
 *
 * @param headroom 0..1 — how much of the curve is usable before it bends.
 *   Lower breaks up earlier. Floored at 0.05 so a definition cannot ask for a
 *   divide by zero.
 */
export function powerStageCurve(headroom: number): (x: number) => number {
  const h = Math.max(0.05, clamp01(headroom));
  const k = 1 / h;
  return (x) => Math.tanh(x * k) / k;
}

/**
 * Output-transformer core saturation.
 *
 * A small OT saturates its core before the tube runs out of swing, which is
 * most of why a 5 W amp sounds loose rather than merely quiet. Gentler
 * shoulders than a tube stage, so arctan rather than tanh.
 *
 * @param saturation 0..1. 0 is a linear transformer — no such thing exists,
 *   but it lets a definition turn the stage off without a special case.
 */
export function transformerCurve(saturation: number): (x: number) => number {
  const s = clamp01(saturation);
  if (s < 0.001) return (x) => x;
  const k = 1 + s * 4;
  return (x) => Math.atan(x * k) / k;
}

/**
 * A one-pot tone control's cutoff, in Hz.
 *
 * The 5F2-A's tone control is a pot and a cap forming a variable treble cut —
 * not a three-band stack, and it boosts nothing anywhere in its travel.
 *
 * Logarithmic because the ear hears frequency ratios: a linear sweep would put
 * almost all the audible change in the last tenth of the rotation.
 */
export function tonePotCutoffHz(position: number, minHz: number, maxHz: number): number {
  const p = clamp01(position);
  return minHz * Math.pow(maxHz / minHz, p);
}

/**
 * A log-taper ("audio") pot's linear gain for a rotation of 0..1.
 *
 * Real volume pots are log-taper because loudness is logarithmic; a linear pot
 * puts the whole usable range in the first third of the travel and the rest of
 * the rotation does almost nothing. Approximated the standard way, as an
 * exponential over a fixed span.
 *
 * The span is a property of pot construction rather than of any one amp, which
 * is why it lives here and not in a definition's `circuit` block. 40 dB puts
 * half rotation at about a tenth of the voltage, which is where a real audio
 * taper sits.
 */
export function audioTaper(position: number): number {
  const p = clamp01(position);
  if (p <= 0) return 0;
  const SPAN_DB = 40;
  return Math.pow(10, (SPAN_DB * (p - 1)) / 20);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
