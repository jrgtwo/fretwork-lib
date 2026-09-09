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

/** What a pair of wiper-tied volume pots hands the stage after them. */
export interface ChannelGains {
  /** Linear gain from the Normal channel's plate to the shared node. */
  readonly normal: number;
  /** Linear gain from the Bright channel's plate to the shared node. */
  readonly bright: number;
  /** Hz. Set by the shared node's SOURCE IMPEDANCE, which peaks where a pot's
   *  wiper splits its track evenly — POSITION 0.85 on a 40 dB audio taper. So
   *  this is DARKEST around 8-9 on the dial and brighter at both ends, not
   *  monotonic in either pot. */
  readonly sharedNodeCornerHz: number;
}

/**
 * Two volume pots whose wipers tie to ONE node at the next stage's grid.
 *
 * This is the 5E3's jumper interaction and its "coupled tone" behaviour, which
 * are the same mechanism seen twice.
 *
 * ── The shape, which is not the obvious one ─────────────────────────
 *
 * Each pot is its channel's plate across a track to ground with the wiper
 * tapped off. Taking `a = audioTaper(position)` as the fraction below the
 * wiper, one pot alone is a Thevenin source of `V·a` behind `R·a(1−a)`.
 *
 * That impedance is ZERO AT BOTH ENDS of rotation and maximum where the wiper
 * splits the track evenly. So a pot at zero is a short from the shared node to
 * ground and collapses the OTHER channel; a pot at full clamps the node to its
 * own plate and swamps the other; and the two interfere least in between. A
 * monotonic "more rotation = more loading" model gets this backwards at the
 * bottom of the dial, which is exactly where players notice it.
 *
 * ⚠ THE TAPER MOVES THE PEAK UP THE DIAL. The impedance peaks where the wiper
 * splits the track evenly, `a = 0.5`, and on this file's 40 dB `audioTaper`
 * that is POSITION 0.85 — not mid rotation. The corner runs 3567 Hz at 0.05,
 * 1746 at 0.5, 400 at 0.85 and back to 4000 at full. Do not "fix" it to peak
 * at 0.5; that is the linear-pot answer to an audio-pot circuit.
 *
 * `loadingStrength` 0..1 blends between two independent pots (0 — no shared
 * node, the shape the single-channel fallback uses) and the ideal tied-wiper
 * circuit (1). A real amp is near 1 but not at it: wiper and track resistance
 * and the grid stopper soften both nulls, so nothing truly reaches silence.
 * Where exactly is a number to find by ear.
 *
 * ⚠ IDEALISED, NOT MEASURED. The SHAPE is the circuit's — the nulls at both
 * ends and the maximum in the middle are what a tied-wiper pair does. The
 * strength is provisional like everything in a `circuit` block. See
 * `docs/SPEC-circuit-amp.md` for the circuit questions still open on this amp.
 */
export function coupledChannelGains(
  normalPosition: number,
  brightPosition: number,
  loadingStrength: number,
  minCornerHz: number,
  maxCornerHz: number,
): ChannelGains {
  const an = audioTaper(clamp01(normalPosition));
  const ab = audioTaper(clamp01(brightPosition));
  const k = clamp01(loadingStrength);

  const rn = an * (1 - an);
  const rb = ab * (1 - ab);
  const total = rn + rb;

  // Both pots at an extreme at once is the one degenerate case: two ideal
  // sources shorted together. Split it evenly rather than dividing by zero.
  const coupledNormal = total > 0 ? (an * rb) / total : an / 2;
  const coupledBright = total > 0 ? (ab * rn) / total : ab / 2;

  // The node's source impedance, normalised against its own maximum (both
  // pots at mid, where r = 0.25 each and the parallel pair is 0.125).
  const MAX_PARALLEL = 0.125;
  const impedance = total > 0 ? (rn * rb) / total / MAX_PARALLEL : 0;

  // A HIGHER source impedance hands the following cap a LOWER corner. So the
  // amp is darkest in the middle of the dial. `k` scales it because with no
  // shared node there is no such corner at all.
  const z = clamp01(impedance) * k;
  const sharedNodeCornerHz = maxCornerHz * Math.pow(minCornerHz / maxCornerHz, z);

  return {
    normal: an * (1 - k) + coupledNormal * k,
    bright: ab * (1 - k) + coupledBright * k,
    sharedNodeCornerHz,
  };
}

