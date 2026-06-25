/**
 * Data model for the Patterns page (Phase 1).
 *
 * The model is designed to express full polyphony (variable durations, rests, chords,
 * articulations, multi-voice via lane tags) even though Phase 1 UI exposes only a subset.
 * Articulation and laneId are reserved fields — the model accepts them, the UI never
 * reads or writes them in Phase 1, but downstream code (imports, future articulation UI,
 * future multi-voice authoring) can light up incrementally without a model migration.
 */

/** Pulse-per-quarter-note resolution. A quarter note = 480 ticks. */
export type Tick = number;

/** The three step-length values the editor's stamp picker exposes in Phase 1. */
export type StepLength = 'quarter' | 'eighth' | 'sixteenth';

/** Reserved — Phase 2 UI. */
export type ArticulationId = 'bend' | 'slide' | 'hammer-on' | 'pull-off' | 'trill';

/**
 * Standard musical dynamic markings, ordered softest → loudest. Used on
 * `PatternEvent.dynamic` for display purposes; the same authoring also
 * populates `PatternEvent.velocity` (the numeric value the playback engine
 * actually consumes).
 */
export type DynamicMark = 'ppp' | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fff';

export interface PatternEvent {
  id: string;
  stringIndex: number;
  fret: number;
  startTick: Tick;
  durationTicks: Tick;
  /** Reserved; no Phase 1 UI. */
  laneId?: string;
  /**
   * Chord-group id — events sharing it are one authored chord (a "make chord"
   * grouping). Optional/back-compat: absent on all legacy + hand-stamped notes.
   * Read by look-ahead segmentation to render a chord card instead of guessing.
   */
  chordId?: string | null;
  /** Display name for the chord group (e.g. "G", "Am7"). Auto-suggested via
   *  `detectChordName` at tag time, user-editable. Only meaningful with `chordId`. */
  chordName?: string | null;
  /** Deprecated single-articulation field. New code reads/writes the
   *  fine-grained boolean/object fields below; this stays for backward
   *  compatibility with persisted data. */
  articulation?: ArticulationId;

