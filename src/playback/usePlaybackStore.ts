import { create } from 'zustand';
import type { PlayableCell } from './types';
import { cellsEqual } from './types';
import { DEFAULT_PATTERN_ID } from './patterns';

/**
 * Zustand store for note-playback state. Mirrors the metronome store pattern:
 * persisted-leaning fields up top (currently in-memory only; URL persistence is a
 * follow-up), live runtime fields below.
 */
export interface PlaybackStoreState {
  // Configuration
  enabled: boolean;
  patternId: string;
  customSequence: readonly PlayableCell[];

  // Programming mode (for custom pattern)
  isProgramming: boolean;

  // Live state
  /** The cell currently being played (null when paused or playback disabled). */
  currentPlayheadCell: PlayableCell | null;
  /** The next several cells in the resolved sequence — fed to the look-ahead bar. */
  upcomingCells: readonly PlayableCell[];

  // Setters
  setEnabled: (enabled: boolean) => void;
  toggleEnabled: () => void;
  setPatternId: (id: string) => void;
  setCustomSequence: (cells: readonly PlayableCell[]) => void;
  appendCustomCell: (cell: PlayableCell) => void;
  clearCustomSequence: () => void;
  setIsProgramming: (programming: boolean) => void;
  setCurrentPlayheadCell: (cell: PlayableCell | null) => void;
}

export const DEFAULT_PLAYBACK_STATE = {
  // Walk-note playback defaults ON: the ribbon no longer has an on/off "Notes"
  // toggle (the notes-volume slider, 0 = silent, is the control instead).
  enabled: true,
  patternId: DEFAULT_PATTERN_ID,
  customSequence: [] as readonly PlayableCell[],
  isProgramming: false,
  currentPlayheadCell: null as PlayableCell | null,
  upcomingCells: [] as readonly PlayableCell[],
};

export const usePlaybackStore = create<PlaybackStoreState>((set) => ({
  ...DEFAULT_PLAYBACK_STATE,
  setEnabled: (enabled) =>
    set(enabled ? { enabled } : { enabled, currentPlayheadCell: null }),
  toggleEnabled: () => set((s) => ({ enabled: !s.enabled, currentPlayheadCell: null })),
  setPatternId: (patternId) => set({ patternId, currentPlayheadCell: null }),
  setCustomSequence: (customSequence) => set({ customSequence: [...customSequence] }),
  appendCustomCell: (cell) => set((s) => {
    // Avoid duplicates — same cell already in the sequence is a no-op.
    if (s.customSequence.some((c) => cellsEqual(c, cell))) {
      return s;
    }
    return { customSequence: [...s.customSequence, cell] };
  }),
  clearCustomSequence: () => set({ customSequence: [] }),
  setIsProgramming: (isProgramming) => set({ isProgramming }),
  setCurrentPlayheadCell: (currentPlayheadCell) => set({ currentPlayheadCell }),
}));
