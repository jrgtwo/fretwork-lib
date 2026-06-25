/**
 * useMetronome — React-friendly wrapper around the shared Metronome singleton.
 *
 * IMPORTANT: there is exactly ONE Metronome instance per app, lazily created on first
 * use and shared across every component that calls this hook. This is intentional —
 * a metronome is logically a global resource (one tempo, one beat, one audio output),
 * and creating one per hook call would mean multiple instances all scheduling
 * independently on Tone's global Transport, producing double-clicks and desync.
 *
 * Pass `events` to react to ticks/accents/measures from your component:
 *
 *   const m = useMetronome({
 *     events: {
 *       tick: (e) => console.log('beat', e.beat),
 *       measure: () => switchToNextScale(),
 *     }
 *   });
 *
 * Each hook subscribes its own event handlers on mount and unsubscribes on unmount —
 * the underlying singleton is never disposed.
 */
import { useEffect, useRef, useCallback, useMemo } from 'react';
import { Metronome } from './Metronome';
import type { MetronomeEvents, MetronomeOptions, SubdivisionId, TimeSignature } from './types';
import { getTimeSignature } from './time-signatures';
import { useMetronomeStore } from './useMetronomeStore';

export interface UseMetronomeReturn {
  isRunning: boolean;
  currentBeat: number;
  currentMeasure: number;
  currentSubdivisionIndex: number;
  bpm: number;
  timeSignature: TimeSignature;
  accents: readonly number[];
  accentEnabled: boolean;
  clickMuted: boolean;
  volume: number;
  subdivision: SubdivisionId;
  swing: number;
  start: () => Promise<void>;
  stop: () => void;
  toggle: () => Promise<void>;
  setBpm: (bpm: number) => void;
  setTimeSignature: (id: string) => void;
  setAccents: (accents: readonly number[]) => void;
  setAccentEnabled: (enabled: boolean) => void;
  toggleAccentEnabled: () => void;
  setClickMuted: (muted: boolean) => void;
  toggleClickMuted: () => void;
  setVolume: (v: number) => void;
  setSubdivision: (id: SubdivisionId) => void;
  setSwing: (swing: number) => void;
  /** The shared Metronome instance, for advanced usage (e.g. sample override). */
  metronome: Metronome | null;
}

interface UseMetronomeOptions
  extends Omit<
    MetronomeOptions,
    'bpm' | 'timeSignature' | 'accents' | 'accentEnabled' | 'volume' | 'subdivision' | 'swing'
  > {
  /** Additional event handlers (in addition to those wiring the store). */
  events?: MetronomeEvents;
}

// ─── Singleton management ──────────────────────────────────────────────────────

let sharedMetronome: Metronome | null = null;

function ensureSharedMetronome(): Metronome | null {
  if (typeof window === 'undefined') return null;
  if (sharedMetronome) return sharedMetronome;

  const initial = useMetronomeStore.getState();
  const initialTs = getTimeSignature(initial.timeSignatureId);
  const accents = initial.accents.length > 0
    ? initial.accents
    : (initialTs?.defaultAccents ?? [0]);

  sharedMetronome = new Metronome({
    bpm: initial.bpm,
    timeSignature: initial.timeSignatureId,
    accents,
    accentEnabled: initial.accentEnabled,
    muted: initial.clickMuted,
    volume: initial.volume,
    subdivision: initial.subdivision,
    swing: initial.swing,
  });

  // Sync metronome → store: every tick, push beat/measure into the store so any
  // component reading the store stays in lockstep with the audio loop. Subdivision
  // ticks update only the sub-index counter so the strip's sub-dots can flash.
  sharedMetronome.on('tick', (e) => {
    useMetronomeStore.setState({
      currentBeat: e.beat,
      currentMeasure: e.measure,
      currentSubdivisionIndex: 0,
    });
  });
  sharedMetronome.on('subdivision', (e) => {
    useMetronomeStore.setState({
      currentSubdivisionIndex: e.subdivisionIndex,
    });
  });
  sharedMetronome.on('start', () => {
    useMetronomeStore.setState({ isRunning: true });
  });
  sharedMetronome.on('stop', () => {
    useMetronomeStore.setState({
      isRunning: false,
      currentBeat: -1,
      currentMeasure: -1,
      currentSubdivisionIndex: -1,
    });
  });

  // Sync store → metronome: when any consumer changes BPM, time signature, accents,
  // accentEnabled, or volume in the store, push it to the singleton.
  useMetronomeStore.subscribe((state, prev) => {
    const m = sharedMetronome;
    if (!m) return;
    if (state.bpm !== prev.bpm) m.setBpm(state.bpm);
    if (state.timeSignatureId !== prev.timeSignatureId) {
      m.setTimeSignature(state.timeSignatureId);
    }
    // Accents may need a refresh either when the explicit array changes OR when the
    // time signature changes (which clears the override and falls back to defaults).
    if (state.accents !== prev.accents || state.timeSignatureId !== prev.timeSignatureId) {
      const ts = getTimeSignature(state.timeSignatureId);
      const next = state.accents.length > 0
        ? state.accents
        : (ts?.defaultAccents ?? [0]);
      m.setAccents(next);
    }
    if (state.accentEnabled !== prev.accentEnabled) m.setAccentEnabled(state.accentEnabled);
    if (state.clickMuted !== prev.clickMuted) m.setMuted(state.clickMuted);
    if (state.volume !== prev.volume) m.setVolume(state.volume);
    if (state.subdivision !== prev.subdivision) m.setSubdivision(state.subdivision);
    if (state.swing !== prev.swing) m.setSwing(state.swing);
  });

  return sharedMetronome;
}

// ─── The hook ──────────────────────────────────────────────────────────────────

