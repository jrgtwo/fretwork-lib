/**
 * Voice presets — five seed values for the Sound Lab to start tuning from.
 *
 * v2: All presets use FMSynth as the primary source (the engine that produced
 * the most usable sound during early tuning). PluckSynth is still in the
 * VoiceSource union and remains useful as an optional layer for plucked-attack
 * articulation. Each preset is shipped with an optional sub-body layer
 * suggestion to add depth without flatness.
 *
 * These values are deliberately rough — Phase 0 of the audio work dials in the
 * final numbers and we replace them here.
 */
import type {
  FretInstrumentId,
  VoiceFamily,
  VoiceLevel,
  VoicePreset,
} from './types';
import { PHILHARMONIA_CLASSICAL, KARORYFER_GREEN, KARORYFER_BLACK, OFFSET_P90 } from './sample-packs';
import { getCabinetIR } from './cabinet-irs';

// Sentinel — if the IR id isn't found we ship `undefined` (no cab) rather
// than crash. Should never happen in production, but lets the registry
// move under us without breaking presets.
const KARORYFER_GREEN_CAB = getCabinetIR('twin-clean')?.url;
const KARORYFER_BLACK_CAB = getCabinetIR('twin-clean')?.url;
// Cab IRs used by the Phase 1d test presets — exercise different IRs to verify
// each one wires through the chain correctly.
const TEST_CLEAN_CAB = getCabinetIR('twin-clean')?.url;
const TEST_CRUNCH_CAB = getCabinetIR('twin-clean')?.url;
const TEST_METAL_CAB = getCabinetIR('twin-clean')?.url;
// Blues currently pairs with the God's Cab Crunch IR (SM57 + Tube Screamer) so
// the bake-in pre-amp character gives instant break-up without dialing drive.
const BLUES_CAB = getCabinetIR('gods-crunch-57-ts')?.url;

const NEUTRAL_LEVEL: VoiceLevel = { volumeDb: 0, pan: 0 };

// Acoustic guitar — Philharmonia classical guitar samples (CC-BY-NC, hosted on
// Supabase). No compressor — pre-recorded sample dynamics are already balanced
// across the range, and a compressor on the chain just pumps unpredictably on
// the pluck transients (creates *more* per-note inconsistency, not less).
// Long release lets the sample's natural body ring out after the short
// preview-hold duration so we hear closer to the full recording. v6: 2026-05-22.
export const ACOUSTIC_GUITAR_PRESET: VoicePreset = {
  id: 'acoustic-guitar',
  name: 'Acoustic Guitar',
  instrumentId: 'guitar',
  family: 'acoustic',
  source: {
    kind: 'sampler',
    samples: PHILHARMONIA_CLASSICAL,
    release: 2.5,
  },
  level: { volumeDb: 3, pan: 0 },
};

// Electric guitar — PluckSynth primary, brighter than acoustic, light overdrive,
// drier reverb. v3 retune: 2026-05-22.
export const ELECTRIC_GUITAR_PRESET: VoicePreset = {
  id: 'electric-guitar',
  name: 'Electric Guitar',
  instrumentId: 'guitar',
  family: 'electric',
  source: {
    kind: 'pluck-synth',
    params: { attackNoise: 1.5, dampening: 6000, resonance: 0.85, release: 1.0 },
  },
  level: NEUTRAL_LEVEL,
  bodyFilter: {
    cutoff: 5500,
    q: 0.9,
    envelope: {
      attack: 0.003,
      decay: 0.2,
      sustain: 0.5,
      release: 0.8,
      baseFrequency: 2000,
      octaves: 1.5,
    },
  },
  compressor: { threshold: -16, ratio: 3.0, attack: 0.01, release: 0.1, knee: 4 },
  effects: {
    distortion: { drive: 0.18, wet: 0.35, oversample: '4x' },
    finalEq: { low: 1, mid: 3, high: 0, lowFrequency: 250, highFrequency: 1500 },
  },
};

// Karoryfer "Black And Green Guitars" — sampler-based hollowbody electrics.
// Clean DI samples with no insert FX; users can tune in Sound Lab if they want
// drive/EQ/cabinet IR. Karoryfer's own SFZ patches add +2dB to green to match
// black's louder recording — we trim black by 2dB instead. v1: 2026-05-24.
export const KARORYFER_GREEN_GUITAR_PRESET: VoicePreset = {
  id: 'karoryfer-green-guitar',
  name: 'Gretsch Hollowbody',
  instrumentId: 'guitar',
  family: 'electric',
  source: {
    kind: 'sampler',
    samples: KARORYFER_GREEN,
    release: 2.5,
  },
  level: { volumeDb: 0, pan: 0 },
  effects: KARORYFER_GREEN_CAB
    ? { cabIR: { url: KARORYFER_GREEN_CAB } }
    : undefined,
};