/**
 * The treble lift a bright cap across a volume pot produces, in DECIBELS for a
 * high-shelf.
 *
 * The cap is a path around the pot that only treble takes. With the pot down,
 * most of the signal is being dropped and the cap carries the top end past it,
 * so the lift is large. With the pot full the wiper is at the top and there is
 * nothing to bypass, so the lift is exactly 0 dB — not "small", zero.
 *
 * ⚠ IT TRACKS THE TAPER, NOT THE ROTATION. What the cap bypasses is the
 * attenuation the pot is applying, and on this file's 40 dB `audioTaper` an
 * audio pot is already 20 dB down at half rotation. A lift interpolated
 * linearly in position would fade out long before the attenuation it exists to
 * bypass does.
 *
 * dB rather than a linear factor because `Tone.Filter`'s `highshelf` reads its
 * `gain` param in dB — a linear 4 arriving as +4 dB is a bug that sounds
 * plausible.
 *
 * @param depth 0..1. Lift at pot minimum, as a fraction of MAX_LIFT_DB. 0 is a
 *   channel with no bright cap at all, which is what the Normal channel gets.
 */
export function brightCapShelfDb(volumePosition: number, depth: number): number {
  const p = clamp01(volumePosition);
  const d = clamp01(depth);
  const MAX_LIFT_DB = 12;
  return d * MAX_LIFT_DB * (1 - audioTaper(p));
}

/**
 * A push-pull output pair, as one composed curve.
 *
 * Two tubes conducting on opposite half-cycles into one transformer. Each is
 * asymmetric on its own; summed IN OPPOSITION, the even harmonics cancel and
 * the odd ones remain — which is most of why a push-pull amp does not sound
 * like a single-ended one, and it is asserted by a test rather than claimed in
 * prose.
 *
 * ── Why ONE curve here, and a real split in the renderer ────────────
 *
 * A `WaveShaper` is memoryless, so split -> shape -> sum-in-opposition is
 * exactly this function evaluated per sample. Two nodes would buy nothing on
 * their own. The lite renderer DOES build a real split, for a different
 * reason — the cathodyne's legs get different FILTERS, which are not
 * composable into one curve — and this function is the reference that split is
 * measured against with `legSpread` at 0.
 *
 * ⚠ `k` IS INSIDE THIS CURVE, not in a gain in front of it. In the split it
 * has to be inside each leg's table too, or the legs meet Web Audio's ±1 input
 * clamp at half the drive the composed shaper does and the two paths diverge
 * by over a dB at the shipped operating point. The engine's "every stage's
 * real gain is an explicit Tone.Gain" rule is still kept: the power stage's
 * gain is `powerGain`, which is a separate node.
 *
 * @param imbalance 0..1. How unmatched the pair is. 0 cancels the even
 *   harmonics completely, which no real pair does. Note the SCALE: at 0.08 the
 *   second harmonic sits 62 dB below the third, and even 0.3 only reaches
 *   -40 dB relative. This is a fine trim, not a character control.
 */
export function pushPullCurve(
  asymmetry: number,
  headroom: number,
  imbalance: number,
): (x: number) => number {
  const tube = triodeCurve(asymmetry);
  const h = Math.max(0.05, clamp01(headroom));
  const k = 1 / h;
  const m = 1 + clamp01(imbalance);

  // Each half drives its own tube; the transformer sums them in OPPOSITION —
  // the minus sign is the OT's opposed primary windings, and dropping it
  // cancels the odd harmonics instead of the even ones and leaves the stage
  // with no fundamental at all.
  const raw = (x: number) => tube(x * k) - tube(-x * k * m);

  // Analytic: `triodeCurve` has unity slope at the origin by construction, so
  // raw'(0) = k + k·m = k·(1 + m). Normalising by a numerically measured slope
  // and then testing it numerically would be a tautology.
  const slope = k * (1 + m);
  return (x) => raw(x) / slope;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
