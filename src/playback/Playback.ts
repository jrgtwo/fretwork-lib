/**
 * Playback — the orchestrator between the metronome and the audio/visual playhead.
 *
 * On each metronome tick, Playback:
 *   1. Resolves the active pattern (if not cached) → ordered list of PlayableCell.
 *   2. Picks the cell at the current playhead index.
 *   3. Triggers the instrument with the cell's sounding pitch at the metronome's audioTime.
 *   4. Updates its store with the new playhead cell.
 *   5. Advances the index, wrapping at the end of the sequence.
 *
 * The pattern's `resolve()` is pure — given the same input, it returns the same sequence.
 * Playback caches the resolved sequence and re-resolves only when the upstream state
 * changes (key/mode/type/tuning/capo/pattern/customSequence). Cache invalidation is
 * pull-based: the consumer (the React hook) calls `setResolveInput()` on every render
 * so Playback always has the latest snapshot when a tick fires.
 */
import type { Metronome } from '../metronome/Metronome';
import { noteAt } from '../lib/theory';
import type {
  GuitarInstrument,
  PlaybackOptions,
  PlaybackPattern,
  PlayableCell,
  ResolveInput,
} from './types';
import { cellsEqual } from './types';
import { getPlaybackPattern, DEFAULT_PATTERN_ID } from './patterns';
import { PluckSynthInstrument } from './instrument';

type PlayheadListener = (cell: PlayableCell | null) => void;

export class Playback {
  private _instrument: GuitarInstrument;
  private _enabled: boolean;
  private _pattern: PlaybackPattern;
  private _customSequence: readonly PlayableCell[] = [];
  private _isProgramming = false;

  /** Latest snapshot of state to feed into pattern.resolve(). */
  private _resolveInput: ResolveInput | null = null;

  /** Cached resolved sequence + the index of the next cell to play. */
  private _resolvedSequence: readonly PlayableCell[] = [];
  private _playheadIndex = 0;
  /** The cell that was last played — used for the visual playhead. */
  private _currentPlayheadCell: PlayableCell | null = null;

  private _playheadListeners = new Set<PlayheadListener>();

  /** Subscription cleanup for the Metronome tick listener. */
  private _unsubTick: (() => void) | null = null;
  /** Subscription cleanup for the Metronome subdivision listener. */
  private _unsubSubdivision: (() => void) | null = null;
  /** Subscription cleanup for the Metronome stop listener. */
  private _unsubStop: (() => void) | null = null;

  constructor(metronome: Metronome, options: PlaybackOptions = {}) {
    this._enabled = options.enabled ?? false;
    const initialPatternId = options.patternId ?? DEFAULT_PATTERN_ID;
    this._pattern = getPlaybackPattern(initialPatternId) ?? getPlaybackPattern(DEFAULT_PATTERN_ID)!;
    this._instrument = options.instrument ?? new PluckSynthInstrument();

    // Subscribe to the metronome's tick event. The subscription stays for the lifetime
    // of this Playback instance.
    this._unsubTick = metronome.on('tick', (event) => {
      this._onTick(event.audioTime);
    });
    // Walk-note density follows the metronome's subdivision (set via Feel): the
    // metronome only emits 'subdivision' events when a subdivision is active, so
    // playing on every one of them gives one note per sub-tick when subdivided,
    // and one note per beat when Feel is "off" (no sub-tick events fire).
    this._unsubSubdivision = metronome.on('subdivision', (event) => {
      this._onTick(event.audioTime);
    });
    this._unsubStop = metronome.on('stop', () => {
      // Reset playhead when metronome stops so the next start begins from index 0.
      this._resetPlayhead();
    });
  }

  // ─── Configuration ───────────────────────────────────────────────────────────

  setEnabled(enabled: boolean): void {
    if (this._enabled === enabled) return;
    this._enabled = enabled;
    if (!enabled) {
      this._instrument.releaseAll();
      this._resetPlayhead();
    }
  }

  setPatternId(id: string): void {
    const next = getPlaybackPattern(id);
    if (!next || next.id === this._pattern.id) return;
    this._pattern = next;
    this._invalidateCache();
  }

  setCustomSequence(cells: readonly PlayableCell[]): void {
    this._customSequence = [...cells];
    this._invalidateCache();
  }

  setInstrument(instrument: GuitarInstrument): void {
    // Dispose the old one if we own it. v1 always owns its default — if a consumer
    // passes one in, we still dispose on swap; the consumer can re-supply a fresh
    // instance if they want lifecycle control beyond that.
    this._instrument.dispose();
    this._instrument = instrument;
  }

