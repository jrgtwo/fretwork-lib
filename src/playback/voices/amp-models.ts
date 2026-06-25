/**
 * Amp models — discrete "amp character" presets the saturator + tone stack +
 * presence shelf are configured from. Replaces the previous "one hardcoded
 * curve for everyone" approach: each model has its own waveshape function
 * (clean Fender-style vs Marshall mid-forward vs Vox chimey vs modern
 * high-gain), its own tone stack crossover frequencies, and its own presence
 * shelf frequency.
 *
 * The character differences come from three independently-tunable axes:
 *
 *   1. CURVE — `(drive: number) => (x: number) => number`. The drive value
 *      (0..1) shapes the curve's steepness AND its asymmetry. drive=0 always
 *      returns identity (clean passthrough). Curves are NORMALIZED so peak
 *      output ≈ unity regardless of drive — the saturator compresses dynamics
 *      but doesn't bump the overall peak level, so existing preset trim
 *      values (outputDb / level.volumeDb) stay roughly meaningful.
 *
 *   2. TONE STACK — `lowFrequency` + `highFrequency` for the EQ3 between
 *      preDist and powerDist. Fender amps have wider/brighter tone stacks
 *      (bass shelf around 80 Hz, treble around 4 kHz); Marshall narrower with
 *      a more mid-forward voice.
 *
 *   3. PRESENCE — high-shelf frequency for the presence knob. Twin/AC30 use
 *      higher (4.5-5 kHz) for "air"; Marshalls sit lower (~3 kHz) for upper-
 *      midrange snap.
 *
 * Each model also names a suggested cab IR pairing — the UI can offer a
 * "use suggested cab" button when switching amps. Today the cab IR stays on
 * the preset; suggestion is documentary only.
 *
 * We don't claim to match Neural DSP / Kemper / NAM accuracy. The goal is
 * **recognizable character difference** — clean-glassy vs mid-forward-crunchy
 * vs chimey-compressed vs scooped-modern is easy to distinguish even with
 * relatively simple algorithms.
 */

export type AmpModelCategory = 'clean' | 'breakup' | 'crunch' | 'high-gain';

export interface AmpModel {
  /** Stable id — referenced from `AmpParams.modelId`. */
  readonly id: string;
  /** Human-readable name for the picker UI. */
  readonly name: string;
  /** Category for grouping in pickers. */
  readonly category: AmpModelCategory;
  /** Short description shown under the picker — what this amp sounds like
   *  and what it's good for. */
  readonly description: string;
  /** Saturator curve generator. Takes drive 0..1 (the preDrive/powerDrive
   *  knob), returns a waveshape function `(x: number) => number`. At drive=0
   *  the function returns identity (clean passthrough). Peaks normalized to
   *  ~unity at any drive value — saturation compresses dynamics, but
   *  doesn't bump headline level. */
  readonly curve: (drive: number) => (x: number) => number;
  /** Tone stack EQ3 crossover frequencies. */
  readonly toneStack: {
    /** Bass shelf cutoff (Hz). Lower = more low-end response. */
    readonly lowFrequency: number;
    /** Treble shelf cutoff (Hz). Higher = brighter, more air. */
    readonly highFrequency: number;
  };
  /** Presence high-shelf characteristics. */
  readonly presence: {
    /** Frequency (Hz) where the presence shelf kicks in. */
    readonly frequency: number;
  };
  /** Suggested cab IR id (from `cabinet-irs.ts`). Used by the UI to offer
   *  "use suggested cab when switching amps." */
  readonly defaultCabIrId?: string;
}

// ─── Curve helpers — building blocks for the model curves below ───────────

/** Symmetric tanh soft-clip, normalized so peak ≈ unity at any drive.
 *  Adds **odd** harmonics only — characteristic of push-pull power amps
 *  (matched tube pairs cancel even harmonics). Used by Twin (6L6 push-pull)
 *  and Modern High-Gain (matched pair cascading stages). */
function symmetricSoftClip(driveAmount: number, shape: number = 1): (x: number) => number {
  if (driveAmount < 0.001) return (x) => x;
  const k = 1 + driveAmount * shape;
  const norm = Math.tanh(k);
  return (x) => Math.tanh(x * k) / norm;
}

/** Asymmetric tanh soft-clip with different positive/negative gain.
 *  Produces **even** harmonics (octaves, fifths) — the "warm tube" character.
 *  Used by single-ended class-A amps (Champ) and amps with asymmetric biased
 *  power stages (Plexi EL34s). */
function asymmetricSoftClip(
  driveAmount: number,
  positiveShape: number,
  negativeShape: number,
): (x: number) => number {
  if (driveAmount < 0.001) return (x) => x;
  const dp = 1 + driveAmount * positiveShape;
  const dn = 1 + driveAmount * negativeShape;
  const normP = Math.tanh(dp);
  const normN = Math.tanh(dn);
  return (x) => (x >= 0 ? Math.tanh(x * dp) / normP : Math.tanh(x * dn) / normN);
}

/** Arctan-based soft compression. Gentler shoulders than tanh — feels like
 *  more "give" before clipping. Characteristic of EL84 tubes (AC30). */
function arctanCompress(driveAmount: number, shape: number): (x: number) => number {
  if (driveAmount < 0.001) return (x) => x;
  const k = 1 + driveAmount * shape;
  const norm = Math.atan(k);
  return (x) => Math.atan(x * k) / norm;
}

