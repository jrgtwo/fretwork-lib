/**
 * ASCII-tab parser: plain-text guitar/bass tab → `ImportIR`.
 *
 * Extracts notes, their **articulations** (`h p / \ s b ~ x t` + ghost), a
 * **rhythm calibrated to the bar lines** (each `|`-delimited segment is one
 * measure; notes sit proportionally within), and **inline time-signature
 * changes** (`2/4`, `4/4` annotation lines) which set each measure's width.
 *
 * Spacing in ASCII tab is loose, so timing is a best guess — the user fine-tunes
 * the groove on the timeline. See
 * `docs/superpowers/specs/2026-05-31-chord-and-tab-import-flow-design.md`.
 */
import type {
  ChordMarker,
  ImportIR,
  IREvent,
  IRNote,
  IRSlide,
  SectionMarker,
  TimeSignatureEvent,
} from '../types';
import { PPQ, ticksPerBar } from '../../patterns/timebase';
import { parseChordSymbol } from '../../lib/chords';

/** Fallback when a block has no bar lines: ticks per tab character. */
const TICKS_PER_CHAR = PPQ / 8;
const MIN_DURATION = PPQ / 8;
const BLOCK_TAIL_CHARS = 4;

const SECTION_RE = /^\s*\[([^\]]+)\]\s*$/;

function isTabLine(line: string): boolean {
  const dashes = (line.match(/-/g) ?? []).length;
  if (dashes < 4) return false;
  const tabChars = (line.match(/[-0-9hpbsxX/\\~().*<>^t |=]/g) ?? []).length;
  return line.length > 0 && tabChars / line.length > 0.8;
}

/** A rhythm-legend line under a tab block: `+   .   +   .` (beats and off-beats).
 *  Each `+`/`.` marks a subdivision column. Detected by being all spaces and
 *  beat glyphs (no letters/digits) with at least two markers. */
function isBeatLine(line: string): boolean {
  const markers = (line.match(/[+.]/g) ?? []).length;
  if (markers < 2 || /[0-9A-Za-z]/.test(line)) return false;
  const allowed = (line.match(/[+.\s|:]/g) ?? []).length;
  return allowed / line.length > 0.95;
}

const VALID_DENOMINATOR = new Set([1, 2, 4, 8, 16, 32]);

/** Harvest `N/M` time-signature tokens from a non-tab line. Works even when the
 *  line also carries chord names (Blackbird-style: `3/4 G Am7 4/4 G`). Only
 *  tokens with a real denominator are kept, so stray fractions in prose are
 *  unlikely to match. Tab lines are excluded by the caller (their slides would
 *  otherwise look like `5/7`). */
function scanTimeSigTokens(line: string): { charIndex: number; num: number; den: number }[] {
  // Reject prose lines: a real TS annotation is bare fractions or fractions mixed
  // with chord names (`3/4 G Am7`), never a sentence. After removing the
  // fractions, if any residual word contains a letter that doesn't start a chord
  // (uppercase A–G), treat it as prose — so "Tuned down 1/2 step" yields nothing.
  const residual = line.replace(/\d+\/\d+/g, ' ').trim();
  if (residual && residual.split(/\s+/).some((t) => /[a-zA-Z]/.test(t) && !/^[A-G]/.test(t))) {
    return [];
  }
  const tokens: { charIndex: number; num: number; den: number }[] = [];
  const re = /(\d+)\/(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const num = parseInt(m[1], 10);
    const den = parseInt(m[2], 10);
    if (num >= 1 && num <= 32 && VALID_DENOMINATOR.has(den)) {
      tokens.push({ charIndex: m.index, num, den });
    }
  }
  return tokens;
}

/** Harvest chord symbols (with columns) from an annotation line above the staff
 *  (`3/4 G  Am7  G/B  4/4 G`). Time-signature tokens are skipped. Only returns
 *  anything when chord tokens DOMINATE the line's words, so lyric lines
 *  ("Blackbird singing…") and prose don't produce phantom chords. */
