/**
 * Chord-chart → library mapper. Turns a parsed chord chart into the rows the
 * app already knows how to render: one Pattern per *unique* chord (the chord
 * grip, voiced onto the fretboard) and one Composition that places those
 * patterns in appearance order, one chord per bar.
 *
 * Pure: produces in-memory Pattern/Composition rows + a suggested folder name.
 * Persisting them (creating the folder, assigning ids to the store, cloud sync)
 * is the commit step's job, not this function's.
 */
import type {
  Pattern,
  Composition,
  Placement,
  PatternEvent,
  PatternTimeSignature,
} from '../../patterns/types';
import type { TuningDef } from '../../types';
import type { ChordChart } from './parse-chord-chart';
import { parseChordSymbol } from '../../lib/chords';
import { voiceChordPreferred, type Grip } from '../../lib/chord-voicing';
import { buildPattern, buildComposition, clonePatternForPlacement } from '../mapper';
import { ticksPerBar } from '../../patterns/timebase';
import { generateUuid } from '../../patterns/ids';

const DEFAULT_TS: PatternTimeSignature = { numerator: 4, denominator: 4 };
const DEFAULT_BPM = 120;

export interface ChordMapInput {
  chart: ChordChart;
  /** Original file name — drives the folder + composition name. */
  fileName: string;
  instrumentId: string;
  tuning: TuningDef;
  bpm?: number;
  timeSignature?: PatternTimeSignature;
  /**
   * Pre-resolved grips per chord symbol (e.g. from the import review palette,
   * where the user may have adjusted voicings). When a symbol is absent, the
   * mapper auto-voices it with `voiceChordPreferred`.
   */
  gripsBySymbol?: Record<string, Grip>;
}

export interface ChordMapResult {
  patterns: Pattern[];
  composition: Composition;
  /** Suggested library folder name (created at commit time). */
  folderName: string;
  warnings: string[];
}

/** `blackbird-chords.txt` → "Blackbird"; `stand-by-me-chords.txt` → "Stand By Me". */
export function prettifyFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const noExt = base.replace(/\.[^.]+$/, '');
  const noSuffix = noExt.replace(/[-_](chords?|tabs?)$/i, '');
  return noSuffix
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Default voicing per unique chord — seeds the review palette's editable grips. */
export function defaultGripsForChart(
  chart: ChordChart,
  tuning: TuningDef,
): Record<string, Grip> {
  const out: Record<string, Grip> = {};
  for (const symbol of chart.uniqueSymbols) {
    const parsed = parseChordSymbol(symbol);
    const grip = parsed ? voiceChordPreferred(parsed, tuning) : null;
    if (grip && grip.cells.length > 0) out[symbol] = grip;
  }
  return out;
}

export function mapChordChartToLibrary(input: ChordMapInput): ChordMapResult {
  const { chart, fileName, instrumentId, tuning } = input;
  const ts = input.timeSignature ?? DEFAULT_TS;
  const bpm = input.bpm ?? DEFAULT_BPM;
  const barTicks = ticksPerBar(ts);
  const name = prettifyFileName(fileName);
  const warnings: string[] = [];

  const tempoTrack = [{ atTick: 0, bpm, interpolation: 'step' as const }];
  const timeSignatureTrack = [
    { atTick: 0, numerator: ts.numerator, denominator: ts.denominator },
  ];

  // 1. One Pattern per unique chord — the voiced grip, ringing a full bar.
  const patternBySymbol = new Map<string, Pattern>();
  const patterns: Pattern[] = [];
  for (const symbol of chart.uniqueSymbols) {
    const provided = input.gripsBySymbol?.[symbol];
    const parsed = provided ? null : parseChordSymbol(symbol);
    const grip = provided ?? (parsed ? voiceChordPreferred(parsed, tuning) : null);
    if (!grip || grip.cells.length === 0) {
      warnings.push(`Could not voice chord "${symbol}" — skipped.`);
      continue;
    }
    const events: PatternEvent[] = grip.cells.map((c) => ({
      id: generateUuid(),
      stringIndex: c.stringIndex,
      fret: c.fret,
      startTick: 0,
      durationTicks: barTicks,
    }));
    const pattern = buildPattern({
      name: symbol,
      instrumentId,
      events,
      durationTicks: barTicks,
      timeSignature: ts,
      suggestedBpm: bpm,
      tempoTrack,
      timeSignatureTrack,
      sourceIR: null,
    });
    patternBySymbol.set(symbol, pattern);
    patterns.push(pattern);
  }

  // 2. Place every occurrence in order, one bar each.
  const placements: Placement[] = [];
  let bar = 0;
  for (const section of chart.sections) {
    for (const symbol of section.chords) {
      const pattern = patternBySymbol.get(symbol);
      if (!pattern) continue; // unvoiced chord — already warned
      placements.push({
        id: generateUuid(),
        patternSnapshot: clonePatternForPlacement(pattern),
        startTick: bar * barTicks,
        repeat: 1,
        transposeSemitones: 0,
        lengthTicks: null,
      });
      bar++;
    }
  }

  const composition = buildComposition({
    name,
    instrumentId,
    bpm,
    timeSignature: ts,
    placements,
    tempoTrack,
    timeSignatureTrack,
    sourceIR: null,
  });

  return { patterns, composition, folderName: name, warnings };
}