export const KARORYFER_BLACK_GUITAR_PRESET: VoicePreset = {
  id: 'karoryfer-black-guitar',
  name: 'Hofner Hollowbody',
  instrumentId: 'guitar',
  family: 'electric',
  source: {
    kind: 'sampler',
    samples: KARORYFER_BLACK,
    release: 2.5,
  },
  level: { volumeDb: -2, pan: 0 },
  effects: KARORYFER_BLACK_CAB
    ? { cabIR: { url: KARORYFER_BLACK_CAB } }
    : undefined,
};

// Acoustic bass — round upright body, soft attack, long sustain.
export const ACOUSTIC_BASS_PRESET: VoicePreset = {
  id: 'acoustic-bass',
  name: 'Acoustic Bass',
  instrumentId: 'bass',
  family: 'acoustic',
  source: {
    kind: 'fm-synth',
    params: {
      harmonicity: 1,
      modulationIndex: 5,
      detune: 0,
      carrierWaveform: 'sine',
      modulatorWaveform: 'sine',
      envelope: { attack: 0.01, decay: 0.4, sustain: 0.5, release: 1.2 },
      modulationEnvelope: { attack: 0.01, decay: 0.5, sustain: 0.4, release: 1.0 },
    },
  },
  layer: {
    source: {
      kind: 'fm-synth',
      params: {
        harmonicity: 0.5,
        modulationIndex: 2,
        detune: 0,
        carrierWaveform: 'sine',
        modulatorWaveform: 'sine',
        envelope: { attack: 0.01, decay: 0.6, sustain: 0.4, release: 1.4 },
        modulationEnvelope: { attack: 0.01, decay: 0.6, sustain: 0.3, release: 1.2 },
      },
    },
    gainDb: -8,
    octaveOffset: -1,
    detuneCents: 0,
  },
  level: NEUTRAL_LEVEL,
};

// Electric bass — sawtooth carrier for grit, mild distortion + low-shelf boost.
export const ELECTRIC_BASS_PRESET: VoicePreset = {
  id: 'electric-bass',
  name: 'Electric Bass',
  instrumentId: 'bass',
  family: 'electric',
  source: {
    kind: 'fm-synth',
    params: {
      harmonicity: 1,
      modulationIndex: 8,
      detune: 0,
      carrierWaveform: 'sawtooth',
      modulatorWaveform: 'sine',
      envelope: { attack: 0.005, decay: 0.5, sustain: 0.4, release: 0.9 },
      modulationEnvelope: { attack: 0.001, decay: 0.4, sustain: 0.3, release: 0.7 },
    },
  },
  layer: {
    source: {
      kind: 'fm-synth',
      params: {
        harmonicity: 0.5,
        modulationIndex: 3,
        detune: 0,
        carrierWaveform: 'sine',
        modulatorWaveform: 'sine',
        envelope: { attack: 0.005, decay: 0.6, sustain: 0.4, release: 1.0 },
        modulationEnvelope: { attack: 0.005, decay: 0.5, sustain: 0.3, release: 0.9 },
      },
    },
    gainDb: -6,
    octaveOffset: -1,
    detuneCents: 0,
  },
  level: NEUTRAL_LEVEL,
  effects: {
    distortion: { drive: 0.15, wet: 0.2, oversample: '2x' },
    finalEq: { low: 3, mid: 0, high: -2, lowFrequency: 250, highFrequency: 2500 },
  },
};

// Acoustic ukulele — bright, plucky, very short tail.
export const ACOUSTIC_UKULELE_PRESET: VoicePreset = {
  id: 'acoustic-ukulele',
  name: 'Acoustic Ukulele',
  instrumentId: 'ukulele',
  family: 'acoustic',
  source: {
    kind: 'fm-synth',
    params: {
      harmonicity: 2,
      modulationIndex: 3,
      detune: 0,
      carrierWaveform: 'triangle',
      modulatorWaveform: 'sine',
      envelope: { attack: 0.002, decay: 0.3, sustain: 0.05, release: 0.4 },
      modulationEnvelope: { attack: 0.001, decay: 0.25, sustain: 0.05, release: 0.35 },
    },
  },
  layer: {
    source: {
      kind: 'fm-synth',
      params: {
        harmonicity: 4,
        modulationIndex: 1.5,
        detune: 0,
        carrierWaveform: 'sine',
        modulatorWaveform: 'sine',
        envelope: { attack: 0.002, decay: 0.2, sustain: 0.05, release: 0.3 },
        modulationEnvelope: { attack: 0.002, decay: 0.2, sustain: 0.05, release: 0.3 },
      },
    },
    gainDb: -14,
    octaveOffset: 1,
    detuneCents: 0,
  },
  level: NEUTRAL_LEVEL,
};