function scanChordTokens(line: string): { charIndex: number; symbol: string }[] {
  const cand: { charIndex: number; symbol: string }[] = [];
  let wordCount = 0;
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const tok = m[0];
    if (/^\d+\/\d+$/.test(tok)) continue; // time-signature token
    if (!/[A-Za-z]/.test(tok)) continue; // pure punctuation / digits
    wordCount++;
    if (/^[A-G]/.test(tok) && parseChordSymbol(tok)) {
      cand.push({ charIndex: m.index, symbol: tok });
    }
  }
  // Chords must be a CLEAR majority of the words, else it's a lyric / metadata
  // line. The 60% bar rejects the tuning line (`Tuning: E A D G B E…`, exactly
  // half note-names) while keeping real chord lines (`Verse: C G Am F`, 80%+).
  return cand.length >= 1 && cand.length > wordCount * 0.6 ? cand : [];
}

interface ScannedNote {
  charIndex: number;
  string: number;
  fret: number;
  dead?: boolean;
  ghost?: boolean;
  hammerOn?: boolean;
  pullOff?: boolean;
  tap?: boolean;
  vibrato?: 'slight' | 'wide';
  slide?: IRSlide;
  bend?: { type: 'bend'; semitones: number };
}

const isDigit = (c: string) => c >= '0' && c <= '9';

function scanLine(line: string, stringIndex: number): ScannedNote[] {
  const out: ScannedNote[] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (isDigit(ch)) {
      let j = i;
      while (j < line.length && isDigit(line[j])) j++;
      const fret = parseInt(line.slice(i, j), 10);
      // Skip any `=` immediately before the note — it marks a *delayed* hammer/
      // pull (`4h=5`); we treat it as the plain articulation, so look past it to
      // find the real prefix glyph.
      let pi = i - 1;
      while (pi >= 0 && line[pi] === '=') pi--;
      const prev = line[pi] ?? '';
      const note: ScannedNote = { charIndex: i, string: stringIndex, fret };
      if (prev === 'h') note.hammerOn = true;
      else if (prev === 'p') note.pullOff = true;
      if (prev === 't') note.tap = true;
      if (prev === '(') note.ghost = true;
      if (prev === '/') note.slide = { type: 'slide-in-above' };
      else if (prev === '\\') note.slide = { type: 'slide-in-below' };
      let k = j;
      const next = line[k] ?? '';
      if (next === 'b') {
        k++;
        let t = '';
        while (k < line.length && isDigit(line[k])) t += line[k++];
        const target = t ? parseInt(t, 10) : fret + 2;
        note.bend = { type: 'bend', semitones: Math.max(1, target - fret) };
      } else if (next === '~') {
        let mm = j;
        while (line[mm] === '~') mm++;
        note.vibrato = mm - j >= 2 ? 'wide' : 'slight';
      } else if (next === '/') {
        note.slide = { type: 'slide-out-up' };
      } else if (next === '\\') {
        note.slide = { type: 'slide-out-down' };
      } else if (next === 's' || next === 'S') {
        let mm = j + 1;
        let t = '';
        while (mm < line.length && isDigit(line[mm])) t += line[mm++];
        const target = t ? parseInt(t, 10) : fret;
        note.slide = { type: target < fret ? 'slide-out-down' : 'slide-out-up', toFret: target };
      }
      out.push(note);
      i = k > j ? k : j;
    } else if (ch === 'x' || ch === 'X') {
      out.push({ charIndex: i, string: stringIndex, fret: 0, dead: true });
      i++;
    } else {
      i++;
    }
  }
  return out;
}

function toIRNote(n: ScannedNote): IRNote {
  const note: IRNote = { string: n.string, fret: n.fret };
  if (n.dead) note.dead = true;
  if (n.ghost) note.ghost = true;
  if (n.hammerOn) note.hammerOn = true;
  if (n.pullOff) note.pullOff = true;
  if (n.tap) note.tap = true;
  if (n.vibrato) note.vibrato = n.vibrato;
  if (n.slide) note.slide = n.slide;
  if (n.bend) note.bend = n.bend;
  return note;
}

