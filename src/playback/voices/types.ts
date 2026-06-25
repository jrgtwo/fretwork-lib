/**
 * Voice / preset types — public surface for the playback synthesis layer.
 *
 * A `VoicePreset` describes how to build a `Voice` from a Tone.js synth source plus
 * an optional effects chain. The `Voice` class consumes a preset and provides a
 * `GuitarInstrument` implementation, so anything in the playback module that talks
 * to `GuitarInstrument` (i.e. `Playback`, `usePlayback`, every pattern resolver)
 * works unchanged.
 *
 * Today's voice sources: `pluck-synth` (Karplus-Strong) and `fm-synth` (FM
 * synthesis, useful for upright-bass-like body). The `sampler` variant is reserved
 * for a future implementation that loads recorded WAV/MP3 samples; it's part of the
 * union now so consumers can author preset data shaped for that future without
 * waiting for the implementation.
 */

export type FretInstrumentId = 'guitar' | 'bass' | 'ukulele';
export type VoiceFamily = 'acoustic' | 'electric';

export interface PluckSynthParams {
  /** 0..1. Initial impulse amplitude. Lower = softer, less click. */
  readonly attackNoise: number;
  /** Hertz. Lowpass on the feedback delay; lower = darker/warmer tone. */
  readonly dampening: number;
  /** 0..1. Body resonance / how long the string rings out before fading. */
  readonly resonance: number;
  /** Seconds. Tail length after the synth's attack. */
  readonly release: number;
}

export type OscillatorType = 'sine' | 'square' | 'sawtooth' | 'triangle';

export interface ADSREnvelope {
  /** Seconds. */
  readonly attack: number;
  readonly decay: number;
  /** 0..1. */
  readonly sustain: number;
  /** Seconds. */
  readonly release: number;
}

export interface FMSynthParams {
  /** Carrier:modulator frequency ratio. */
  readonly harmonicity: number;
  /** Depth of the modulator's effect on the carrier. */
  readonly modulationIndex: number;
  /** Cents. Pitch fine-tune applied to both carrier and modulator. */
  readonly detune: number;
  /** Carrier oscillator waveform. */
  readonly carrierWaveform: OscillatorType;
  /** Modulator oscillator waveform. */
  readonly modulatorWaveform: OscillatorType;
  /** Amplitude envelope (when the note's volume reaches/fades). */
  readonly envelope: ADSREnvelope;
  /** Modulation envelope (when the FM brightness reaches/fades, separate from volume). */
  readonly modulationEnvelope: ADSREnvelope;
}

/**
 * Discriminated union of supported synth sources. New kinds can be added without
 * breaking existing consumers — the `Voice` class switches on `kind` to build the
 * appropriate Tone.js graph.
 */
export type VoiceSource =
  | { readonly kind: 'pluck-synth'; readonly params: PluckSynthParams }
  | { readonly kind: 'fm-synth'; readonly params: FMSynthParams }
  /** Sampler source. `samples` is one-or-more `note → URL` maps; each entry in the
   *  array is a "bank" (a round-robin take of the same instrument). Single-take
   *  packs use `[oneMap]`; multi-bank packs (e.g. Karoryfer rr1..rr4) list all
   *  takes and the Voice rotates between them per-pitch at trigger time. */
  | { readonly kind: 'sampler'; readonly samples: ReadonlyArray<Readonly<Record<string, string>>>; readonly release?: number };

// ─── Tone-shaping (always available, not just electric) ──────────────────────

/** Per-voice gain + stereo placement. Always present in the chain. */
export interface VoiceLevel {
  /** Decibels. -24..+12 is a sensible range. 0 = unity. */
  readonly volumeDb: number;
  /** -1..+1. -1 = full left, 0 = centre, +1 = full right. */
  readonly pan: number;
}

/** Optional ADSR envelope driving the body filter's cutoff per note. When set,
 *  each `play()` triggers an attack/release on the envelope. The envelope sweeps
 *  the cutoff from `baseFrequency` upward by `octaves` over the attack phase,
 *  then settles at `baseFrequency * 2^(sustain * octaves)`. */
export interface BodyFilterEnvelope {
  /** Seconds. */
  readonly attack: number;
  readonly decay: number;
  /** 0..1. Sustain level applied to the octave sweep. */
  readonly sustain: number;
  /** Seconds. */
  readonly release: number;
  /** Hz. The lower end of the cutoff sweep. */
  readonly baseFrequency: number;
  /** How many octaves above `baseFrequency` the envelope can reach at peak. */
  readonly octaves: number;
}

/** Optional post-synth lowpass filter. Useful for "body" character beyond what
 *  PluckSynth's `dampening` provides. */
