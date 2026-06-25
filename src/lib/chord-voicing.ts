/**
 * Algorithmic chord voicer: turn a parsed chord into a playable fretboard grip
 * (≤ one note per string) on a given tuning.
 *
 * This is the *fallback* engine of the hybrid voicer described in the import
 * spec — it always produces a tones-correct, span-limited voicing for any chord
 * on any tuning. A curated dictionary of canonical open/barre grips overrides it
 * for the common chords where a guitarist expects a specific shape (added in a
 * later step). The goal here is correctness and playability, not idiomatic feel.
 *
 * Heuristic:
 *   1. Anchor the bass — lowest string × lowest fret sounding the bass pitch
 *      class (slash bass, else the root).
 *   2. Walk upward string by string, picking a chord tone that keeps all fretted
 *      notes within a playable span, preferring tones not yet covered and frets
 *      nearest the anchor (open strings allowed anywhere).
 */
import { Note } from 'tonal';
import type { TuningDef } from '../types';
import type { ParsedChord } from './chords';
import { pitchClass } from './theory';
import { pitchOf } from './fretboard';
import {
  resolveCagedChordCells,
  CAGED_CHORD_LETTERS,
  type ChordQuality,
} from '../playback/patterns/caged-chord-shapes-data';

export interface Grip {
  cells: ReadonlyArray<{ stringIndex: number; fret: number }>;
}

export interface VoiceChordOptions {
  /** Highest fret the search will consider. */
  maxFret?: number;
  /** Maximum span (in frets) between the lowest and highest fretted note. */
  maxSpan?: number;
}

const norm = (pc: number) => ((pc % 12) + 12) % 12;

export function voiceChord(
  chord: ParsedChord,
  tuning: TuningDef,
  opts: VoiceChordOptions = {},
): Grip | null {
  const { maxFret = 12, maxSpan = 4 } = opts;
  const chordPcs = new Set(chord.pitchClasses.map(norm));
  const bassPc = norm(chord.bass ? pitchClass(chord.bass) : chord.pitchClasses[0]);

  const openMidi = tuning.strings.map((s) => {
    const m = Note.midi(s);
    if (m == null) throw new Error(`Unknown open-string pitch: ${s}`);
    return m;
  });

  const noteAtPc = (stringIdx: number, fret: number) => norm(openMidi[stringIdx] + fret);

  // 1. Anchor the bass on the lowest possible string + fret.
  let anchor: { stringIndex: number; fret: number } | null = null;
  for (let s = 0; s < openMidi.length && !anchor; s++) {
    for (let f = 0; f <= maxFret; f++) {
      if (noteAtPc(s, f) === bassPc) {
        anchor = { stringIndex: s, fret: f };
        break;
      }
    }
  }
  if (!anchor) return null;

  const cells = [anchor];
  const covered = new Set([bassPc]);
  const frettedFrets = anchor.fret > 0 ? [anchor.fret] : [];

  const withinSpan = (fret: number): boolean => {
    if (fret === 0) return true; // open strings are always reachable
    if (frettedFrets.length === 0) return true;
    const lo = Math.min(...frettedFrets, fret);
    const hi = Math.max(...frettedFrets, fret);
    return hi - lo <= maxSpan;
  };

  // 2. Fill the strings above the bass.
  for (let s = anchor.stringIndex + 1; s < openMidi.length; s++) {
    let best: { fret: number; pc: number; score: number } | null = null;
    for (let f = 0; f <= maxFret; f++) {
      const pc = noteAtPc(s, f);
      if (!chordPcs.has(pc)) continue;
      if (!withinSpan(f)) continue;
      // Prefer covering an uncovered tone, then frets near the anchor.
      const score = (covered.has(pc) ? 0 : 100) - Math.abs(f - anchor.fret);
      if (!best || score > best.score) best = { fret: f, pc, score };
    }
    if (best) {
      cells.push({ stringIndex: s, fret: best.fret });
      covered.add(best.pc);
      if (best.fret > 0) frettedFrets.push(best.fret);
    }
  }

  return { cells };
}

/** Tonal chord `type` → the five CAGED qualities, or null when no canonical
 *  CAGED shape exists (dim, sus, 6, add9, aug… fall through to the algorithm). */
function cagedQualityOf(type: string): ChordQuality | null {
  switch (type) {
    case 'major':
      return 'major';
    case 'minor':
      return 'minor';
    case 'dominant seventh':
      return 'dom7';
    case 'major seventh':
      return 'maj7';
    case 'minor seventh':
      return 'min7';
    default:
      return null;
  }
}

/**
 * Preferred (idiomatic) voicing: for the common chord qualities on standard
 * guitar tuning, return the lowest CAGED voicing — which lands the open shapes
 * at the nut and barre shapes elsewhere, i.e. what a guitarist actually plays.
 * Everything else (slash chords, non-standard tunings, exotic qualities) falls
 * back to the algorithmic voicer.
 */
export function voiceChordPreferred(
  chord: ParsedChord,
  tuning: TuningDef,
  opts: VoiceChordOptions = {},
): Grip | null {
  const quality = cagedQualityOf(chord.type);
  // The CAGED shape offsets assume standard-guitar string intervals; only apply
  // them there. Slash basses aren't honored by the root-position shapes, so let
  // the algorithm (which anchors the written bass) handle those.
  if (quality && tuning.id === 'standard' && !chord.bass) {
    const ctx = {
      tuning,
      key: chord.root,
      capo: 0,
      fretCount: 15,
      stringCount: tuning.strings.length,
    };
    const chordPcs = new Set(chord.pitchClasses.map(norm));
    type Candidate = {
      cells: { stringIndex: number; fret: number }[];
      coverage: number;
      maxFret: number;
    };
    let best: Candidate | null = null;
    for (const letter of CAGED_CHORD_LETTERS) {
      const resolved = resolveCagedChordCells(letter, quality, ctx);
      if (resolved.length === 0) continue;
      const cells = resolved.map((c) => ({ stringIndex: c.stringIndex, fret: c.fret }));
      const covered = new Set(cells.map((c) => norm(pitchOf(c, tuning))));
      const coverage = [...chordPcs].filter((pc) => covered.has(pc)).length;
      const maxFret = Math.max(...cells.map((c) => c.fret));
      // Most chord tones covered wins (no sparse fragments); then the lowest
      // position; then the fuller voicing.
      const better =
        !best ||
        coverage > best.coverage ||
        (coverage === best.coverage && maxFret < best.maxFret) ||
        (coverage === best.coverage && maxFret === best.maxFret && cells.length > best.cells.length);
      if (better) best = { cells, coverage, maxFret };
    }
    if (best) return { cells: best.cells };
  }
  return voiceChord(chord, tuning, opts);
}
