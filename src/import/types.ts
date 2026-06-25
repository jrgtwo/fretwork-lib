/**
 * Music import intermediate representation (IR).
 *
 * The IR is the format-agnostic shape every parser produces. Downstream, a single
 * mapper translates the IR into Pattern / Composition rows. The IR is **additive**:
 * every articulation / effect / dynamic field on `IREvent` and `IRNote` is optional.
 * Parsers fill in what they understand; parsers that don't, leave the field undefined.
 * The mapper handles unsupported fields by approximating or dropping with a logged
 * warning — never silently.
 *
 * Design notes:
 *   - Ticks are the same pulse-per-quarter-note resolution used by Pattern (`Tick`).
 *     Parsers may produce arbitrary `ticksPerQuarter`; the mapper rescales to the
 *     project's canonical 480 ppq.
 *   - String indices match `NoteCell.stringIndex` (0 = lowest physical string).
 *   - Tuning strings follow the same convention as `TuningDef.strings` —
 *     scientific-pitch, low-to-high in physical bottom-to-top order.
 *
 * See `docs/superpowers/specs/2026-05-22-music-import-design.md` for the full design.
 */

import type { Tick, TempoEvent, TimeSignatureEvent } from '../patterns/types';

// Re-export so consumers of the import module have a single place to grab
// every type the IR composes.
export type { Tick, TempoEvent, TimeSignatureEvent };

export type SourceFormat = 'guitar-pro' | 'musicxml' | 'midi' | 'ascii-tab';

export interface ImportMeta {
  title?: string;
  artist?: string;
  album?: string;
  composer?: string;
  sourceFormat: SourceFormat;
  /** e.g. 'gp5', 'gp7', '4.0'. Free-form short string. */
  sourceFormatVersion?: string;
  /**
   * Temporary debug payload — parsers may set this to a pre-stringified
   * dump that the import preview renders inside a collapsible block. Useful
   * for verifying extraction logic without devtools. Cleared by the
   * validator's string-length cap (so the field doesn't bloat persisted
   * `sourceIR` blobs).
   */
  parserDiagnostics?: string;
}

export interface KeySignatureEvent {
  atTick: Tick;
  /** Note name (e.g. 'A', 'F#'). Free-form short string. */
  key: string;
  mode: 'major' | 'minor';
}

export interface SectionMarker {
  atTick: Tick;
  /** User-visible section name ('Intro', 'Verse 1', 'Chorus', 'A', 'Bridge'…). */
  name: string;
}

export interface BendPoint {
  /** 0..1 — fraction of the note's duration where this bend point lands. */
  at: number;
  /** Bend depth in semitones; may be negative for release-below. */
  semitones: number;
}

export interface IRBend {
  type: 'bend' | 'release' | 'pre-bend' | 'bend-release';
  /** Peak/sustained bend depth in semitones. */
  semitones: number;
  /** Optional bend curve. If absent, treat as a simple bend to `semitones`. */
  points?: BendPoint[];
}

export interface IRSlide {
  type:
    | 'legato'
    | 'shift'
    | 'slide-in-below'
    | 'slide-in-above'
    | 'slide-out-down'
    | 'slide-out-up';
  /** For explicit shift slides, the destination fret. */
  toFret?: number;
}

export interface IRHarmonic {
  type: 'natural' | 'artificial' | 'pinch' | 'tap' | 'semi';
  /** Sounding fret for natural harmonics (often different from the played fret). */
  fret?: number;
}

export interface IRNote {
  /** 0 = lowest physical string (matches NoteCell.stringIndex). */
  string: number;
  /** 0 = open, 1+ = fretted. Clamped by the validator. */
  fret: number;

  // ─── Optional articulations — additive, parsers fill what they know ──────
  ghost?: boolean;
  dead?: boolean;
  letRing?: boolean;

  bend?: IRBend;
  slide?: IRSlide;
  hammerOn?: boolean;
  pullOff?: boolean;
  tap?: boolean;
  harmonic?: IRHarmonic;
  vibrato?: 'slight' | 'wide';
  tieToNext?: boolean;
}

export interface IREventEffects {
  palmMute?: boolean;
  accent?: 'normal' | 'heavy';
  staccato?: boolean;
  fadeIn?: boolean;
  tremoloPicking?: boolean;
  strumDirection?: 'up' | 'down';
}

export type Dynamic = 'ppp' | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fff';

export interface IREvent {
  atTick: Tick;
  durationTicks: Tick;
  /** One or more notes that fire on this beat. Multiple = chord. */
  notes: IRNote[];

  // ─── Optional beat-level metadata ────────────────────────────────────────
  tuplet?: { num: number; den: number };
  effects?: IREventEffects;
  dynamic?: Dynamic;
  tieToNext?: boolean;
}

export type InstrumentHint =
  | 'guitar'
  | 'bass'
  | 'ukulele'
  | 'drums'
  | 'vocals'
  | 'other';

export interface IRTrack {
  id: string;
  name: string;
  instrumentHint?: InstrumentHint;
  /** General MIDI program number, when the source carries it (0..127). */
  midiProgram?: number;
  /** Scientific-pitch open-string names, low-to-high physical order. */
  tuning?: string[];
  /** Capo position; 0 = no capo. */
  capo?: number;
  events: IREvent[];
}

/** A chord symbol placed at a tick — e.g. the `G`/`Am7`/`G/B` markers written
 *  above a tab staff. The mapper turns these into a composition's harmony lane. */
export interface ChordMarker {
  atTick: Tick;
  /** Chord symbol as written, e.g. "G", "Am7", "G/B". */
  symbol: string;
}

export interface ImportIR {
  meta: ImportMeta;
  /** Pulse-per-quarter-note resolution as reported by the source file. */
  ticksPerQuarter: number;
  /** Total length of the piece in IR ticks. */
  totalTicks: Tick;
  tempos: TempoEvent[];
  timeSignatures: TimeSignatureEvent[];
  keySignatures: KeySignatureEvent[];
  sections: SectionMarker[];
  tracks: IRTrack[];
  /** Chord markers (e.g. from chord names above a tab staff). Optional — only
   *  formats that carry harmony fill it; the mapper maps them to the harmony lane. */
  chords?: ChordMarker[];
}
