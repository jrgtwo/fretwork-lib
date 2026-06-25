/**
 * Look-ahead segmentation: regroup a pattern's events into the ordered
 * perceptual chunks the look-ahead bar reads — **chord** segments (notes you
 * hit together) and **run** segments (notes you play in sequence).
 *
 * It's the same events, regrouped — no new authored data. Classification:
 *   - Events sharing a `chordId` are an authored chord group (kept together
 *     regardless of timing — covers strummed/staggered chords).
 *   - Otherwise events are clustered by start tick; a cluster of 2+ that Tonal
 *     recognizes as a chord becomes a chord segment; lone notes are run notes,
 *     merged across consecutive moments into a single run segment.
 *
 * See `docs/lookahead-feature-plan.md`.
 */
import type { Tick } from '../patterns/types';
import type { TuningDef } from '../types';
import { noteAt } from '../lib/theory';
import { detectChordName } from '../lib/chords';
import { PPQ } from '../patterns/timebase';

export interface SegmentEvent {
  stringIndex: number;
  fret: number;
  startTick: Tick;
  durationTicks: Tick;
  /** Authored chord-group id — events sharing it are one chord. */
  chordId?: string | null;
  /** Authored chord name for the group (overrides detection). */
  chordName?: string | null;
}

export interface LookaheadSegment {
  kind: 'chord' | 'run';
  startTick: Tick;
  endTick: Tick;
  cells: { stringIndex: number; fret: number }[];
  /** Present on chord segments. */
  chordName?: string;
}

export interface SegmentOptions {
  /** Notes whose starts fall within this many ticks count as struck together.
   *  Default = a 16th note (strum tolerance). */
  clusterTicks?: number;
}

const cellOf = (e: SegmentEvent) => ({ stringIndex: e.stringIndex, fret: e.fret });
const startOf = (evs: SegmentEvent[]) => Math.min(...evs.map((e) => e.startTick));
const endOf = (evs: SegmentEvent[]) => Math.max(...evs.map((e) => e.startTick + e.durationTicks));

export function segmentEvents(
  events: readonly SegmentEvent[],
  tuning: TuningDef,
  opts: SegmentOptions = {},
): LookaheadSegment[] {
  if (events.length === 0) return [];
  const clusterTicks = opts.clusterTicks ?? PPQ / 4;
  const noteName = (e: SegmentEvent) => noteAt(tuning.strings[e.stringIndex], e.fret);

  const sorted = [...events].sort(
    (a, b) => a.startTick - b.startTick || a.stringIndex - b.stringIndex,
  );

  // ── Build moments: authored chord groups + time-clusters of the rest ──
  type Moment = { events: SegmentEvent[]; tagged: boolean };
  const moments: Moment[] = [];
  const taggedById = new Map<string, SegmentEvent[]>();
  const untagged: SegmentEvent[] = [];
  for (const e of sorted) {
    if (e.chordId) {
      const arr = taggedById.get(e.chordId) ?? [];
      arr.push(e);
      taggedById.set(e.chordId, arr);
    } else {
      untagged.push(e);
    }
  }
  for (const evs of taggedById.values()) moments.push({ events: evs, tagged: true });
  for (let i = 0; i < untagged.length; ) {
    const start = untagged[i].startTick;
    const cluster: SegmentEvent[] = [untagged[i]];
    let j = i + 1;
    while (j < untagged.length && untagged[j].startTick - start <= clusterTicks) {
      cluster.push(untagged[j]);
      j++;
    }
    moments.push({ events: cluster, tagged: false });
    i = j;
  }
  moments.sort((a, b) => startOf(a.events) - startOf(b.events));

  // ── Classify + merge consecutive run notes ──
  const segments: LookaheadSegment[] = [];
  let runBuf: SegmentEvent[] = [];
  const flushRun = () => {
    if (runBuf.length === 0) return;
    segments.push({
      kind: 'run',
      startTick: startOf(runBuf),
      endTick: endOf(runBuf),
      cells: runBuf.map(cellOf),
    });
    runBuf = [];
  };

  for (const m of moments) {
    const isChord =
      m.tagged || (m.events.length >= 2 && detectChordName(m.events.map(noteName)) !== null);
    if (isChord) {
      flushRun();
      const authored = m.events.find((e) => e.chordName)?.chordName;
      const name = authored ?? detectChordName(m.events.map(noteName)) ?? undefined;
      segments.push({
        kind: 'chord',
        startTick: startOf(m.events),
        endTick: endOf(m.events),
        cells: m.events.map(cellOf),
        chordName: name ?? undefined,
      });
    } else {
      runBuf.push(...m.events);
    }
  }
  flushRun();

  segments.sort((a, b) => a.startTick - b.startTick);
  return segments;
}
