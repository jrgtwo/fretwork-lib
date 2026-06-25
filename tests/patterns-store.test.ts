import { describe, it, expect, beforeEach } from 'vitest';
import { usePatternsStore, DEFAULT_PATTERNS_STATE, selectEditingPattern } from '../src/patterns/store/usePatternsStore';
import { PPQ } from '../src/patterns';
import type { CagedInsertPlan } from '../src/patterns/caged-insert';
import { ticksPerBar } from '../src/patterns/timebase';

beforeEach(() => {
  // Reset state and clear persisted storage so each test starts clean.
  // sessionStorage is the actual backend since the anon-privacy change;
  // clear localStorage too for hygiene.
  localStorage.clear();
  sessionStorage.clear();
  usePatternsStore.setState({
    ...DEFAULT_PATTERNS_STATE,
  });
});

describe('usePatternsStore', () => {
  it('createPattern adds to library and opens it for editing', () => {
    const { createPattern } = usePatternsStore.getState();
    const id = createPattern('riff');
    const s = usePatternsStore.getState();
    expect(s.library.patterns).toHaveLength(1);
    expect(s.library.patterns[0].id).toBe(id);
    expect(s.library.patterns[0].name).toBe('riff');
    expect(s.editingPatternId).toBe(id);
  });

  it('stampAt commits an event and advances cursor by step length', () => {
    const { createPattern, setStepLength, stampAt } = usePatternsStore.getState();
    createPattern();
    setStepLength('quarter');
    stampAt({ stringIndex: 0, fret: 5 }, false);
    const s = usePatternsStore.getState();
    const pat = selectEditingPattern(s)!;
    expect(pat.events).toHaveLength(1);
    expect(pat.events[0].fret).toBe(5);
    expect(s.cursorTick).toBe(PPQ);
  });

  it('chord stamping freezes cursor until flushChordStamp is called', () => {
    const { createPattern, setStepLength, stampAt, flushChordStamp } = usePatternsStore.getState();
    createPattern();
    setStepLength('eighth');
    stampAt({ stringIndex: 0, fret: 3 }, true);
    stampAt({ stringIndex: 1, fret: 5 }, true);
    stampAt({ stringIndex: 2, fret: 7 }, true);
    let s = usePatternsStore.getState();
    expect(s.cursorTick).toBe(0);
    expect(selectEditingPattern(s)!.events).toHaveLength(3);
    flushChordStamp();
    s = usePatternsStore.getState();
    expect(s.cursorTick).toBe(PPQ / 2);
  });

  it('rest advances cursor without stamping', () => {
    const { createPattern, setStepLength, rest } = usePatternsStore.getState();
    createPattern();
    setStepLength('sixteenth');
    rest();
    const s = usePatternsStore.getState();
    expect(s.cursorTick).toBe(PPQ / 4);
    expect(selectEditingPattern(s)!.events).toHaveLength(0);
  });

  it('addPlacement deep-copies the source pattern (snapshot)', () => {
    const { createPattern, createComposition, stampAt, openPatternForEditing, addPlacement } = usePatternsStore.getState();
    const patId = createPattern();
    stampAt({ stringIndex: 0, fret: 3 }, false);
    const compId = createComposition();
    const placementId = addPlacement(patId)!;
    // Edit the source pattern.
    openPatternForEditing(patId);
    usePatternsStore.getState().stampAt({ stringIndex: 1, fret: 5 }, false);
    // The placement's snapshot must NOT have the new event.
    const s = usePatternsStore.getState();
    const comp = s.library.compositions.find((c) => c.id === compId)!;
    const placement = comp.tracks[0].placements.find((p) => p.id === placementId)!;
    expect(placement.patternSnapshot.events).toHaveLength(1);
    expect(placement.patternSnapshot.events[0].fret).toBe(3);
  });

  it('editing a placement does not propagate back to the library pattern', () => {
    const { createPattern, createComposition, stampAt, addPlacement, openPlacementForEditing } = usePatternsStore.getState();
    const patId = createPattern();
    stampAt({ stringIndex: 0, fret: 3 }, false);
    const compId = createComposition();
    const placementId = addPlacement(patId)!;
    // Open the placement; stamp a new event into the snapshot.
    openPlacementForEditing(compId, placementId);
    usePatternsStore.getState().stampAt({ stringIndex: 5, fret: 7 }, false);
    const s = usePatternsStore.getState();
    // Library pattern unchanged.
    const libPat = s.library.patterns.find((p) => p.id === patId)!;
    expect(libPat.events).toHaveLength(1);
    expect(libPat.events[0].fret).toBe(3);
    // Placement snapshot has both events.
    const comp = s.library.compositions.find((c) => c.id === compId)!;
    const placement = comp.tracks[0].placements.find((p) => p.id === placementId)!;
    expect(placement.patternSnapshot.events).toHaveLength(2);
  });

  it('deletePattern clears editingPatternId when the deleted pattern was open', () => {
    const { createPattern, deletePattern } = usePatternsStore.getState();
    const id = createPattern();
    deletePattern(id);
    const s = usePatternsStore.getState();
    expect(s.library.patterns).toHaveLength(0);
    expect(s.editingPatternId).toBeNull();
  });

  it('selectEvents in replace mode overwrites selection', () => {
    const { createPattern, stampAt, selectEvents } = usePatternsStore.getState();
    createPattern();
    stampAt({ stringIndex: 0, fret: 3 }, false);
    stampAt({ stringIndex: 0, fret: 5 }, false);
    const s = usePatternsStore.getState();
    const ev = selectEditingPattern(s)!.events;
    selectEvents([ev[0].id], 'replace');
    expect(usePatternsStore.getState().selectedEventIds).toEqual([ev[0].id]);
    selectEvents([ev[1].id], 'replace');
    expect(usePatternsStore.getState().selectedEventIds).toEqual([ev[1].id]);
  });

  it('deleteEvents purges selection of deleted event ids', () => {
    const { createPattern, stampAt, selectEvents, deleteEvents } = usePatternsStore.getState();
    createPattern();
    stampAt({ stringIndex: 0, fret: 3 }, false);
    const ev = selectEditingPattern(usePatternsStore.getState())!.events[0];
    selectEvents([ev.id], 'replace');
    deleteEvents([ev.id]);
    expect(usePatternsStore.getState().selectedEventIds).toEqual([]);
  });

  it('setStepLength does not move cursor', () => {
    const { createPattern, setStepLength, stampAt } = usePatternsStore.getState();
    createPattern();
    setStepLength('quarter');
    stampAt({ stringIndex: 0, fret: 0 }, false);
    expect(usePatternsStore.getState().cursorTick).toBe(PPQ);
    setStepLength('sixteenth');
    expect(usePatternsStore.getState().cursorTick).toBe(PPQ);
  });

  describe('groove/bpm editing actions', () => {
    it('setEditingPatternSuggestedBpm writes through to the library entry', () => {
      const store = usePatternsStore.getState();
      store.ensureEditingPattern();
      const editingId = usePatternsStore.getState().editingPatternId!;
      usePatternsStore.getState().setEditingPatternSuggestedBpm(95);
      const p = usePatternsStore
        .getState()
        .library.patterns.find((x) => x.id === editingId);
      expect(p?.suggestedBpm).toBe(95);
    });
  });
});