// ─── Named amp voicings — starter presets for the new chain ──────────────────
// Each preset showcases a different combination of amp + pedals + reverb so
// users can pick a sound and start playing without diving into Sound Lab. All
// build on OFFSET_P90 DI samples + appropriate cab IR; tone shaping happens in
// the amp + effects chain.

// Clean Amp — basically no drive, gentle reverb. Starting point for clean
// tones; foundation other presets layer drive/effects on.
export const CLEAN_AMP_PRESET: VoicePreset = {
  id: 'clean-amp',
  name: 'Clean Amp',
  instrumentId: 'guitar',
  family: 'electric',
  source: { kind: 'sampler', samples: OFFSET_P90, release: 2.5 },
  // First-pass loudness balancing across the amp arc — Clean is the quiet end
  // of the drive spectrum, so it gets the biggest level boost. See the level
  // ladder at the top of this preset group.
  level: { volumeDb: 6, pan: 0 },
  compressor: {
    threshold: -41.5, ratio: 6, attack: 0.001, release: 0.535, knee: 3.5,
  },
  effects: {
    amp: {
      modelId: 'fender-twin',
      preGainDb: -12, preDrive: 0.11, bass: 0, mid: -6.5, treble: 0,
      presence: -1.5, powerDrive: 0.29, outputDb: 0,
    },
    cabIR: TEST_CLEAN_CAB ? { url: TEST_CLEAN_CAB, makeupDb: 3 } : undefined,
    finalEq: { low: 0, mid: -1, high: 0.5, lowFrequency: 250, highFrequency: 2500 },
  },
};

// Blues — warm, low-moderate breakup, mid-forward, gentle short reverb. Sits
// between Clean and Crunch — the "edge of breakup" tone.
export const BLUES_PRESET: VoicePreset = {
  id: 'blues-amp',
  name: 'Blues',
  instrumentId: 'guitar',
  family: 'electric',
  source: { kind: 'sampler', samples: OFFSET_P90, release: 2.2 },
  level: { volumeDb: -0.5, pan: 0 },
  effects: {
    amp: {
      modelId: 'fender-champ',
      preGainDb: -4.5, preDrive: 0, bass: -9, mid: 0, treble: -2.5,
      presence: 1, powerDrive: 0.83, outputDb: 3.5,
    },
    cabIR: BLUES_CAB ? { url: BLUES_CAB } : undefined,
    finalEq: { low: 0, mid: 1, high: 0, lowFrequency: 250, highFrequency: 2500 },
  },
};

// Crunch — moderate preDrive, mid-bump, brighter top from presence. Classic
// rhythm-chord crunch.
export const CRUNCH_PRESET: VoicePreset = {
  id: 'crunch-amp',
  name: 'Crunch',
  instrumentId: 'guitar',
  family: 'electric',
  source: { kind: 'sampler', samples: OFFSET_P90, release: 2.0 },
  level: { volumeDb: 0, pan: 0 },
  effects: {
    amp: {
      modelId: 'marshall-plexi',
      preGainDb: 6, preDrive: 0.4, bass: -2, mid: 0, treble: -3,
      presence: 3, powerDrive: 0.1, outputDb: 1,
    },
    cabIR: TEST_CRUNCH_CAB ? { url: TEST_CRUNCH_CAB } : undefined,
    finalEq: { low: -2, mid: 0, high: 0, lowFrequency: 200, highFrequency: 2500 },
  },
};

// Lead — moderate-high drive, focused mids, slight delay for thickness,
// longer reverb. Sustaining solo voice.
export const LEAD_PRESET: VoicePreset = {
  id: 'lead-amp',
  name: 'Lead',
  instrumentId: 'guitar',
  family: 'electric',
  source: { kind: 'sampler', samples: OFFSET_P90, release: 2.5 },
  level: { volumeDb: -2, pan: 0 },
  effects: {
    delay: { delayTime: 0.32, feedback: 0.25, wet: 0.12 },
    amp: {
      modelId: 'marshall-plexi',
      preGainDb: 7, preDrive: 0.6, bass: -4, mid: 0, treble: -3,
      presence: 4, powerDrive: 0.2, outputDb: 1,
    },
    cabIR: TEST_CRUNCH_CAB ? { url: TEST_CRUNCH_CAB } : undefined,
    finalEq: { low: -1, mid: 2, high: 1, lowFrequency: 200, highFrequency: 3000 },
  },
};