export interface BodyFilterParams {
  /** Whether this stage is currently in the audio chain. `undefined` is
   *  implicit-on (back-compat with stored variants that pre-date this field).
   *  Toggling off in the lab sets `enabled: false` and preserves all other
   *  params so toggling back on restores the user's tuning. */
  readonly enabled?: boolean;
  /** Cutoff frequency in Hertz. Used as the static value when `envelope` is
   *  absent; ignored when an envelope is driving the cutoff. */
  readonly cutoff: number;
  /** Resonance peak at the cutoff (0.1..18). 0.7 ≈ no peak; higher = pronounced
   *  resonance (use sparingly). */
  readonly q: number;
  /** Optional ADSR envelope on the cutoff, triggered per note. */
  readonly envelope?: BodyFilterEnvelope;
}

/** Optional pre-effects compressor. Useful for evening out attack transients
 *  and adding warmth. */
export interface CompressorParams {
  /** Whether this stage is currently in the audio chain. `undefined` = on. */
  readonly enabled?: boolean;
  /** dB. Level above which compression starts. */
  readonly threshold: number;
  /** Compression ratio (1 = none, 4 = moderate, 20 = limiter). */
  readonly ratio: number;
  /** Seconds. How fast the compressor reacts. */
  readonly attack: number;
  /** Seconds. How fast the compressor releases. */
  readonly release: number;
  /** dB. Soft-knee width. */
  readonly knee: number;
}

// ─── Effects ─────────────────────────────────────────────────────────────────

export type DistortionOversample = 'none' | '2x' | '4x';

export interface DistortionParams {
  /** Whether this stage is currently in the audio chain. `undefined` = on. */
  readonly enabled?: boolean;
  /** 0..1. Drive amount. Higher = more clipping. */
  readonly drive: number;
  /** 0..1. Effect mix. 0 = bypassed. */
  readonly wet: number;
  /** Anti-aliasing oversample mode. '4x' is cleanest, '2x' is a balance, 'none'
   *  is cheapest (and audibly cruder). */
  readonly oversample: DistortionOversample;
}

export type ChorusType = 'sine' | 'square' | 'sawtooth' | 'triangle';

export interface ChorusParams {
  /** Whether this stage is currently in the audio chain. `undefined` = on. */
  readonly enabled?: boolean;
  /** Hz. LFO rate of the chorus modulation. */
  readonly frequency: number;
  /** 0..1. Modulation depth. */
  readonly depth: number;
  /** 0..1. Effect mix. */
  readonly wet: number;
  /** LFO waveform. */
  readonly type: ChorusType;
  /** 0..1. How much delayed signal feeds back into the chorus line. */
  readonly feedback: number;
  /** Seconds. Base delay time the LFO modulates around. */
  readonly delayTime: number;
  /** Degrees. Stereo spread of the two delay lines (0..180). */
  readonly spread: number;
}

export interface DelayParams {
  /** Whether this stage is currently in the audio chain. `undefined` = on. */
  readonly enabled?: boolean;
  /** Seconds. Delay time. */
  readonly delayTime: number;
  /** 0..1. Feedback amount (how much echo bleeds back into the line). */
  readonly feedback: number;
  /** 0..1. Effect mix. */
  readonly wet: number;
}

export interface EQParams {
  /** Whether this stage is currently in the audio chain. `undefined` = on. */
  readonly enabled?: boolean;
  /** dB. Low-shelf gain. Negative = cut, positive = boost. Range typically -12..+12. */
  readonly low: number;
  /** dB. Mid peak/cut gain. */
  readonly mid: number;
  /** dB. High-shelf gain. */
  readonly high: number;
  /** Hz. Crossover frequency between low and mid bands. */
  readonly lowFrequency: number;
  /** Hz. Crossover frequency between mid and high bands. */
  readonly highFrequency: number;
}

/** Envelope-follower-driven wah (Tone.AutoWah). The filter cutoff tracks the
 *  amplitude of the incoming signal — louder notes open the filter more, like a
 *  classic "envelope wah" pedal. Different from the body-filter envelope, which
 *  is triggered per note. */
export interface AutoWahParams {
  /** Whether this stage is currently in the audio chain. `undefined` = on. */
  readonly enabled?: boolean;
  /** Hz. Lowest cutoff (when input is silent). */
  readonly baseFrequency: number;
  /** How many octaves above `baseFrequency` the cutoff can sweep. */
  readonly octaves: number;
  /** dB. How sensitive the envelope follower is to input amplitude. Lower values
   *  mean the filter opens at quieter notes. */
  readonly sensitivity: number;
  /** 0.1..18. Filter resonance peak at the cutoff. */
  readonly q: number;
  /** dB. Gain applied to the wet signal. */
  readonly gain: number;
  /** 0..1. Effect mix. */
  readonly wet: number;
}

