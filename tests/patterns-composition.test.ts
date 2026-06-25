import { describe, it, expect } from 'vitest';
import type { Composition, Placement, Pattern } from '../src/patterns';
import {
  createEmptyPattern,
  createEmptyComposition,
  stampEvent,
  addPlacement,
  addPlacementToTrack,
  addTrack,
  setPlacementRepeat,
  removePlacement,
  movePlacement,
  totalDurationTicks,
  flattenComposition,
  placementEffectiveLength,
  setCompositionTempoMode,
  setCompositionGroove,
  setCompositionGrooveMode,
  setPlacementTranspose,
  resizePlacement,
  setCompositionLoop,
  ticksPerBar,
  PPQ,
} from '../src/patterns';

/** Test-helper: placements live on `tracks[*].placements` after the multi-
 *  track migration. This convenience function flattens them across all
 *  tracks for read-side assertions, preserving authored order. Mirrors the
 *  legacy `comp.placements` array. */
function placementsOf(comp: Composition): Placement[] {
  return (comp.tracks ?? []).flatMap((t) => t.placements);
}

/** Test-helper: clone the composition with `mutator(placement)` applied to
 *  the placement matching `placementId`. Used by tests that intentionally
 *  bypass the public ops to construct edge cases for `flattenComposition`. */
function mutatePlacement(
  comp: Composition,
  placementId: string,
  mutator: (p: Placement) => Placement,
): Composition {
  return {
    ...comp,
    tracks: comp.tracks.map((t) => ({
      ...t,
      placements: t.placements.map((p) => (p.id === placementId ? mutator(p) : p)),
    })),
  };
}

