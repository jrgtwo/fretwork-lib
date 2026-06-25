/**
 * usePatternsStore — central state hub for the Patterns page.
 *
 * Holds:
 *   - library (patterns + compositions; localStorage-persisted)
 *   - editor UI state (active tab, sidebar/fretboard collapse, cursor, step length, selection)
 *   - which pattern/placement/composition is currently the editor's target
 *
 * Snapshot semantics live here: addPlacement deep-copies the source library pattern
 * into the composition. Editing the placement's snapshot does NOT touch the library
 * pattern, and editing the library pattern does NOT touch any placed copy.
 */
import { create } from 'zustand';
import { persist, createJSONStorage, type PersistOptions } from 'zustand/middleware';
import type {
  Composition,
  GrooveSpec,
  HarmonicContextBlock,
  Library,
  Pattern,
  PatternTimeSignature,
  Placement,
  StepLength,
  Tick,
} from '../types';
import { stepLengthToTicks } from '../timebase';
import { BUILTIN_PATTERNS } from '../builtin';
import type { CagedInsertPlan } from '../caged-insert';
import {
  applyPatternMetadata,
  clonePattern,
  createEmptyPattern,
  deleteEvents as opsDeleteEvents,
  fitPatternDuration,
  moveEvent as opsMoveEvent,
  moveEventsBy as opsMoveEventsBy,
  resizeEvent as opsResizeEvent,
  resizeEventsBy as opsResizeEventsBy,
  setEventFret as opsSetEventFret,
  updateEventArticulations as opsUpdateEventArticulations,
  type PatternEventArticulationPatch,
  setPatternDuration as opsSetPatternDuration,
  setPatternGroove,
  setPatternInstrument,
  setPatternName,
  setPatternSuggestedBpm,
  setPatternTimeSignature,
  stampEvent,
  transposeEventsDiatonic as opsTransposeDiatonic,
  type EventDragSnapshot,
  type EventResizeSnapshot,
  type PatternMetadataPatch,
} from '../pattern-ops';
import { getScale } from '../../lib/scales';
import type { TuningDef } from '../../types';
import {
  addPlacement as opsAddPlacement,
  addPlacementToTrack as opsAddPlacementToTrack,
  applyCompositionMetadata,
  createEmptyComposition,
  migrateCompositionToTracks,
  removePlacement as opsRemovePlacement,
  movePlacement as opsMovePlacement,
  splitPlacement as opsSplitPlacement,
  duplicatePlacements as opsDuplicatePlacements,
  setCompositionBpm,
  setCompositionTimeSignature,
  setCompositionGroove,
  setCompositionGrooveMode,
  setCompositionInstrument,
  setCompositionName,
  setCompositionTempoMode,
  setPlacementRepeat as opsSetPlacementRepeat,
  setPlacementSnapshot as opsSetPlacementSnapshot,
  setPlacementTranspose as opsSetPlacementTranspose,
  resizePlacement as opsResizePlacement,
  setCompositionLoop as opsSetCompositionLoop,
  addTrack as opsAddTrack,
  removeTrack as opsRemoveTrack,
  setTrackName as opsSetTrackName,
  setTrackInstrument as opsSetTrackInstrument,
  setTrackVoiceRef as opsSetTrackVoiceRef,
  setTrackVolumeDb as opsSetTrackVolumeDb,
  setTrackMuted as opsSetTrackMuted,
  setTrackSoloed as opsSetTrackSoloed,
  setMasterVolumeDb as opsSetMasterVolumeDb,
  type CompositionMetadataPatch,
} from '../composition-ops';
import {
  MAX_FOLDER_DEPTH,
  applyCollectionMetadata,
  createEmptyCollection,
  getCollectionDepth,
  setCollectionName as opsSetCollectionName,
  setCollectionParent as opsSetCollectionParent,
  wouldCreateCycle,
  type CollectionMetadataPatch,
} from '../collection-ops';
import { generateId, generateUuid } from '../ids';
import type { MapperResult as ImportMapperResult } from '../../import/mapper';
import { useFretworkStore } from '../../store/useFretworkStore';
import { useAuthStore } from '../../auth/useAuthStore';
import { canCreate, DEFAULT_SUBSCRIPTION } from '../../subscription';
import { gateCreate } from '../../subscription/gate';

export type SelectionMode = 'replace' | 'add' | 'toggle';

/** A pending stamp that hasn't been committed yet (shift-held chord buffering). */
export interface PendingStamp {
  stringIndex: number;
  fret: number;
}

export interface PreRollStateValue {
  barsRemaining: number;
  beatInBar: number;
  beatsPerBar: number;
}

export interface PatternsState {
  // Persisted
  library: Library;
  fretboardCollapsed: boolean;
  stepLength: StepLength;
  /** Whether the 2-bar visual count-in plays before content starts. Persisted
   *  user preference; defaults to true. */
  preRollEnabled: boolean;
  /**
   * Id of the auto-seeded "Untitled" draft created by `ensureEditingPattern` when the
   * user enters the patterns page with no pattern open. The draft is invisible to cloud
   * sync until any mutation promotes it (clears this id). `discardUnpersistedDraft` is
   * called on page unmount to evict pristine drafts so they don't linger in the library.
   */
  unpersistedDraftId: string | null;

  // Ephemeral (not persisted)
  editingPatternId: string | null;
  editingPlacementId: string | null;
  editingCompositionId: string | null;
  cursorTick: Tick;
  /** Blue start cursor for the composition arranger — where composition
   *  playback begins (analogous to `cursorTick` for the pattern editor). */
  compositionCursorTick: Tick;
  /** DAW loop-brace region for the composition arranger (Wave 2). `null` =
   *  loop the whole composition. When set + loop on, only this tick range
   *  repeats; playback start is clamped into it. */
  compositionLoopRegion: { start: Tick; end: Tick } | null;
  /** DAW loop-brace region for the pattern editor. Mirrors
   *  `compositionLoopRegion`. `null` = loop the whole pattern. */
  patternLoopRegion: { start: Tick; end: Tick } | null;
  selectedEventIds: string[];
  pendingChordStamp: PendingStamp[];
  selectedPlacementId: string | null;
  /** Non-null while the 2-bar pre-roll count-in is active. Stored here (not in
   *  the hook) so every usePatternsPlayback caller shares the same value. */
  preRollState: PreRollStateValue | null;
  /** Current playback head position in ticks. Null when not playing. Stored
   *  here so the timeline playhead and any other subscriber share one value
   *  regardless of which component initiated playback. */
  headTick: number | null;
}

export interface PatternsActions {
  // Lifecycle: idempotent guards used by PatternsPage on mount/unmount.
  ensureEditingPattern(): void;
  ensureEditingComposition(): void;
  discardUnpersistedDraft(): void;

