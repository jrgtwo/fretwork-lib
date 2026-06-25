/**
 * IR → Pattern / Composition mapper.
 *
 * Takes a validated `ImportIR` plus user-side choices (which track to import,
 * what topology to use) and produces:
 *
 *   - One or more `Pattern` rows (one for each section in composition mode,
 *     or a single pattern in single-pattern mode).
 *   - An optional `Composition` row that arranges those patterns in order.
 *   - A `MapperResult.warnings` list describing what was approximated or
 *     dropped — surfaced in the import preview.
 *
 * Tick rescaling: AlphaTab produces 960 ppq; our project uses 480 ppq. The
 * mapper divides every IR tick by `irPpq / PROJECT_PPQ` so the resulting
 * Pattern events land on the canonical grid. Any quantization the rescale
 * forces is recorded as a warning when notable.
 *
 * Articulations: phase-1 mapping treats every IRNote as a plain note (no
 * bends, slides, harmonics, etc. yet make it into the Pattern model). The
 * source IR is preserved on the row's `sourceIR` field, so future model
 * expansion can light up these articulations without re-import.
 */

import type { ChordMarker, ImportIR, IREvent, IRNote, IRTrack } from './types';
import type {
  Composition,
  HarmonicContextBlock,
  Pattern,
  PatternEvent,
  Placement,
  Tick,
  PatternTimeSignature,
  TempoEvent,
  TimeSignatureEvent,
  Track,
} from '../patterns/types';
import { MAX_COMPOSITION_TRACKS } from '../patterns/types';
import { generateId, generateUuid } from '../patterns/ids';
import { PPQ } from '../patterns/timebase';
import { migrateCompositionToTracks } from '../patterns/composition-ops';

const DEFAULT_INSTRUMENT_FOR_HINT: Record<string, string> = {
  guitar: 'guitar',
  bass: 'bass',
  ukulele: 'ukulele',
  drums: 'guitar', // we don't support drums; the mapper rejects upstream
  vocals: 'guitar',
  other: 'guitar',
};

export type MapTopology = 'composition' | 'single-pattern';

export interface MapInput {
  ir: ImportIR;
  /** Which track in `ir.tracks` is the "primary" — focus lands on this
   *  track post-import, and the arranger's first lane comes from here. */
  selectedTrackId: string;
  /**
   * Composition-mode-only filter: when present, only these tracks get
   * materialized into the composition. The rest stay in `sourceIR` for
   * future re-extraction. When absent (the default), every non-empty
   * track is imported.
   *
   * Single-pattern mode ignores this list — it always imports just the
   * `selectedTrackId` track.
   */
  includedTrackIds?: readonly string[];
  /** Override the topology choice (defaults to 'composition' if sections exist). */
  topology?: MapTopology;
  /** Override the user's currently-active instrument; used when the track
   *  has no usable `instrumentHint` and we need a fallback. */
  fallbackInstrumentId?: string;
}

export interface MapperResult {
  /** Library patterns to create. In single-pattern mode: length 1. In
   *  composition mode: one per section (or one if there are no sections). */
  patterns: Pattern[];
  /** Composition to create, with placements referencing snapshots of
   *  `patterns`. Null in single-pattern mode or when no sections exist. */
  composition: Composition | null;
  /** Human-readable warnings the preview can display. */
  warnings: string[];
  /** Topology actually used (the mapper falls back to 'single-pattern' when
   *  composition mode is requested but the IR has no sections). */
  topology: MapTopology;
}