describe('composition-ops', () => {
  describe('createEmptyComposition', () => {
    it('seeds empty automation tracks and null sourceIR by default', () => {
      const c = createEmptyComposition();
      expect(c.tempoTrack).toEqual([]);
      expect(c.timeSignatureTrack).toEqual([]);
      expect(c.sourceIR).toBeNull();
    });
  });

  describe('addPlacement', () => {
    it('deep-copies the pattern so library edits do not propagate', () => {
      let pat = createEmptyPattern('source');
      pat = stampEvent({ pattern: pat, stringIndex: 0, fret: 5, startTick: 0, durationTicks: PPQ }).pattern;
      let comp = createEmptyComposition();
      const { composition: c1, placement } = addPlacement(comp, pat);
      // Mutating the library pattern's events should not affect the placement.
      pat.events[0].fret = 99;
      const placed = placementsOf(c1).find((p) => p.id === placement.id)!;
      expect(placed.patternSnapshot.events[0].fret).toBe(5);
    });

    it('appends at end of composition by default', () => {
      let p1 = createEmptyPattern('A');
      p1 = stampEvent({ pattern: p1, stringIndex: 0, fret: 0, startTick: 0, durationTicks: PPQ }).pattern;
      let p2 = createEmptyPattern('B');
      p2 = stampEvent({ pattern: p2, stringIndex: 0, fret: 0, startTick: 0, durationTicks: PPQ }).pattern;
      let comp = createEmptyComposition();
      ({ composition: comp } = addPlacement(comp, p1));
      ({ composition: comp } = addPlacement(comp, p2));
      expect(placementsOf(comp)).toHaveLength(2);
      expect(placementsOf(comp)[0].startTick).toBe(0);
      expect(placementsOf(comp)[1].startTick).toBe(p1.durationTicks);
    });

    it('preserves authoritative startTick across subsequent edits', async () => {
      // Regression: in the new free-placement model, adding a placement at
      // an explicit atTick must not get re-derived on the next mutation.
      const p = createEmptyPattern();
      let comp = createEmptyComposition();
      const trackId = comp.tracks[0].id;
      const r1 = addPlacementToTrack(comp, trackId, p, p.durationTicks * 3);
      comp = r1.composition;
      const id1 = r1.placement!.id;
      expect(comp.tracks[0].placements[0].startTick).toBe(p.durationTicks * 3);
      // A second placement appended via the default (no atTick) shouldn't
      // alter the first one's startTick.
      const r2 = addPlacementToTrack(comp, trackId, p);
      comp = r2.composition;
      const first = comp.tracks[0].placements.find((pl) => pl.id === id1)!;
      expect(first.startTick).toBe(p.durationTicks * 3);
    });
  });

  describe('setPlacementRepeat', () => {
    it('pushes downstream placements when increasing repeat overlaps the neighbor', () => {
      let p = createEmptyPattern();
      let comp = createEmptyComposition();
      let placementAId = '';
      let placementBId = '';
      ({ composition: comp, placement: { id: placementAId } } = addPlacement(comp, p));
      ({ composition: comp, placement: { id: placementBId } } = addPlacement(comp, p));
      const beforeB = placementsOf(comp).find((pl) => pl.id === placementBId)!;
      expect(beforeB.startTick).toBe(p.durationTicks);
      comp = setPlacementRepeat(comp, placementAId, 3);
      // A now spans [0, 3 * durationTicks). B must be at >= 3 * durationTicks.
      const afterB = placementsOf(comp).find((pl) => pl.id === placementBId)!;
      expect(afterB.startTick).toBe(p.durationTicks * 3);
    });

    it('leaves the gap when decreasing repeat', () => {
      let p = createEmptyPattern();
      let comp = createEmptyComposition();
      let placementAId = '';
      let placementBId = '';
      ({ composition: comp, placement: { id: placementAId } } = addPlacement(comp, p));
      ({ composition: comp, placement: { id: placementBId } } = addPlacement(comp, p));
      // Set A's repeat to 3 → B pushes out to 3 * durationTicks.
      comp = setPlacementRepeat(comp, placementAId, 3);
      // Drop A back to repeat 1 → A spans [0, durationTicks). B stays at
      // 3 * durationTicks (gap is the user's, not auto-closed).
      comp = setPlacementRepeat(comp, placementAId, 1);
      const afterB = placementsOf(comp).find((pl) => pl.id === placementBId)!;
      expect(afterB.startTick).toBe(p.durationTicks * 3);
    });
  });

  describe('removePlacement', () => {
    it('leaves the gap behind (no reflow)', () => {
      let p = createEmptyPattern();
      let comp = createEmptyComposition();
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const { composition: c2, placement } = addPlacement(comp, p);
        comp = c2;
        ids.push(placement.id);
      }
      // Three placements at 0, durationTicks, 2*durationTicks.
      comp = removePlacement(comp, ids[1]);
      expect(placementsOf(comp)).toHaveLength(2);
      // First placement still at 0; third (now second in array) still at
      // 2*durationTicks — a gap exists at [durationTicks, 2*durationTicks).
      const sorted = [...placementsOf(comp)].sort((a, b) => a.startTick - b.startTick);
      expect(sorted[0].startTick).toBe(0);
      expect(sorted[1].startTick).toBe(p.durationTicks * 2);
    });
  });

  describe('movePlacement (cross-lane scenarios)', () => {
    function buildTwoTrackComp(aCount: number, bCount: number) {
      const p = createEmptyPattern();
      let comp = createEmptyComposition();
      comp = addTrack(comp, 'Track 2');
      const trackAId = comp.tracks[0].id;
      const trackBId = comp.tracks[1].id;
      const aIds: string[] = [];
      const bIds: string[] = [];
      for (let i = 0; i < aCount; i++) {
        const r = addPlacementToTrack(comp, trackAId, p);
        comp = r.composition;
        aIds.push(r.placement!.id);
      }
      for (let i = 0; i < bCount; i++) {
        const r = addPlacementToTrack(comp, trackBId, p);
        comp = r.composition;
        bIds.push(r.placement!.id);
      }
      return { comp, trackAId, trackBId, aIds, bIds, patternDur: p.durationTicks };
    }

    it('moves a placement from a populated track to an empty track', () => {
      let { comp, trackBId, aIds } = buildTwoTrackComp(2, 0);
      comp = movePlacement(comp, aIds[0], trackBId, 0);
      expect(comp.tracks[0].placements).toHaveLength(1);
      expect(comp.tracks[1].placements).toHaveLength(1);
      expect(comp.tracks[1].placements[0].startTick).toBe(0);
    });

    it('inserts at the requested tick on the destination lane', () => {
      let { comp, trackBId, aIds, bIds, patternDur } = buildTwoTrackComp(1, 2);
      // Drop A at the midpoint of B's first placement → should snap past it.
      const dropTick = Math.floor(patternDur / 2);
      comp = movePlacement(comp, aIds[0], trackBId, dropTick);
      // Source empty.
      expect(comp.tracks[0].placements).toHaveLength(0);
      // Destination has three: original B's two + the moved A in middle/end.
      expect(comp.tracks[1].placements).toHaveLength(3);
      // Sort invariant
      const sorted = comp.tracks[1].placements;
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].startTick).toBeGreaterThanOrEqual(sorted[i - 1].startTick);
      }
    });

    it('is a no-op when destTrackId does not exist', () => {
      const built = buildTwoTrackComp(2, 0);
      const next = movePlacement(built.comp, built.aIds[0], 'trk_bogus', 0);
      expect(next).toBe(built.comp);
    });
  });

  describe('placementEndTick', () => {
    it('returns startTick + effective length × repeat', async () => {
      const { placementEndTick } = await import('../src/patterns');
      const p = createEmptyPattern();
      let comp = createEmptyComposition();
      const r = addPlacement(comp, p);
      const placement = placementsOf(r.composition)[0];
      // Default: repeat=1, lengthTicks=null → endTick = startTick + snapshot.durationTicks
      expect(placementEndTick(placement)).toBe(placement.startTick + p.durationTicks);
      // Mutate to repeat=2 and lengthTicks halved: endTick = startTick + (durationTicks/2 * 2)
      const half = Math.floor(p.durationTicks / 2);
      const repeated = { ...placement, repeat: 2, lengthTicks: half };
      expect(placementEndTick(repeated)).toBe(placement.startTick + half * 2);
    });
  });

  describe('movePlacement', () => {
    it('places at the requested tick when there are no conflicts', async () => {
      const { movePlacement } = await import('../src/patterns');
      const p = createEmptyPattern();
      let comp = createEmptyComposition();
      const trackAId = comp.tracks[0].id;
      const r = addPlacementToTrack(comp, trackAId, p);
      comp = r.composition;
      const id = r.placement!.id;
      // Move to a far-future tick on the same track; no other blocks → no conflict.
      const targetTick = p.durationTicks * 5;
      comp = movePlacement(comp, id, trackAId, targetTick);
      const placed = placementsOf(comp).find((pl) => pl.id === id)!;
      expect(placed.startTick).toBe(targetTick);
    });

    it('clamps a negative destStartTick to 0', async () => {
      const { movePlacement } = await import('../src/patterns');
      const p = createEmptyPattern();
      let comp = createEmptyComposition();
      const trackAId = comp.tracks[0].id;
      const r = addPlacementToTrack(comp, trackAId, p);
      comp = r.composition;
      comp = movePlacement(comp, r.placement!.id, trackAId, -500);
      const placed = placementsOf(comp).find((pl) => pl.id === r.placement!.id)!;
      expect(placed.startTick).toBe(0);
    });

    it('snaps forward past a block whose body the drop lands inside', async () => {
      const { movePlacement } = await import('../src/patterns');
      const p = createEmptyPattern();
      let comp = createEmptyComposition();
      const trackAId = comp.tracks[0].id;
      // Block A at 0, length = p.durationTicks (so it occupies [0, p.durationTicks)).
      const aR = addPlacementToTrack(comp, trackAId, p);
      comp = aR.composition;
      // Block B (the one we'll move) added at end; will move into A's body.
      const bR = addPlacementToTrack(comp, trackAId, p);
      comp = bR.composition;
      // Drop B inside A's body (e.g., at the midpoint of A).
      const midA = Math.floor(p.durationTicks / 2);
      comp = movePlacement(comp, bR.placement!.id, trackAId, midA);
      const placed = placementsOf(comp).find((pl) => pl.id === bR.placement!.id)!;
      // Should snap to the end of A (i.e., to p.durationTicks).
      expect(placed.startTick).toBe(p.durationTicks);
    });

    it('clamps the moving block into the nearest free slot without pushing neighbors', async () => {
      const { movePlacement } = await import('../src/patterns');
      const p = createEmptyPattern();
      const dur = p.durationTicks;
      let comp = createEmptyComposition();
      const trackAId = comp.tracks[0].id;
      // Three sequential blocks A, B, C at 0, dur, 2*dur.
      const aR = addPlacementToTrack(comp, trackAId, p);
      comp = aR.composition;
      const bR = addPlacementToTrack(comp, trackAId, p);
      comp = bR.composition;
      const cR = addPlacementToTrack(comp, trackAId, p);
      comp = cR.composition;
      // Drop A into C's body (2.5*dur). With B and C occupying [dur, 3*dur), the
      // nearest free slot that fits is just past C → 3*dur. B and C don't move.
      comp = movePlacement(comp, aR.placement!.id, trackAId, Math.floor(2.5 * dur));
      const placements = comp.tracks[0].placements;
      const findBy = (id: string) => placements.find((pl) => pl.id === id)!;
      expect(placements).toHaveLength(3);
      expect(findBy(bR.placement!.id).startTick).toBe(dur); // neighbor unmoved
      expect(findBy(cR.placement!.id).startTick).toBe(2 * dur); // neighbor unmoved
      expect(findBy(aR.placement!.id).startTick).toBe(3 * dur); // clamped past C
      // Non-overlapping, sorted.
      const sorted = [...placements].sort((a, b) => a.startTick - b.startTick);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].startTick).toBeGreaterThanOrEqual(sorted[i - 1].startTick + dur);
      }
    });

    it('moves a placement to a different track at the given tick', async () => {
      const { movePlacement, addTrack } = await import('../src/patterns');
      const p = createEmptyPattern();
      let comp = createEmptyComposition();
      comp = addTrack(comp, 'Track 2');
      const trackAId = comp.tracks[0].id;
      const trackBId = comp.tracks[1].id;
      const aR = addPlacementToTrack(comp, trackAId, p);
      comp = aR.composition;
      // Move to track B at tick 0.
      comp = movePlacement(comp, aR.placement!.id, trackBId, 0);
      expect(comp.tracks[0].placements).toHaveLength(0); // gone from source
      expect(comp.tracks[1].placements).toHaveLength(1);
      expect(comp.tracks[1].placements[0].startTick).toBe(0);
    });

    it('keeps the destination track sorted by startTick', async () => {
      const { movePlacement } = await import('../src/patterns');
      const p = createEmptyPattern();
      let comp = createEmptyComposition();
      const trackAId = comp.tracks[0].id;
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const r = addPlacementToTrack(comp, trackAId, p);
        comp = r.composition;
        ids.push(r.placement!.id);
      }
      // Move the last block to tick 0.
      comp = movePlacement(comp, ids[2], trackAId, 0);
      const placements = comp.tracks[0].placements;
      for (let i = 1; i < placements.length; i++) {
        expect(placements[i].startTick).toBeGreaterThanOrEqual(placements[i - 1].startTick);
      }
    });

    it('is a no-op when placementId does not exist', async () => {
      const { movePlacement } = await import('../src/patterns');
      const p = createEmptyPattern();
      let comp = createEmptyComposition();
      const r = addPlacementToTrack(comp, comp.tracks[0].id, p);
      comp = r.composition;
      const before = comp;
      const after = movePlacement(comp, 'pl_bogus', comp.tracks[0].id, 1000);
      expect(after).toBe(before);
    });

    it('is a no-op when destTrackId does not exist', async () => {
      const { movePlacement } = await import('../src/patterns');
      const p = createEmptyPattern();
      let comp = createEmptyComposition();
      const r = addPlacementToTrack(comp, comp.tracks[0].id, p);
      comp = r.composition;
      const before = comp;
      const after = movePlacement(comp, r.placement!.id, 'trk_bogus', 0);
      expect(after).toBe(before);
    });
  });

  describe('splitPlacement', () => {
    it('splits a placement into two halves at the given tick', async () => {
      const { splitPlacement } = await import('../src/patterns');
      const p = createEmptyPattern();
      let comp = createEmptyComposition();
      const trackId = comp.tracks[0].id;
      const r = addPlacementToTrack(comp, trackId, p);
      comp = r.composition;
      const id = r.placement!.id;
      const splitAt = Math.floor(p.durationTicks / 2);
      // Split at midpoint of the placement (which starts at tick 0)
      comp = splitPlacement(comp, id, splitAt);
      const placements = comp.tracks[0].placements;
      expect(placements).toHaveLength(2);
      // Left half: startTick 0, length = splitAt
      expect(placements[0].startTick).toBe(0);
      expect(placements[0].lengthTicks).toBe(splitAt);
      // Right half: startTick = splitAt, length = (durationTicks - splitAt)
      expect(placements[1].startTick).toBe(splitAt);
      expect(placements[1].lengthTicks).toBe(p.durationTicks - splitAt);
      // Both share the same snapshot reference (non-destructive)
      expect(placements[0].patternSnapshot).toBe(placements[1].patternSnapshot);
      // Different ids
      expect(placements[0].id).not.toBe(placements[1].id);
    });

    it('collapses repeat to 1 on split', async () => {
      const { splitPlacement } = await import('../src/patterns');
      const p = createEmptyPattern();
      let comp = createEmptyComposition();
      const trackId = comp.tracks[0].id;
      const r = addPlacementToTrack(comp, trackId, p);
      comp = r.composition;
      const id = r.placement!.id;
      comp = setPlacementRepeat(comp, id, 3);
      // Now block plays 3x; splitting still collapses to repeat=1.
      const splitAt = Math.floor(p.durationTicks / 2);
      comp = splitPlacement(comp, id, splitAt);
      const placements = comp.tracks[0].placements;
      expect(placements).toHaveLength(2);
      expect(placements[0].repeat).toBe(1);
      expect(placements[1].repeat).toBe(1);
    });

    it('is a no-op when atTick is outside the placement range', async () => {
      const { splitPlacement } = await import('../src/patterns');
      const p = createEmptyPattern();
      let comp = createEmptyComposition();
      const trackId = comp.tracks[0].id;
      const r = addPlacementToTrack(comp, trackId, p);
      comp = r.composition;
      const before = comp;
      // atTick equal to startTick (left boundary) — no split.
      let after = splitPlacement(comp, r.placement!.id, 0);
      expect(after).toBe(before);
      // atTick past the end — no split.
      after = splitPlacement(comp, r.placement!.id, p.durationTicks + 100);
      expect(after).toBe(before);
    });

    it('is a no-op when placementId does not exist', async () => {
      const { splitPlacement } = await import('../src/patterns');
      let comp = createEmptyComposition();
      const before = comp;
      const after = splitPlacement(comp, 'pl_bogus', 100);
      expect(after).toBe(before);
    });
  });

  describe('duplicatePlacements', () => {
    it('clones a single placement with a tick offset', async () => {
      const { duplicatePlacements } = await import('../src/patterns');
      const p = createEmptyPattern();
      let comp = createEmptyComposition();
      const trackId = comp.tracks[0].id;
      const r = addPlacementToTrack(comp, trackId, p);
      comp = r.composition;
      const id = r.placement!.id;
      // Duplicate at +durationTicks (lands at end of original).
      comp = duplicatePlacements(comp, [id], p.durationTicks);
      expect(comp.tracks[0].placements).toHaveLength(2);
      const ids = comp.tracks[0].placements.map((pl) => pl.id);
      expect(new Set(ids).size).toBe(2); // unique ids
      // Both share the same snapshot reference
      expect(comp.tracks[0].placements[0].patternSnapshot).toBe(
        comp.tracks[0].placements[1].patternSnapshot,
      );
    });

    it('preserves relative offsets when duplicating multiple placements', async () => {
      const { duplicatePlacements } = await import('../src/patterns');
      const p = createEmptyPattern();
      let comp = createEmptyComposition();
      const trackId = comp.tracks[0].id;
      const a = addPlacementToTrack(comp, trackId, p);
      comp = a.composition;
      const b = addPlacementToTrack(comp, trackId, p);
      comp = b.composition;
      // Duplicate both by 4 × durationTicks (large enough to be past the
      // current pair so no conflict)
      const delta = p.durationTicks * 4;
      comp = duplicatePlacements(comp, [a.placement!.id, b.placement!.id], delta);
      expect(comp.tracks[0].placements).toHaveLength(4);
      // The duplicates' startTicks preserve the original spacing:
      const sorted = [...comp.tracks[0].placements].sort(
        (x, y) => x.startTick - y.startTick,
      );
      // First two are originals at 0 and durationTicks.
      expect(sorted[0].startTick).toBe(0);
      expect(sorted[1].startTick).toBe(p.durationTicks);
      // Duplicates at delta and delta + durationTicks
      expect(sorted[2].startTick).toBe(delta);
      expect(sorted[3].startTick).toBe(delta + p.durationTicks);
    });

    it('routes duplicates to destTrackId when provided', async () => {
      const { duplicatePlacements, addTrack } = await import('../src/patterns');
      const p = createEmptyPattern();
      let comp = createEmptyComposition();
      comp = addTrack(comp, 'Track 2');
      const trackAId = comp.tracks[0].id;
      const trackBId = comp.tracks[1].id;
      const r = addPlacementToTrack(comp, trackAId, p);
      comp = r.composition;
      comp = duplicatePlacements(comp, [r.placement!.id], 0, trackBId);
      expect(comp.tracks[0].placements).toHaveLength(1); // original stays on A
      expect(comp.tracks[1].placements).toHaveLength(1); // clone on B
      expect(comp.tracks[1].placements[0].startTick).toBe(0);
    });

    it('is a no-op when ids is empty', async () => {
      const { duplicatePlacements } = await import('../src/patterns');
      let comp = createEmptyComposition();
      const before = comp;
      const after = duplicatePlacements(comp, [], 100);
      expect(after).toBe(before);
    });

    it('skips ids that do not exist', async () => {
      const { duplicatePlacements } = await import('../src/patterns');
      const p = createEmptyPattern();
      let comp = createEmptyComposition();
      const r = addPlacementToTrack(comp, comp.tracks[0].id, p);
      comp = r.composition;
      const before = comp.tracks[0].placements.length;
      comp = duplicatePlacements(comp, ['pl_bogus', r.placement!.id], p.durationTicks * 4);
      // Only the valid id produced a clone
      expect(comp.tracks[0].placements.length).toBe(before + 1);
    });
  });

  describe('pushPlacementsForward', () => {
    it('returns the input array unchanged when byTicks <= 0', async () => {
      const { pushPlacementsForward } = await import('../src/patterns');
      const placements: Placement[] = [];
      expect(pushPlacementsForward(placements, 0, 0)).toBe(placements);
      expect(pushPlacementsForward(placements, 100, -50)).toBe(placements);
    });

    it('shifts every placement with startTick >= fromTick by byTicks', async () => {
      const { pushPlacementsForward, placementEndTick } = await import('../src/patterns');
      const p = createEmptyPattern();
      let comp = createEmptyComposition();
      const trackId = comp.tracks[0].id;
      const r1 = addPlacementToTrack(comp, trackId, p);
      comp = r1.composition;
      const r2 = addPlacementToTrack(comp, trackId, p);
      comp = r2.composition;
      const r3 = addPlacementToTrack(comp, trackId, p);
      comp = r3.composition;
      const placements = comp.tracks[0].placements;
      // First placement at 0, second at p.durationTicks, third at 2*p.durationTicks
      const fromTick = p.durationTicks; // includes second + third
      const byTicks = 200;
      const pushed = pushPlacementsForward(placements, fromTick, byTicks);
      expect(pushed[0].startTick).toBe(0); // untouched (before fromTick)
      expect(pushed[1].startTick).toBe(p.durationTicks + byTicks);
      expect(pushed[2].startTick).toBe(2 * p.durationTicks + byTicks);
      // End ticks also shift correctly
      expect(placementEndTick(pushed[1])).toBe(p.durationTicks + byTicks + p.durationTicks);
    });

    it('returns a new array (does not mutate input)', async () => {
      const { pushPlacementsForward } = await import('../src/patterns');
      const p = createEmptyPattern();
      let comp = createEmptyComposition();
      const r = addPlacementToTrack(comp, comp.tracks[0].id, p);
      comp = r.composition;
      const placements = comp.tracks[0].placements;
      const pushed = pushPlacementsForward(placements, 0, 100);
      expect(pushed).not.toBe(placements);
      expect(placements[0].startTick).toBe(0); // input untouched
    });
  });

  describe('totalDurationTicks', () => {
    it('sums each placement durationTicks * repeat', () => {
      let p = createEmptyPattern();
      let comp = createEmptyComposition();
      ({ composition: comp } = addPlacement(comp, p));
      comp = setPlacementRepeat(comp, placementsOf(comp)[0].id, 4);
      expect(totalDurationTicks(comp)).toBe(p.durationTicks * 4);
    });
  });

  describe('flattenComposition', () => {
    it('produces correctly-offset events including repeats', () => {
      let p = createEmptyPattern();
      p = stampEvent({ pattern: p, stringIndex: 0, fret: 5, startTick: 0, durationTicks: PPQ }).pattern;
      p = stampEvent({ pattern: p, stringIndex: 1, fret: 3, startTick: PPQ, durationTicks: PPQ }).pattern;
      let comp = createEmptyComposition();
      ({ composition: comp } = addPlacement(comp, p));
      comp = setPlacementRepeat(comp, placementsOf(comp)[0].id, 2);

      const events = flattenComposition(comp);
      // 2 events per repeat * 2 repeats = 4 events
      expect(events).toHaveLength(4);
      // First repeat: events at 0 and PPQ
      expect(events[0].startTick).toBe(0);
      expect(events[1].startTick).toBe(PPQ);
      // Second repeat: events at p.durationTicks and p.durationTicks + PPQ
      expect(events[2].startTick).toBe(p.durationTicks);
      expect(events[3].startTick).toBe(p.durationTicks + PPQ);
    });

    it('sorts events by startTick', () => {
      let p = createEmptyPattern();
      p = stampEvent({ pattern: p, stringIndex: 5, fret: 0, startTick: PPQ, durationTicks: PPQ }).pattern;
      p = stampEvent({ pattern: p, stringIndex: 0, fret: 0, startTick: 0, durationTicks: PPQ }).pattern;
      let comp = createEmptyComposition();
      ({ composition: comp } = addPlacement(comp, p));
      const events = flattenComposition(comp);
      for (let i = 1; i < events.length; i++) {
        expect(events[i].startTick).toBeGreaterThanOrEqual(events[i - 1].startTick);
      }
    });
  });
});

