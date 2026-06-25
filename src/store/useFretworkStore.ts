import { create } from 'zustand';
import type {
  FretworkSettings,
  FretworkState,
  Handedness,
  LabelMode,
  Mode,
} from '../types';
import {
  DEFAULT_STATE,
  defaultTypeForMode,
  isValidTypeForMode,
  readStateFromLocation,
  writeStateToLocation,
} from '../lib/url-state';
import { getInstrument, DEFAULT_INSTRUMENT_ID } from '../lib/instruments';
import { getTuning } from '../lib/tunings';

interface FretworkActions {
  setInstrumentId: (id: string) => void;
  setMode: (mode: Mode) => void;
  setKey: (key: string) => void;
  setType: (type: string) => void;
  setTuning: (tuning: string) => void;
  setCapo: (capo: number) => void;
  setLabels: (labels: LabelMode) => void;
  setShapeId: (id: string | null) => void;
  setHandedness: (handedness: Handedness) => void;
  setColorByDegree: (on: boolean) => void;
  setHighlightRoot: (on: boolean) => void;
  setShowGhostMarkers: (on: boolean) => void;
  reset: () => void;
}

type Store = FretworkState & FretworkActions;

const initial: FretworkState =
  typeof window === 'undefined' ? DEFAULT_STATE : readStateFromLocation();

export const useFretworkStore = create<Store>((set, get) => {
  const persist = () => writeStateToLocation(get());

  const updateSettings = (patch: Partial<FretworkSettings>) => {
    set((s) => ({ settings: { ...s.settings, ...patch } }));
    persist();
  };

  return {
    ...initial,

    setInstrumentId: (id) => {
      const instrument = getInstrument(id);
      if (!instrument) return;
      const currentTuning = getTuning(get().tuning);
      // If the current tuning belongs to a different instrument, reset to the
      // new instrument's default tuning. Otherwise keep the user's choice.
      const nextTuning =
        currentTuning?.instrumentId === id ? currentTuning.id : instrument.defaultTuningId;
      const currentCapo = get().capo;
      const nextCapo = Math.max(0, Math.min(instrument.fretCount, currentCapo));
      set({
        instrumentId: id,
        tuning: nextTuning,
        capo: nextCapo,
      });
      persist();
    },

    setMode: (mode) => {
      const currentType = get().type;
      // Switching modes usually invalidates the type; reset to a sensible default.
      const nextType = isValidTypeForMode(mode, currentType) ? currentType : defaultTypeForMode(mode);
      // CAGED shape applies to scales and arpeggios. Clear it when entering Notes
      // mode so a hidden filter doesn't follow the user there.
      const nextShapeId = mode === 'notes' ? null : get().shapeId;
      set({ mode, type: nextType, shapeId: nextShapeId });
      persist();
    },
    setKey: (key) => {
      set({ key });
      persist();
    },
    setType: (type) => {
      set({ type });
      persist();
    },
    setTuning: (tuning) => {
      // Defensive: only accept tunings that match the active instrument.
      const t = getTuning(tuning);
      const currentInstrument = get().instrumentId;
      if (t && t.instrumentId !== currentInstrument) return;
      set({ tuning });
      persist();
    },
    setCapo: (capo) => {
      const instrument = getInstrument(get().instrumentId);
      const max = instrument?.fretCount ?? 22;
      set({ capo: Math.max(0, Math.min(max, capo)) });
      persist();
    },
    setLabels: (labels) => {
      set({ labels });
      persist();
    },
    setShapeId: (shapeId) => {
      // Meaningful in scales and arpeggios modes — silently ignored in notes mode.
      const mode = get().mode;
      if (mode !== 'scales' && mode !== 'arpeggios' && shapeId !== null) return;
      set({ shapeId });
      persist();
    },
    setHandedness: (handedness) => updateSettings({ handedness }),
    setColorByDegree: (colorByDegree) => updateSettings({ colorByDegree }),
    setHighlightRoot: (highlightRoot) => updateSettings({ highlightRoot }),
    setShowGhostMarkers: (showGhostMarkers) => updateSettings({ showGhostMarkers }),

    reset: () => {
      set(DEFAULT_STATE);
      persist();
    },
  };
});

// Reference DEFAULT_INSTRUMENT_ID so it's not orphaned on imports
void DEFAULT_INSTRUMENT_ID;