  // Library actions
  createPattern(name?: string, collectionId?: string | null): string;
  renamePattern(id: string, name: string): void;
  setPatternInstrument(id: string, instrumentId: string): void;
  updatePatternMetadata(id: string, patch: PatternMetadataPatch): void;
  deletePattern(id: string): void;
  duplicatePattern(id: string): string;
  /**
   * Add a fork of someone else's pattern to the library. The source is passed by
   * value (the viewer has already fetched it from cloud) so the action doesn't
   * need to know about the source's owner. The new copy:
   *   - gets a fresh UUID + fresh event ids (via clonePattern)
   *   - sets `forkedFromId` for attribution
   *   - snapshots `forkedFromCreatorName` if the caller knows the source
   *     creator's display name (e.g. from the shared-pattern viewer's owner
   *     descriptor) so "Forked from X" survives even if the source row later
   *     turns private or its creator's account is deleted
   *   - starts private, never published
   *   - inherits the source's instrument + musical content
   *
   * `created_by_display_name` is set automatically at the next sync INSERT
   * using the forker's auth-store profile name — no special handling here.
   */
  forkPattern(source: Pattern, sourceCreatorName?: string | null): string;
  /** Copy a read-only built-in pattern into the library (editable) and open it. */
  useBuiltinPattern(source: Pattern): string;
  createComposition(name?: string, collectionId?: string | null): string;
  /**
   * Commit a music-import `MapperResult` to the library. Adds every pattern
   * the mapper produced, plus the composition (if any). Returns a descriptor
   * pointing at the "primary" thing the user should be taken to — the
   * composition when one was created, the single pattern otherwise.
   *
   * Tier-cap behaviour: the action runs `gateGate` against the combined
   * additional-row count. If the user is over their cap, returns null and
   * doesn't mutate the library — the caller surfaces the upgrade prompt.
   */
  commitImport(result: ImportMapperResult, collectionId?: string | null):
    | { kind: 'pattern' | 'composition'; id: string }
    | null;
  renameComposition(id: string, name: string): void;
  setCompositionInstrument(id: string, instrumentId: string): void;
  updateCompositionMetadata(id: string, patch: CompositionMetadataPatch): void;
  setCompositionBpm(id: string, bpm: number): void;
  setCompositionTimeSignature(id: string, ts: PatternTimeSignature): void;
  setEditingPatternSuggestedBpm(bpm: number | null): void;
  setEditingPatternTimeSignature(ts: PatternTimeSignature): void;
  setEditingPatternGroove(groove: GrooveSpec | null): void;
  setEditingPatternSubdivision(subdivision: import('../../metronome/types').SubdivisionId | null): void;
  /** Toggle whether editor playback loops the editing pattern. */
  setEditingPatternLoop(loop: boolean): void;
  /** Set (or clear, with null) the editing pattern's voice. Cast `voiceRef` to
   *  `VariantRef | null` at the call site; stored loose to avoid a voices-module
   *  dependency from the patterns model. */
  setEditingPatternVoiceRef(voiceRef: unknown | null): void;
  setEditingCompositionTempoMode(mode: 'global' | 'inherit'): void;
  setEditingCompositionGroove(groove: GrooveSpec | null): void;
  setEditingCompositionGrooveMode(mode: 'global' | 'inherit'): void;
  setEditingCompositionSubdivision(subdivision: import('../../metronome/types').SubdivisionId | null): void;
  /** Add a harmony block to the editing composition's context layer (id auto-assigned). */
  addHarmonicBlock(block: Omit<HarmonicContextBlock, 'id'>): void;
  updateHarmonicBlock(blockId: string, patch: Partial<HarmonicContextBlock>): void;
  removeHarmonicBlock(blockId: string): void;
  /** Replace the whole harmony lane (used by inline editing — materializes
   *  derived blocks as authored on first edit). */
  setHarmonicContext(blocks: HarmonicContextBlock[]): void;
  /**
   * Fork a (typically public/unlisted) composition into the user's library.
   * Mirrors `forkPattern` semantics — fresh uuid, fresh placement ids, fresh
   * pattern-snapshot event ids; sets `forkedFromId`; snapshots the source
   * creator's display name when provided; resets visibility to private and
   * `collectionId` to null. Gated by the compositions tier cap.
   */
  forkComposition(source: Composition, sourceCreatorName?: string | null): string;
  /** Copy a read-only built-in composition into the library (editable) and open it. */
  useBuiltinComposition(source: Composition): string;
  deleteComposition(id: string): void;

  // Layout
  setFretboardCollapsed(b: boolean): void;

  // Open for editing
  openPatternForEditing(id: string | null): void;
  openPlacementForEditing(compositionId: string, placementId: string): void;
  openCompositionForArranging(id: string | null): void;

  // Editor state
  setCursorTick(t: Tick): void;
  setCompositionCursorTick(t: Tick): void;
  /** Set or clear the composition loop-brace region. Pass null (or a zero/
   *  negative-length range) to clear → loops the whole composition. */
  setCompositionLoopRegion(region: { start: Tick; end: Tick } | null): void;
  /** Set or clear the pattern-editor loop-brace region. Pass null (or a zero/
   *  negative-length range) to clear → loops the whole pattern. */
  setPatternLoopRegion(region: { start: Tick; end: Tick } | null): void;
  setStepLength(s: StepLength): void;

  // Editor mutations (operate on whichever target is currently open)
  stampAt(cell: { stringIndex: number; fret: number }, isChord: boolean): void;
  stampCagedPlan(plan: CagedInsertPlan): void;
  flushChordStamp(): void;
  rest(): void;
  moveEvent(eventId: string, newStartTick: Tick, newStringIndex?: number): void;
  moveEventsBy(
    snapshots: readonly EventDragSnapshot[],
    deltaTicks: Tick,
    deltaStringIdx: number,
    stringCount: number,
  ): void;
  resizeEvent(eventId: string, newDurationTicks: Tick): void;
  resizeEventsBy(snapshots: readonly EventResizeSnapshot[], deltaTicks: Tick): void;
  setEventFret(eventId: string, fret: number): void;
  /**
   * Patch articulation fields on the given event. Pass `undefined` for a
   * field to clear it. Hammer-on and pull-off are kept mutually exclusive
   * automatically by the underlying op.
   */
  updateEventArticulations(eventId: string, patch: PatternEventArticulationPatch): void;
  /** Group the current selection (≥2 notes) into one chord with the given
   *  display name. Read by look-ahead segmentation to show a chord card. */
  groupSelectionAsChord(chordName: string): void;
  /** Clear the chord grouping from the current selection. */
  ungroupSelectionChord(): void;
  nudgeSelectedFret(delta: number): void;
  transposeSelectedDiatonic(direction: 1 | -1, tuning: TuningDef, fretCount: number): void;
  deleteEvents(ids: readonly string[]): void;
  selectEvents(ids: readonly string[], mode: SelectionMode): void;
  setEditingPatternDuration(durationTicks: Tick): void;
  setEditingPatternKeyScale(key: string | null, scaleType: string | null): void;

  // Arrange mutations
  addPlacement(patternId: string, atTick?: Tick): string | null;
  addPlacementToTrack(patternId: string, trackId: string, atTick?: Tick): string | null;
  movePlacement(placementId: string, destTrackId: string, destStartTick: Tick): void;
  splitPlacement(placementId: string, atTick: Tick): void;
  duplicatePlacements(ids: string[], deltaTicks: Tick, destTrackId?: string): void;
  setPlacementRepeat(placementId: string, repeat: number): void;
  setPlacementTranspose(placementId: string, semitones: number): void;
  resizePlacement(placementId: string, lengthTicks: Tick): void;
  setCompositionLoop(compositionId: string, loop: boolean): void;
  removePlacement(placementId: string): void;
  selectPlacement(id: string | null): void;

  // ─── Multi-track composition ───────────────────────────────────────────
  /** Append a new empty Track to the editing composition. Refuses past cap. */
  addCompositionTrack(name?: string, instrumentId?: string): void;
  /** Remove a track. Refuses to remove the last remaining track. */
  removeCompositionTrack(trackId: string): void;
  setCompositionTrackName(trackId: string, name: string): void;
  setCompositionTrackInstrument(trackId: string, instrumentId: string): void;
  /** Set a per-track voice-variant override (or null to follow the global active). */
  setCompositionTrackVoiceRef(trackId: string, voiceRef: unknown | null): void;
  setCompositionTrackVolumeDb(trackId: string, volumeDb: number): void;
  setCompositionTrackMuted(trackId: string, muted: boolean): void;
  setCompositionTrackSoloed(trackId: string, soloed: boolean): void;
  setCompositionMasterVolumeDb(masterVolumeDb: number): void;

  /** Update (or clear) the pre-roll countdown state. Stored at store level so
   *  every usePatternsPlayback caller shares the same value regardless of which
   *  hook instance initiated the playback. */
  setPreRollState(state: PreRollStateValue | null): void;
  /** Toggle whether the 2-bar visual count-in plays before content starts. */
  setPreRollEnabled(enabled: boolean): void;
  /** Update (or clear) the playback head tick. Stored at store level so the
   *  timeline playhead and any subscriber see the same position. */
  setHeadTick(tick: number | null): void;

