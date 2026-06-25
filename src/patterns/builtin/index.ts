/**
 * Built-in (first-party) default library content — read-only patterns and
 * compositions the app ships with. SAFE only: theory building blocks (CAGED
 * chord shapes, scales, arpeggios — functional, not copyrightable) generated via
 * `planCagedInsert`, plus a few trivially-ORIGINAL riffs/demo. No copyrighted
 * songs, no lyrics. (Public-domain pieces are added later, owner-verified.)
 *
 * Built-in items are NOT stored in the user's library: they live here as
 * constants, are merged into the pickers/catalog for display only, and excluded
 * from cloud sync / tier caps / delete. Ids are prefixed `builtin-` so read/write
 * sites can recognise them; using one = duplicate into the user's library.
 */
import type { Pattern, PatternEvent, Composition, Collection } from '../types';
import { createEmptyPattern, fitPatternDuration } from '../pattern-ops';
import { createEmptyComposition, addPlacementToTrack } from '../composition-ops';
import { PPQ } from '../timebase';
import { getTuning, DEFAULT_TUNING_ID } from '../../lib/tunings';
import { SCALES } from '../../lib/scales';
import { ARPEGGIOS } from '../../lib/arpeggios';
import { planCagedInsert, type CagedInsertMode } from '../caged-insert';
import type { CagedShapeId } from '../../playback/patterns/caged-shapes-data';
import type { ChordQuality } from '../../playback/patterns/caged-chord-shapes-data';

export const BUILTIN_COLLECTION_ID = 'builtin';

/** Is this id a built-in (read-only, first-party) library item or folder?
 *  Items/child-folders are `builtin-*`; the root folder is exactly `builtin`. */
export const isBuiltinId = (id: string | null | undefined): boolean =>
  typeof id === 'string' && (id === BUILTIN_COLLECTION_ID || id.startsWith('builtin-'));

const NOW = Date.UTC(2026, 0, 1); // fixed so built-ins are stable across reloads

// ── Built-in folder tree ────────────────────────────────────────────────────
// Read-only collections the built-in content is filed under. Same `Collection`
// shape as user folders so the shared folder logic treats them identically; the
// only difference is `isBuiltinId` → no rename/move/delete.
const COL = {
  root: BUILTIN_COLLECTION_ID,
  chords: 'builtin-col-chords',
  chordsMajor: 'builtin-col-chords-major',
  chordsMinor: 'builtin-col-chords-minor',
  chordsDom7: 'builtin-col-chords-dom7',
  chordsMaj7: 'builtin-col-chords-maj7',
  chordsMin7: 'builtin-col-chords-min7',
  scales: 'builtin-col-scales',
  arps: 'builtin-col-arps',
  riffs: 'builtin-col-riffs',
} as const;

const collection = (id: string, name: string, parentId: string | null): Collection => ({
  id,
  name,
  parentId,
  visibility: 'private',
  publishedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
});

/** The whole built-in folder tree (root included), for merging into the shared
 *  `collections` taxonomy on any surface. */
export const BUILTIN_COLLECTIONS: Collection[] = [
  collection(COL.root, 'Built-in', null),
  collection(COL.chords, 'Chords', COL.root),
  collection(COL.chordsMajor, 'Major', COL.chords),
  collection(COL.chordsMinor, 'Minor', COL.chords),
  collection(COL.chordsDom7, 'Dominant 7', COL.chords),
  collection(COL.chordsMaj7, 'Major 7', COL.chords),
  collection(COL.chordsMin7, 'Minor 7', COL.chords),
  collection(COL.scales, 'Scales', COL.root),
  collection(COL.arps, 'Arpeggios', COL.root),
  collection(COL.riffs, 'Riffs & Demos', COL.root),
];

/** Back-compat: the root "Built-in" collection on its own. */
export const BUILTIN_COLLECTION: Collection = BUILTIN_COLLECTIONS[0];

/** Leaf chord folder for a given chord quality. */
const CHORD_FOLDER: Record<ChordQuality, string> = {
  major: COL.chordsMajor,
  minor: COL.chordsMinor,
  dom7: COL.chordsDom7,
  maj7: COL.chordsMaj7,
  min7: COL.chordsMin7,
};