  // ─── Articulation fields (populated by music-import; future Phase 2 UI) ──
  /**
   * This note is the destination of a hammer-on from the previous note on
   * the same string. The playback engine reduces its attack to approximate
   * the legato sound.
   */
  hammerOn?: boolean;
  /**
   * This note is the destination of a pull-off from the previous note on
   * the same string. Same playback treatment as `hammerOn`.
   */
  pullOff?: boolean;
  /**
   * Marks that this event ties into the immediately-following same-string
   * same-fret event — playback collapses the pair into a single sustained
   * note (the second event's attack is suppressed and its duration is
   * folded into the first). The model still stores both events so the
   * timeline can render them as two visually-distinct tied notes.
   */
  tieToNext?: boolean;
  /**
   * Normalized velocity in [0, 1]. The playback engine passes this as the
   * 4th argument to `triggerAttackRelease`. When undefined, the engine's
   * default (1.0) is used. Population paths:
   *   - Import: mapper translates the file's dynamic marking (ppp..fff) to
   *     a value on a fixed musical curve.
   *   - Future authoring: a velocity stepper in NoteInspector will let
   *     users dial per-event loudness directly.
   *
   * This field composes with hammer-on/pull-off treatment — the scheduler
   * multiplies the velocity by a legato factor when those flags are set,
   * so a forte hammer-on plays louder than a piano hammer-on but both
   * still feel softer than their plain-pluck counterparts.
   */
  velocity?: number;
  /**
   * Original dynamic marking — for display only. The playback engine reads
   * `velocity`, never this. Import populates both; future authoring UI may
   * let users pick a marking (which back-fills `velocity` via the same
   * curve the mapper uses).
   */
  dynamic?: DynamicMark;
  /**
   * Per-note vibrato. The playback engine modulates the voice's pitch via
   * a Tone.Vibrato node during this note's duration. Two intensities:
   *   - `slight`: depth ≈ 0.04, frequency ≈ 5.5 Hz — finger vibrato.
   *   - `wide`: depth ≈ 0.12, frequency ≈ 4 Hz — whammy-bar / wide hand vib.
   */
  vibrato?: 'slight' | 'wide';
  /**
   * Pitch slide. Six musical types:
   *   - `legato` / `shift` — slide TO the next same-string note (the
   *     `toFret` field is filled by the mapper from the next event).
   *   - `slide-in-below` / `slide-in-above` — start ~2 semitones below/above
   *     and ramp into this note's pitch in the first ~15% of the duration.
   *   - `slide-out-down` / `slide-out-up` — stay at pitch then ramp ±3
   *     semitones in the last ~15% of the duration.
   *
   * Playback uses Tone.PitchShift on the voice's signal chain to apply the
   * ramp. Monophonic only — overlapping notes with active slides will share
   * the pitch shift, but the patterns we currently import are monophonic.
   */
  slide?: {
    type:
      | 'legato'
      | 'shift'
      | 'slide-in-below'
      | 'slide-in-above'
      | 'slide-out-down'
      | 'slide-out-up';
    /** Destination fret for `legato` / `shift` only. */
    toFret?: number;
  };
  /**
   * Pitch bend. The curve is described by an optional list of
   * `{at, semitones}` points along the note's duration (`at` is the
   * normalized 0..1 position within the note). When `points` is absent,
   * the playback engine synthesizes a curve from `type` + `semitones`:
   *   - `bend`         — 0 → semitones across the note
   *   - `release`      — semitones → 0 across the note
   *   - `pre-bend`     — constant semitones throughout
   *   - `bend-release` — 0 → semitones → 0 (peak at midpoint)
   *
   * `semitones` is the peak/sustained bend depth. Bends compose with the
   * same `Tone.PitchShift` node slides use, so a note can't carry both
   * simultaneously — bend takes priority when both are present.
   */
  bend?: {
    type: 'bend' | 'release' | 'pre-bend' | 'bend-release';
    semitones: number;
    points?: Array<{ at: number; semitones: number }>;
  };
  /**
   * Palm-mute. Playback shortens the effective note duration so the sample
   * doesn't ring — approximates the dampened "chug" of a palm-muted string
   * without needing a per-note low-pass filter (would require chain
   * rewiring that's out of scope for phase 1).
   */
  palmMute?: boolean;
  /**
   * Ghost note. Played quieter than a normal pluck (~50% velocity); meant
   * to read as rhythmic articulation rather than a melodic note.
   */
  ghost?: boolean;
  /**
   * Dead / muted note. Very low velocity (~25%) and shortened duration
   * give the percussive "tick" sound of a damped string. Visually
   * rendered as 'X' instead of a fret number.
   */
  dead?: boolean;
  /**
   * Left-hand tap. Same playback treatment as hammer-on (reduced attack);
   * a different name in notation, but the same audible result on a
   * sample-based voice.
   */
  tap?: boolean;
  /**
   * Harmonic — natural / artificial / pinch / tap / semi. Playback
   * approximates by transposing the note up by 12 semitones (one octave),
   * which matches the sounding pitch of a 12th-fret natural harmonic and
   * roughly works for the other harmonic types too. Visually rendered
   * with a small diamond glyph beside the fret.
   */
  harmonic?: {
    type: 'natural' | 'artificial' | 'pinch' | 'tap' | 'semi';
    /** Optional sounding fret. Currently informational — playback uses a
     *  fixed +12 transposition regardless. */
    fret?: number;
  };
}

export interface Lane {
  id: string;
  name: string;
  color?: string;
}

export interface PatternTimeSignature {
  numerator: number;
  denominator: number;
}

/**
 * An automated tempo event on the pattern or composition timeline.
 *
 *   - `step` interpolation: BPM jumps instantly to `bpm` at `atTick`.
 *   - `linear` interpolation: BPM ramps from the previous event's value to this
 *     one across the intervening ticks. The first event in the track must use
 *     `step` (there's nothing to ramp from).
 *
 * A `tempoTrack` is interpreted as a sorted-by-`atTick` series. An empty
 * `tempoTrack` means "no automation" — playback uses whatever BPM the
 * Composition or metronome currently holds, and the legacy `suggestedBpm`
 * field is still consulted.
 */