describe('createEmptyComposition with mode/groove defaults', () => {
  it("defaults tempoMode to 'global'", () => {
    const c = createEmptyComposition();
    expect(c.tempoMode).toBe('global');
  });

  it("defaults grooveMode to 'global'", () => {
    const c = createEmptyComposition();
    expect(c.grooveMode).toBe('global');
  });

  it('defaults groove to null', () => {
    const c = createEmptyComposition();
    expect(c.groove).toBeNull();
  });
});

describe('setCompositionTempoMode', () => {
  it("toggles between 'global' and 'inherit'", () => {
    const c = createEmptyComposition();
    expect(setCompositionTempoMode(c, 'inherit').tempoMode).toBe('inherit');
    expect(setCompositionTempoMode(c, 'global').tempoMode).toBe('global');
  });
});

describe('setCompositionGroove', () => {
  it('sets the groove', () => {
    const c = createEmptyComposition();
    const next = setCompositionGroove(c, { swing: 0.67, appliedTo: 'eighths' });
    expect(next.groove).toEqual({ swing: 0.67, appliedTo: 'eighths' });
  });

  it('clamps swing into [0.5, 0.75]', () => {
    const c = createEmptyComposition();
    expect(setCompositionGroove(c, { swing: 0.1, appliedTo: 'eighths' }).groove?.swing).toBe(0.5);
  });

  it('accepts null', () => {
    const c = setCompositionGroove(createEmptyComposition(), { swing: 0.67, appliedTo: 'eighths' });
    expect(setCompositionGroove(c, null).groove).toBeNull();
  });
});

