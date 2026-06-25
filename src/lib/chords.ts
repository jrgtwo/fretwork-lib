/**
 * Chord-symbol parsing for import (chord sheets) and anywhere a written chord
 * name needs to become pitch classes / a fretboard voicing.
 *
 * Wraps Tonal's `Chord` module (the theory layer is the only place that imports
 * `tonal` directly). Adds tolerance for the messy real-world symbols found in
 * chord-sheet files — footnote markers, parenthetical modifiers — that vanilla
 * Tonal rejects.
 */
import { Chord } from 'tonal';
import { pitchClass } from './theory';

export interface ParsedChord {
  /** The cleaned symbol that actually parsed. */
  symbol: string;
  /** Root pitch-class name, e.g. "G", "C#", "Bb". */
  root: string;
  /** Slash-bass pitch-class name (e.g. "B" in G/B), or null when none. */
  bass: string | null;
  /** Pitch-class names, no octave; bass-first when a slash bass is present. */
  notes: string[];
  /** Pitch classes 0..11, parallel to `notes`. */
  pitchClasses: number[];
  /** Tonal chord type, e.g. "major", "minor seventh", "suspended fourth". */
  type: string;
}

/**
 * Real-world chord tokens carry cruft Tonal rejects: footnote markers (`Asus4*`)
 * and parenthetical modifiers that may be a real quality (`F(add9)` → `Fadd9`) or
 * just a voicing hint to discard (`Gmaj7(no3rd)` → `Gmaj7`). We try progressively
 * more aggressive normalizations and take the first that Tonal accepts.
 */
function cleaningCandidates(raw: string): string[] {
  const trimmed = raw.trim();
  // Strip trailing footnote/punctuation markers (e.g. `Asus4*`, `D7,`).
  const noFootnote = trimmed.replace(/[*.,;:]+$/, '');
  // Inline parentheticals — keep their contents (`F(add9)` → `Fadd9`).
  const inlined = noFootnote.replace(/[()]/g, '');
  // Drop parentheticals entirely (`Gmaj7(no3rd)` → `Gmaj7`).
  const dropped = noFootnote.replace(/\([^)]*\)/g, '').trim();
  return [trimmed, noFootnote, inlined, dropped];
}

/**
 * Best-guess chord name for a set of sounding notes (note names, octave
 * optional) — the reverse of `parseChordSymbol`, used by the look-ahead bar to
 * label a chord segment when no authored name exists. Returns null when the
 * notes don't form a recognizable chord (e.g. a single note). The bare-major
 * suffix Tonal emits (`CM`) is normalized to the plain root (`C`).
 */
export function detectChordName(notes: readonly string[]): string | null {
  const [best] = Chord.detect(notes as string[]);
  if (!best) return null;
  return best.replace(/^([A-G][#b]?)M$/, '$1');
}

export function parseChordSymbol(raw: string): ParsedChord | null {
  for (const candidate of cleaningCandidates(raw)) {
    if (!candidate) continue;
    // A real chord starts with an uppercase root note A–G. This rejects
    // lowercase words Tonal would otherwise coerce (e.g. "a" → A).
    if (!/^[A-G]/.test(candidate)) continue;
    const chord = Chord.get(candidate);
    if (chord.empty || !chord.tonic) continue;
    return {
      symbol: candidate,
      root: chord.tonic,
      bass: chord.bass || null,
      notes: chord.notes,
      pitchClasses: chord.notes.map(pitchClass),
      type: chord.type,
    };
  }
  return null;
}
