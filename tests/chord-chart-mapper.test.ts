import { describe, it, expect } from 'vitest';
import { mapChordChartToLibrary } from '../src/import/chord-chart/map-chord-chart';
import { parseChordChart } from '../src/import/chord-chart/parse-chord-chart';
import { getTuning } from '../src/lib/tunings';
import type { TuningDef } from '../src/types';

const standard = getTuning('standard') as TuningDef;

function placementsOf(comp: { tracks: { placements: any[] }[] }) {
  return [...comp.tracks[0].placements].sort((a, b) => a.startTick - b.startTick);
}

describe('mapChordChartToLibrary', () => {
  it('creates one pattern per unique chord, placed one-per-bar in order', () => {
    const chart = parseChordChart('[Intro]\nG  Em  C  G');
    const res = mapChordChartToLibrary({
      chart,
      fileName: 'stand-by-me-chords.txt',
      instrumentId: 'guitar',
      tuning: standard,
    });

    // 3 unique chords → 3 library patterns
    expect(res.patterns.map((p) => p.name).sort()).toEqual(['C', 'Em', 'G']);

    // composition places all 4 occurrences in order
    const placements = placementsOf(res.composition);
    expect(placements.map((p) => p.patternSnapshot.name)).toEqual(['G', 'Em', 'C', 'G']);

    // one chord per bar at 4/4 / 480 ppq → 1920 ticks/bar
    expect(placements.map((p) => p.startTick)).toEqual([0, 1920, 3840, 5760]);

    // the two G placements reuse the same source pattern
    expect(placements[0].patternSnapshot.id).toBe(placements[3].patternSnapshot.id);

    // folder + composition name derived from the filename
    expect(res.folderName).toBe('Stand By Me');
    expect(res.composition.name).toBe('Stand By Me');
  });

  it('uses caller-provided grips instead of auto-voicing', () => {
    const chart = parseChordChart('[I]\nC');
    const res = mapChordChartToLibrary({
      chart,
      fileName: 'x.txt',
      instrumentId: 'guitar',
      tuning: standard,
      gripsBySymbol: { C: { cells: [{ stringIndex: 0, fret: 8 }] } },
    });
    const cPattern = res.patterns.find((p) => p.name === 'C')!;
    expect(cPattern.events.map((e) => ({ s: e.stringIndex, f: e.fret }))).toEqual([
      { s: 0, f: 8 },
    ]);
  });

  it('voices each chord pattern with real fret events', () => {
    const chart = parseChordChart('[Intro]\nC');
    const res = mapChordChartToLibrary({
      chart,
      fileName: 'x.txt',
      instrumentId: 'guitar',
      tuning: standard,
    });
    const cPattern = res.patterns.find((p) => p.name === 'C')!;
    // open C = x 3 2 0 1 0 → 5 sounding strings, all at tick 0, ringing the bar
    expect(cPattern.events.length).toBe(5);
    for (const e of cPattern.events) {
      expect(e.startTick).toBe(0);
      expect(e.durationTicks).toBe(1920);
    }
  });
});
