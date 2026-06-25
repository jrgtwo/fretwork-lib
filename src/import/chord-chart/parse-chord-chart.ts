/**
 * Chord-sheet parser: raw text → a structured chord chart (sections + the
 * ordered chord sequence + the unique-chord set), tolerant of the cruft real
 * chord files carry (metadata headers, lyrics, prose, footnotes).
 *
 * Lines are classified, not positionally parsed: a line is a *chord line* when
 * most of its whitespace-separated tokens parse as chords (via the chord-symbol
 * parser). That single test distinguishes chord rows — bar grids (`| Am | C |`)
 * and chords-above-lyrics alike — from lyrics, prose, and metadata, without
 * needing column geometry.
 *
 * Output uses each chord's *cleaned* symbol (so `Asus4*` and `Asus4` are one
 * chord), which is also the identity the mapper dedupes patterns on.
 */
import { parseChordSymbol } from '../../lib/chords';

export interface ChordChartSection {
  name: string;
  /** Cleaned chord symbols in left-to-right, top-to-bottom order. */
  chords: string[];
}

export interface ChordChart {
  sections: ChordChartSection[];
  /** Distinct chord symbols in first-appearance order. */
  uniqueSymbols: string[];
}

const SECTION_RE = /^\s*\[([^\]]+)\]\s*$/;

/** Tokens of a line with bar separators removed. */
function chordTokens(line: string): string[] {
  return line
    .replace(/\|/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** A line is a chord line when at least half its tokens parse as chords. */
function isChordLine(line: string): boolean {
  // Transposition/legend lines ("D     = E") parse as chords on both sides but
  // are not a progression — the equals sign is the tell. A colon marks a
  // metadata/prose line ("Tuning: E A D G B E", "Email me at:"); chord notation
  // never uses one.
  if (line.includes('=') || line.includes(':')) return false;
  const tokens = chordTokens(line);
  if (tokens.length === 0) return false;
  const parsed = tokens.filter((t) => parseChordSymbol(t) !== null).length;
  return parsed > 0 && parsed >= Math.ceil(tokens.length / 2);
}

export function parseChordChart(text: string): ChordChart {
  const sections: ChordChartSection[] = [];
  const uniqueSeen = new Set<string>();
  const uniqueSymbols: string[] = [];
  let current: ChordChartSection | null = null;

  const ensureSection = (): ChordChartSection => {
    if (!current) {
      current = { name: '', chords: [] };
      sections.push(current);
    }
    return current;
  };

  for (const line of text.split(/\r?\n/)) {
    const header = line.match(SECTION_RE);
    if (header) {
      current = { name: header[1].trim(), chords: [] };
      sections.push(current);
      continue;
    }
    if (!isChordLine(line)) continue;

    const section = ensureSection();
    for (const token of chordTokens(line)) {
      const parsed = parseChordSymbol(token);
      if (!parsed) continue;
      section.chords.push(parsed.symbol);
      if (!uniqueSeen.has(parsed.symbol)) {
        uniqueSeen.add(parsed.symbol);
        uniqueSymbols.push(parsed.symbol);
      }
    }
  }

  return { sections, uniqueSymbols };
}