describe('setCompositionGrooveMode', () => {
  it("toggles between 'global' and 'inherit'", () => {
    const c = createEmptyComposition();
    expect(setCompositionGrooveMode(c, 'inherit').grooveMode).toBe('inherit');
    expect(setCompositionGrooveMode(c, 'global').grooveMode).toBe('global');
  });
});

describe('flattenComposition — transpose + truncate', () => {
  function patternWith4Events(): Pattern {
    let p = createEmptyPattern('p');
    p = stampEvent({ pattern: p, stringIndex: 1, fret: 5, startTick: 0, durationTicks: 240 }).pattern;
    p = stampEvent({ pattern: p, stringIndex: 1, fret: 7, startTick: 480, durationTicks: 240 }).pattern;
    p = stampEvent({ pattern: p, stringIndex: 1, fret: 9, startTick: 960, durationTicks: 240 }).pattern;
    p = stampEvent({ pattern: p, stringIndex: 1, fret: 11, startTick: 1440, durationTicks: 240 }).pattern;
    return p;
  }

  it('transpose +5 shifts every event\'s fret by 5 (same string)', () => {
    const pat = patternWith4Events();
    let comp = createEmptyComposition('c');
    const r = addPlacement(comp, pat);
    comp = r.composition;
    comp = mutatePlacement(comp, r.placement.id, (p) => ({ ...p, transposeSemitones: 5 }));
    const flat = flattenComposition(comp);
    expect(flat).toHaveLength(4);
    expect(flat.map((e) => e.fret)).toEqual([10, 12, 14, 16]);
    for (const e of flat) {
      expect(e.stringIndex).toBe(1);
    }
  });

  it('transpose drops events whose new fret is out of range', () => {
    const pat = patternWith4Events();
    let comp = createEmptyComposition('c');
    const r = addPlacement(comp, pat);
    comp = r.composition;
    comp = mutatePlacement(comp, r.placement.id, (p) => ({ ...p, transposeSemitones: -6 }));
    const flat = flattenComposition(comp);
    // Frets 5,7,9,11 → -1,1,3,5. -1 is dropped; 3 survive.
    expect(flat).toHaveLength(3);
    expect(flat.map((e) => e.fret).sort((a, b) => a - b)).toEqual([1, 3, 5]);
  });

  it('truncate drops events at or past lengthTicks', () => {
    const pat = patternWith4Events();
    let comp = createEmptyComposition('c');
    const r = addPlacement(comp, pat);
    comp = r.composition;
    comp = mutatePlacement(comp, r.placement.id, (p) => ({ ...p, lengthTicks: 960 }));
    const flat = flattenComposition(comp);
    expect(flat).toHaveLength(2);
    expect(flat.map((e) => e.startTick)).toEqual([0, 480]);
  });

  it('truncate clips events that straddle the cut', () => {
    let pat = createEmptyPattern('p');
    pat = stampEvent({ pattern: pat, stringIndex: 1, fret: 5, startTick: 720, durationTicks: 480 }).pattern;
    let comp = createEmptyComposition('c');
    const r = addPlacement(comp, pat);
    comp = r.composition;
    comp = mutatePlacement(comp, r.placement.id, (p) => ({ ...p, lengthTicks: 960 }));
    const flat = flattenComposition(comp);
    expect(flat).toHaveLength(1);
    expect(flat[0].startTick).toBe(720);
    expect(flat[0].durationTicks).toBe(240); // clipped to 960-720
  });

  it('combined: truncate first, then transpose', () => {
    const pat = patternWith4Events();
    let comp = createEmptyComposition('c');
    const r = addPlacement(comp, pat);
    comp = r.composition;
    comp = mutatePlacement(comp, r.placement.id, (p) => ({ ...p, lengthTicks: 960, transposeSemitones: 2 }));
    const flat = flattenComposition(comp);
    expect(flat).toHaveLength(2);
    expect(flat.map((e) => e.fret)).toEqual([7, 9]);
  });

  it('repeat > 1 with lengthTicks: each iteration uses effective length', () => {
    const pat = patternWith4Events();
    let comp = createEmptyComposition('c');
    const r = addPlacement(comp, pat);
    comp = r.composition;
    comp = mutatePlacement(comp, r.placement.id, (p) => ({ ...p, lengthTicks: 960, repeat: 2 }));
    const flat = flattenComposition(comp);
    expect(flat).toHaveLength(4);
    expect(flat.map((e) => e.startTick).sort((a, b) => a - b)).toEqual([0, 480, 960, 1440]);
  });

  it('snapshot events are not mutated by flatten', () => {
    const pat = patternWith4Events();
    let comp = createEmptyComposition('c');
    const r = addPlacement(comp, pat);
    comp = r.composition;
    comp = mutatePlacement(comp, r.placement.id, (p) => ({ ...p, transposeSemitones: 5, lengthTicks: 960 }));
    const before = placementsOf(comp)[0].patternSnapshot.events.map((e) => ({ ...e }));
    flattenComposition(comp);
    const after = placementsOf(comp)[0].patternSnapshot.events.map((e) => ({ ...e }));
    expect(after).toEqual(before);
  });
});