  // Collections (nested folders). Returned id is the new/affected collection id;
  // returns null when a create is refused (e.g. max depth).
  createCollection(name: string, parentId: string | null): string | null;
  renameCollection(id: string, name: string): void;
  moveCollection(id: string, newParentId: string | null): void;
  deleteCollection(id: string): void;
  updateCollectionMetadata(id: string, patch: CollectionMetadataPatch): void;
  /** Move a pattern or composition into a folder (or to root via null). */
  setPatternCollection(id: string, collectionId: string | null): void;
  setCompositionCollection(id: string, collectionId: string | null): void;
}

export type PatternsStoreState = PatternsState & PatternsActions;

const PERSIST_KEY = 'fretwork:patterns:v1';

export const DEFAULT_PATTERNS_STATE: PatternsState = {
  library: { patterns: [], compositions: [], collections: [] },
  fretboardCollapsed: false,
  stepLength: 'eighth',
  unpersistedDraftId: null,
  preRollEnabled: true,

  editingPatternId: null,
  editingPlacementId: null,
  editingCompositionId: null,
  cursorTick: 0,
  compositionCursorTick: 0,
  compositionLoopRegion: null,
  patternLoopRegion: null,
  selectedEventIds: [],
  pendingChordStamp: [],
  selectedPlacementId: null,
  preRollState: null,
  headTick: null,
};

// Anon users persist to sessionStorage — survives reload within the same tab,
// dies when the tab closes. Privacy stance: no public-computer leaks. Signed-in
// users sync to Supabase (Group E) instead of relying on this layer.
const persistOptions: PersistOptions<PatternsStoreState, Pick<PatternsStoreState, 'library' | 'fretboardCollapsed' | 'stepLength' | 'unpersistedDraftId' | 'preRollEnabled'>> = {
  name: PERSIST_KEY,
  version: 2,
  storage: createJSONStorage(() =>
    quotaTolerant(typeof sessionStorage !== 'undefined' ? sessionStorage : memoryStorage()),
  ),
  partialize: (state) => ({
    library: state.library,
    fretboardCollapsed: state.fretboardCollapsed,
    stepLength: state.stepLength,
    // Persisted so a refresh-within-tab keeps the draft as a draft rather than
    // accidentally promoting it on next load.
    unpersistedDraftId: state.unpersistedDraftId,
    preRollEnabled: state.preRollEnabled,
  }),
  // Migration stub for future schema changes.
  migrate: (persisted, _version) => {
    const state = persisted as PatternsState;
    // Older persisted libraries don't have key/scaleType on patterns; coerce to null
    // so consumers can rely on the both-or-neither invariant.
    if (state.library?.patterns) {
      state.library.patterns = state.library.patterns.map((p) => ({
        ...p,
        key: p.key ?? null,
        scaleType: p.scaleType ?? null,
        subdivision: p.subdivision ?? null,
        loop: p.loop ?? true,
        // Music-import expansion (v2): legacy rows have no automation tracks
        // or sourceIR. Empty tracks = "no automation"; existing playback paths
        // continue consulting the static `suggestedBpm` and `timeSignature`.
        tempoTrack: p.tempoTrack ?? [],
        timeSignatureTrack: p.timeSignatureTrack ?? [],
        sourceIR: p.sourceIR ?? null,
      }));
    }
    if (state.library?.compositions) {
      state.library.compositions = state.library.compositions.map((c) => {
        const placements = (c.placements ?? []).map((pl) => ({
          ...pl,
          transposeSemitones: pl.transposeSemitones ?? 0,
          lengthTicks: pl.lengthTicks ?? null,
        }));
        const partial = {
          ...c,
          loop: c.loop ?? false,
          subdivision: c.subdivision ?? null,
          placements,
          tempoTrack: c.tempoTrack ?? [],
          timeSignatureTrack: c.timeSignatureTrack ?? [],
          sourceIR: c.sourceIR ?? null,
          masterVolumeDb: c.masterVolumeDb ?? 0,
        };
        // Multi-track migration: legacy compositions had `placements` at the
        // composition level. The new shape stores them under `tracks[0]`
        // with an auto-generated track id.
        return migrateCompositionToTracks(partial);
      });
    }
    return state;
  },
};

/** Wrap a Storage so that setItem swallows QuotaExceededError. Without this
 *  the persist middleware throws synchronously during cloud-sync hydration if
 *  the cloud dataset is larger than sessionStorage's ~5MB quota, breaking the
 *  whole app at boot. Warning is logged once per session so we don't lose the
 *  signal. The in-memory store remains correct; only the redundant
 *  sessionStorage cache is skipped.
 *
 *  Long-term: signed-in users should bypass sessionStorage entirely (cloud is
 *  the source of truth). This wrapper is the band-aid until that refactor. */
function quotaTolerant(inner: Storage): Storage {
  let warned = false;
  return {
    getItem: (k) => inner.getItem(k),
    setItem: (k, v) => {
      try {
        inner.setItem(k, v);
      } catch (e) {
        const isQuota =
          e instanceof DOMException &&
          (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);
        if (!isQuota) throw e;
        if (!warned) {
          warned = true;
          // eslint-disable-next-line no-console
          console.warn(
            '[patterns persist] sessionStorage quota exceeded; in-memory state is correct, sessionStorage cache is partial.',
          );
        }
      }
    },
    removeItem: (k) => inner.removeItem(k),
    clear: () => inner.clear(),
    key: (i) => inner.key(i),
    get length() {
      return inner.length;
    },
  } as Storage;
}