export interface TempoEvent {
  atTick: Tick;
  bpm: number;
  interpolation: 'step' | 'linear';
}

/**
 * An automated time-signature change on the pattern or composition timeline.
 * The first event in a non-empty track should be at `atTick: 0`.
 *
 * An empty `timeSignatureTrack` means "no automation" — playback consults the
 * static `timeSignature` field.
 */
export interface TimeSignatureEvent {
  atTick: Tick;
  numerator: number;
  denominator: number;
}

/**
 * Groove (feel) specification. Swing values are in the same [0.5, 0.75] range as
 * `useMetronomeStore.swing` to avoid conversion at the metronome boundary:
 *   - 0.5  = straight (no swing)
 *   - 0.67 ≈ triplet feel
 *   - 0.75 = hard shuffle
 *
 * `appliedTo` chooses which subdivision the swing is applied to. An 8th-note
 * shuffle and a 16th-note swing are musically distinct feels.
 */
export interface GrooveSpec {
  swing: number;
  appliedTo: 'eighths' | 'sixteenths';
}

export interface Pattern {
  id: string;
  name: string;
  instrumentId: string;
  /** Editor-defined; defaults to 4 bars at the current time signature on creation. */
  durationTicks: Tick;
  timeSignature: PatternTimeSignature;
  /** Author's preferred tempo for this pattern. Null = no preference; metronome
   *  uses whatever value it currently holds. Auto-loads into the metronome when
   *  the pattern is opened in the editor. */
  suggestedBpm: number | null;
  /** Author's preferred feel for this pattern. Null = straight (no swing). */
  groove: GrooveSpec | null;
  /** Author's preferred click subdivision for this pattern. Null = no
   *  preference; metronome uses whatever value it currently holds. Combined
   *  with `groove` (swing) by the UI's Feel picker to express a single
   *  rhythmic concept (e.g. "Swung 8ths" = subdivision '8ths' + groove with
   *  appliedTo 'eighths' and swing > 0.5). */
  subdivision: import('../metronome/types').SubdivisionId | null;
  /** Whether editor playback loops this pattern until stopped. Default true
   *  (the pattern editor has always looped). Mirrors `Composition.loop`. */
  loop: boolean;
  /**
   * Optional voice / variant for this pattern. When null / undefined, the
   * global `activeVariants[instrumentId]` setting is used. When set, the
   * pattern plays through this specific voice in the editor, and a track
   * receives it as its default voice when the pattern is first placed onto a
   * track that has no voice of its own (see `addPlacementToTrack`).
   *
   * Loose-typed (`unknown`) to avoid a hard dependency from the patterns
   * model to the voices module — mirrors `Track.voiceRef`. Cast to
   * `VariantRef` at consumption.
   */
  voiceRef?: unknown | null;
  /** Optional musical key (note name like 'A', 'C#'). null = no key set,
   *  free-form chromatic editing. Invariant: key and scaleType are either
   *  both set or both null. */
  key: string | null;
  /** Optional scale id (e.g. 'major', 'minor-pentatonic'). null when key is null. */
  scaleType: string | null;
  events: PatternEvent[];
  /** Empty in Phase 1. */
  lanes: Lane[];

  // ─── Catalog metadata ──────────────────────────────────────────────────────
  // Authoring-time fields the catalog filter eventually reads. Stored alongside
  // musical content in this object; cloud sync extracts them into top-level row
  // columns for efficient WHERE-clauses while leaving them in `data` for the
  // jsonb-canonical reader. See `docs/supabase-integration.md`.
  description: string | null;
  /** 'beginner' | 'intermediate' | 'advanced' — see catalog/difficulty. */
  difficulty: string | null;
  /** Curated values from catalog/genres. */
  genres: string[];
  /** Curated values from catalog/tags. */
  tags: string[];
  /** 'private' | 'unlisted' | 'public' — see catalog/visibility. */
  visibility: string;
  /**
   * Unix-ms timestamp recording when this pattern most-recently transitioned out of
   * private. Cleared on return to private and re-set on the next departure. Used by
   * the catalog's "recently published" sort.
   */
  publishedAt: number | null;
  /** UUID of the pattern this was forked from, or null. */
  forkedFromId: string | null;
  /** Display name of the user who created the source pattern at fork-time.
   *  Denormalized snapshot — set once when the fork is created, never mutated.
   *  Null when this row isn't a fork (or when the source had no attribution
   *  snapshot, e.g. its creator's account was already deleted). */
  forkedFromCreatorName: string | null;