const TUNING = getTuning(DEFAULT_TUNING_ID)!;
const REQ_BASE = { tuning: TUNING, capo: 0, fretCount: 17, stringCount: 6 } as const;

function patternFromEvents(
  slug: string,
  name: string,
  events: PatternEvent[],
  collectionId: string,
): Pattern {
  const base = createEmptyPattern(name);
  return fitPatternDuration({
    ...base,
    id: `builtin-pat-${slug}`,
    name,
    events,
    collectionId,
  });
}

function planEvents(slug: string, plan: { notes: readonly { stringIndex: number; fret: number; startTickOffset: number; durationTicks: number }[] }): PatternEvent[] {
  return plan.notes.map((n, i) => ({
    id: `builtin-pat-${slug}-e${i}`,
    stringIndex: n.stringIndex,
    fret: n.fret,
    startTick: n.startTickOffset,
    durationTicks: n.durationTicks,
  }));
}

function cagedChord(shapeId: CagedShapeId, key: string, quality: ChordQuality, name: string): Pattern {
  const slug = `${shapeId}-${key}-${quality}`.toLowerCase();
  const plan = planCagedInsert({ ...REQ_BASE, shapeId, mode: 'chord', key, chordQuality: quality }, PPQ);
  return patternFromEvents(slug, name, planEvents(slug, plan), CHORD_FOLDER[quality]);
}

const RUN_SHAPE_ORDER: CagedShapeId[] = ['caged-e', 'caged-a', 'caged-c', 'caged-g', 'caged-d'];

function cagedRun(
  mode: Extract<CagedInsertMode, 'scale' | 'arp'>,
  key: string,
  type: string,
  name: string,
): Pattern {
  const slug = `${mode}-${key}-${type}`.toLowerCase(); // shape-independent → stable id
  const folder = mode === 'scale' ? COL.scales : COL.arps;
  // Some scale/arp types don't fill every CAGED box — try shapes until one does.
  for (const shapeId of RUN_SHAPE_ORDER) {
    const plan = planCagedInsert(
      {
        ...REQ_BASE,
        shapeId,
        mode,
        key,
        traversal: 'ascending-pitch',
        ...(mode === 'scale' ? { scaleType: type } : { arpeggioType: type }),
      },
      PPQ / 2,
    );
    if (plan.notes.length > 0)
      return patternFromEvents(slug, name, planEvents(slug, plan), folder);
  }
  return patternFromEvents(slug, name, [], folder); // unreachable in practice
}

// ── Theory: chords ──────────────────────────────────────────────────────────
// Common chords in their idiomatic CAGED shape/key, across the quality
// vocabulary (major / minor / dom7 / maj7 / min7).
const CHORD_SPECS: { shape: CagedShapeId; key: string; quality: ChordQuality; name: string }[] = [
  // Open majors (each CAGED shape at its root)
  { shape: 'caged-c', key: 'C', quality: 'major', name: 'C' },
  { shape: 'caged-a', key: 'A', quality: 'major', name: 'A' },
  { shape: 'caged-g', key: 'G', quality: 'major', name: 'G' },
  { shape: 'caged-e', key: 'E', quality: 'major', name: 'E' },
  { shape: 'caged-d', key: 'D', quality: 'major', name: 'D' },
  // Minors
  { shape: 'caged-a', key: 'A', quality: 'minor', name: 'Am' },
  { shape: 'caged-e', key: 'E', quality: 'minor', name: 'Em' },
  { shape: 'caged-d', key: 'D', quality: 'minor', name: 'Dm' },
  // Dominant 7
  { shape: 'caged-g', key: 'G', quality: 'dom7', name: 'G7' },
  { shape: 'caged-c', key: 'C', quality: 'dom7', name: 'C7' },
  { shape: 'caged-d', key: 'D', quality: 'dom7', name: 'D7' },
  { shape: 'caged-a', key: 'A', quality: 'dom7', name: 'A7' },
  { shape: 'caged-e', key: 'E', quality: 'dom7', name: 'E7' },
  // Major 7
  { shape: 'caged-c', key: 'C', quality: 'maj7', name: 'Cmaj7' },
  { shape: 'caged-a', key: 'A', quality: 'maj7', name: 'Amaj7' },
  { shape: 'caged-d', key: 'D', quality: 'maj7', name: 'Dmaj7' },
  // Minor 7
  { shape: 'caged-a', key: 'A', quality: 'min7', name: 'Am7' },
  { shape: 'caged-e', key: 'E', quality: 'min7', name: 'Em7' },
  { shape: 'caged-d', key: 'D', quality: 'min7', name: 'Dm7' },
];
const chordPatterns = CHORD_SPECS.map((c) => cagedChord(c.shape, c.key, c.quality, c.name));