/** In-memory localStorage shim for SSR / non-DOM environments. Persistence still
 *  "works" inside the process; nothing leaks to disk. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => void map.clear(),
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

export const usePatternsStore = create<PatternsStoreState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_PATTERNS_STATE,

      // ─── Lifecycle ───────────────────────────────────────────────────────────
      // Idempotent guarantee that the editor has a pattern to render. Called by
      // PatternsPage on mount + whenever editingPatternId becomes null. Picks the
      // most-recent existing pattern, or auto-seeds an "Untitled" draft when the
      // library is empty. Drafts are marked via `unpersistedDraftId` so cloud sync
      // ignores them until promoted by any real edit.
      //
      // When the user is at their tier cap with an empty library — which can only
      // happen if their cap is zero (we have no such tier today) — auto-seed is
      // skipped silently. Otherwise auto-seed always proceeds; the user only sees
      // the upgrade prompt for *explicit* creates.
      ensureEditingPattern() {
        const s = get();
        if (s.editingPatternId !== null) {
          const stillExists = s.library.patterns.some((p) => p.id === s.editingPatternId);
          if (stillExists) return;
        }
        if (s.library.patterns.length > 0) {
          // Pick most-recent existing.
          let mostRecent = s.library.patterns[0];
          for (const p of s.library.patterns) {
            if (p.updatedAt > mostRecent.updatedAt) mostRecent = p;
          }
          set({ editingPatternId: mostRecent.id });
          return;
        }
        // Empty library — auto-seed an Untitled draft. Silently skip if even a
        // single pattern would exceed the tier cap (degenerate; no current tier
        // has a cap of zero).
        const subscription = useAuthStore.getState().subscription ?? DEFAULT_SUBSCRIPTION;
        const check = canCreate(subscription.tier, 'patterns', 0);
        if (!check.allowed) return;
        const draft = createEmptyPattern('Untitled pattern', useFretworkStore.getState().instrumentId);
        set((cur) => ({
          library: { ...cur.library, patterns: [draft] },
          editingPatternId: draft.id,
          editingPlacementId: null,
          unpersistedDraftId: draft.id,
          cursorTick: 0,
          selectedEventIds: [],
        }));
      },
      // Mirror of ensureEditingPattern for compositions. Called on
      // CompositionArrangerPage mount + whenever editingCompositionId becomes null.
      ensureEditingComposition() {
        const s = get();
        if (s.editingCompositionId !== null) {
          const stillExists = s.library.compositions.some(
            (c) => c.id === s.editingCompositionId,
          );
          if (stillExists) return;
        }
        if (s.library.compositions.length > 0) {
          let mostRecent = s.library.compositions[0];
          for (const c of s.library.compositions) {
            if (c.updatedAt > mostRecent.updatedAt) mostRecent = c;
          }
          set({ editingCompositionId: mostRecent.id });
          return;
        }
        const subscription = useAuthStore.getState().subscription ?? DEFAULT_SUBSCRIPTION;
        const check = canCreate(subscription.tier, 'compositions', 0);
        if (!check.allowed) return;
        const draft = createEmptyComposition('Untitled composition', useFretworkStore.getState().instrumentId);
        set((cur) => ({
          library: { ...cur.library, compositions: [...cur.library.compositions, draft] },
          editingCompositionId: draft.id,
          editingPlacementId: null,
        }));
      },
      // Remove a pristine auto-seeded draft from the library. Called when the user
      // leaves the patterns page without ever touching the draft, so the library
      // doesn't accumulate empty Untitled rows.
      discardUnpersistedDraft() {
        const s = get();
        if (!s.unpersistedDraftId) return;
        const draftId = s.unpersistedDraftId;
        set((cur) => ({
          library: {
            ...cur.library,
            patterns: cur.library.patterns.filter((p) => p.id !== draftId),
          },
          unpersistedDraftId: null,
          editingPatternId: cur.editingPatternId === draftId ? null : cur.editingPatternId,
        }));
      },

      // ─── Library ─────────────────────────────────────────────────────────────
      createPattern(name, collectionId) {
        if (!gateCreate('patterns', get().library.patterns.length)) return '';
        const p = createEmptyPattern(name, useFretworkStore.getState().instrumentId);
        // `collectionId` defaults to null (root); the in-memory Pattern from
        // createEmptyPattern already has collectionId: null, only override if
        // a folder was passed.
        if (collectionId !== undefined && collectionId !== null) {
          p.collectionId = collectionId;
        }
        set((s) => ({
          library: { ...s.library, patterns: [...s.library.patterns, p] },
          editingPatternId: p.id,
          editingPlacementId: null,
          cursorTick: 0,
          selectedEventIds: [],
        }));
        return p.id;
      },
      renamePattern(id, name) {
        set((s) => ({
          library: {
            ...s.library,
            patterns: s.library.patterns.map((p) =>
              p.id === id ? setPatternName(p, name) : p,
            ),
          },
          ...clearDraftIf(s, id),
        }));
      },
      setPatternInstrument(id, instrumentId) {
        set((s) => ({
          library: {
            ...s.library,
            patterns: s.library.patterns.map((p) =>
              p.id === id ? setPatternInstrument(p, instrumentId) : p,
            ),
          },
          ...clearDraftIf(s, id),
        }));
      },
      updatePatternMetadata(id, patch) {
        set((s) => ({
          library: {
            ...s.library,
            patterns: s.library.patterns.map((p) =>
              p.id === id ? applyPatternMetadata(p, patch) : p,
            ),
          },
          ...clearDraftIf(s, id),
        }));
      },
      deletePattern(id) {
        set((s) => ({
          library: {
            ...s.library,
            patterns: s.library.patterns.filter((p) => p.id !== id),
          },
          editingPatternId: s.editingPatternId === id ? null : s.editingPatternId,
          ...clearDraftIf(s, id),
        }));
      },
      duplicatePattern(id) {
        const s = get();
        const src = s.library.patterns.find((p) => p.id === id);
        if (!src) return '';
        if (!gateCreate('patterns', s.library.patterns.length)) return '';
        const dup = clonePattern(src, { name: `${src.name} (copy)` });
        set((cur) => ({
          library: { ...cur.library, patterns: [...cur.library.patterns, dup] },
          ...clearDraftIf(cur, id),
        }));
        return dup.id;
      },
      forkPattern(source, sourceCreatorName) {
        if (!gateCreate('patterns', get().library.patterns.length)) return '';
        const fork = clonePattern(source, {
          forkedFromId: source.id,
          forkedFromCreatorName: sourceCreatorName ?? null,
          visibility: 'private',
          // The source's collectionId points at the *source owner's* folder. Forks
          // land at the forker's library root; they can move it into a folder later.
          collectionId: null,
        });
        set((cur) => ({
          library: { ...cur.library, patterns: [...cur.library.patterns, fork] },
          editingPatternId: fork.id,
          editingPlacementId: null,
          cursorTick: 0,
          selectedEventIds: [],
        }));
        return fork.id;
      },
      useBuiltinPattern(source) {
        // Copy a read-only built-in into the user's library as a fresh, editable
        // private pattern (no fork attribution), and open it.
        if (!gateCreate('patterns', get().library.patterns.length)) return '';
        const copy = clonePattern(source, { collectionId: null });
        set((cur) => ({
          library: { ...cur.library, patterns: [...cur.library.patterns, copy] },
          editingPatternId: copy.id,
          editingPlacementId: null,
          cursorTick: 0,
          selectedEventIds: [],
        }));
        return copy.id;
      },
      commitImport(result, collectionId) {
        const s = get();
        const newPatterns = result.patterns.length;
        const willCreateComposition = result.composition !== null;
        // Gate against the tier cap. `gateCreate(kind, currentCount)` answers
        // "can we go from `currentCount` to `currentCount + 1`?" — so to check
        // an import that adds N patterns, we ask whether `currentCount + N - 1`
        // is still under the cap. If the cap is hit anywhere, gateCreate opens
        // the upgrade prompt (or signup modal) and we bail without mutating.
        if (
          newPatterns > 0 &&
          !gateCreate('patterns', s.library.patterns.length + newPatterns - 1)
        ) {
          return null;
        }
        if (
          willCreateComposition &&
          !gateCreate('compositions', s.library.compositions.length)
        ) {
          return null;
        }

        const taggedPatterns = result.patterns.map((p) =>
          collectionId !== undefined && collectionId !== null ? { ...p, collectionId } : p,
        );
        const taggedComposition =
          result.composition && collectionId !== undefined && collectionId !== null
            ? { ...result.composition, collectionId }
            : result.composition;

        set((cur) => ({
          library: {
            ...cur.library,
            patterns: [...cur.library.patterns, ...taggedPatterns],
            compositions: taggedComposition
              ? [...cur.library.compositions, taggedComposition]
              : cur.library.compositions,
          },
          // Open the imported result in its editor — composition wins when
          // both were produced (single-pattern mode has no composition).
          editingPatternId: taggedComposition ? null : taggedPatterns[0]?.id ?? null,
          editingCompositionId: taggedComposition?.id ?? null,
          editingPlacementId: null,
          selectedPlacementId: null,
          cursorTick: 0,
          selectedEventIds: [],
        }));
        if (taggedComposition) return { kind: 'composition', id: taggedComposition.id };
        if (taggedPatterns[0]) return { kind: 'pattern', id: taggedPatterns[0].id };
        return null;
      },
      createComposition(name, collectionId) {
        if (!gateCreate('compositions', get().library.compositions.length)) return '';
        const c = createEmptyComposition(name, useFretworkStore.getState().instrumentId);
        if (collectionId !== undefined && collectionId !== null) {
          c.collectionId = collectionId;
        }
        set((s) => ({
          library: { ...s.library, compositions: [...s.library.compositions, c] },
          editingCompositionId: c.id,
          editingPatternId: null,
          editingPlacementId: null,
          selectedPlacementId: null,
        }));
        return c.id;
      },
      renameComposition(id, name) {
        set((s) => ({
          library: {
            ...s.library,
            compositions: s.library.compositions.map((c) =>
              c.id === id ? setCompositionName(c, name) : c,
            ),
          },
        }));
      },
      setCompositionInstrument(id, instrumentId) {
        set((s) => ({
          library: {
            ...s.library,
            compositions: s.library.compositions.map((c) =>
              c.id === id ? setCompositionInstrument(c, instrumentId) : c,
            ),
          },
        }));
      },
      updateCompositionMetadata(id, patch) {
        set((s) => ({
          library: {
            ...s.library,
            compositions: s.library.compositions.map((c) =>
              c.id === id ? applyCompositionMetadata(c, patch) : c,
            ),
          },
        }));
      },
      setCompositionBpm(id, bpm) {
        set((s) => ({
          library: {
            ...s.library,
            compositions: s.library.compositions.map((c) =>
              c.id === id ? setCompositionBpm(c, bpm) : c,
            ),
          },
        }));
      },
      setCompositionTimeSignature(id, ts) {
        set((s) => ({
          library: {
            ...s.library,
            compositions: s.library.compositions.map((c) =>
              c.id === id ? setCompositionTimeSignature(c, ts) : c,
            ),
          },
        }));
      },
      setEditingPatternSuggestedBpm(bpm) {
        set((s) => {
          const id = s.editingPatternId;
          if (!id) return s;
          return {
            library: {
              ...s.library,
              patterns: s.library.patterns.map((p) =>
                p.id === id ? setPatternSuggestedBpm(p, bpm) : p,
              ),
            },
          };
        });
      },
      setEditingPatternTimeSignature(ts) {
        set((s) => {
          const id = s.editingPatternId;
          if (!id) return s;
          return {
            library: {
              ...s.library,
              patterns: s.library.patterns.map((p) =>
                p.id === id ? setPatternTimeSignature(p, ts) : p,
              ),
            },
          };
        });
      },
      setEditingPatternGroove(groove) {
        set((s) => {
          const id = s.editingPatternId;
          if (!id) return s;
          return {
            library: {
              ...s.library,
              patterns: s.library.patterns.map((p) =>
                p.id === id ? setPatternGroove(p, groove) : p,
              ),
            },
          };
        });
      },
      setEditingPatternSubdivision(subdivision) {
        set((s) => {
          const id = s.editingPatternId;
          if (!id) return s;
          return {
            library: {
              ...s.library,
              patterns: s.library.patterns.map((p) =>
                p.id === id ? { ...p, subdivision, updatedAt: Date.now() } : p,
              ),
            },
            ...clearDraftIf(s, id),
          };
        });
      },
      setEditingPatternVoiceRef(voiceRef) {
        set((s) => {
          const id = s.editingPatternId;
          if (!id) return s;
          return {
            library: {
              ...s.library,
              patterns: s.library.patterns.map((p) =>
                p.id === id ? { ...p, voiceRef, updatedAt: Date.now() } : p,
              ),
            },
            ...clearDraftIf(s, id),
          };
        });
      },
      setEditingPatternLoop(loop) {
        set((s) => {
          const id = s.editingPatternId;
          if (!id) return s;
          return {
            library: {
              ...s.library,
              patterns: s.library.patterns.map((p) =>
                p.id === id ? { ...p, loop, updatedAt: Date.now() } : p,
              ),
            },
            ...clearDraftIf(s, id),
          };
        });
      },
      setEditingCompositionTempoMode(mode) {
        set((s) => {
          const id = s.editingCompositionId;
          if (!id) return s;
          return {
            library: {
              ...s.library,
              compositions: s.library.compositions.map((c) =>
                c.id === id ? setCompositionTempoMode(c, mode) : c,
              ),
            },
          };
        });
      },
      setEditingCompositionGroove(groove) {
        set((s) => {
          const id = s.editingCompositionId;
          if (!id) return s;
          return {
            library: {
              ...s.library,
              compositions: s.library.compositions.map((c) =>
                c.id === id ? setCompositionGroove(c, groove) : c,
              ),
            },
          };
        });
      },
      addHarmonicBlock(block) {
        set((s) => {
          const id = s.editingCompositionId;
          if (!id) return s;
          return {
            library: {
              ...s.library,
              compositions: s.library.compositions.map((c) =>
                c.id === id
                  ? { ...c, harmonicContext: [...(c.harmonicContext ?? []), { ...block, id: generateUuid() }] }
                  : c,
              ),
            },
          };
        });
      },
      updateHarmonicBlock(blockId, patch) {
        set((s) => {
          const id = s.editingCompositionId;
          if (!id) return s;
          return {
            library: {
              ...s.library,
              compositions: s.library.compositions.map((c) =>
                c.id === id
                  ? {
                      ...c,
                      harmonicContext: (c.harmonicContext ?? []).map((b) =>
                        b.id === blockId ? { ...b, ...patch } : b,
                      ),
                    }
                  : c,
              ),
            },
          };
        });
      },
      removeHarmonicBlock(blockId) {
        set((s) => {
          const id = s.editingCompositionId;
          if (!id) return s;
          return {
            library: {
              ...s.library,
              compositions: s.library.compositions.map((c) =>
                c.id === id
                  ? { ...c, harmonicContext: (c.harmonicContext ?? []).filter((b) => b.id !== blockId) }
                  : c,
              ),
            },
          };
        });
      },
      setHarmonicContext(blocks) {
        set((s) => {
          const id = s.editingCompositionId;
          if (!id) return s;
          return {
            library: {
              ...s.library,
              compositions: s.library.compositions.map((c) =>
                c.id === id ? { ...c, harmonicContext: blocks } : c,
              ),
            },
          };
        });
      },
      setEditingCompositionSubdivision(subdivision) {
        set((s) => {
          const id = s.editingCompositionId;
          if (!id) return s;
          return {
            library: {
              ...s.library,
              compositions: s.library.compositions.map((c) =>
                c.id === id ? { ...c, subdivision, updatedAt: Date.now() } : c,
              ),
            },
          };
        });
      },
      setEditingCompositionGrooveMode(mode) {
        set((s) => {
          const id = s.editingCompositionId;
          if (!id) return s;
          return {
            library: {
              ...s.library,
              compositions: s.library.compositions.map((c) =>
                c.id === id ? setCompositionGrooveMode(c, mode) : c,
              ),
            },
          };
        });
      },
      forkComposition(source, sourceCreatorName) {
        if (!gateCreate('compositions', get().library.compositions.length)) return '';
        const now = Date.now();
        // Deep-clone helper for placements — used per-track in the fork.
        const clonePlacement = (p: Placement): Placement => ({
          id: generateId('place'),
          startTick: p.startTick,
          repeat: p.repeat,
          transposeSemitones: p.transposeSemitones,
          lengthTicks: p.lengthTicks,
          patternSnapshot: clonePattern(p.patternSnapshot),
        });
        const fork: Composition = {
          ...source,
          id: generateUuid(),
          // Multi-track fork: each track gets a fresh id + its placements
          // get deep-cloned. Track names / volumes / mute / solo settings
          // are inherited as-is.
          tracks: (source.tracks ?? []).map((t) => ({
            ...t,
            id: generateId('trk'),
            placements: t.placements.map(clonePlacement),
          })),
          placements: [],
          visibility: 'private',
          publishedAt: null,
          forkedFromId: source.id,
          forkedFromCreatorName: sourceCreatorName ?? null,
          collectionId: null,
          createdAt: now,
          updatedAt: now,
        };
        set((cur) => ({
          library: { ...cur.library, compositions: [...cur.library.compositions, fork] },
          editingCompositionId: fork.id,
          editingPatternId: null,
          editingPlacementId: null,
          selectedPlacementId: null,
        }));
        return fork.id;
      },
      useBuiltinComposition(source) {
        // Copy a read-only built-in composition into the library (editable,
        // private, no fork attribution) and open it. Deep-clones tracks/placements.
        if (!gateCreate('compositions', get().library.compositions.length)) return '';
        const now = Date.now();
        const clonePlacement = (p: Placement): Placement => ({
          id: generateId('place'),
          startTick: p.startTick,
          repeat: p.repeat,
          transposeSemitones: p.transposeSemitones,
          lengthTicks: p.lengthTicks,
          patternSnapshot: clonePattern(p.patternSnapshot),
        });
        const copy: Composition = {
          ...source,
          id: generateUuid(),
          tracks: (source.tracks ?? []).map((t) => ({
            ...t,
            id: generateId('trk'),
            placements: t.placements.map(clonePlacement),
          })),
          placements: [],
          visibility: 'private',
          publishedAt: null,
          forkedFromId: null,
          forkedFromCreatorName: null,
          collectionId: null,
          createdAt: now,
          updatedAt: now,
        };
        set((cur) => ({
          library: { ...cur.library, compositions: [...cur.library.compositions, copy] },
          editingCompositionId: copy.id,
          editingPatternId: null,
          editingPlacementId: null,
          selectedPlacementId: null,
        }));
        return copy.id;
      },
      deleteComposition(id) {
        set((s) => ({
          library: {
            ...s.library,
            compositions: s.library.compositions.filter((c) => c.id !== id),
          },
          editingCompositionId: s.editingCompositionId === id ? null : s.editingCompositionId,
          editingPlacementId: s.editingCompositionId === id ? null : s.editingPlacementId,
        }));
      },

      // ─── Collections ─────────────────────────────────────────────────────────
      createCollection(name, parentId) {
        const s = get();
        const parentDepth = parentId === null ? -1 : getCollectionDepth(s.library.collections, parentId);
        // Root is depth -1; a folder directly under root is depth 0; etc. So a new
        // folder under `parentId` would be at depth `parentDepth + 1`. Refuse if
        // that would exceed MAX_FOLDER_DEPTH.
        if (parentDepth + 1 >= MAX_FOLDER_DEPTH) return null;
        const c = createEmptyCollection(name, parentId);
        set((cur) => ({
          library: { ...cur.library, collections: [...cur.library.collections, c] },
        }));
        return c.id;
      },
      renameCollection(id, name) {
        set((s) => ({
          library: {
            ...s.library,
            collections: s.library.collections.map((c) =>
              c.id === id ? opsSetCollectionName(c, name) : c,
            ),
          },
        }));
      },
      moveCollection(id, newParentId) {
        const s = get();
        // Refuse to move a folder into itself or any of its descendants.
        if (wouldCreateCycle(s.library.collections, id, newParentId)) return;
        // Refuse if the move would exceed depth (computed from the new parent).
        const newParentDepth = newParentId === null ? -1 : getCollectionDepth(s.library.collections, newParentId);
        if (newParentDepth + 1 >= MAX_FOLDER_DEPTH) return;
        set((cur) => ({
          library: {
            ...cur.library,
            collections: cur.library.collections.map((c) =>
              c.id === id ? opsSetCollectionParent(c, newParentId) : c,
            ),
          },
        }));
      },
      deleteCollection(id) {
        // The FK is `on delete set null` on both parent_id and the item collection_id,
        // so deleting a folder at the DB layer leaves subfolders + items at root. Mirror
        // that locally so the UI stays consistent with what cloud sync will produce.
        set((s) => ({
          library: {
            ...s.library,
            collections: s.library.collections
              .filter((c) => c.id !== id)
              .map((c) => (c.parentId === id ? { ...c, parentId: null, updatedAt: Date.now() } : c)),
            patterns: s.library.patterns.map((p) =>
              p.collectionId === id ? { ...p, collectionId: null, updatedAt: Date.now() } : p,
            ),
            compositions: s.library.compositions.map((cm) =>
              cm.collectionId === id ? { ...cm, collectionId: null, updatedAt: Date.now() } : cm,
            ),
          },
        }));
      },
      updateCollectionMetadata(id, patch) {
        set((s) => ({
          library: {
            ...s.library,
            collections: s.library.collections.map((c) =>
              c.id === id ? applyCollectionMetadata(c, patch) : c,
            ),
          },
        }));
      },
      setPatternCollection(id, collectionId) {
        set((s) => ({
          library: {
            ...s.library,
            patterns: s.library.patterns.map((p) =>
              p.id === id ? { ...p, collectionId, updatedAt: Date.now() } : p,
            ),
          },
          ...clearDraftIf(s, id),
        }));
      },
      setCompositionCollection(id, collectionId) {
        set((s) => ({
          library: {
            ...s.library,
            compositions: s.library.compositions.map((cm) =>
              cm.id === id ? { ...cm, collectionId, updatedAt: Date.now() } : cm,
            ),
          },
        }));
      },

      // ─── Layout ──────────────────────────────────────────────────────────────
      setFretboardCollapsed(b) {
        set({ fretboardCollapsed: b });
      },

      // ─── Open targets ────────────────────────────────────────────────────────
      openPatternForEditing(id) {
        set({
          editingPatternId: id,
          editingPlacementId: null,
          cursorTick: 0,
          selectedEventIds: [],
          pendingChordStamp: [],
        });
      },
      openPlacementForEditing(compositionId, placementId) {
        set({
          editingCompositionId: compositionId,
          editingPlacementId: placementId,
          editingPatternId: null,
          cursorTick: 0,
          selectedEventIds: [],
          pendingChordStamp: [],
        });
      },
      openCompositionForArranging(id) {
        set({
          editingCompositionId: id,
          editingPlacementId: null,
          selectedPlacementId: null,
        });
      },

      // ─── Pre-roll countdown ──────────────────────────────────────────────────
      setPreRollState(state) {
        set({ preRollState: state });
      },
      setPreRollEnabled(enabled) {
        set({ preRollEnabled: enabled });
      },

      // ─── Playback head tick ──────────────────────────────────────────────────
      setHeadTick(tick) {
        set({ headTick: tick });
      },

      // ─── Editor state ────────────────────────────────────────────────────────
      setCursorTick(t) {
        set({ cursorTick: Math.max(0, t) });
      },
      setCompositionCursorTick(t) {
        set({ compositionCursorTick: Math.max(0, t) });
      },
      setCompositionLoopRegion(region) {
        if (!region || region.end - region.start <= 0) {
          set({ compositionLoopRegion: null });
          return;
        }
        set({ compositionLoopRegion: { start: Math.max(0, region.start), end: region.end } });
      },
      setPatternLoopRegion(region) {
        if (!region || region.end - region.start <= 0) {
          set({ patternLoopRegion: null });
          return;
        }
        set({ patternLoopRegion: { start: Math.max(0, region.start), end: region.end } });
      },
      setStepLength(s) {
        set({ stepLength: s });
      },

      // ─── Editor mutations (resolve current target) ───────────────────────────
      stampAt(cell, isChord) {
        const s = get();
        const target = currentEditTarget(s);
        if (!target) return;
        const durationTicks = stepLengthToTicks(s.stepLength);
        if (isChord) {
          // Buffer this cell into the pending chord; the cursor doesn't advance until flush.
          // Also commit it immediately (so the user sees the bar appear) at cursorTick.
          const result = stampEvent({
            pattern: target.pattern,
            stringIndex: cell.stringIndex,
            fret: cell.fret,
            startTick: s.cursorTick,
            durationTicks,
          });
          if (result.pattern === target.pattern) return; // conflict, no-op
          set(updateTarget(s, result.pattern, {
            pendingChordStamp: [...s.pendingChordStamp, cell],
          }));
        } else {
          // Single-note stamp: commit, advance cursor.
          // Also flush any pending chord (the user released shift and is now stamping forward).
          const result = stampEvent({
            pattern: target.pattern,
            stringIndex: cell.stringIndex,
            fret: cell.fret,
            startTick: s.cursorTick,
            durationTicks,
          });
          if (result.pattern === target.pattern) {
            // Conflict — still advance cursor so user isn't stuck.
            set({ cursorTick: s.cursorTick + durationTicks, pendingChordStamp: [] });
            return;
          }
          set(updateTarget(s, result.pattern, {
            cursorTick: s.cursorTick + durationTicks,
            pendingChordStamp: [],
          }));
        }
      },
      flushChordStamp() {
        const s = get();
        if (s.pendingChordStamp.length === 0) return;
        const durationTicks = stepLengthToTicks(s.stepLength);
        set({ cursorTick: s.cursorTick + durationTicks, pendingChordStamp: [] });
      },
      rest() {
        const s = get();
        const durationTicks = stepLengthToTicks(s.stepLength);
        set({ cursorTick: s.cursorTick + durationTicks, pendingChordStamp: [] });
      },
      stampCagedPlan(plan) {
        if (plan.notes.length === 0) return;
        const s = get();
        const target = currentEditTarget(s);
        if (!target) return;
        let pattern = target.pattern;
        const baseTick = s.cursorTick;
        for (const note of plan.notes) {
          const startTick = baseTick + note.startTickOffset;
          const res = stampEvent({
            pattern,
            stringIndex: note.stringIndex,
            fret: note.fret,
            startTick,
            durationTicks: note.durationTicks,
          });
          // stampEvent returns the input pattern unchanged on conflict; skip that note.
          if (res.pattern !== pattern) pattern = res.pattern;
        }
        const endTick = baseTick + plan.totalTicks;
        // Pattern length is fit to content centrally in updateTarget().
        set(updateTarget(s, pattern, {
          cursorTick: endTick,
          pendingChordStamp: [],
        }));
      },
      moveEvent(eventId, newStartTick, newStringIndex) {
        const s = get();
        const target = currentEditTarget(s);
        if (!target) return;
        const next = opsMoveEvent(target.pattern, eventId, newStartTick, newStringIndex);
        if (next === target.pattern) return;
        set(updateTarget(s, next));
      },
      moveEventsBy(snapshots, deltaTicks, deltaStringIdx, stringCount) {
        const s = get();
        const target = currentEditTarget(s);
        if (!target) return;
        const next = opsMoveEventsBy(target.pattern, snapshots, deltaTicks, deltaStringIdx, stringCount);
        if (next === target.pattern) return;
        set(updateTarget(s, next));
      },
      resizeEvent(eventId, newDurationTicks) {
        const s = get();
        const target = currentEditTarget(s);
        if (!target) return;
        const next = opsResizeEvent(target.pattern, eventId, newDurationTicks);
        if (next === target.pattern) return;
        set(updateTarget(s, next));
      },
      resizeEventsBy(snapshots, deltaTicks) {
        const s = get();
        const target = currentEditTarget(s);
        if (!target) return;
        const next = opsResizeEventsBy(target.pattern, snapshots, deltaTicks);
        if (next === target.pattern) return;
        set(updateTarget(s, next));
      },
      setEventFret(eventId, fret) {
        const s = get();
        const target = currentEditTarget(s);
        if (!target) return;
        const next = opsSetEventFret(target.pattern, eventId, fret);
        if (next === target.pattern) return;
        set(updateTarget(s, next));
      },
      updateEventArticulations(eventId, patch) {
        const s = get();
        const target = currentEditTarget(s);
        if (!target) return;
        const next = opsUpdateEventArticulations(target.pattern, eventId, patch);
        if (next === target.pattern) return;
        set(updateTarget(s, next));
      },
      groupSelectionAsChord(chordName) {
        const s = get();
        const target = currentEditTarget(s);
        if (!target || s.selectedEventIds.length < 2) return;
        const ids = new Set(s.selectedEventIds);
        const chordId = generateUuid();
        const next = {
          ...target.pattern,
          events: target.pattern.events.map((e) =>
            ids.has(e.id) ? { ...e, chordId, chordName } : e,
          ),
          updatedAt: Date.now(),
        };
        set(updateTarget(s, next));
      },
      ungroupSelectionChord() {
        const s = get();
        const target = currentEditTarget(s);
        if (!target || s.selectedEventIds.length === 0) return;
        const ids = new Set(s.selectedEventIds);
        const next = {
          ...target.pattern,
          events: target.pattern.events.map((e) =>
            ids.has(e.id) ? { ...e, chordId: null, chordName: null } : e,
          ),
          updatedAt: Date.now(),
        };
        set(updateTarget(s, next));
      },
      nudgeSelectedFret(delta) {
        const s = get();
        const target = currentEditTarget(s);
        if (!target || s.selectedEventIds.length === 0) return;
        let next = target.pattern;
        for (const id of s.selectedEventIds) {
          const ev = next.events.find((e) => e.id === id);
          if (!ev) continue;
          next = opsSetEventFret(next, id, ev.fret + delta);
        }
        if (next === target.pattern) return;
        set(updateTarget(s, next));
      },
      transposeSelectedDiatonic(direction, tuning, fretCount) {
        const s = get();
        const target = currentEditTarget(s);
        if (!target || s.selectedEventIds.length === 0) return;
        const { pattern } = target;
        if (pattern.key === null || pattern.scaleType === null) return;
        const scale = getScale(pattern.scaleType);
        if (!scale) return;
        const next = opsTransposeDiatonic(
          pattern,
          s.selectedEventIds,
          direction,
          pattern.key,
          scale.intervals,
          tuning,
          fretCount,
        );
        if (next === pattern) return;
        set(updateTarget(s, next));
      },
      deleteEvents(ids) {
        const s = get();
        const target = currentEditTarget(s);
        if (!target) return;
        const next = opsDeleteEvents(target.pattern, ids);
        if (next === target.pattern) return;
        const remaining = new Set(next.events.map((e) => e.id));
        set(updateTarget(s, next, {
          selectedEventIds: s.selectedEventIds.filter((id) => remaining.has(id)),
        }));
      },
      selectEvents(ids, mode) {
        set((s) => {
          let nextSelection: string[];
          if (mode === 'replace') {
            nextSelection = [...ids];
          } else if (mode === 'add') {
            const set = new Set([...s.selectedEventIds, ...ids]);
            nextSelection = Array.from(set);
          } else {
            // toggle
            const set = new Set(s.selectedEventIds);
            for (const id of ids) {
              if (set.has(id)) set.delete(id);
              else set.add(id);
            }
            nextSelection = Array.from(set);
          }
          return { selectedEventIds: nextSelection };
        });
      },
      setEditingPatternDuration(durationTicks) {
        const s = get();
        const target = currentEditTarget(s);
        if (!target) return;
        const next = opsSetPatternDuration(target.pattern, durationTicks);
        if (next === target.pattern) return;
        set(updateTarget(s, next));
      },
      setEditingPatternKeyScale(key, scaleType) {
        const s = get();
        const target = currentEditTarget(s);
        if (!target) return;
        // Both-or-neither invariant: setting key=null clears scaleType too;
        // setting key with no scaleType defaults scaleType to 'major'.
        const finalKey = key === null ? null : key;
        const finalScale = key === null ? null : (scaleType ?? 'major');
        if (finalKey === target.pattern.key && finalScale === target.pattern.scaleType) return;
        const next: Pattern = {
          ...target.pattern,
          key: finalKey,
          scaleType: finalScale,
          updatedAt: Date.now(),
        };
        set(updateTarget(s, next));
      },

      // ─── Arrange mutations ───────────────────────────────────────────────────
      addPlacement(patternId, atTick) {
        const s = get();
        const compId = s.editingCompositionId;
        if (!compId) return null;
        // Resolve from the user's library OR the read-only built-in library
        // (built-ins aren't stored; the placement snapshots a copy, so no sync/cap).
        const sourcePattern =
          s.library.patterns.find((p) => p.id === patternId) ??
          BUILTIN_PATTERNS.find((p) => p.id === patternId);
        if (!sourcePattern) return null;
        const comp = s.library.compositions.find((c) => c.id === compId);
        if (!comp) return null;
        const { composition: next, placement } = opsAddPlacement(comp, sourcePattern, atTick);
        set({
          library: {
            ...s.library,
            compositions: s.library.compositions.map((c) => (c.id === compId ? next : c)),
          },
          selectedPlacementId: placement.id,
        });
        return placement.id;
      },
      addPlacementToTrack(patternId, trackId, atTick) {
        const s = get();
        const compId = s.editingCompositionId;
        if (!compId) return null;
        // Resolve from the user's library OR the read-only built-in library
        // (built-ins aren't stored; the placement snapshots a copy, so no sync/cap).
        const sourcePattern =
          s.library.patterns.find((p) => p.id === patternId) ??
          BUILTIN_PATTERNS.find((p) => p.id === patternId);
        if (!sourcePattern) return null;
        const comp = s.library.compositions.find((c) => c.id === compId);
        if (!comp) return null;
        const { composition: next, placement } = opsAddPlacementToTrack(
          comp,
          trackId,
          sourcePattern,
          atTick,
        );
        if (!placement) return null;
        set({
          library: {
            ...s.library,
            compositions: s.library.compositions.map((c) => (c.id === compId ? next : c)),
          },
          selectedPlacementId: placement.id,
        });
        return placement.id;
      },
      movePlacement(placementId, destTrackId, destStartTick) {
        applyComposition(set, get, (comp) =>
          opsMovePlacement(comp, placementId, destTrackId, destStartTick),
        );
      },
      splitPlacement(placementId, atTick) {
        applyComposition(set, get, (comp) => opsSplitPlacement(comp, placementId, atTick));
      },
      duplicatePlacements(ids, deltaTicks, destTrackId) {
        applyComposition(set, get, (comp) =>
          opsDuplicatePlacements(comp, ids, deltaTicks, destTrackId),
        );
      },
      setPlacementRepeat(placementId, repeat) {
        applyComposition(set, get, (comp) => opsSetPlacementRepeat(comp, placementId, repeat));
      },
      setPlacementTranspose(placementId, semitones) {
        applyComposition(set, get, (comp) => opsSetPlacementTranspose(comp, placementId, semitones));
      },
      resizePlacement(placementId, lengthTicks) {
        applyComposition(set, get, (comp) => opsResizePlacement(comp, placementId, lengthTicks));
      },
      setCompositionLoop(compositionId, loop) {
        const s = get();
        const comp = s.library.compositions.find((c) => c.id === compositionId);
        if (!comp) return;
        const next = opsSetCompositionLoop(comp, loop);
        if (next === comp) return;
        set({
          library: {
            ...s.library,
            compositions: s.library.compositions.map((c) => (c.id === compositionId ? next : c)),
          },
        });
      },
      removePlacement(placementId) {
        applyComposition(set, get, (comp) => opsRemovePlacement(comp, placementId));
        // If we removed the currently-edited placement, clear that pointer.
        const s = get();
        if (s.editingPlacementId === placementId) {
          set({ editingPlacementId: null, selectedPlacementId: null });
        } else if (s.selectedPlacementId === placementId) {
          set({ selectedPlacementId: null });
        }
      },
      selectPlacement(id) {
        set({ selectedPlacementId: id });
      },

      // ─── Multi-track composition actions ────────────────────────────────
      addCompositionTrack(name, instrumentId) {
        applyComposition(set, get, (comp) => opsAddTrack(comp, name, instrumentId));
      },
      removeCompositionTrack(trackId) {
        applyComposition(set, get, (comp) => opsRemoveTrack(comp, trackId));
      },
      setCompositionTrackName(trackId, name) {
        applyComposition(set, get, (comp) => opsSetTrackName(comp, trackId, name));
      },
      setCompositionTrackInstrument(trackId, instrumentId) {
        applyComposition(set, get, (comp) => opsSetTrackInstrument(comp, trackId, instrumentId));
      },
      setCompositionTrackVoiceRef(trackId, voiceRef) {
        applyComposition(set, get, (comp) => opsSetTrackVoiceRef(comp, trackId, voiceRef));
      },
      setCompositionTrackVolumeDb(trackId, volumeDb) {
        applyComposition(set, get, (comp) => opsSetTrackVolumeDb(comp, trackId, volumeDb));
      },
      setCompositionTrackMuted(trackId, muted) {
        applyComposition(set, get, (comp) => opsSetTrackMuted(comp, trackId, muted));
      },
      setCompositionTrackSoloed(trackId, soloed) {
        applyComposition(set, get, (comp) => opsSetTrackSoloed(comp, trackId, soloed));
      },
      setCompositionMasterVolumeDb(masterVolumeDb) {
        applyComposition(set, get, (comp) => opsSetMasterVolumeDb(comp, masterVolumeDb));
      },
    }),
    persistOptions,
  ),
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Resolve which pattern the editor is currently operating on. Returns null when
 *  nothing is open. */
