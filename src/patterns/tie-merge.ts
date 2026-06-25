/**
 * Tie merging — collapses chains of tied PatternEvents into single sustained
 * events for playback.
 *
 * A tie is recorded as `event.tieToNext = true` on the *first* event of the
 * pair. For playback we want one note that rings for the combined duration,
 * not two separate plucks. This helper walks events in order and folds any
 * tied chain into the leading event's duration.
 *
 * The MERGE requires strict adjacency:
 *   - same string
 *   - same fret
 *   - the next event's startTick equals the prior event's endTick
 *
 * If any of these don't match (typically a quantization artifact or an
 * unexpected gap), the tie is treated as "not actually tied" — the prior
 * event's `tieToNext` is ignored and the next event plays normally. This
 * keeps the merger safe; it never silently drops audible notes.
 *
 * This helper operates on a structural superset of `PatternEvent`/
 * `FlattenedEvent` so a single implementation serves both timeline-relative
 * Pattern events and absolute-tick Composition flattens.
 */

export interface MergeableEvent {
  id: string;
  startTick: number;
  durationTicks: number;
  stringIndex: number;
  fret: number;
  tieToNext?: boolean;
  hammerOn?: boolean;
  pullOff?: boolean;
  velocity?: number;
  vibrato?: 'slight' | 'wide';
  slide?: { type: string; toFret?: number };
  bend?: {
    type: 'bend' | 'release' | 'pre-bend' | 'bend-release';
    semitones: number;
    points?: Array<{ at: number; semitones: number }>;
  };
  palmMute?: boolean;
  ghost?: boolean;
  dead?: boolean;
  tap?: boolean;
  harmonic?: { type: string; fret?: number };
}

export function mergeTies<E extends MergeableEvent>(events: readonly E[]): E[] {
  // Sort defensively — input is normally pre-sorted but we don't rely on it.
  const sorted = [...events].sort((a, b) => {
    if (a.startTick !== b.startTick) return a.startTick - b.startTick;
    if (a.stringIndex !== b.stringIndex) return a.stringIndex - b.stringIndex;
    return 0;
  });

  const out: E[] = [];
  const skipped = new Set<string>();

  // We can't drop the second event from `sorted` in-place because the tied
  // chain may extend multiple events (a → b → c). Walk forward, and for
  // each "leader" event, scan ahead to find tied followers, folding their
  // durations into the leader and marking them as skipped.
  for (let i = 0; i < sorted.length; i++) {
    const lead = sorted[i];
    if (skipped.has(lead.id)) continue;
    if (!lead.tieToNext) {
      out.push(lead);
      continue;
    }
    let cumulative = lead.durationTicks;
    let currentEnd = lead.startTick + cumulative;
    let chainEnd = false;
    for (let j = i + 1; j < sorted.length && !chainEnd; j++) {
      const next = sorted[j];
      if (next.stringIndex !== lead.stringIndex) continue;
      if (next.startTick !== currentEnd) {
        // No further tied note adjacent on this string — stop the chain.
        chainEnd = true;
        break;
      }
      if (next.fret !== lead.fret) {
        chainEnd = true;
        break;
      }
      cumulative += next.durationTicks;
      currentEnd += next.durationTicks;
      skipped.add(next.id);
      if (!next.tieToNext) chainEnd = true;
    }
    const merged: E = { ...lead, durationTicks: cumulative };
    // Clear the tie flag on the merged event so downstream code doesn't
    // try to merge it again or render an arc that no longer makes sense.
    (merged as MergeableEvent).tieToNext = undefined;
    out.push(merged);
  }

  return out;
}
