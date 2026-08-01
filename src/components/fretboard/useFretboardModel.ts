/**
 * useFretboardModel — the headless data core behind `<Fretboard>`.
 *
 * Reads the global fretwork + playback state and returns every derived value the
 * renderer needs: the grid-derived highlight layers, CAGED shape scoping, the
 * playback activity/footprint layers, and the display flags. The default
 * `<Fretboard>` consumes this hook; a consumer can build a completely custom
 * renderer (canvas, different SVG, etc.) from the same return shape.
 *
 * NOTE (staged): this still reads `useFretworkStore` internally, plus the
 * playhead/programming flags on `usePlaybackStore`. A later pass will let callers
 * inject that state too. It deliberately does NOT call `usePlayback()` — doing so
 * constructed the Practice `Playback` singleton (and its voice + metronome
 * subscriptions) as a side effect of merely rendering a board, so the instance is
 * an optional *input* now: callers that want click-to-program wiring pass theirs in.
 */
import { useMemo } from 'react';
import { useFretworkStore } from '../../store/useFretworkStore';
import { getTuning } from '../../lib/tunings';
import { getInstrument, DEFAULT_INSTRUMENT_ID } from '../../lib/instruments';
import { getScale } from '../../lib/scales';
import { getArpeggio } from '../../lib/arpeggios';
import { buildGrid, computeHighlights, effectiveOpenStrings } from '../../lib/fretboard';
import { noteAt } from '../../lib/theory';
import type {
  Highlight,
  IntervalSet,
  LabelMode,
  FretworkSettings,
  InstrumentDef,
  TuningDef,
} from '../../types';
import { usePlaybackStore } from '../../playback/usePlaybackStore';
import { resolveShapeAbsoluteCells } from '../../playback/patterns/caged';
import { isCagedShapeId } from '../../playback/patterns/caged-shapes-data';
import { buildResolveInput } from '../../playback/build-resolve-input';
import type { PlayableCell } from '../../playback/types';
import type { Playback } from '../../playback/Playback';

/** The subset of `<Fretboard>` props that influence the computed render model. */
export interface FretboardModelInput {
  /**
   * Caller-supplied override of the internally-computed scale highlights.
   * Omit to derive them from `useFretworkStore`; pass an empty array to mean
   * "no highlights at all" (a bare neck), which is distinct from omitting it.
   */
  highlights?: readonly Highlight[];
  /** Render every cell as a uniform neutral marker (no scale/theory styling). */
  neutralGrid?: boolean;
  /**
   * Render every cell, dimming the ones outside the active highlight set. This
   * expands `renderHighlights` to the whole grid, so pass a stable (memoized)
   * `highlights` array — an inline literal re-derives every layer each render.
   */
  dimNonHighlighted?: boolean;
  /** Cells to light with the playhead treatment (supports chords). */
  activeCells?: ReadonlyArray<{ stringIndex: number; fret: number }>;
  /** Dim "context" layer — a pattern's footprint, drawn behind the activity layer. */
  footprintCells?: ReadonlyArray<{ stringIndex: number; fret: number }>;
  /**
   * The caller's `Playback` instance, passed straight back out on the model for
   * click-to-program wiring. The model never builds one — a fretboard that is only
   * being looked at must not spin up an audio engine.
   */
  playback?: Playback | null;
}

/** Everything a fretboard renderer needs to draw the board for the current state. */
export interface FretboardModel {
  instrumentId: string;
  instrument: InstrumentDef;
  fretCount: number;
  stringCount: number;
  tuning: TuningDef;
  capo: number;
  effectiveKey: string;
  type: string;
  labels: LabelMode;
  settings: FretworkSettings;
  leftHanded: boolean;
  openStrings: ReturnType<typeof effectiveOpenStrings>;
  /**
   * The base set of markers to render (scale highlights, or the neutral grid).
   *
   * In `dimNonHighlighted` mode this is the WHOLE grid, not just the highlights:
   * the highlights plus a neutral filler for every other cell (see `dimmedKeys`).
   * Cells owned by the activity/footprint layers are left out of that filler so
   * those layers still draw them on top.
   */
  renderHighlights: readonly Highlight[];
  /** O(1) "is this cell already drawn?" lookup over `renderHighlights`. */
  renderedKeys: Set<string>;
  /**
   * In `dimNonHighlighted` mode, the `renderHighlights` members that are background
   * filler — not in the active highlight set, and not owned by the activity or
   * footprint layer — and must be drawn faded. `null` in every other mode.
   */
  dimmedKeys: Set<string> | null;
  /** When a CAGED shape is active, the set of in-shape "string:fret" keys (else null). */
  inShapeKeys: Set<string> | null;
  /** Keyed set of `activeCells` (else null when the legacy single playhead is used). */
  activeCellKeys: Set<string> | null;
  /** Legacy single playhead cell, used when `activeCells` is not supplied. */
  playheadCell: PlayableCell | null;
  /** Synthetic markers for sounding cells not already in `renderHighlights`. */
  activityOnlyHighlights: Highlight[];
  /** Synthetic markers for footprint cells not already drawn or active. */
  footprintHighlights: Highlight[];
  isProgramming: boolean;
  customSequence: readonly PlayableCell[];
  /** The caller-injected Playback instance (see `FretboardModelInput.playback`). */
  playback: Playback | null;
}