function currentEditTarget(s: PatternsState): {
  pattern: Pattern;
  /** Which kind of target we're updating — used by updateTarget() to know where to write. */
  kind: 'library' | 'placement';
} | null {
  if (s.editingPlacementId && s.editingCompositionId) {
    const comp = s.library.compositions.find((c) => c.id === s.editingCompositionId);
    if (!comp) return null;
    let placement: Placement | undefined;
    for (const t of comp.tracks ?? []) {
      placement = t.placements.find((p) => p.id === s.editingPlacementId);
      if (placement) break;
    }
    if (!placement) return null;
    return { pattern: placement.patternSnapshot, kind: 'placement' };
  }
  if (s.editingPatternId) {
    const p = s.library.patterns.find((pp) => pp.id === s.editingPatternId);
    if (!p) return null;
    return { pattern: p, kind: 'library' };
  }
  return null;
}

/** Build a state patch that writes the updated pattern back to its source — either to
 *  the library or to the placement's snapshot. */
/**
 * Single chokepoint for content mutations on the currently-edited pattern. Also clears
 * `unpersistedDraftId` when the editing target is the draft, so any real edit promotes
 * the draft into a regular library pattern.
 */
function updateTarget(
  s: PatternsState,
  nextRaw: Pattern,
  extra: Partial<PatternsState> = {},
): Partial<PatternsState> {
  // Pattern length is freeform: always fit it to content (bar-rounded) so it
  // grows/shrinks as notes are added/removed — there is no manual length input.
  const next = fitPatternDuration(nextRaw);
  if (s.editingPlacementId && s.editingCompositionId) {
    const compId = s.editingCompositionId;
    const placementId = s.editingPlacementId;
    return {
      library: {
        ...s.library,
        compositions: s.library.compositions.map((c) =>
          c.id === compId ? opsSetPlacementSnapshot(c, placementId, next) : c,
        ),
      },
      ...extra,
    };
  }
  if (s.editingPatternId) {
    const patternId = s.editingPatternId;
    return {
      library: {
        ...s.library,
        patterns: s.library.patterns.map((p) => (p.id === patternId ? next : p)),
      },
      ...clearDraftIf(s, patternId),
      ...extra,
    };
  }
  return extra;
}