  /** Containing folder id, or null for library root. See `Collection`. */
  collectionId: string | null;

  /**
   * Optional tempo-automation track. Empty array (the default) means no
   * automation: playback consults `suggestedBpm` and the metronome's current
   * BPM. Populated by imports that carry mid-song tempo changes; future
   * authoring UI will let users edit it directly.
   */
  tempoTrack: TempoEvent[];

  /**
   * Optional time-signature-automation track. Empty array (the default) means
   * no automation: playback consults the static `timeSignature` field.
   */
  timeSignatureTrack: TimeSignatureEvent[];

  /**
   * Original import payload. Non-null only for rows produced by the import
   * pipeline. Carries every track from the source file (including the ones
   * not chosen for the active import target), enabling future re-extraction
   * and multi-instrument playback without re-importing. The type is loose
   * (`unknown`) here to avoid a circular type dependency on the import IR;
   * code that reads this field should narrow via `as ImportIR`.
   */
  sourceIR: unknown | null;

  createdAt: number;
  updatedAt: number;
}

/**
 * One playback track within a `Composition`. Compositions are multi-track:
 * each track plays its own placements through its own voice/instrument and
 * mixes through a per-track volume into the composition's master bus.
 *
 * Mute / solo follow standard DAW semantics: any soloed track silences
 * non-soloed tracks; mute is independent. Both ride on a per-track
 * audio-rate gain so toggling them doesn't click.
 */
export interface Track {
  id: string;
  name: string;
  instrumentId: string;
  /**
   * Optional voice / variant override for this track. When null /
   * undefined, the global `activeVariants[instrumentId]` setting is used
   * (matches pre-multi-track behavior). When set, two tracks of the same
   * instrument can use different voice variants (e.g. a clean lead guitar
   * + a distorted rhythm guitar).
   *
   * Loose-typed (`unknown`) to avoid a hard dependency from the patterns
   * model to the voices module. Cast to `VariantRef` at consumption.
   */
  voiceRef?: unknown | null;
  /** Per-track volume in dB. 0 = unity. Range typically -60..+6.  */
  volumeDb: number;
  muted: boolean;
  soloed: boolean;
  /** This track's placements — each placement points to a deep-copied
   *  Pattern snapshot just like the legacy single-track model. */
  placements: Placement[];
}

/** Maximum simultaneous tracks per Composition. The cap exists because each
 *  Sampler-based voice loads its own sample bank; 8 already pushes ~50MB
 *  for an all-sampler band. */
export const MAX_COMPOSITION_TRACKS = 8;

export interface Placement {
  id: string;
  /** Deep-copied at placement time — no reference to the library pattern. */
  patternSnapshot: Pattern;
  /** Absolute tick within the composition where this placement begins. */
  startTick: Tick;
  /** Number of times the effective length is repeated back-to-back. >= 1.
   *  Kept on the model for backward-compatibility with persisted data. The
   *  new arranger UI hides this control; new placements always have repeat 1.
   *  Legacy placements with repeat > 1 still play correctly. */
  repeat: number;
  /** Render-time pitch shift in semitones. Default 0. Non-destructive — the
   *  snapshot's events are unchanged; `flattenComposition` applies the shift.
   *  Out-of-range frets (< 0 or > fretCount) are dropped from playback. */
  transposeSemitones: number;
  /** Render-time truncation. When non-null, only the first `lengthTicks` of
   *  the snapshot are emitted by `flattenComposition`. Events straddling the
   *  cut have their `durationTicks` clipped. null = use the snapshot's full
   *  duration. */
  lengthTicks: Tick | null;
}