/** Cabinet impulse-response convolution. Models the speaker cabinet + mic +
 *  room — the single biggest contributor to "amp sound" for an electric guitar.
 *  The IR is fetched from a URL and convolved with the dry signal. Wet is
 *  always 1.0 — a cab is a transducer, not an effect you blend with dry.
 *
 *  `makeupDb` compensates for convolution-induced loudness changes. We run
 *  the Tone.Convolver with `normalize:false` so the IR's natural level is
 *  preserved; some IRs come out hotter than dry, some quieter, so an
 *  explicit makeup knob lets each IR be balanced individually. Defaults to
 *  0dB. Applied via a Gain node directly after the Convolver. */
export interface CabIRParams {
  /** Whether this stage is currently in the audio chain. `undefined` = on. */
  readonly enabled?: boolean;
  readonly url: string;
  readonly makeupDb?: number;
}

/** Amplifier simulation. Sits between the pedalboard and the cabinet IR in
 *  the chain. Implemented as a 5-node stack: pre-gain → pre-amp saturation
 *  → tone stack (EQ3) → power-amp saturation → output gain. Together these
 *  give the clean→metal range from a single parameter shape — clean settings
 *  use low drive on both stages, crunch uses moderate pre-drive, metal uses
 *  high pre-drive plus moderate power-amp coloration.
 *
 *  Not modelled as named amp archetypes (Tweed, Plexi, Recto) — those live
 *  in preset configs that set these params to evocative values. The data
 *  shape stays generic so the preset surface can grow without expanding the
 *  type. */
export interface AmpParams {
  /** Whether this stage is currently in the audio chain. `undefined` = on. */
  readonly enabled?: boolean;
  /** Optional reference to a named amp model (e.g. `'fender-twin'`,
   *  `'marshall-plexi'`). The model defines the saturator curve algorithm,
   *  tone-stack crossover frequencies, and presence-shelf frequency — all
   *  characteristics that distinguish e.g. a Fender clean from a Marshall
   *  crunch. When undefined, falls back to `DEFAULT_AMP_MODEL_ID` (Plexi —
   *  closest to the legacy single-curve behavior so old variants keep
   *  sounding similar after the migration). The numeric knobs below
   *  (preGainDb, preDrive, bass/mid/treble, presence, powerDrive) still
   *  control how each model is set; the model just decides what those
   *  controls do. See `amp-models.ts`. */
  readonly modelId?: string;
  /** dB. Input gain — drives signal harder into the pre-amp saturation stage. */
  readonly preGainDb: number;
  /** 0..1. Pre-amp saturation amount (clipper drive). 0 = clean pass-through;
   *  1 = aggressive distortion. */
  readonly preDrive: number;
  /** dB. Tone-stack bass shelf. Typical range -12..+12. */
  readonly bass: number;
  /** dB. Tone-stack mid bell. Typical range -12..+12. */
  readonly mid: number;
  /** dB. Tone-stack treble shelf. Typical range -12..+12. */
  readonly treble: number;
  /** dB. High-shelf around 3kHz, applied after the tone stack. Mimics a real
   *  amp's "presence" knob — adds top-end clarity to a saturated signal. */
  readonly presence: number;
  /** 0..1. Power-amp saturation amount. Typically lighter than preDrive;
   *  contributes harmonic coloration rather than overt distortion. */
  readonly powerDrive: number;
  /** dB. Output trim after all amp stages. Use to compensate for level
   *  changes introduced by the saturation stages. */
  readonly outputDb: number;
}

/** Per-voice algorithmic reverb. Sits in the chain between the amp and the
 *  cab — analogous to a spring reverb tank inside a guitar amp. Implemented
 *  as `Tone.JCReverb` (Schroeder-style, naturally spring-like character).
 *  Lightweight enough to run one per voice without significant CPU cost,
 *  including at multi-track composition scale.
 *
 *  Separate from the global MasterBus reverb, which remains as a send for
 *  room/hall ambience applied to the full mix. */
export interface VoiceReverbParams {
  /** Whether this stage is currently in the audio chain. `undefined` = on. */
  readonly enabled?: boolean;
  /** 0..1. Room-size analogue. Maps to `JCReverb.roomSize`. Larger values =
   *  longer, more diffuse tail. */
  readonly roomSize: number;
  /** 0..1. Wet/dry mix. 0 = bypassed-feel (dry-only), 1 = fully wet. */
  readonly wet: number;
}

