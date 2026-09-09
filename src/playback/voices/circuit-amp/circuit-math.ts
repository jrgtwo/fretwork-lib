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

/** The component values the 5E3's volume/tone node is built from. Real ohms
 *  and farads, because the behaviour here is a resistive network working
 *  against two caps and no normalised stand-in reproduces it. */
export interface SharedNodeCircuit {
  /** Ω. Each volume pot's track. 1 MΩ on a 5E3, and both are the same. */
  readonly volumePotOhms: number;
  /** Ω. A channel's plate source impedance — the tube's `r_p` in parallel
   *  with its plate load. About 20 kΩ for a 12AY7 into 100 kΩ. */
  readonly plateSourceOhms: number;
  /** Ω. The tone pot's track. */
  readonly tonePotOhms: number;
  /** Farads. The cap from the tone pot's lower end to ground. */
  readonly toneCapFarads: number;
  /** Farads. The cap from V1B's plate to the tone pot's upper end. */
  readonly brightCapFarads: number;
}

/** What the node hands the stage after it. The two gains are the resistive
 *  path; the tone and bright figures describe the two reactive branches the
 *  renderer builds as filters. */
export interface SharedNodeResponse {
  /** Linear gain, V1A's plate to the shared node. */
  readonly normal: number;
  /** Linear gain, V1B's plate to the shared node. */
  readonly bright: number;
  /** Ω. The node's own source impedance — what both caps work against. */
  readonly nodeOhms: number;
  /** Hz. The tone shelf's corner. */
  readonly toneCornerHz: number;
  /** 0..1 linear. What survives ABOVE that corner. 1 is no cut at all. */
  readonly tonePlateau: number;
  /** Hz. Where the bright cap starts injecting. */
  readonly brightCornerHz: number;
  /** 0..1 linear. How much of V1B's plate reaches the node above it. */
  readonly brightInjection: number;
}

/**
 * The 5E3's volume and tone controls, which are ONE network and not three.
 *
 * ── The wiring, which is not the obvious one ────────────────────────
 *
 * A 5E3's volume pots ARE V2A's grid leak. Each pot's track runs from the
 * shared grid node to ground, and the channel's signal arrives at the WIPER —
 * not at the top of the track with the wiper as the output, which is how a
 * volume pot is normally drawn and how this file modelled it until the
 * schematic was read.
 *
 * Everything follows from that, and most of it is the reverse of the
 * conventional arrangement:
 *
 *   - A pot at ZERO grounds its own wiper and presents its full 1 MΩ to the
 *     node. Its channel goes silent and the OTHER channel is barely touched.
 *   - A pot at FULL puts the wiper at the grid end, so V1's ~20 kΩ plate
 *     impedance clamps the node and swamps the other channel. Turning a
 *     channel UP is what steals from the other one — which is what Deluxe
 *     players actually describe.
 *   - The node's impedance therefore falls MONOTONICALLY as the volumes come
 *     up, 500 kΩ down to about 10 kΩ, so the amp gets brighter as it is turned
 *     up. There is no darkest point mid-dial.
 *
 * ── Why the tone control is in here ─────────────────────────────────
 *
 * Because it hangs off the same node. Its wiper joins the two volume pots at
 * V2A's grid; below it the .005 shunts treble to ground, and above it the
 * .0005 bright cap feeds it from V1B's plate. So the tone pot loads the node
 * the volumes are fighting over, and the volumes set the impedance the tone
 * cap works against. That mutual dependence is the amp's character and it
 * cannot be expressed as three independent controls.
 *
 * The tone branch is a first-order SHELF, not a lowpass: flat below
 * `toneCornerHz`, falling to `tonePlateau` above it. A renderer builds it as a
 * direct path at `tonePlateau` summed with a lowpass at `toneCornerHz` scaled
 * by `1 - tonePlateau`.
 *
 * ⚠ THE BRIGHT CAP TRACKS THE TONE POT. It does not bridge a volume pot. Its
 * injection is summed at the node AHEAD of the tone shelf, so what is audible
 * is `brightInjection * tonePlateau`.
 *
 * ⚠ IDEALISED, NOT MEASURED. The topology is the schematic's and the component
 * values come from it. What is provisional is everything a schematic cannot
 * say: the pots' tapers, `plateSourceOhms`, and `MIN_WIPER_OHMS`. See
 * `docs/SPEC-circuit-amp.md`.
 */
export function sharedNodeResponse(
  normalPosition: number,
  brightPosition: number,
  tonePosition: number,
  circuit: SharedNodeCircuit,
): SharedNodeResponse {
  // A pot never reaches a true zero: wiper contact and the track's own end
  // resistance stop it. Without a floor the tone control's cut is infinite at
  // one end of its travel. Provisional, like every number in a `circuit` block.
  const MIN_WIPER_OHMS = 500;

  const { volumePotOhms: rv, plateSourceOhms: rs, tonePotOhms: rt } = circuit;

  /** One channel, reduced to a Thevenin source at the shared node.
   *
   *  `a` is the fraction of the track between the wiper and the GROUNDED end,
   *  so `a = 0` is the pot turned down. The remainder sits between the wiper
   *  and the grid node, carrying no current of its own — V2A's grid draws
   *  none — which is why a closed channel is a resistor to ground rather than
   *  a short. */
  const leg = (position: number) => {
    const a = audioTaper(clamp01(position));
    const toGround = rv * a;
    const toGrid = rv * (1 - a);
    const vth = toGround > 0 ? toGround / (rs + toGround) : 0;
    return { vth, zth: parallel(rs, toGround) + toGrid };
  };

  const n = leg(normalPosition);
  const b = leg(brightPosition);
  const yn = 1 / n.zth;
  const yb = 1 / b.zth;
  const nodeOhms = 1 / (yn + yb);

  // The tone pot's lower section, between its wiper and the .005 to ground.
  const toneToCap = Math.max(MIN_WIPER_OHMS, rt * audioTaper(clamp01(tonePosition)));
  // Its upper section, between the wiper and the .0005 from V1B's plate.
  const toneToBright = rt * (1 - audioTaper(clamp01(tonePosition)));

  return {
    normal: (n.vth * yn) / (yn + yb),
    bright: (b.vth * yb) / (yn + yb),
    nodeOhms,
    toneCornerHz: cornerHz(nodeOhms + toneToCap, circuit.toneCapFarads),
    tonePlateau: toneToCap / (nodeOhms + toneToCap),
    brightCornerHz: cornerHz(nodeOhms + toneToBright + rs, circuit.brightCapFarads),
    brightInjection: nodeOhms / (nodeOhms + toneToBright + rs),
  };
}

function parallel(a: number, b: number): number {
  return a + b === 0 ? 0 : (a * b) / (a + b);
}

function cornerHz(ohms: number, farads: number): number {
  return 1 / (2 * Math.PI * ohms * farads);
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