// ── Theory: scales & arpeggios ──────────────────────────────────────────────
// Every scale type and every arpeggio type, in a common reference position
// (key A, E-shape box) so the whole vocabulary is browsable.
// Drop any type the CAGED resolver can't place (e.g. the blues scale isn't in
// the CAGED scale data) so the built-in set never contains empty patterns.
const scaleRuns = SCALES.map((s) => cagedRun('scale', 'A', s.id, `A ${s.name}`)).filter(
  (p) => p.events.length > 0,
);
const arpRuns = ARPEGGIOS.map((a) => cagedRun('arp', 'A', a.id, `A ${a.name} arpeggio`)).filter(
  (p) => p.events.length > 0,
);

// ── Original demo riffs (trivially original — safe) ─────────────────────────
const e = (slug: string, i: number, s: number, fret: number, at: number, dur: number): PatternEvent => ({
  id: `builtin-pat-${slug}-e${i}`,
  stringIndex: s,
  fret,
  startTick: at,
  durationTicks: dur,
});

// A simple low-string riff (string 0 = low E). Original.
const demoRiff = patternFromEvents(
  'demo-riff',
  'Demo Riff',
  [
    e('demo-riff', 0, 0, 0, 0, PPQ / 2),
    e('demo-riff', 1, 0, 3, PPQ / 2, PPQ / 2),
    e('demo-riff', 2, 0, 5, PPQ, PPQ / 2),
    e('demo-riff', 3, 1, 3, PPQ * 1.5, PPQ / 2),
    e('demo-riff', 4, 0, 5, PPQ * 2, PPQ / 2),
    e('demo-riff', 5, 0, 3, PPQ * 2.5, PPQ / 2),
    e('demo-riff', 6, 0, 0, PPQ * 3, PPQ),
  ],
  COL.riffs,
);

// A steady eighth-note bass walk on the A string. Original.
const demoBass = patternFromEvents(
  'demo-bass',
  'Demo Bass Walk',
  [
    e('demo-bass', 0, 1, 3, 0, PPQ / 2),
    e('demo-bass', 1, 1, 3, PPQ / 2, PPQ / 2),
    e('demo-bass', 2, 1, 5, PPQ, PPQ / 2),
    e('demo-bass', 3, 1, 5, PPQ * 1.5, PPQ / 2),
    e('demo-bass', 4, 1, 7, PPQ * 2, PPQ / 2),
    e('demo-bass', 5, 1, 5, PPQ * 2.5, PPQ / 2),
    e('demo-bass', 6, 1, 3, PPQ * 3, PPQ),
  ],
  COL.riffs,
);

/** Built-in patterns grouped by category. Kept for any non-tree display; the
 *  folder surfaces now render the `BUILTIN_COLLECTIONS` tree instead. */
export const BUILTIN_PATTERN_GROUPS: { label: string; patterns: Pattern[] }[] = [
  { label: 'Chords', patterns: chordPatterns },
  { label: 'Scales', patterns: scaleRuns },
  { label: 'Arpeggios', patterns: arpRuns },
  { label: 'Riffs', patterns: [demoRiff, demoBass] },
];

export const BUILTIN_PATTERNS: Pattern[] = BUILTIN_PATTERN_GROUPS.flatMap((g) => g.patterns);

// ── Original demo composition ───────────────────────────────────────────────
function demoComposition(): Composition {
  const base = createEmptyComposition('Demo Composition');
  const trackId = base.tracks[0].id;
  let comp = addPlacementToTrack(base, trackId, demoRiff).composition;
  comp = addPlacementToTrack(comp, trackId, demoRiff).composition;
  comp = addPlacementToTrack(comp, trackId, chordPatterns[0]).composition; // C major
  return { ...comp, id: 'builtin-comp-demo', name: 'Demo Composition', collectionId: COL.riffs };
}

export const BUILTIN_COMPOSITIONS: Composition[] = [demoComposition()];
