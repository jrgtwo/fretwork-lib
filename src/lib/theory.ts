/**
 * Music-theory wrapper around Tonal.js.
 * The rest of the app imports from this file; nothing else should import `tonal` directly.
 */
import { Note, Interval } from 'tonal';
import type { PitchClass } from '../types';

/** Transpose an open-string pitch up `fret` semitones. */
export function noteAt(openStringNote: string, fret: number): string {
  const midi = Note.midi(openStringNote);
  if (midi == null) {
    throw new Error(`Unknown open-string pitch: ${openStringNote}`);
  }
  // Note.fromMidi returns sharp spellings by default. We re-spell to match the active
  // key elsewhere (in spellInKey); for raw fretboard math, sharp spelling is fine.
  return Note.fromMidi(midi + fret);
}

/** Pitch class 0..11 of any note (with or without octave). */
export function pitchClass(note: string): PitchClass {
  const ch = Note.chroma(note);
  if (ch == null) {
    throw new Error(`Unknown note: ${note}`);
  }
  return ch;
}

/** Pitch class of a note name without octave (e.g. "C#" → 1). */
export function pitchClassOfTonic(tonic: string): PitchClass {
  return pitchClass(tonic);
}

/**
 * Spell a target pitch class as it should appear in the active key, using Tonal's
 * letter-stepping interval transpose. For a root and an interval (in semitones), Tonal
 * picks the conventional spelling — e.g. A + 4 → "C#" (M3), F + 4 → "A" (M3),
 * D + 6 → "G#" (A4), Eb + 6 → "A" (A4). This avoids hand-rolled sharp/flat tables.
 *
 * For chromatic keys with sharp tonics our UI uses sharp names, so the rooted
 * intervals naturally produce sharp-leaning spellings; F-rooted keys produce
 * the expected flat-leaning spellings.
 */
export function spellInKey(rootTonic: string, intervalSemitones: number): string {
  const intervalName = Interval.fromSemitones(intervalSemitones);
  const transposed = Note.transpose(`${rootTonic}4`, intervalName);
  return Note.pitchClass(transposed);
}

/**
 * Short interval label suitable for guitarists ("1", "b3", "5", "b7", etc.).
 * Always returns one of the 12 chromatic-degree shorthands; doesn't distinguish
 * enharmonic equivalents (#4 vs b5, #5 vs b6) — picks the form most common in
 * scale/arpeggio teaching.
 */
const INTERVAL_LABELS: Readonly<Record<number, string>> = {
  0: '1',
  1: 'b2',
  2: '2',
  3: 'b3',
  4: '3',
  5: '4',
  6: 'b5',
  7: '5',
  8: 'b6',
  9: '6',
  10: 'b7',
  11: '7',
};

export function intervalLabel(semitones: number): string {
  const normalized = ((semitones % 12) + 12) % 12;
  return INTERVAL_LABELS[normalized];
}

/** 1-based degree number for the Notes label mode (1..7 for diatonic, may go up to 7+ as needed). */
export function degreeNumber(intervalIndex: number): number {
  return intervalIndex + 1;
}