// Metal — heavy preDrive + powerDrive, scooped mids, tight finalEq. Modern
// high-gain rhythm tone.
export const METAL_PRESET: VoicePreset = {
  id: 'metal-amp',
  name: 'Metal',
  instrumentId: 'guitar',
  family: 'electric',
  source: { kind: 'sampler', samples: OFFSET_P90, release: 1.5 },
  level: { volumeDb: -4, pan: 0 },
  effects: {
    amp: {
      modelId: 'modern-high-gain',
      preGainDb: 9, preDrive: 0.85, bass: 0, mid: -8, treble: 0,
      presence: 4, powerDrive: 0.3, outputDb: -2,
    },
    cabIR: TEST_METAL_CAB ? { url: TEST_METAL_CAB } : undefined,
    finalEq: { low: 3, mid: -1, high: -3, lowFrequency: 150, highFrequency: 4000 },
  },
};

// Surf — fully clean, bright tone, heavy spring reverb. Showcases the
// per-voice reverb stage; closest the bundled set gets to a vintage surf-rock
// tone without a dedicated tremolo (no tremolo node yet).
export const SURF_PRESET: VoicePreset = {
  id: 'surf-amp',
  name: 'Surf',
  instrumentId: 'guitar',
  family: 'electric',
  source: { kind: 'sampler', samples: OFFSET_P90, release: 2.5 },
  level: { volumeDb: 6, pan: 0 },
  effects: {
    amp: {
      modelId: 'fender-twin',
      preGainDb: 0, preDrive: 0, bass: -4, mid: -5, treble: 0,
      presence: 2, powerDrive: 0, outputDb: 4,
    },
    reverb: { roomSize: 0.9, wet: 0.55 },   // BIG spring reverb
    cabIR: TEST_CLEAN_CAB ? { url: TEST_CLEAN_CAB } : undefined,
    finalEq: { low: -1, mid: 0, high: 2, lowFrequency: 200, highFrequency: 3000 },
  },
};

// Ambient — clean tone with chorus + delay + heavy reverb. Showcases the full
// pedalboard chain. Good starter for shimmer / ambient passages.
export const AMBIENT_PRESET: VoicePreset = {
  id: 'ambient-amp',
  name: 'Ambient',
  instrumentId: 'guitar',
  family: 'electric',
  source: { kind: 'sampler', samples: OFFSET_P90, release: 2.8 },
  level: { volumeDb: 4, pan: 0 },
  effects: {
    chorus: { frequency: 0.8, depth: 0.5, wet: 0.35, type: 'sine', feedback: 0.2, delayTime: 0.004, spread: 180 },
    delay: { delayTime: 0.45, feedback: 0.4, wet: 0.25 },
    amp: {
      modelId: 'fender-twin',
      preGainDb: 0, preDrive: 0.05, bass: -1, mid: -3, treble: 0,
      presence: 1, powerDrive: 0, outputDb: 2,
    },
    reverb: { roomSize: 0.95, wet: 0.55 },
    cabIR: TEST_CLEAN_CAB ? { url: TEST_CLEAN_CAB } : undefined,
    finalEq: { low: -1, mid: 0, high: 1, lowFrequency: 250, highFrequency: 2500 },
  },
};

export const VOICE_PRESETS: readonly VoicePreset[] = [
  ACOUSTIC_GUITAR_PRESET,
  ELECTRIC_GUITAR_PRESET,
  KARORYFER_GREEN_GUITAR_PRESET,
  KARORYFER_BLACK_GUITAR_PRESET,
  CLEAN_AMP_PRESET,
  BLUES_PRESET,
  CRUNCH_PRESET,
  LEAD_PRESET,
  METAL_PRESET,
  SURF_PRESET,
  AMBIENT_PRESET,
  ACOUSTIC_BASS_PRESET,
  ELECTRIC_BASS_PRESET,
  ACOUSTIC_UKULELE_PRESET,
];

export function findPreset(
  instrumentId: FretInstrumentId,
  family: VoiceFamily,
): VoicePreset | undefined {
  return VOICE_PRESETS.find(
    (p) => p.instrumentId === instrumentId && p.family === family,
  );
}