export function useFretboardModel({
  highlights: highlightsProp,
  neutralGrid,
  dimNonHighlighted,
  activeCells,
  footprintCells,
  playback,
}: FretboardModelInput = {}): FretboardModel {
  const instrumentId = useFretworkStore((s) => s.instrumentId);
  const mode = useFretworkStore((s) => s.mode);
  const key = useFretworkStore((s) => s.key);
  const type = useFretworkStore((s) => s.type);
  const tuningId = useFretworkStore((s) => s.tuning);
  const capo = useFretworkStore((s) => s.capo);
  const labels = useFretworkStore((s) => s.labels);
  const shapeId = useFretworkStore((s) => s.shapeId);
  const settings = useFretworkStore((s) => s.settings);

  const instrument = getInstrument(instrumentId) ?? getInstrument(DEFAULT_INSTRUMENT_ID)!;
  const fretCount = instrument.fretCount;
  const stringCount = instrument.stringCount;

  const { intervals, effectiveKey } = useMemo(() => {
    if (mode === 'scales') {
      const scale = getScale(type);
      return { intervals: (scale?.intervals ?? [0]) as IntervalSet, effectiveKey: key };
    }
    if (mode === 'arpeggios') {
      const arp = getArpeggio(type);
      return { intervals: (arp?.intervals ?? [0]) as IntervalSet, effectiveKey: key };
    }
    return { intervals: [0] as IntervalSet, effectiveKey: type };
  }, [mode, key, type]);

  const tuning = getTuning(tuningId)!;
  const grid = useMemo(() => buildGrid(tuning, capo, fretCount), [tuning, capo, fretCount]);
  const scaleHighlights = useMemo(
    () => computeHighlights(grid, effectiveKey, intervals, capo),
    [grid, effectiveKey, intervals, capo],
  );

  const effectiveScaleHighlights = useMemo<readonly Highlight[]>(
    () => highlightsProp ?? scaleHighlights,
    [highlightsProp, scaleHighlights],
  );

  const openStrings = useMemo(() => effectiveOpenStrings(tuning, capo), [tuning, capo]);

  // Neutral-grid highlights: one synthetic Highlight per cell, all flagged as 'tone'
  // so NoteMarker's color resolver yields the neutral color. Also used by
  // dimNonHighlighted mode as the base render set.
  const neutralHighlights = useMemo<Highlight[]>(() => {
    if (!neutralGrid && !dimNonHighlighted) return [];
    const out: Highlight[] = [];
    for (let s = 0; s < stringCount; s++) {
      const openNote = openStrings[s];
      if (!openNote) continue;
      for (let f = 0; f <= fretCount; f++) {
        out.push({
          stringIndex: s,
          fret: f,
          noteName: noteAt(openNote, f),
          intervalLabel: '',
          degreeNumber: 0,
          category: 'tone',
        });
      }
    }
    return out;
  }, [neutralGrid, dimNonHighlighted, stringCount, fretCount, openStrings]);

  // Playback state — plain store subscriptions. These do NOT construct the Playback
  // singleton; the instance itself is a caller-supplied input.
  const storePlayheadCell = usePlaybackStore((s) => s.currentPlayheadCell);
  const isProgramming = usePlaybackStore((s) => s.isProgramming);
  const customSequence = usePlaybackStore((s) => s.customSequence);

  const activityCells = useMemo<ReadonlyArray<{ stringIndex: number; fret: number }>>(
    () => activeCells ?? (storePlayheadCell ? [storePlayheadCell] : []),
    [activeCells, storePlayheadCell],
  );
  const activeCellKeys = useMemo<Set<string> | null>(() => {
    if (!activeCells) return null;
    return new Set(activeCells.map((c) => `${c.stringIndex}:${c.fret}`));
  }, [activeCells]);
  const playheadCell = activeCells ? null : storePlayheadCell;

  // Cells the activity and footprint layers own. The dim filler must leave these
  // alone: filling them in would put them in `renderedKeys`, which both layers skip,
  // so the playhead would silently render as dim filler instead of bright and the
  // footprint would be indistinguishable from the rest of the grid.
  const overlayKeys = useMemo<Set<string>>(() => {
    const s = new Set<string>();
    for (const c of activityCells) s.add(`${c.stringIndex}:${c.fret}`);
    if (footprintCells) {
      for (const c of footprintCells) s.add(`${c.stringIndex}:${c.fret}`);
    }
    return s;
  }, [activityCells, footprintCells]);

  // dimNonHighlighted renders the whole grid: the active highlights keep their
  // degree styling and every remaining cell is filled in from the neutral grid and
  // flagged dim. Without the filler there is nothing for "dim the rest" to mean —
  // only the highlights were ever drawn.
  const dimLayer = useMemo<{ highlights: Highlight[]; dimmedKeys: Set<string> } | null>(() => {
    if (!dimNonHighlighted || neutralGrid) return null;
    const highlighted = new Set(
      effectiveScaleHighlights.map((h) => `${h.stringIndex}:${h.fret}`),
    );
    const out: Highlight[] = [...effectiveScaleHighlights];
    const dimmedKeys = new Set<string>();
    for (const n of neutralHighlights) {
      const k = `${n.stringIndex}:${n.fret}`;
      if (highlighted.has(k) || overlayKeys.has(k)) continue;
      dimmedKeys.add(k);
      out.push(n);
    }
    return { highlights: out, dimmedKeys };
  }, [dimNonHighlighted, neutralGrid, effectiveScaleHighlights, neutralHighlights, overlayKeys]);

  const renderHighlights = neutralGrid
    ? neutralHighlights
    : (dimLayer?.highlights ?? effectiveScaleHighlights);
  const dimmedKeys = dimLayer?.dimmedKeys ?? null;

  const renderedKeys = useMemo<Set<string>>(() => {
    const s = new Set<string>();
    for (const h of renderHighlights) s.add(`${h.stringIndex}:${h.fret}`);
    return s;
  }, [renderHighlights]);

  // Active CAGED shape — split highlights into in-shape (full prominence) and
  // out-of-shape (ghosted/hidden). Suppressed in neutralGrid mode.
  const inShapeKeys = useMemo<Set<string> | null>(() => {
    if (neutralGrid) return null;
    if (!isCagedShapeId(shapeId)) return null;
    if (mode !== 'scales' && mode !== 'arpeggios') return null;
    const input = buildResolveInput({
      highlights: effectiveScaleHighlights,
      tuning,
      key,
      capo,
      mode,
      instrumentId,
      fretCount,
      type,
    });
    const cells = resolveShapeAbsoluteCells(shapeId, input);
    if (cells.length === 0) return null;
    return new Set(cells.map((c) => `${c.stringIndex}:${c.fret}`));
  }, [neutralGrid, shapeId, mode, effectiveScaleHighlights, tuning, key, capo, instrumentId, fretCount, type]);

  // Activity layer: currently-sounding / playhead cells NOT already drawn by the
  // render set. We synthesize markers for those so the activity layer is fully
  // decoupled from scale membership.
  const activityOnlyHighlights = useMemo<Highlight[]>(() => {
    const cells = activityCells;
    if (cells.length === 0) return [];
    const out: Highlight[] = [];
    const seen = new Set<string>();
    for (const c of cells) {
      const k = `${c.stringIndex}:${c.fret}`;
      if (renderedKeys.has(k) || seen.has(k)) continue;
      seen.add(k);
      const openNote = openStrings[c.stringIndex];
      if (!openNote) continue;
      out.push({
        stringIndex: c.stringIndex,
        fret: c.fret,
        noteName: noteAt(openNote, c.fret),
        intervalLabel: '',
        degreeNumber: 0,
        category: 'tone',
      });
    }
    return out;
  }, [activityCells, renderedKeys, openStrings]);

  // Context layer: the pattern's footprint, drawn dim behind the activity layer.
  // Skips cells already drawn and cells that are currently active.
  const footprintHighlights = useMemo<Highlight[]>(() => {
    if (!footprintCells || footprintCells.length === 0) return [];
    const out: Highlight[] = [];
    const seen = new Set<string>();
    for (const c of footprintCells) {
      const k = `${c.stringIndex}:${c.fret}`;
      if (renderedKeys.has(k) || seen.has(k)) continue;
      if (activeCellKeys?.has(k)) continue;
      seen.add(k);
      const openNote = openStrings[c.stringIndex];
      if (!openNote) continue;
      out.push({
        stringIndex: c.stringIndex,
        fret: c.fret,
        noteName: noteAt(openNote, c.fret),
        intervalLabel: '',
        degreeNumber: 0,
        category: 'tone',
      });
    }
    return out;
  }, [footprintCells, renderedKeys, activeCellKeys, openStrings]);

  const leftHanded = settings.handedness === 'left';

  return {
    instrumentId,
    instrument,
    fretCount,
    stringCount,
    tuning,
    capo,
    effectiveKey,
    type,
    labels,
    settings,
    leftHanded,
    openStrings,
    renderHighlights,
    renderedKeys,
    dimmedKeys,
    inShapeKeys,
    activeCellKeys,
    playheadCell,
    activityOnlyHighlights,
    footprintHighlights,
    isProgramming,
    customSequence,
    playback: playback ?? null,
  };
}