/** One span of the composition's authored harmonic-context layer (super-tab).
 *  Defined here (not in lookahead/) so `Composition` can reference it without a
 *  circular import. Portable + self-contained for the future file format. */
export interface HarmonicContextBlock {
  id: string;
  startTick: Tick;
  /** End tick, exclusive. */
  endTick: Tick;
  /** Chord symbol for this span, e.g. "C", "Am7". Null = scale-only. */
  chord?: string | null;
  /** Scale/key for this span. Null = chord-only. */
  scale?: { root: string; type: string } | null;
}

export interface Composition {
  id: string;
  name: string;
  instrumentId: string;
  /** Pushed into the metronome on play; not the metronome's current value until play. */
  bpm: number;
  /** Whether composition playback uses `bpm` globally for all placements
   *  ('global'), or each placement plays at its source pattern's `suggestedBpm`
   *  with `bpm` as the fallback ('inherit'). */
  tempoMode: 'global' | 'inherit';
  /** Composition-level groove. Acts as the global groove when grooveMode is
   *  'global', and as the fallback when grooveMode is 'inherit'. */
  groove: GrooveSpec | null;
  /** Whether composition playback uses `groove` globally ('global') or pulls
   *  each placement's source pattern groove ('inherit'). */
  grooveMode: 'global' | 'inherit';
  /** Composition-level click subdivision. Null = use the metronome's current
   *  value at play time. See `Pattern.subdivision` for the per-pattern field. */
  subdivision: import('../metronome/types').SubdivisionId | null;
  timeSignature: PatternTimeSignature;
  /** Authored harmonic-context layer (super-tab): chord/scale references over
   *  measure ranges, independent of any track's notes. Optional / back-compat. */
  harmonicContext?: HarmonicContextBlock[];
  /**
   * Multi-track playback content. Always non-empty: hydration migrates
   * legacy single-track compositions into a one-track structure so every
   * Composition consistently exposes `tracks`. The legacy `placements`
   * field below is kept for one migration cycle — new code reads
   * `tracks[*].placements`.
   */
  tracks: Track[];
  /**
   * Composition-level master volume in dB. 0 = unity. Each track's gain
   * mixes through this before reaching the global MasterBus.
   */
  masterVolumeDb: number;
  /**
   * @deprecated Legacy single-track field. Empty array after migration;
   * tracks[0].placements is canonical now. Kept on the type so persisted
   * blobs hydrate without warnings.
   */
  placements: Placement[];
  /** When true, composition playback wraps end → 0 and continues indefinitely.
   *  When false, playback stops at the end of the last placement. */
  loop: boolean;

  // ─── Catalog metadata (parallel to Pattern; see notes there) ──────────────
  description: string | null;
  difficulty: string | null;
  genres: string[];
  tags: string[];
  visibility: string;
  publishedAt: number | null;
  forkedFromId: string | null;
  /** Denormalized creator-name snapshot for fork attribution. See Pattern. */
  forkedFromCreatorName: string | null;

  /** Containing folder id, or null for library root. See `Collection`. */
  collectionId: string | null;

  /**
   * Optional tempo-automation track. Empty array (the default) means no
   * automation: playback consults `bpm` plus the per-placement inherit logic.
   */
  tempoTrack: TempoEvent[];

  /**
   * Optional time-signature-automation track. Empty array (the default) means
   * no automation: playback consults the static `timeSignature` field.
   */
  timeSignatureTrack: TimeSignatureEvent[];

  /** See `Pattern.sourceIR`. */
  sourceIR: unknown | null;

  createdAt: number;
  updatedAt: number;
}

/**
 * A folder. Kind-agnostic — a single collection can hold patterns, compositions,
 * and voice presets (via their `collectionId` FK). `parentId` is the containing
 * folder (or null for root); nested arbitrarily up to MAX_FOLDER_DEPTH.
 *
 * Visibility is independent of contained-item visibility — see migration 0010.
 */
export interface Collection {
  id: string;
  name: string;
  parentId: string | null;
  visibility: string;
  publishedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Library {
  patterns: Pattern[];
  compositions: Composition[];
  collections: Collection[];
}