describe('Placement + Composition new fields', () => {
  it('createEmptyComposition has loop=false', () => {
    const c = createEmptyComposition('t');
    expect(c.loop).toBe(false);
  });

  it('addPlacement initializes transposeSemitones=0 and lengthTicks=null', () => {
    const comp = createEmptyComposition('t');
    const pattern = createEmptyPattern('p');
    const { composition, placement } = addPlacement(comp, pattern);
    expect(placement.transposeSemitones).toBe(0);
    expect(placement.lengthTicks).toBeNull();
    expect(placement.repeat).toBe(1);
    expect(placementsOf(composition)).toHaveLength(1);
  });

  it('placementEffectiveLength returns lengthTicks when set', () => {
    const pattern = createEmptyPattern('p');
    const placement: Placement = {
      id: 'pl1',
      patternSnapshot: pattern,
      startTick: 0,
      repeat: 1,
      transposeSemitones: 0,
      lengthTicks: 960,
    };
    expect(placementEffectiveLength(placement)).toBe(960);
  });

  it('placementEffectiveLength falls back to snapshot duration when lengthTicks is null', () => {
    const pattern = createEmptyPattern('p');
    const placement: Placement = {
      id: 'pl1',
      patternSnapshot: pattern,
      startTick: 0,
      repeat: 1,
      transposeSemitones: 0,
      lengthTicks: null,
    };
    expect(placementEffectiveLength(placement)).toBe(pattern.durationTicks);
  });
});