/** Seven-band graphic EQ modelled on the Boss GE-7. Sits between the
 *  pedalboard and the amp — the classic pre-amp tone-shaper position. Each
 *  band is a peaking filter centred on a fixed frequency; the user adjusts
 *  its gain (±15 dB typical) to dial in the tone going into the amp. A
 *  separate Level control trims the overall output of the EQ stage so
 *  cuts/boosts don't change apparent loudness.
 *
 *  Implementation: 7 chained `Tone.Filter` peaking nodes + 1 output
 *  `Tone.Gain`. Q ≈ 1.4 (approximate ANSI 1/3-octave width — wider feels
 *  musical, narrower feels surgical). */
export interface GraphicEqParams {
  /** Whether this stage is currently in the audio chain. `undefined` = on. */
  readonly enabled?: boolean;
  /** dB at 100 Hz. Typical range ±15. */
  readonly band100Hz: number;
  /** dB at 200 Hz. */
  readonly band200Hz: number;
  /** dB at 400 Hz. */
  readonly band400Hz: number;
  /** dB at 800 Hz. */
  readonly band800Hz: number;
  /** dB at 1.6 kHz. */
  readonly band1_6kHz: number;
  /** dB at 3.2 kHz. */
  readonly band3_2kHz: number;
  /** dB at 6.4 kHz. */
  readonly band6_4kHz: number;
  /** Overall output trim in dB. Typical range ±15. */
  readonly levelDb: number;
}

export interface EffectsConfig {
  // Pedalboard stage (pre-amp)
  readonly distortion?: DistortionParams;
  readonly chorus?: ChorusParams;
  readonly delay?: DelayParams;
  readonly autoWah?: AutoWahParams;

  // Pre-amp tone shaper (graphic EQ, post-pedalboard)
  readonly graphicEq?: GraphicEqParams;

  // Amp stage
  readonly amp?: AmpParams;

  // Post-amp per-voice reverb (spring/plate analogue)
  readonly reverb?: VoiceReverbParams;

  // Cab stage
  readonly cabIR?: CabIRParams;

  // Post-cab mastering EQ
  readonly finalEq?: EQParams;
}

// ─── Voice layer (sub-body / harmonic stacking) ──────────────────────────────

/** Optional second synth mixed underneath the primary. Triggered alongside the
 *  primary on every note. Useful for adding sub-octave body (sine layer one
 *  octave down), shimmer (FM layer one octave up), or articulation (plucked
 *  pluck layered on a soft FM body). */
export interface VoiceLayer {
  /** What synth the layer is built from. Same union as the primary source. */
  readonly source: VoiceSource;
  /** dB. Mix level of the layer relative to the primary. -infinity..+6 typical;
   *  defaults around -10..-6 for "underneath" sub-bodies. */
  readonly gainDb: number;
  /** Octave offset from the primary's note. -2..+2 typical. */
  readonly octaveOffset: number;
  /** Cents. Fine pitch detune applied where the layer synth supports it
   *  (FMSynth has `detune`; PluckSynth ignores). */
  readonly detuneCents: number;
}

// ─── Voice + presets ─────────────────────────────────────────────────────────

export interface VoicePreset {
  readonly id: string;
  readonly name: string;
  readonly instrumentId: FretInstrumentId;
  readonly family: VoiceFamily;
  readonly source: VoiceSource;
  /** Optional layered second synth, mixed with the primary for harmonic depth. */
  readonly layer?: VoiceLayer;
  /** Optional input gain — clean linear gain applied at the very start of the
   *  chain (after the synth/sampler mixer, before bodyFilter / compressor /
   *  effects / amp). Use to attenuate hot sample levels before they hit the
   *  amp section, or to boost quiet sources without driving the saturators
   *  harder. Default 0 dB (unity). Slider min of -80 dB grounds the signal
   *  (perceptually silent), max +24 dB for hot boost. Optional for back-compat
   *  with stored variants that pre-date this field. */
  readonly inputGainDb?: number;
  /** Per-voice gain + stereo placement. Always present in the chain. */
  readonly level: VoiceLevel;
  /** Optional body lowpass before the effects chain. */
  readonly bodyFilter?: BodyFilterParams;
  /** Optional compressor before the distortion. */
  readonly compressor?: CompressorParams;
  /** Effects chain. Conventional defaults populate this for `family === 'electric'`,
   *  but the lab lets users add effects to any voice. */
  readonly effects?: EffectsConfig;
}

// ─── Master / reverb ─────────────────────────────────────────────────────────

export interface ReverbSettings {
  readonly enabled: boolean;
  /** Seconds. Reverb tail length. */
  readonly decay: number;
  /** Seconds. Time before the reverb tail begins (mimics distance to early
   *  reflections). Typical range 0..0.1. */
  readonly preDelay: number;
  /** 0..1. Reverb send level. */
  readonly wet: number;
}

export const DEFAULT_REVERB_SETTINGS: ReverbSettings = {
  enabled: true,
  decay: 1.5,
  preDelay: 0.01,
  wet: 0.18,
};