// ─── Model definitions ────────────────────────────────────────────────────

const FENDER_TWIN: AmpModel = {
  id: 'fender-twin',
  name: 'Fender Twin',
  category: 'clean',
  description:
    'Bright, glassy clean with massive headroom. 6L6 push-pull — symmetric, ' +
    'odd-harmonic character. Only breaks up at extreme settings. Quadratic ' +
    'drive ramp keeps it pristine through most of the knob travel.',
  // Quadratic drive ramp: shape = drive*6 means coefficient grows slowly at
  // low drive, then takes off. Stays cleaner for longer than a linear ramp.
  curve: (drive) => symmetricSoftClip(drive, drive * 6),
  toneStack: { lowFrequency: 150, highFrequency: 4500 },
  presence: { frequency: 4500 },
  defaultCabIrId: 'twin-clean',
};

const FENDER_CHAMP: AmpModel = {
  id: 'fender-champ',
  name: 'Fender Champ',
  category: 'breakup',
  description:
    'Small single-ended class-A combo. Asymmetric clip kicks in immediately ' +
    '— breaks up at low volumes, very touch-sensitive. Narrower bandwidth ' +
    'than the bigger Fenders, more upper-mid focus.',
  // Aggressive asymmetry (single-ended = no even-harmonic cancellation).
  // Fast onset (positive coefficient 12) — characteristic early breakup.
  curve: (drive) => asymmetricSoftClip(drive, 12, 6),
  toneStack: { lowFrequency: 150, highFrequency: 3500 },
  presence: { frequency: 4000 },
  defaultCabIrId: 'twin-clean', // we don't have a 1×10 IR yet; clean cab is closest
};

const MARSHALL_PLEXI: AmpModel = {
  id: 'marshall-plexi',
  name: 'Marshall Plexi',
  category: 'crunch',
  description:
    'EL34 push-pull, biased asymmetric. Mid-forward voice, aggressive ' +
    'breakup, classic British rock crunch. The "stack" sound — narrow ' +
    'high-end roll-off, presence pushes upper-midrange snap.',
  // EL34 asymmetry — moderate p:n ratio (10:5), faster onset than Twin's
  // quadratic ramp (this curve uses linear).
  curve: (drive) => asymmetricSoftClip(drive, 10, 5),
  toneStack: { lowFrequency: 200, highFrequency: 2200 },
  presence: { frequency: 3000 },
  defaultCabIrId: 'gods-warm-421',
};

const VOX_AC30: AmpModel = {
  id: 'vox-ac30',
  name: 'Vox AC30',
  category: 'breakup',
  description:
    'EL84 cathode-biased, naturally chimey top end. Gentler arctan-style ' +
    'soft compression rather than tanh-shaped clipping — feels like more ' +
    'give before breakup. Distinctive presence shelf around 5 kHz for the ' +
    '"chime."',
  // arctan gives a softer shoulder — more "compressed" feel than tanh
  curve: (drive) => arctanCompress(drive, 7),
  toneStack: { lowFrequency: 120, highFrequency: 3000 },
  presence: { frequency: 5000 },
  defaultCabIrId: 'gods-bright-57', // close-mic'd bright is closest to Vox character
};

const MODERN_HIGH_GAIN: AmpModel = {
  id: 'modern-high-gain',
  name: 'Modern High-Gain',
  category: 'high-gain',
  description:
    'Mesa Recto-style cascading gain stages. Very steep curve — heavy ' +
    'clipping even at moderate drive settings. Symmetric for a tight, ' +
    'percussive feel. Pair with scooped mids on the tone stack and ' +
    'aggressive cab IR for modern metal.',
  // Steep symmetric curve (shape coefficient 15) — hits hard clipping fast.
  curve: (drive) => symmetricSoftClip(drive, 15),
  toneStack: { lowFrequency: 100, highFrequency: 5000 },
  presence: { frequency: 3500 },
  defaultCabIrId: 'catharsis-balanced',
};

// ─── Registry + lookup ────────────────────────────────────────────────────

export const AMP_MODELS: readonly AmpModel[] = [
  FENDER_TWIN,
  FENDER_CHAMP,
  MARSHALL_PLEXI,
  VOX_AC30,
  MODERN_HIGH_GAIN,
];

/** Default fallback used when a preset / variant references an unknown
 *  modelId, or when a legacy variant has no modelId at all. Marshall Plexi
 *  is the closest match to the previous hardcoded asymmetric tanh curve. */
export const DEFAULT_AMP_MODEL_ID = 'marshall-plexi';

/** Look up an amp model by id. Falls back to the default model if the id is
 *  unknown — so the chain always builds with a real curve + tone-stack
 *  config, even when stored variants reference a model that's been renamed
 *  or removed from the registry. */
export function getAmpModel(id: string | undefined): AmpModel {
  if (!id) return getAmpModelOrDefault(DEFAULT_AMP_MODEL_ID);
  return getAmpModelOrDefault(id);
}

function getAmpModelOrDefault(id: string): AmpModel {
  const found = AMP_MODELS.find((m) => m.id === id);
  return found ?? AMP_MODELS.find((m) => m.id === DEFAULT_AMP_MODEL_ID)!;
}
