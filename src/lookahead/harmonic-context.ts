/**
 * Harmonic-context layer — the authored "what everyone's thinking" track of a
 * composition: a chord and/or scale reference over a tick range, independent of
 * any track's notes. Drives the super-tab chord/theory lane.
 *
 * Portable + versioned by design (no DB ids, self-contained) so it serializes
 * straight into the future `.supertab` file format. See
 * `docs/lookahead-feature-plan.md`.
 */
import type { Tick, HarmonicContextBlock, Composition } from '../patterns/types';
import { parseChordSymbol } from '../lib/chords';

export type { HarmonicContextBlock };

/**
 * Pre-fill a harmonic-context layer from a composition's placements: any
 * placement whose pattern is named like a chord (e.g. a chord-import song's
 * `G`, `Am7`) becomes a context block. Used as a fallback when the user hasn't
 * authored their own `harmonicContext` yet. Returns the first track that has
 * chord-named placements (the "chord track"); empty for pure-instrumental songs.
 */
export function deriveHarmonicContext(comp: Composition): HarmonicContextBlock[] {
  for (const track of comp.tracks) {
    const blocks: HarmonicContextBlock[] = [];
    for (const p of track.placements) {
      const name = p.patternSnapshot?.name;
      if (!name || !parseChordSymbol(name)) continue;
      const oneLen = p.lengthTicks ?? p.patternSnapshot.durationTicks;
      const len = oneLen * Math.max(1, p.repeat ?? 1);
      blocks.push({
        id: p.id,
        startTick: p.startTick,
        endTick: p.startTick + len,
        chord: name,
        scale: null,
      });
    }
    if (blocks.length) return blocks.sort((a, b) => a.startTick - b.startTick);
  }
  return [];
}

/** The context block covering `tick` (start-inclusive, end-exclusive), or null. */
export function harmonicContextAt(
  blocks: readonly HarmonicContextBlock[],
  tick: Tick,
): HarmonicContextBlock | null {
  for (const b of blocks) {
    if (tick >= b.startTick && tick < b.endTick) return b;
  }
  return null;
}

/** The first block that starts strictly after `tick` (the "next" / on-deck), or null. */
export function nextHarmonicContext(
  blocks: readonly HarmonicContextBlock[],
  tick: Tick,
): HarmonicContextBlock | null {
  let best: HarmonicContextBlock | null = null;
  for (const b of blocks) {
    if (b.startTick > tick && (!best || b.startTick < best.startTick)) best = b;
  }
  return best;
}