export function mapImportToLibrary(input: MapInput): MapperResult {
  const { ir, selectedTrackId } = input;

  const selected = ir.tracks.find((t) => t.id === selectedTrackId);
  if (!selected) {
    return {
      patterns: [],
      composition: null,
      warnings: [`Selected track "${selectedTrackId}" not found in IR`],
      topology: 'single-pattern',
    };
  }

  const warnings: string[] = [];

  // Tempo automation: tempoTrack on the composition is fully scheduled
  // onto Tone.Transport.bpm at playback time, so multi-tempo files now
  // play with correct BPM changes. TS automation is still data-only —
  // changing meter mid-song requires per-bar accent updates that are not
  // yet wired into the metronome.
  if (ir.tempos.length > 1) {
    warnings.push(
      `Tempo automation (${ir.tempos.length} changes) — scheduled on the transport, audible during composition playback`,
    );
  }
  if (ir.timeSignatures.length > 1) {
    warnings.push(
      `Time signature automation (${ir.timeSignatures.length} changes) — scheduled on the transport; the metronome accent pattern and tick subdivision switch live at each boundary`,
    );
  }

  // Pick topology. Auto-default falls to composition mode when the file has
  // either multiple tracks OR section markers — both are signals that the
  // user expects more structure than a single flat pattern. An explicit
  // `input.topology` is honored regardless of file shape (the user knows
  // what they want).
  const tracksWithEvents = ir.tracks.filter((t) => t.events.length > 0);
  const multiTrack = tracksWithEvents.length > 1;
  const hasSections = ir.sections.length > 0;
  // Meter changes are a song-level concern → the meter map belongs on a
  // composition (whose ruler renders variable-width bars), not crammed into a
  // single pattern. So multiple time signatures also push to composition mode.
  const hasMeterChanges = ir.timeSignatures.length > 1;
  const topology: MapTopology =
    input.topology ??
    (multiTrack || hasSections || hasMeterChanges ? 'composition' : 'single-pattern');

  if (topology === 'composition') {
    return mapAsComposition(
      ir,
      selected,
      input.fallbackInstrumentId,
      warnings,
      input.includedTrackIds,
    );
  }

  // Single-pattern mode warns about the unselected tracks since they're
  // dropped from active playback (still preserved in sourceIR).
  const instrumentId = chooseInstrumentId(selected, input.fallbackInstrumentId);
  if (selected.instrumentHint === 'drums' || selected.instrumentHint === 'vocals') {
    warnings.push(
      `Selected track is a "${selected.instrumentHint}" track; imported as ${instrumentId} (no native ${selected.instrumentHint} support yet)`,
    );
  }
  const skipped = ir.tracks.filter((t) => t.id !== selectedTrackId);
  if (skipped.length > 0) {
    warnings.push(
      `Skipped tracks (preserved in source data, not yet playable): ${skipped.map((t) => t.name).join(', ')}`,
    );
  }
  inventoryArticulations(selected, warnings);
  return mapAsSinglePattern(ir, selected, instrumentId, warnings);
}

// ─── Single-pattern mode ──────────────────────────────────────────────────

function mapAsSinglePattern(
  ir: ImportIR,
  track: IRTrack,
  instrumentId: string,
  warnings: string[],
): MapperResult {
  const scale = scaleFactor(ir.ticksPerQuarter);
  const events: PatternEvent[] = [];
  let dropped = 0;
  let irNoteCount = 0;
  const stringCount = track.tuning?.length ?? 6;

  for (let ei = 0; ei < track.events.length; ei++) {
    const irEvent = track.events[ei];
    for (const irNote of irEvent.notes) {
      irNoteCount++;
      const pe = irNoteToPatternEvent(irNote, irEvent, scale, track.capo ?? 0, stringCount);
      if (pe) {
        resolveSlideTarget(pe, irNote, track, ei);
        events.push(pe);
      } else dropped++;
    }
  }

  if (dropped > 0) {
    warnings.push(`Dropped ${dropped} notes that fell outside the playable string/fret range`);
  }
  warnings.push(
    `Selected track "${track.name}" → ${irNoteCount} IR notes → ${events.length} pattern events`,
  );

  const initialBpm = ir.tempos[0]?.bpm ?? null;
  const initialTs: PatternTimeSignature =
    ir.timeSignatures[0]
      ? { numerator: ir.timeSignatures[0].numerator, denominator: ir.timeSignatures[0].denominator }
      : { numerator: 4, denominator: 4 };

  const durationTicks = Math.max(events.reduce((m, e) => Math.max(m, e.startTick + e.durationTicks), 0), 1);

  const pattern = buildPattern({
    name: ir.meta.title || track.name || 'Imported pattern',
    instrumentId,
    events,
    durationTicks,
    timeSignature: initialTs,
    suggestedBpm: initialBpm,
    tempoTrack: rescaleTempoTrack(ir.tempos, scale),
    timeSignatureTrack: rescaleTimeSignatureTrack(ir.timeSignatures, scale),
    sourceIR: ir,
  });

  return {
    patterns: [pattern],
    composition: null,
    warnings,
    topology: 'single-pattern',
  };
}