export function parseAsciiTab(text: string): ImportIR {
  const lines = text.split(/\r?\n/);
  const events: IREvent[] = [];
  const sections: SectionMarker[] = [];
  const timeSignatures: TimeSignatureEvent[] = [{ atTick: 0, numerator: 4, denominator: 4 }];
  let blockStartTick = 0;
  let blockHeight = 6;
  let curNum = 4;
  let curDen = 4;
  let pendingTS: { charIndex: number; num: number; den: number }[] = [];
  let pendingChords: { charIndex: number; symbol: string }[] = [];
  const chords: ChordMarker[] = [];
  let block: string[] = [];
  let beatLine: string | null = null;

  const pushTS = (atTick: number, num: number, den: number) => {
    const last = timeSignatures[timeSignatures.length - 1];
    if (last && last.atTick === atTick) {
      last.numerator = num;
      last.denominator = den;
    } else {
      timeSignatures.push({ atTick, numerator: num, denominator: den });
    }
  };

  const flush = () => {
    const legend = beatLine;
    beatLine = null; // consume regardless of which return path flush takes
    if (block.length === 0) return;
    blockHeight = block.length;
    const notes: ScannedNote[] = [];
    block.forEach((line, offset) => notes.push(...scanLine(line, block.length - 1 - offset)));

    const barTally = new Map<number, number>();
    for (const line of block) {
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '|') barTally.set(i, (barTally.get(i) ?? 0) + 1);
      }
    }
    const threshold = Math.ceil(block.length / 2);
    const barCols = [...barTally.entries()]
      .filter(([, n]) => n >= threshold)
      .map(([i]) => i)
      .sort((a, b) => a - b);
    // Coalesce adjacent bar columns: a `||` double-barline (and the `E||` /
    // `{|` line openers) puts two pipes a char apart. Those are ONE boundary,
    // not a zero-width measure — counting both spawns a phantom bar that still
    // eats a full measure of ticks and shifts everything after it. Real
    // measures are always many chars wide, so merging columns ≤2 apart is safe.
    // Keep the RIGHTMOST pipe of each run so the boundary sits AFTER the `||`,
    // giving every measure the same lead and landing note 1 on the downbeat.
    const bars: number[] = [];
    for (const c of barCols) {
      if (bars.length && c - bars[bars.length - 1] <= 2) bars[bars.length - 1] = c;
      else bars.push(c);
    }
    block = [];
    if (notes.length === 0) return;

    const byCol = new Map<number, ScannedNote[]>();
    for (const n of notes) {
      const arr = byCol.get(n.charIndex) ?? [];
      arr.push(n);
      byCol.set(n.charIndex, arr);
    }
    const cols = [...byCol.keys()].sort((a, b) => a - b);
    const hasBars = bars.length >= 2;

    if (!hasBars) {
      pendingTS = [];
      for (let ci = 0; ci < cols.length; ci++) {
        const c = cols[ci];
        const nextC = ci < cols.length - 1 ? cols[ci + 1] : c + BLOCK_TAIL_CHARS;
        events.push({
          atTick: blockStartTick + (c - cols[0]) * TICKS_PER_CHAR,
          durationTicks: Math.max(MIN_DURATION, (nextC - c) * TICKS_PER_CHAR),
          notes: byCol.get(c)!.map(toIRNote),
        });
      }
      blockStartTick += (cols[cols.length - 1] - cols[0] + BLOCK_TAIL_CHARS) * TICKS_PER_CHAR;
      return;
    }

    const M = bars.length - 1; // measures in this block
    const segOf = (c: number) => {
      let k = 0;
      while (k < bars.length - 1 && c >= bars[k + 1]) k++;
      return Math.min(k, M - 1); // notes past the last bar belong to the last measure
    };

    // Per-measure time signature: carry the current TS, override where an
    // annotation's column lands.
    const measureTS = Array.from({ length: M }, () => ({ num: curNum, den: curDen }));
    for (const ann of [...pendingTS].sort((a, b) => a.charIndex - b.charIndex)) {
      const k = segOf(ann.charIndex);
      for (let kk = k; kk < M; kk++) measureTS[kk] = { num: ann.num, den: ann.den };
    }
    pendingTS = [];

    // Measure start ticks + emit TS changes.
    const measureStart: number[] = [];
    let t = blockStartTick;
    for (let k = 0; k < M; k++) {
      measureStart[k] = t;
      const ts = measureTS[k];
      const last = timeSignatures[timeSignatures.length - 1];
      if (ts.num !== last.numerator || ts.den !== last.denominator) {
        pushTS(t, ts.num, ts.den);
      }
      t += ticksPerBar({ numerator: ts.num, denominator: ts.den });
    }
    curNum = measureTS[M - 1].num;
    curDen = measureTS[M - 1].den;

    // Resolve chord markers (from the annotation line above this block) to ticks,
    // beat-snapped within their measure. The first chord of a measure anchors to
    // the downbeat (the label often sits a few chars in, after a `4/4 ` prefix);
    // later chords snap to their nearest beat, kept strictly ordered.
    if (pendingChords.length) {
      const byMeasure = new Map<number, { charIndex: number; symbol: string }[]>();
      for (const pc of pendingChords) {
        const k = segOf(pc.charIndex);
        const arr = byMeasure.get(k);
        if (arr) arr.push(pc);
        else byMeasure.set(k, [pc]);
      }
      for (const [k, pcs] of byMeasure) {
        pcs.sort((a, b) => a.charIndex - b.charIndex);
        const ts = measureTS[k];
        const beats = ts.num;
        const beatLen = ticksPerBar({ numerator: ts.num, denominator: ts.den }) / beats;
        const segStart = bars[k];
        const segEnd = bars[k + 1] ?? segStart + 1;
        let prevBeat = -1;
        pcs.forEach((pc, idx) => {
          const frac =
            segEnd > segStart
              ? Math.min(1, Math.max(0, (pc.charIndex - segStart) / (segEnd - segStart)))
              : 0;
          let beat = idx === 0 ? 0 : Math.round(frac * beats);
          beat = Math.min(beats - 1, Math.max(prevBeat + 1, beat));
          prevBeat = beat;
          chords.push({ atTick: measureStart[k] + beat * beatLen, symbol: pc.symbol });
        });
      }
      pendingChords = [];
    }

    // Note columns per measure (sorted), for content-fill timing below.
    const colsByMeasure = new Map<number, number[]>();
    for (const c of cols) {
      const k = segOf(c);
      const arr = colsByMeasure.get(k);
      if (arr) arr.push(c);
      else colsByMeasure.set(k, [c]);
    }
    // Beat-legend markers (`+`/`.`) per measure: columns of the evenly-spaced
    // subdivision grid the tab author drew under the staff. When present, they
    // give the EXACT rhythm — snap each note to its nearest marker.
    const markersByMeasure = new Map<number, number[]>();
    if (legend) {
      for (let i = 0; i < legend.length; i++) {
        if (legend[i] === '+' || legend[i] === '.') {
          const k = segOf(i);
          const arr = markersByMeasure.get(k);
          if (arr) arr.push(i);
          else markersByMeasure.set(k, [i]);
        }
      }
    }

    // Map each note column to an onset tick.
    //  • With a legend: snap to the nearest subdivision marker (exact rhythm).
    //  • Without: EVEN spacing by default, but keep OBVIOUS extra space. First
    //    note on the downbeat, last ends on the bar line, trailing padding
    //    excluded. (See the grid-quantization comment below.)
    const onsetOf = new Map<number, number>();
    for (const [k, mcols] of colsByMeasure) {
      const ticks = ticksPerBar({ numerator: measureTS[k].num, denominator: measureTS[k].den });
      const first = mcols[0];
      const markers = markersByMeasure.get(k);
      if (markers && markers.length >= 2) {
        // Each marker is one subdivision; marker j sits at measureStart + j*step.
        // Interpolate a note's column between the two markers bracketing it, so a
        // note exactly on a marker lands on the grid while a note between markers
        // (e.g. a sixteenth inside an eighth grid) keeps its finer placement.
        const step = ticks / markers.length;
        const interp = (c: number): number => {
          if (c <= markers[0]) {
            const spc = markers[1] - markers[0];
            return Math.max(measureStart[k], measureStart[k] + ((c - markers[0]) / spc) * step);
          }
          for (let j = 0; j < markers.length - 1; j++) {
            if (c <= markers[j + 1]) {
              const frac = (c - markers[j]) / (markers[j + 1] - markers[j]);
              return measureStart[k] + (j + frac) * step;
            }
          }
          const j = markers.length - 1;
          const spc = markers[j] - markers[j - 1];
          const t = measureStart[k] + (j + (c - markers[j]) / spc) * step;
          return Math.min(measureStart[k] + ticks, t);
        };
        for (const c of mcols) onsetOf.set(c, interp(c));
        continue;
      }
      if (mcols.length === 1) {
        onsetOf.set(first, measureStart[k]); // lone note on the downbeat (sustains)
        continue;
      }
      // Quantize gaps to a grid: read EVENLY by default, keep OBVIOUS extra
      // space. `base` is a robust small gap (25th percentile — resists the extra
      // dash of padding tabs put at a measure's edges). Each gap becomes whole
      // grid-steps via floor(g/base + 0.4): a ~1.6× threshold, so minor jitter
      // (a 1.5×-wide edge gap) collapses to one step while a clearly wider gap
      // (≥~1.6×) earns extra steps. The steps then fill the bar evenly.
      const colGaps: number[] = [];
      for (let i = 1; i < mcols.length; i++) colGaps.push(mcols[i] - mcols[i - 1]);
      const sortedGaps = [...colGaps].sort((a, b) => a - b);
      const base = Math.max(1, sortedGaps[Math.floor(sortedGaps.length * 0.25)]);
      let pos = 0;
      const stepPos = [0];
      for (const g of colGaps) {
        pos += Math.max(1, Math.floor(g / base + 0.4));
        stepPos.push(pos);
      }
      const step = ticks / (pos + 1); // +1 implied final note → last ends on the bar line
      mcols.forEach((c, i) => onsetOf.set(c, measureStart[k] + stepPos[i] * step));
    }

    for (let ci = 0; ci < cols.length; ci++) {
      const c = cols[ci];
      const k = segOf(c);
      const at = onsetOf.get(c)!;
      const nextInSameMeasure = ci < cols.length - 1 && segOf(cols[ci + 1]) === k;
      const measureEnd =
        measureStart[k] + ticksPerBar({ numerator: measureTS[k].num, denominator: measureTS[k].den });
      // Interior note → up to the next onset; last note of the measure → fill to
      // the bar line, which (by the span construction above) equals the median
      // note length, so it matches its neighbours AND leaves no trailing gap.
      const dur = nextInSameMeasure ? onsetOf.get(cols[ci + 1])! - at : measureEnd - at;
      events.push({
        atTick: at,
        durationTicks: Math.max(MIN_DURATION, dur),
        notes: byCol.get(c)!.map(toIRNote),
      });
    }
    blockStartTick = t;
  };

  for (const line of lines) {
    const header = line.match(SECTION_RE);
    if (header) {
      flush();
      sections.push({ atTick: blockStartTick, name: header[1].trim() });
      continue;
    }
    if (isTabLine(line)) {
      block.push(line);
      continue;
    }
    // A rhythm-legend line belongs to the block just above it — capture it so
    // flush() can snap notes to its subdivision grid, then flush.
    if (block.length > 0 && beatLine === null && isBeatLine(line)) {
      beatLine = line;
      flush();
      continue;
    }
    // Any other non-tab line ends the current block; harvest time-sig and chord
    // annotations (often on the same line) for the next block.
    flush();
    pendingTS.push(...scanTimeSigTokens(line));
    pendingChords.push(...scanChordTokens(line));
  }
  flush();

  const instrumentHint = blockHeight <= 4 ? 'bass' : 'guitar';
  return {
    meta: { sourceFormat: 'ascii-tab' },
    ticksPerQuarter: PPQ,
    totalTicks: blockStartTick,
    tempos: [{ atTick: 0, bpm: 120, interpolation: 'step' }],
    timeSignatures,
    keySignatures: [],
    sections,
    chords,
    tracks: [
      {
        id: 'tab-1',
        name: instrumentHint === 'bass' ? 'Bass' : 'Guitar',
        instrumentHint,
        capo: 0,
        events,
      },
    ],
  };
}
