/**
 * Domain types — kept pure (no React, no UI concerns).
 */

export type Mode = 'scales' | 'arpeggios' | 'notes';

export type LabelMode = 'notes' | 'intervals' | 'blank';

export type Handedness = 'right' | 'left';

/** A 12-tone pitch class, 0 = C, 1 = C#, ..., 11 = B. */
export type PitchClass = number;

/** Semitone offsets from the root, in [0..11]. Order is conventional ascending. */
export type IntervalSet = readonly number[];

export interface ScaleDef {
  readonly id: string;
  readonly name: string;
  readonly intervals: IntervalSet;
  /** Optional short tag shown under the title in the info card (e.g. "Diatonic · Mode I"). */
  readonly tag?: string;
}

export interface ArpeggioDef {
  readonly id: string;
  readonly name: string;
  readonly intervals: IntervalSet;
  readonly tag?: string;
}

export interface TuningDef {
  readonly id: string;
  readonly name: string;
  /** Which instrument this tuning belongs to (e.g. 'guitar', 'bass', 'ukulele'). */
  readonly instrumentId: string;
  /**
   * Open-string pitches in scientific notation, in **physical bottom-to-top order**
   * (i.e. the order strings appear in standard tablature, with index 0 being the
   * string drawn at the bottom of the fretboard). For non-reentrant instruments
   * this also happens to be lowest-pitch-first; for reentrant instruments
   * (e.g. ukulele standard tuning ['G4','C4','E4','A4']) this is NOT the case —
   * the high-G drone string sits at the bottom physically despite being higher in
   * pitch than the C and E strings above it. See lib/instruments.ts.
   */
  readonly strings: readonly string[];
}

/** Re-export of InstrumentDef for the public types surface. */
export type { InstrumentDef } from './lib/instruments';
export type InstrumentId = string;

/** A specific cell on the fretboard grid (one string × one fret position). */
export interface NoteCell {
  /** 0 = lowest string (low E in standard), 5 = highest. */
  readonly stringIndex: number;
  /** 0 = open, 1..22 = fretted. */
  readonly fret: number;
  /** Sounding pitch in scientific notation, e.g. "C#4". */
  readonly note: string;
  /** Pitch class (0–11) of the sounding pitch. */
  readonly pitchClass: PitchClass;
}

export type DegreeCategory = 'root' | 'third' | 'fifth' | 'tone';

/** A cell that is part of the active scale/arpeggio/note set. */
export interface Highlight {
  readonly stringIndex: number;
  readonly fret: number;
  /** Spelled note name in the active key (e.g. "C#" not "Db" if the key calls for sharps). */
  readonly noteName: string;
  /** Interval label (e.g. "1", "b3", "5", "b7"). */
  readonly intervalLabel: string;
  /** 1-based scale degree number for "Notes" labels. */
  readonly degreeNumber: number;
  readonly category: DegreeCategory;
}

export interface FretworkSettings {
  readonly handedness: Handedness;
  readonly colorByDegree: boolean;
  readonly highlightRoot: boolean;
  /** When true, notes that are part of the full scale but outside the active CAGED
   *  shape render at low opacity instead of being hidden. Same flag also governs
   *  the planned ghost markers in Chord mode. Default true. */
  readonly showGhostMarkers: boolean;
}

export interface FretworkState {
  /** Active instrument id (e.g. 'guitar', 'bass', 'ukulele'). */
  readonly instrumentId: string;
  readonly mode: Mode;
  /** Root note (e.g. "A", "Bb", "F#"). Tonic only — no octave. */
  readonly key: string;
  /** Scale id, arpeggio id, or note name (e.g. "C") depending on mode. */
  readonly type: string;
  /** Tuning id from the tunings table. Must belong to the active instrument. */
  readonly tuning: string;
  /** Capo position, 0 = no capo, 1..(instrument.fretCount). */
  readonly capo: number;
  readonly labels: LabelMode;
  /** Active CAGED shape id (`'caged-c'` … `'caged-d'`) or null for the full scale.
   *  Only meaningful when `mode === 'scales'`; cleared automatically on mode change. */
  readonly shapeId: string | null;
  readonly settings: FretworkSettings;
}