// ─── Composition mode ─────────────────────────────────────────────────────

/**
 * Multi-track composition import:
 *   - Every IR track with events becomes a Composition Track.
 *   - When section markers exist, every track is split into per-section
 *     patterns + placements (so all tracks share a common timeline
 *     skeleton). Empty sections on a track still produce a pattern — they
 *     just have no events. This keeps lane alignment intuitive in the
 *     arranger.
 *   - When no section markers exist, every track gets one big pattern
 *     containing all its events (one placement per track).
 *
 * Tracks beyond `MAX_COMPOSITION_TRACKS` are dropped with a warning;
 * their data is preserved in `sourceIR`.
 */
function mapAsComposition(
  ir: ImportIR,
  selectedTrack: IRTrack,
  fallbackInstrumentId: string | undefined,
  warnings: string[],
  includedTrackIds?: readonly string[],
): MapperResult {
  const scale = scaleFactor(ir.ticksPerQuarter);

  // Build section intervals (or a single full-song interval when no markers).
  const sections = ir.sections.slice().sort((a, b) => a.atTick - b.atTick);
  const intervals: Array<{ name: string; start: number; end: number }> = [];
  if (sections.length > 0) {
    for (let i = 0; i < sections.length; i++) {
      const start = sections[i].atTick;
      const end = i + 1 < sections.length ? sections[i + 1].atTick : ir.totalTicks;
      intervals.push({ name: sections[i].name || `Section ${i + 1}`, start, end });
    }
    if (sections[0].atTick > 0) {
      intervals.unshift({ name: 'Intro', start: 0, end: sections[0].atTick });
    }
  } else {
    intervals.push({ name: 'Main', start: 0, end: ir.totalTicks });
  }

  // Tracks to import — non-empty only, capped at MAX_COMPOSITION_TRACKS.
  // The selected track is sorted first so the arranger's "primary" lane
  // matches the user's pick. Drum/vocals tracks come through as
  // guitar-fallback today; richer mapping when those engines exist.
  // When `includedTrackIds` is provided, restrict to that subset so the
  // user can opt out of tracks they don't want (the unchecked ones still
  // ride along in sourceIR for future re-extraction).
  const includedSet = includedTrackIds ? new Set(includedTrackIds) : null;
  // Always keep the selected (primary) track included so the post-commit
  // navigation makes sense.
  if (includedSet && !includedSet.has(selectedTrack.id)) includedSet.add(selectedTrack.id);
  const importable = ir.tracks.filter(
    (t) => t.events.length > 0 && (includedSet === null || includedSet.has(t.id)),
  );
  importable.sort((a, b) => (a.id === selectedTrack.id ? -1 : b.id === selectedTrack.id ? 1 : 0));
  const dropped = importable.slice(MAX_COMPOSITION_TRACKS);
  const usable = importable.slice(0, MAX_COMPOSITION_TRACKS);

  // Tracks the user opted out of (still preserved in sourceIR).
  if (includedSet) {
    const explicitlyExcluded = ir.tracks.filter(
      (t) => t.events.length > 0 && !includedSet.has(t.id),
    );
    if (explicitlyExcluded.length > 0) {
      warnings.push(
        `Excluded ${explicitlyExcluded.length} track${explicitlyExcluded.length === 1 ? '' : 's'} (preserved in source data): ${explicitlyExcluded.map((t) => t.name).join(', ')}`,
      );
    }
  }

  if (dropped.length > 0) {
    warnings.push(
      `Dropped ${dropped.length} track${dropped.length === 1 ? '' : 's'} beyond the ${MAX_COMPOSITION_TRACKS}-track cap (preserved in source data): ${dropped.map((t) => t.name).join(', ')}`,
    );
  }
  const emptyTracks = ir.tracks.filter((t) => t.events.length === 0);
  if (emptyTracks.length > 0) {
    warnings.push(
      `${emptyTracks.length} empty track${emptyTracks.length === 1 ? '' : 's'} skipped (preserved in source data): ${emptyTracks.map((t) => t.name).join(', ')}`,
    );
  }

  // Materialize each track. Section patterns are collected into a single
  // flat list (the library); each track gets per-section placements
  // referencing snapshots.
  const patterns: Pattern[] = [];
  const trackResults: Track[] = [];
  let totalNotes = 0;
  let totalEvents = 0;
  let totalDropped = 0;

  for (const irTrack of usable) {
    const trackInstrumentId = chooseInstrumentId(irTrack, fallbackInstrumentId);
    const stringCount = irTrack.tuning?.length ?? 6;
    const trackPlacements: Placement[] = [];

    for (const seg of intervals) {
      const segEvents: PatternEvent[] = [];
      for (let ei = 0; ei < irTrack.events.length; ei++) {
        const irEvent = irTrack.events[ei];
        if (irEvent.atTick < seg.start || irEvent.atTick >= seg.end) continue;
        for (const irNote of irEvent.notes) {
          totalNotes++;
          const offsetEvent: IREvent = { ...irEvent, atTick: irEvent.atTick - seg.start };
          const pe = irNoteToPatternEvent(irNote, offsetEvent, scale, irTrack.capo ?? 0, stringCount);
          if (pe) {
            resolveSlideTarget(pe, irNote, irTrack, ei);
            segEvents.push(pe);
          } else totalDropped++;
        }
      }
      totalEvents += segEvents.length;

      const tsAtSegStart = timeSignatureAt(ir.timeSignatures, seg.start);
      const initialBpmAtSeg = bpmAt(ir.tempos, seg.start);
      const durationTicks = Math.max(
        segEvents.reduce((m, e) => Math.max(m, e.startTick + e.durationTicks), 0),
        Math.round((seg.end - seg.start) / scale),
      );
      // Pattern name: when multi-section, "<Track> · <Section>"; when
      // single-section, just the track name (more concise).
      const patternName =
        intervals.length > 1
          ? `${irTrack.name} · ${seg.name}`
          : irTrack.name;
      const sectionPattern = buildPattern({
        name: patternName,
        instrumentId: trackInstrumentId,
        events: segEvents,
        durationTicks,
        timeSignature: tsAtSegStart,
        suggestedBpm: initialBpmAtSeg,
        tempoTrack: sliceTempoTrack(ir.tempos, seg.start, seg.end, scale),
        timeSignatureTrack: sliceTimeSignatureTrack(ir.timeSignatures, seg.start, seg.end, scale),
        sourceIR: null,
      });
      patterns.push(sectionPattern);

      trackPlacements.push({
        id: generateId('pl'),
        patternSnapshot: clonePatternForPlacement(sectionPattern),
        startTick: Math.round(seg.start / scale),
        repeat: 1,
        transposeSemitones: 0,
        lengthTicks: null,
      });
    }

    trackResults.push({
      id: generateId('trk'),
      name: irTrack.name,
      instrumentId: trackInstrumentId,
      volumeDb: 0,
      muted: false,
      soloed: false,
      placements: trackPlacements,
    });

    // Inventory unsupported / surfaced articulations once per track —
    // labelled with the track name so the user knows where each warning came from.
    inventoryArticulationsLabeled(irTrack, warnings);
  }

  if (totalDropped > 0) {
    warnings.push(`Dropped ${totalDropped} notes that fell outside the playable string/fret range`);
  }
  warnings.push(
    `Imported ${usable.length} track${usable.length === 1 ? '' : 's'} → ${totalNotes} IR notes → ${totalEvents} pattern events across ${intervals.length} section${intervals.length === 1 ? '' : 's'}`,
  );

  const initialBpm = ir.tempos[0]?.bpm ?? 120;
  const initialTs: PatternTimeSignature =
    ir.timeSignatures[0]
      ? { numerator: ir.timeSignatures[0].numerator, denominator: ir.timeSignatures[0].denominator }
      : { numerator: 4, denominator: 4 };

  // Comp-level instrumentId stays as the selected track's instrument for
  // legacy UI bits that still read `composition.instrumentId`.
  const primaryInstrumentId = chooseInstrumentId(selectedTrack, fallbackInstrumentId);

  const composition = buildComposition({
    name: ir.meta.title || selectedTrack.name || 'Imported composition',
    instrumentId: primaryInstrumentId,
    bpm: initialBpm,
    timeSignature: initialTs,
    placements: [],
    tracks: trackResults,
    tempoTrack: rescaleTempoTrack(ir.tempos, scale),
    timeSignatureTrack: rescaleTimeSignatureTrack(ir.timeSignatures, scale),
    harmonicContext: buildHarmonicContext(ir.chords, scale, ir.totalTicks),
    sourceIR: ir,
  });

  return { patterns, composition, warnings, topology: 'composition' };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function scaleFactor(irPpq: number): number {
  // IR ticks / scale = project ticks. e.g. 960 / 2 = 480.
  return irPpq / PPQ;
}

function chooseInstrumentId(track: IRTrack, fallback: string | undefined): string {
  if (track.instrumentHint && DEFAULT_INSTRUMENT_FOR_HINT[track.instrumentHint]) {
    return DEFAULT_INSTRUMENT_FOR_HINT[track.instrumentHint];
  }
  return fallback ?? 'guitar';
}

/**
 * Multi-track variant: same warning content as `inventoryArticulations`
 * but each line is prefixed with the track name so the user knows which
 * track's articulations are being summarized.
 */
function inventoryArticulationsLabeled(track: IRTrack, warnings: string[]): void {
  const localWarnings: string[] = [];
  inventoryArticulations(track, localWarnings);
  for (const w of localWarnings) {
    warnings.push(`[${track.name}] ${w}`);
  }
}

function inventoryArticulations(track: IRTrack, warnings: string[]): void {
  let bends = 0;
  let slides = 0;
  let harmonics = 0;
  let hammers = 0;
  let ties = 0;
  let palmMutes = 0;
  let dynamics = 0;
  let ghost = 0;
  let dead = 0;
  let vibrato = 0;
  let taps = 0;

  for (const ev of track.events) {
    if (ev.effects?.palmMute) palmMutes++;
    if (ev.dynamic) dynamics++;
    for (const n of ev.notes) {
      if (n.bend) bends++;
      if (n.slide) slides++;
      if (n.harmonic) harmonics++;
      if (n.hammerOn || n.pullOff) hammers++;
      if (n.tieToNext) ties++;
      if (n.ghost) ghost++;
      if (n.dead) dead++;
      if (n.vibrato) vibrato++;
      if (n.tap) taps++;
    }
  }
  // Articulations split by current support status. "supported" prints a
  // green-feeling message (they're audibly different); "preserved" prints
  // the old wait-and-see message (data round-trips through sourceIR but
  // playback doesn't act on them yet).
  const supported: Array<[number, string]> = [
    [hammers, 'hammer-ons / pull-offs (destinations play with reduced attack)'],
    [ties, 'tied notes (collapsed into single sustained notes at playback)'],
    [dynamics, 'dynamic markings (ppp..fff translated to per-note velocity)'],
    [vibrato, 'vibrato notes (pitch modulated by LFO during the note)'],
    [slides, 'slides (pitch ramped via PitchShift across the note duration)'],
    [bends, 'bends (pitch curve stepped through the IR bend points)'],
    [palmMutes, 'palm-muted beats (shortened duration for the chug-chug feel)'],
    [ghost, 'ghost notes (played softer than surrounding notes)'],
    [dead, 'dead/muted notes (percussive tick, no defined pitch)'],
    [taps, 'tapped notes (same playback as hammer-ons)'],
    [harmonics, 'harmonics (transposed up one octave — approximation)'],
  ];
  const preserved: Array<[number, string]> = [];
  for (const [count, label] of supported) {
    if (count > 0) warnings.push(`${count} ${label} — applied during playback`);
  }
  for (const [count, label] of preserved) {
    if (count > 0) {
      warnings.push(
        `${count} ${label} detected — preserved in source data, played as plain notes for now`,
      );
    }
  }
  // Tuplets removed from the warning list intentionally — alphaTab already
  // adjusts beat tick positions to land on the correct tuplet sub-grid, so
  // the rhythm plays correctly without any further mapper work.
}

function irNoteToPatternEvent(
  note: IRNote,
  irEvent: IREvent,
  scale: number,
  capo: number,
  stringCount: number,
): PatternEvent | null {
  if (note.string < 0 || note.string >= stringCount) return null;
  const absoluteFret = note.fret + capo;
  if (absoluteFret < 0 || absoluteFret > 36) return null;
  const startTick = Math.round(irEvent.atTick / scale);
  const durationTicks = Math.max(1, Math.round(irEvent.durationTicks / scale));
  const pe: PatternEvent = {
    id: generateId('ev'),
    stringIndex: note.string,
    fret: absoluteFret,
    startTick,
    durationTicks,
  };
  // Articulations the model understands today. The IR carries strictly more
  // detail in the always-preserved sourceIR; future model expansion can wake
  // them up without re-import.
  if (note.hammerOn) pe.hammerOn = true;
  if (note.pullOff) pe.pullOff = true;
  if (note.tieToNext) pe.tieToNext = true;
  if (note.vibrato) pe.vibrato = note.vibrato;
  if (note.slide) pe.slide = { type: note.slide.type };
  if (note.bend) {
    pe.bend = {
      type: note.bend.type,
      semitones: note.bend.semitones,
      points: note.bend.points?.map((p) => ({ at: p.at, semitones: p.semitones })),
    };
  }
  if (note.ghost) pe.ghost = true;
  if (note.dead) pe.dead = true;
  if (note.tap) pe.tap = true;
  if (note.harmonic) {
    pe.harmonic = { type: note.harmonic.type, fret: note.harmonic.fret };
  }
  // Palm-mute lives on the beat (IREvent.effects), so it applies to every
  // note in the beat. We replicate it onto each per-note PatternEvent.
  if (irEvent.effects?.palmMute) pe.palmMute = true;
  const velocity = dynamicToVelocity(irEvent.dynamic);
  if (velocity != null) pe.velocity = velocity;
  if (irEvent.dynamic) pe.dynamic = irEvent.dynamic;
  return pe;
}

/**
 * For 'shift' / 'legato' slides, the destination fret is whatever the next
 * same-string event lands on. The mapper resolves that ahead of playback
 * so the scheduler doesn't have to do same-string lookups at audio time.
 *
 * For other slide types ('slide-in-*' / 'slide-out-*'), the offset is
 * implicit (a small fixed semitone gesture) and `toFret` stays undefined.
 */
function resolveSlideTarget(
  pe: PatternEvent,
  irNote: IRNote,
  track: IRTrack,
  fromEventIndex: number,
): void {
  if (!pe.slide || !irNote.slide) return;
  if (irNote.slide.type !== 'legato' && irNote.slide.type !== 'shift') return;
  // Walk forward through events to find the next note on the same string.
  for (let i = fromEventIndex + 1; i < track.events.length; i++) {
    for (const next of track.events[i].notes) {
      if (next.string === irNote.string) {
        pe.slide.toFret = next.fret;
        return;
      }
    }
  }
}

/**
 * Musical dynamic → normalized velocity curve. The curve is sub-linear at
 * the soft end (ppp/pp are quite quiet — you want a real sense of "barely
 * audible") and compresses at the loud end (ff and fff approach 1.0 without
 * overshooting). Tuned by ear, not derived from a standard.
 */
function dynamicToVelocity(d: IREvent['dynamic']): number | undefined {
  switch (d) {
    case 'ppp':
      return 0.08;
    case 'pp':
      return 0.18;
    case 'p':
      return 0.32;
    case 'mp':
      return 0.5;
    case 'mf':
      return 0.65;
    case 'f':
      return 0.8;
    case 'ff':
      return 0.92;
    case 'fff':
      return 1.0;
    default:
      return undefined;
  }
}

function rescaleTempoTrack(tempos: readonly TempoEvent[], scale: number): TempoEvent[] {
  return tempos.map((t) => ({
    atTick: Math.round(t.atTick / scale),
    bpm: t.bpm,
    interpolation: t.interpolation,
  }));
}

function rescaleTimeSignatureTrack(
  tss: readonly TimeSignatureEvent[],
  scale: number,
): TimeSignatureEvent[] {
  return tss.map((ts) => ({
    atTick: Math.round(ts.atTick / scale),
    numerator: ts.numerator,
    denominator: ts.denominator,
  }));
}

/** Turn IR chord markers into harmony-lane blocks: each chord spans from its
 *  (rescaled) tick to the next chord's, the last running to the song's end.
 *  Consecutive identical chords merge; same-tick chords keep the last. */
function buildHarmonicContext(
  chords: readonly ChordMarker[] | undefined,
  scale: number,
  totalTicks: number,
): HarmonicContextBlock[] {
  if (!chords || chords.length === 0) return [];
  const sorted = chords
    .map((c) => ({ atTick: Math.round(c.atTick / scale), symbol: c.symbol }))
    .sort((a, b) => a.atTick - b.atTick);
  const blocks: HarmonicContextBlock[] = [];
  for (const c of sorted) {
    const prev = blocks[blocks.length - 1];
    if (prev && prev.startTick === c.atTick) {
      prev.chord = c.symbol; // same tick, later token wins
      continue;
    }
    if (prev && prev.chord === c.symbol) continue; // extend through a repeat
    blocks.push({
      id: generateId('hc'),
      startTick: c.atTick,
      endTick: 0,
      chord: c.symbol,
      scale: null,
    });
  }
  const end = Math.round(totalTicks / scale);
  for (let i = 0; i < blocks.length; i++) {
    blocks[i].endTick = i + 1 < blocks.length ? blocks[i + 1].startTick : end;
  }
  return blocks;
}

function sliceTempoTrack(
  tempos: readonly TempoEvent[],
  startIr: number,
  endIr: number,
  scale: number,
): TempoEvent[] {
  const out: TempoEvent[] = [];
  for (const t of tempos) {
    if (t.atTick < startIr || t.atTick >= endIr) continue;
    out.push({
      atTick: Math.round((t.atTick - startIr) / scale),
      bpm: t.bpm,
      interpolation: t.interpolation,
    });
  }
  return out;
}

function sliceTimeSignatureTrack(
  tss: readonly TimeSignatureEvent[],
  startIr: number,
  endIr: number,
  scale: number,
): TimeSignatureEvent[] {
  const out: TimeSignatureEvent[] = [];
  for (const ts of tss) {
    if (ts.atTick < startIr || ts.atTick >= endIr) continue;
    out.push({
      atTick: Math.round((ts.atTick - startIr) / scale),
      numerator: ts.numerator,
      denominator: ts.denominator,
    });
  }
  return out;
}

function timeSignatureAt(
  tss: readonly TimeSignatureEvent[],
  atIrTick: number,
): PatternTimeSignature {
  let active = tss[0];
  for (const ts of tss) {
    if (ts.atTick <= atIrTick) active = ts;
    else break;
  }
  return active
    ? { numerator: active.numerator, denominator: active.denominator }
    : { numerator: 4, denominator: 4 };
}

function bpmAt(tempos: readonly TempoEvent[], atIrTick: number): number | null {
  let active = tempos[0];
  for (const t of tempos) {
    if (t.atTick <= atIrTick) active = t;
    else break;
  }
  return active ? active.bpm : null;
}

export interface PatternSeed {
  name: string;
  instrumentId: string;
  events: PatternEvent[];
  durationTicks: Tick;
  timeSignature: PatternTimeSignature;
  suggestedBpm: number | null;
  tempoTrack: TempoEvent[];
  timeSignatureTrack: TimeSignatureEvent[];
  sourceIR: ImportIR | null;
}

export function buildPattern(seed: PatternSeed): Pattern {
  const now = Date.now();
  return {
    id: generateUuid(),
    name: seed.name,
    instrumentId: seed.instrumentId,
    durationTicks: seed.durationTicks,
    timeSignature: seed.timeSignature,
    suggestedBpm: seed.suggestedBpm,
    groove: null,
    subdivision: null,
    loop: true,
    key: null,
    scaleType: null,
    events: seed.events,
    lanes: [],
    description: null,
    difficulty: null,
    genres: [],
    tags: [],
    visibility: 'private',
    publishedAt: null,
    forkedFromId: null,
    forkedFromCreatorName: null,
    collectionId: null,
    tempoTrack: seed.tempoTrack,
    timeSignatureTrack: seed.timeSignatureTrack,
    sourceIR: seed.sourceIR,
    createdAt: now,
    updatedAt: now,
  };
}

export function clonePatternForPlacement(p: Pattern): Pattern {
  return {
    ...p,
    events: p.events.map((e) => ({ ...e })),
    lanes: p.lanes.map((l) => ({ ...l })),
  };
}

export interface CompositionSeed {
  name: string;
  instrumentId: string;
  bpm: number;
  timeSignature: PatternTimeSignature;
  /** Legacy single-track placements list. Empty when `tracks` is provided. */
  placements: Placement[];
  /** Pre-built tracks. When provided, the migration shim is bypassed. */
  tracks?: Track[];
  tempoTrack: TempoEvent[];
  timeSignatureTrack: TimeSignatureEvent[];
  harmonicContext?: HarmonicContextBlock[];
  sourceIR: ImportIR | null;
}

export function buildComposition(seed: CompositionSeed): Composition {
  const now = Date.now();
  // Two paths:
  //   - Multi-track import (Phase 2+) passes pre-built `tracks` — we use
  //     them directly.
  //   - Single-pattern fallback / legacy callers pass `placements` only;
  //     the migration helper lifts them into `tracks[0]`.
  const base: Composition = {
    id: generateUuid(),
    name: seed.name,
    instrumentId: seed.instrumentId,
    bpm: seed.bpm,
    tempoMode: 'global',
    groove: null,
    grooveMode: 'global',
    subdivision: null,
    timeSignature: seed.timeSignature,
    placements: seed.placements,
    tracks: seed.tracks ?? [],
    masterVolumeDb: 0,
    loop: false,
    description: null,
    difficulty: null,
    genres: [],
    tags: [],
    visibility: 'private',
    publishedAt: null,
    forkedFromId: null,
    forkedFromCreatorName: null,
    collectionId: null,
    tempoTrack: seed.tempoTrack,
    timeSignatureTrack: seed.timeSignatureTrack,
    harmonicContext: seed.harmonicContext,
    sourceIR: seed.sourceIR,
    createdAt: now,
    updatedAt: now,
  };
  return migrateCompositionToTracks(base);
}