describe('usePatternsStore.stampCagedPlan', () => {
  it('stamps notes at the cursor and advances cursor by totalTicks', () => {
    const { createPattern, setCursorTick, stampCagedPlan } = usePatternsStore.getState();
    const id = createPattern('t');
    setCursorTick(0);
    const plan: CagedInsertPlan = {
      notes: [
        { stringIndex: 0, fret: 3, startTickOffset: 0, durationTicks: 240 },
        { stringIndex: 1, fret: 5, startTickOffset: 240, durationTicks: 240 },
      ],
      totalTicks: 480,
    };
    stampCagedPlan(plan);
    const s = usePatternsStore.getState();
    const pat = s.library.patterns.find((p) => p.id === id)!;
    expect(pat.events.map((e) => ({ s: e.stringIndex, f: e.fret, t: e.startTick }))).toEqual([
      { s: 0, f: 3, t: 0 },
      { s: 1, f: 5, t: 240 },
    ]);
    expect(s.cursorTick).toBe(480);
  });

  it('extends pattern duration to next bar when stamping past the end', () => {
    const { createPattern, setCursorTick, stampCagedPlan } = usePatternsStore.getState();
    const id = createPattern('t');
    const pat0 = usePatternsStore.getState().library.patterns.find((p) => p.id === id)!;
    const tpb = ticksPerBar(pat0.timeSignature);
    setCursorTick(pat0.durationTicks - 240);
    const plan: CagedInsertPlan = {
      notes: [
        { stringIndex: 0, fret: 3, startTickOffset: 0, durationTicks: 240 },
        { stringIndex: 0, fret: 5, startTickOffset: 240, durationTicks: 240 },
        { stringIndex: 0, fret: 7, startTickOffset: 480, durationTicks: 240 },
      ],
      totalTicks: 720,
    };
    stampCagedPlan(plan);
    const pat = usePatternsStore.getState().library.patterns.find((p) => p.id === id)!;
    expect(pat.durationTicks % tpb).toBe(0);
    expect(pat.durationTicks).toBeGreaterThanOrEqual(pat0.durationTicks - 240 + 720);
  });

  it('skips conflicting notes silently and still advances cursor by totalTicks', () => {
    const { createPattern, setCursorTick, stampAt, stampCagedPlan } = usePatternsStore.getState();
    const id = createPattern('t');
    setCursorTick(0);
    stampAt({ stringIndex: 0, fret: 1 }, false);
    setCursorTick(0);
    const plan: CagedInsertPlan = {
      notes: [
        { stringIndex: 0, fret: 99, startTickOffset: 0, durationTicks: 240 }, // conflicts
        { stringIndex: 1, fret: 7, startTickOffset: 240, durationTicks: 240 },
      ],
      totalTicks: 480,
    };
    stampCagedPlan(plan);
    const s = usePatternsStore.getState();
    const pat = s.library.patterns.find((p) => p.id === id)!;
    expect(pat.events.find((e) => e.fret === 99)).toBeUndefined();
    expect(pat.events.find((e) => e.stringIndex === 1 && e.fret === 7)).toBeDefined();
    expect(s.cursorTick).toBe(480);
  });

  it('is a no-op when the plan is empty', () => {
    const { createPattern, stampCagedPlan } = usePatternsStore.getState();
    createPattern('t');
    const tickBefore = usePatternsStore.getState().cursorTick;
    stampCagedPlan({ notes: [], totalTicks: 0 });
    expect(usePatternsStore.getState().cursorTick).toBe(tickBefore);
  });
});