  /**
   * Update the resolve input snapshot. Called by the React hook on every render so the
   * Playback class always has the latest fretboard state when a tick fires. This is the
   * only place upstream state enters Playback.
   */
  setResolveInput(input: ResolveInput): void {
    // Quick equality check: if all the things that affect resolution are unchanged,
    // skip cache invalidation. We compare highlights by identity — `computeHighlights`
    // returns a new array on each call, so changes show up as different references.
    const prev = this._resolveInput;
    this._resolveInput = input;
    if (
      !prev ||
      prev.highlights !== input.highlights ||
      prev.tuning !== input.tuning ||
      prev.key !== input.key ||
      prev.capo !== input.capo ||
      prev.mode !== input.mode ||
      prev.scaleType !== input.scaleType ||
      prev.fretCount !== input.fretCount ||
      prev.customSequence !== input.customSequence
    ) {
      this._invalidateCache();
    }
  }

  // ─── Programming mode (custom pattern) ───────────────────────────────────────

  startProgramming(): void {
    this._isProgramming = true;
  }

  finishProgramming(): void {
    this._isProgramming = false;
  }

  addCustomCell(cell: PlayableCell): void {
    if (this._customSequence.some((c) => cellsEqual(c, cell))) {
      return;
    }
    this._customSequence = [...this._customSequence, cell];
    this._invalidateCache();
  }

  clearCustom(): void {
    this._customSequence = [];
    this._invalidateCache();
  }

  // ─── Playhead listeners ──────────────────────────────────────────────────────

  onPlayheadChange(listener: PlayheadListener): () => void {
    this._playheadListeners.add(listener);
    return () => this._playheadListeners.delete(listener);
  }

  // ─── Read-only getters ───────────────────────────────────────────────────────

  get isEnabled(): boolean { return this._enabled; }
  get currentPattern(): PlaybackPattern { return this._pattern; }
  get currentPlayheadCell(): PlayableCell | null { return this._currentPlayheadCell; }
  get isProgramming(): boolean { return this._isProgramming; }
  get instrument(): GuitarInstrument { return this._instrument; }
  get customSequence(): readonly PlayableCell[] { return this._customSequence; }
  /** The resolved ordered play sequence (for the look-ahead readout). */
  get resolvedSequence(): readonly PlayableCell[] { return this._resolvedSequence; }
  /** Index of the next cell to play within `resolvedSequence`. */
  get playheadIndex(): number { return this._playheadIndex; }

  // ─── Cleanup ─────────────────────────────────────────────────────────────────

  dispose(): void {
    this._unsubTick?.();
    this._unsubTick = null;
    this._unsubSubdivision?.();
    this._unsubSubdivision = null;
    this._unsubStop?.();
    this._unsubStop = null;
    this._instrument.dispose();
    this._playheadListeners.clear();
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  /** Reset the playhead position and clear the visual playhead cell. Shared by
   *  the metronome-stop handler and `setEnabled(false)`. */
  private _resetPlayhead(): void {
    this._playheadIndex = 0;
    this._setCurrentPlayheadCell(null);
  }

  private _invalidateCache(): void {
    this._resolvedSequence = [];
    this._playheadIndex = 0;
    // Don't clear the current cell here — the visual playhead persists until the next
    // tick advances it. Clearing on stop/setEnabled(false) is handled separately.
  }

  private _ensureResolved(): readonly PlayableCell[] {
    if (this._resolvedSequence.length > 0) return this._resolvedSequence;
    if (!this._resolveInput) return [];
    const input: ResolveInput = {
      ...this._resolveInput,
      customSequence: this._customSequence,
    };
    this._resolvedSequence = this._pattern.resolve(input);
    return this._resolvedSequence;
  }

  private _onTick(audioTime: number): void {
    if (!this._enabled || this._isProgramming) return;
    const seq = this._ensureResolved();
    if (seq.length === 0) return;

    const idx = this._playheadIndex % seq.length;
    const cell = seq[idx];
    this._playheadIndex = (idx + 1) % seq.length;

    if (this._resolveInput) {
      const note = noteAt(this._resolveInput.tuning.strings[cell.stringIndex], cell.fret);
      try {
        this._instrument.play(note, '8n', audioTime);
      } catch {
        // Instruments may throw under various conditions; never let one bad note kill
        // the playhead loop.
      }
    }

    this._setCurrentPlayheadCell(cell);
  }

  private _setCurrentPlayheadCell(cell: PlayableCell | null): void {
    this._currentPlayheadCell = cell;
    for (const listener of this._playheadListeners) {
      try {
        listener(cell);
      } catch {
        // Don't let a buggy UI listener break audio.
      }
    }
  }
}