export function useMetronome(options: UseMetronomeOptions = {}): UseMetronomeReturn {
  // Trigger singleton creation. Memoized once per render; the function itself returns
  // the same instance on every call.
  const metronome = useMemo(() => ensureSharedMetronome(), []);

  // Reactive store reads.
  const bpm = useMetronomeStore((s) => s.bpm);
  const timeSignatureId = useMetronomeStore((s) => s.timeSignatureId);
  const storeAccents = useMetronomeStore((s) => s.accents);
  const accentEnabled = useMetronomeStore((s) => s.accentEnabled);
  const clickMuted = useMetronomeStore((s) => s.clickMuted);
  const volume = useMetronomeStore((s) => s.volume);
  const subdivision = useMetronomeStore((s) => s.subdivision);
  const swing = useMetronomeStore((s) => s.swing);
  const isRunning = useMetronomeStore((s) => s.isRunning);
  const currentBeat = useMetronomeStore((s) => s.currentBeat);
  const currentMeasure = useMetronomeStore((s) => s.currentMeasure);
  const currentSubdivisionIndex = useMetronomeStore((s) => s.currentSubdivisionIndex);

  const setStoreBpm = useMetronomeStore((s) => s.setBpm);
  const setStoreTimeSignatureId = useMetronomeStore((s) => s.setTimeSignatureId);
  const setStoreAccents = useMetronomeStore((s) => s.setAccents);
  const setStoreAccentEnabled = useMetronomeStore((s) => s.setAccentEnabled);
  const toggleStoreAccentEnabled = useMetronomeStore((s) => s.toggleAccentEnabled);
  const setStoreClickMuted = useMetronomeStore((s) => s.setClickMuted);
  const toggleStoreClickMuted = useMetronomeStore((s) => s.toggleClickMuted);
  const setStoreVolume = useMetronomeStore((s) => s.setVolume);
  const setStoreSubdivision = useMetronomeStore((s) => s.setSubdivision);
  const setStoreSwing = useMetronomeStore((s) => s.setSwing);

  // Resolve TimeSignature object once per id change.
  const timeSignature = useMemo(
    () => getTimeSignature(timeSignatureId)!,
    [timeSignatureId],
  );

  // Effective accents — empty array in the store means "use defaults".
  const effectiveAccents = storeAccents.length > 0 ? storeAccents : timeSignature.defaultAccents;

  // User-supplied event handlers — kept in a ref so we can call latest without
  // re-subscribing on every render.
  const userEventsRef = useRef<MetronomeEvents | undefined>(options.events);
  userEventsRef.current = options.events;

  // Subscribe THIS hook instance's user-supplied event handlers to the singleton.
  // Each hook adds its own listener; multiple hook callers can have independent events.
  useEffect(() => {
    if (!metronome) return;
    const offs: Array<() => void> = [];
    offs.push(metronome.on('tick', (e) => userEventsRef.current?.tick?.(e)));
    offs.push(metronome.on('accent', (e) => userEventsRef.current?.accent?.(e)));
    offs.push(metronome.on('measure', (e) => userEventsRef.current?.measure?.(e)));
    offs.push(metronome.on('subdivision', (e) => userEventsRef.current?.subdivision?.(e)));
    offs.push(metronome.on('start', () => userEventsRef.current?.start?.()));
    offs.push(metronome.on('stop', () => userEventsRef.current?.stop?.()));
    offs.push(metronome.on('bpmChange', (b) => userEventsRef.current?.bpmChange?.(b)));
    offs.push(metronome.on('timeSignatureChange', (ts) => userEventsRef.current?.timeSignatureChange?.(ts)));
    offs.push(metronome.on('subdivisionChange', (s) => userEventsRef.current?.subdivisionChange?.(s)));
    offs.push(metronome.on('swingChange', (s) => userEventsRef.current?.swingChange?.(s)));
    return () => {
      for (const off of offs) off();
    };
  }, [metronome]);

  // One-time application of consumer-supplied custom sounds. The singleton is shared,
  // so the last caller's sounds win — that's acceptable for v1 (typically only one
  // place in the app overrides sounds).
  useEffect(() => {
    if (!metronome || !options.sounds) return;
    metronome.setSounds(options.sounds);
  }, [metronome, options.sounds]);

  const start = useCallback(async () => {
    if (metronome) await metronome.start();
  }, [metronome]);
  const stop = useCallback(() => { metronome?.stop(); }, [metronome]);
  const toggle = useCallback(async () => {
    if (!metronome) return;
    if (metronome.isRunning) metronome.stop();
    else await metronome.start();
  }, [metronome]);

  return {
    isRunning,
    currentBeat,
    currentMeasure,
    currentSubdivisionIndex,
    bpm,
    timeSignature,
    accents: effectiveAccents,
    accentEnabled,
    clickMuted,
    volume,
    subdivision,
    swing,
    start,
    stop,
    toggle,
    setBpm: setStoreBpm,
    setTimeSignature: setStoreTimeSignatureId,
    setAccents: setStoreAccents,
    setAccentEnabled: setStoreAccentEnabled,
    toggleAccentEnabled: toggleStoreAccentEnabled,
    setClickMuted: setStoreClickMuted,
    toggleClickMuted: toggleStoreClickMuted,
    setVolume: setStoreVolume,
    setSubdivision: setStoreSubdivision,
    setSwing: setStoreSwing,
    metronome,
  };
}

/**
 * Reset the shared Metronome — for tests only. Disposes the current singleton so the
 * next ensureSharedMetronome() call builds a fresh one.
 */
export function _resetSharedMetronomeForTests(): void {
  sharedMetronome?.dispose();
  sharedMetronome = null;
}