describe('resizePlacement', () => {
  it('truncates lengthTicks without affecting neighbors when no overlap', () => {
    let p = createEmptyPattern();
    let comp = createEmptyComposition();
    const r1 = addPlacement(comp, p);
    comp = r1.composition;
    const r2 = addPlacement(comp, p);
    comp = r2.composition;
    // Two placements: r1 at 0, r2 at p.durationTicks.
    // Truncate r1 to half its length (no overlap risk; r2 stays put).
    const half = Math.floor(p.durationTicks / 2);
    comp = resizePlacement(comp, r1.placement.id, half);
    const placements = comp.tracks[0].placements;
    const r1After = placements.find((pl) => pl.id === r1.placement.id)!;
    const r2After = placements.find((pl) => pl.id === r2.placement.id)!;
    expect(r1After.lengthTicks).toBe(half);
    expect(r2After.startTick).toBe(p.durationTicks); // unchanged
  });

  it('extending back to full length leaves r2 in place when there\'s no overlap', () => {
    let p = createEmptyPattern();
    let comp = createEmptyComposition();
    const r1 = addPlacement(comp, p);
    comp = r1.composition;
    const r2 = addPlacement(comp, p);
    comp = r2.composition;
    // Truncate r1 to half, then restore to full. r2 starts at p.durationTicks
    // so when r1 returns to full length [0, durationTicks), no overlap.
    const half = Math.floor(p.durationTicks / 2);
    comp = resizePlacement(comp, r1.placement.id, half);
    comp = resizePlacement(comp, r1.placement.id, p.durationTicks);
    const r2NoOverlap = comp.tracks[0].placements.find((pl) => pl.id === r2.placement.id)!;
    expect(r2NoOverlap.startTick).toBe(p.durationTicks);
  });

  it('collapses repeat to 1 on resize', () => {
    let p = createEmptyPattern();
    let comp = createEmptyComposition();
    const r = addPlacement(comp, p);
    comp = r.composition;
    comp = setPlacementRepeat(comp, r.placement.id, 3);
    // Truncate; repeat should collapse to 1.
    comp = resizePlacement(comp, r.placement.id, Math.floor(p.durationTicks / 2));
    const after = comp.tracks[0].placements[0];
    expect(after.repeat).toBe(1);
  });

  it('clamps a resize at the next block instead of pushing it', () => {
    let p = createEmptyPattern();
    let comp = createEmptyComposition();
    const trackId = comp.tracks[0].id;
    // Place A at 0, length p.durationTicks (default).
    const a = addPlacementToTrack(comp, trackId, p);
    comp = a.composition;
    // Truncate A to half so a gap exists past its tail.
    const half = Math.floor(p.durationTicks / 2);
    comp = resizePlacement(comp, a.placement!.id, half);
    // Add B; addPlacementToTrack defaults to per-track endTick (= half).
    const b = addPlacementToTrack(comp, trackId, p);
    comp = b.composition;
    expect(comp.tracks[0].placements.find((pl) => pl.id === b.placement!.id)!.startTick).toBe(half);
    // Try to restore A to full length. B sits at `half`, so A clamps there — it
    // can't grow into B, and B does NOT move.
    comp = resizePlacement(comp, a.placement!.id, p.durationTicks);
    const placements = comp.tracks[0].placements;
    const aAfter = placements.find((pl) => pl.id === a.placement!.id)!;
    const bAfter = placements.find((pl) => pl.id === b.placement!.id)!;
    expect(aAfter.lengthTicks).toBe(half); // clamped at B's start
    expect(bAfter.startTick).toBe(half); // neighbor unmoved
  });
});

