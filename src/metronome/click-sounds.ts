/**
 * Default click-sound factory. The metronome creates three voices on construction:
 * an "accent" voice (high), a "regular" voice (mid), and a "subdivision" voice
 * (low, softer). All are short triangle blips with a near-instant attack and a
 * 50ms decay.
 *
 * Consumers can override any voice via `Metronome.setSounds(...)` — see types.ts.
 */
import { Synth, Sampler, gainToDb } from 'tone';
import type { ClickSound } from './types';

export type ClickRole = 'accent' | 'regular' | 'subdivision';

export interface NormalizedClickVoices {
  accent: Synth | Sampler;
  regular: Synth | Sampler;
  subdivision: Synth | Sampler;
  /** Voices we created and own — must be disposed when the metronome is disposed. */
  ownedVoices: Set<Synth | Sampler>;
}

/** Build the default Tone.Synth-based click voices. */
export function createDefaultClickVoices(): NormalizedClickVoices {
  const accent = new Synth({
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
    volume: 2,
  }).toDestination();

  const regular = new Synth({
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
    volume: 0,
  }).toDestination();

  const subdivision = new Synth({
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 },
    volume: -6,
  }).toDestination();

  return {
    accent,
    regular,
    subdivision,
    ownedVoices: new Set([accent, regular, subdivision]),
  };
}

/**
 * Normalize a user-provided ClickSound into a Tone instrument the metronome can play.
 * If the input is `{ url }`, we create a Sampler that loads the URL — the caller takes
 * ownership of disposing that Sampler unless we created it (we record ownership in the
 * returned set).
 */
export function normalizeClickSound(
  sound: ClickSound | undefined,
  fallback: Synth | Sampler,
  ownedVoices: Set<Synth | Sampler>,
): Synth | Sampler {
  if (!sound) return fallback;
  if (sound instanceof Synth || sound instanceof Sampler) {
    return sound;
  }
  if ('url' in sound) {
    const sampler = new Sampler({ urls: { C4: sound.url } }).toDestination();
    ownedVoices.add(sampler);
    return sampler;
  }
  return fallback;
}

/**
 * Trigger one click on the given voice with role-appropriate pitch + level.
 *
 * Important: Tone.Synth's pitch is determined by the note passed to
 * triggerAttackRelease, not the oscillator config. We pass a higher note for accent
 * ('C6'), 'C5' for regular, and 'C4' for subdivision. Volume offsets stack on top
 * of the per-voice base level so the relative balance survives a master-volume
 * change.
 */
export function triggerClick(
  voice: Synth | Sampler,
  time: number,
  volume01: number,
  role: ClickRole = 'regular',
) {
  const offsetDb = role === 'accent' ? 4 : role === 'subdivision' ? -4 : 0;
  const dB = gainToDb(Math.max(0.0001, volume01)) + offsetDb;
  voice.volume.value = dB;
  const note = role === 'accent' ? 'C6' : role === 'subdivision' ? 'C4' : 'C5';
  voice.triggerAttackRelease(note, '32n', time);
}