/**
 * Returns `{ unpersistedDraftId: null }` if the given id matches the currently-pending
 * draft, otherwise `{}`. Spread into the result of a `set()` call to promote the draft
 * (i.e. flag it as a real, syncable pattern) on first mutation.
 */
function clearDraftIf(s: PatternsState, id: string | null): { unpersistedDraftId: null } | Record<string, never> {
  return s.unpersistedDraftId !== null && s.unpersistedDraftId === id
    ? { unpersistedDraftId: null }
    : {};
}

function applyComposition(
  set: (patch: Partial<PatternsStoreState> | ((s: PatternsStoreState) => Partial<PatternsStoreState>)) => void,
  get: () => PatternsStoreState,
  fn: (comp: Composition) => Composition,
): void {
  const s = get();
  const compId = s.editingCompositionId;
  if (!compId) return;
  const comp = s.library.compositions.find((c) => c.id === compId);
  if (!comp) return;
  const next = fn(comp);
  if (next === comp) return;
  set({
    library: {
      ...s.library,
      compositions: s.library.compositions.map((c) => (c.id === compId ? next : c)),
    },
  });
}

// ─── Selector helpers (convenience for callers) ───────────────────────────────

/** Get the pattern currently open in the editor, regardless of whether it's a library
 *  pattern or a placement's snapshot. Returns null when nothing is open. */
export function selectEditingPattern(s: PatternsStoreState): Pattern | null {
  return currentEditTarget(s)?.pattern ?? null;
}

export function selectEditingComposition(s: PatternsStoreState): Composition | null {
  if (!s.editingCompositionId) return null;
  return s.library.compositions.find((c) => c.id === s.editingCompositionId) ?? null;
}

/** Compositions that reference the given pattern id via any placement on
 *  any track. Deduped by composition id (filter on library.compositions). */
export function selectCompositionsUsingPattern(
  s: PatternsStoreState,
  patternId: string,
): Composition[] {
  return s.library.compositions.filter((c) =>
    (c.tracks ?? []).some((t) =>
      t.placements.some((pl) => pl.patternSnapshot.id === patternId),
    ),
  );
}

/** Find a placement by id across all compositions and tracks. */
export function findPlacement(
  s: PatternsStoreState,
  placementId: string,
): { composition: Composition; placement: Placement } | null {
  for (const c of s.library.compositions) {
    for (const t of c.tracks ?? []) {
      const p = t.placements.find((pl) => pl.id === placementId);
      if (p) return { composition: c, placement: p };
    }
  }
  return null;
}