describe('setPlacementTranspose / resizePlacement / setCompositionLoop', () => {
  it('setPlacementTranspose clamps to [-24, +24]', () => {
    let comp = createEmptyComposition('c');
    const pat = createEmptyPattern('p');
    const r = addPlacement(comp, pat);
    comp = r.composition;
    let next = setPlacementTranspose(comp, r.placement.id, 100);
    expect(placementsOf(next)[0].transposeSemitones).toBe(24);
    next = setPlacementTranspose(comp, r.placement.id, -100);
    expect(placementsOf(next)[0].transposeSemitones).toBe(-24);
  });

  it('setPlacementTranspose returns same ref when unchanged', () => {
    let comp = createEmptyComposition('c');
    const pat = createEmptyPattern('p');
    const r = addPlacement(comp, pat);
    comp = r.composition;
    const next = setPlacementTranspose(comp, r.placement.id, 0);
    expect(next).toBe(comp);
  });

  it('resizePlacement clamps to [tpb, snapshotDuration] and collapses repeat to 1', () => {
    let comp = createEmptyComposition('c');
    const pat = createEmptyPattern('p');
    const r = addPlacement(comp, pat);
    comp = r.composition;
    comp = mutatePlacement(comp, r.placement.id, (p) => ({ ...p, repeat: 3 }));
    const tpb = ticksPerBar(comp.timeSignature);
    const next = resizePlacement(comp, r.placement.id, tpb * 2);
    expect(placementsOf(next)[0].lengthTicks).toBe(tpb * 2);
    expect(placementsOf(next)[0].repeat).toBe(1);
  });

  it('setCompositionLoop toggles the flag and returns same ref when unchanged', () => {
    let comp = createEmptyComposition('c');
    expect(comp.loop).toBe(false);
    comp = setCompositionLoop(comp, true);
    expect(comp.loop).toBe(true);
    expect(setCompositionLoop(comp, true)).toBe(comp);
  });
});