describe('placement transpose / resize / composition loop', () => {
  function setupCompositionWithPlacement(): { compId: string; placementId: string } {
    const store = usePatternsStore.getState();
    const patId = store.createPattern('p');
    const compId = store.createComposition('c');
    store.openCompositionForArranging(compId);
    const placementId = store.addPlacement(patId);
    if (!placementId) throw new Error('addPlacement returned null');
    return { compId, placementId };
  }

  it('setPlacementTranspose writes through the store', () => {
    const { compId, placementId } = setupCompositionWithPlacement();
    usePatternsStore.getState().setPlacementTranspose(placementId, 7);
    const comp = usePatternsStore.getState().library.compositions.find((c) => c.id === compId)!;
    const placement = comp.tracks[0].placements.find((p) => p.id === placementId)!;
    expect(placement.transposeSemitones).toBe(7);
  });

  it('resizePlacement collapses legacy repeat', () => {
    const { compId, placementId } = setupCompositionWithPlacement();
    usePatternsStore.getState().setPlacementRepeat(placementId, 3);
    let comp = usePatternsStore.getState().library.compositions.find((c) => c.id === compId)!;
    const tpb = ticksPerBar(comp.timeSignature);
    usePatternsStore.getState().resizePlacement(placementId, tpb * 2);
    comp = usePatternsStore.getState().library.compositions.find((c) => c.id === compId)!;
    const placement = comp.tracks[0].placements.find((p) => p.id === placementId)!;
    expect(placement.lengthTicks).toBe(tpb * 2);
    expect(placement.repeat).toBe(1);
  });

  it('setCompositionLoop toggles', () => {
    const { compId } = setupCompositionWithPlacement();
    usePatternsStore.getState().setCompositionLoop(compId, true);
    const comp = usePatternsStore.getState().library.compositions.find((c) => c.id === compId)!;
    expect(comp.loop).toBe(true);
  });
});

describe('setEditingPatternKeyScale', () => {
  it('sets both key and scaleType', () => {
    const { createPattern, setEditingPatternKeyScale } = usePatternsStore.getState();
    const id = createPattern('t');
    setEditingPatternKeyScale('A', 'major');
    const pat = usePatternsStore.getState().library.patterns.find((p) => p.id === id)!;
    expect(pat.key).toBe('A');
    expect(pat.scaleType).toBe('major');
  });

  it('clearing key also clears scaleType', () => {
    const { createPattern, setEditingPatternKeyScale } = usePatternsStore.getState();
    const id = createPattern('t');
    setEditingPatternKeyScale('A', 'major');
    setEditingPatternKeyScale(null, null);
    const pat = usePatternsStore.getState().library.patterns.find((p) => p.id === id)!;
    expect(pat.key).toBeNull();
    expect(pat.scaleType).toBeNull();
  });

  it('setting a key without a scaleType defaults scaleType to major', () => {
    const { createPattern, setEditingPatternKeyScale } = usePatternsStore.getState();
    const id = createPattern('t');
    setEditingPatternKeyScale('C', null);
    const pat = usePatternsStore.getState().library.patterns.find((p) => p.id === id)!;
    expect(pat.key).toBe('C');
    expect(pat.scaleType).toBe('major');
  });
});
