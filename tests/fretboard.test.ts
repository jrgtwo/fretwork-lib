import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { createElement } from 'react';
import { render, renderHook, cleanup, fireEvent } from '@testing-library/react';
import {
  buildGrid,
  effectiveOpenStrings,
  computeHighlights,
  fretX,
  fretCenterX,
  FRET_COUNT,
} from '../src/lib/fretboard';
import { getTuning } from '../src/lib/tunings';
import { getScale } from '../src/lib/scales';
import { Fretboard } from '../src/components/fretboard/Fretboard';
import { useFretboardModel } from '../src/components/fretboard/useFretboardModel';
import { usePlayback, _resetSharedPlaybackForTests } from '../src/playback/usePlayback';
import { usePlaybackStore } from '../src/playback/usePlaybackStore';
import { useFretworkStore } from '../src/store/useFretworkStore';
import type { Playback } from '../src/playback/Playback';
import type { Highlight } from '../src/types';

// Counts every `new Playback(...)`. The <Fretboard> defect this guards was that
// merely rendering a board built the Practice singleton (plus its voice + metronome
// subscriptions) — a return-value assertion would not have caught it.
const playbackSpy = vi.hoisted(() => ({ constructed: 0 }));
vi.mock('../src/playback/Playback', () => {
  class FakePlayback {
    constructor() {
      playbackSpy.constructed++;
    }
    dispose(): void {}
    onPlayheadChange(): void {}
    setEnabled(): void {}
    setPatternId(): void {}
    setCustomSequence(): void {}
    setResolveInput(): void {}
    setInstrument(): void {}
    startProgramming(): void {}
    finishProgramming(): void {}
    addCustomCell(): void {}
    get resolvedSequence(): readonly unknown[] {
      return [];
    }
    get playheadIndex(): number {
      return 0;
    }
  }
  return { Playback: FakePlayback };
});

const STANDARD = getTuning('standard')!;
const DROP_D = getTuning('drop-d')!;

describe('buildGrid', () => {
  it('builds 6 strings × 23 columns', () => {
    const grid = buildGrid(STANDARD);
    expect(grid).toHaveLength(6);
    grid.forEach((row) => expect(row).toHaveLength(FRET_COUNT + 1));
  });

  it('low-E open is E2, fret 5 is A2, fret 12 is E3', () => {
    const [lowE] = buildGrid(STANDARD);
    expect(lowE[0].note).toBe('E2');
    expect(lowE[5].note).toBe('A2');
    expect(lowE[12].note).toBe('E3');
  });

  it('drop-d retunes the lowest string', () => {
    const [lowString] = buildGrid(DROP_D);
    expect(lowString[0].note).toBe('D2');
    expect(lowString[2].note).toBe('E2');
  });

  it('high-E (string index 5) open is E4', () => {
    const grid = buildGrid(STANDARD);
    expect(grid[5][0].note).toBe('E4');
    expect(grid[5][7].note).toBe('B4');
  });
});

describe('effectiveOpenStrings', () => {
  it('returns standard tuning when no capo', () => {
    expect(effectiveOpenStrings(STANDARD)).toEqual(['E2', 'A2', 'D3', 'G3', 'B3', 'E4']);
  });

  it('shifts up correctly with capo at 5', () => {
    expect(effectiveOpenStrings(STANDARD, 5)).toEqual(['A2', 'D3', 'G3', 'C4', 'E4', 'A4']);
  });

  it('handles drop-d with capo at 2', () => {
    // Tonal's default fromMidi spelling may use flats for these chromatic positions —
    // accept either enharmonic form. The headstock UI re-spells in the active key anyway.
    const result = effectiveOpenStrings(DROP_D, 2);
    expect(result[0]).toBe('E2');
    expect(result[1]).toBe('B2');
    expect(result[2]).toBe('E3');
    expect(result[3]).toBe('A3');
    expect(['C#4', 'Db4']).toContain(result[4]);
    expect(['F#4', 'Gb4']).toContain(result[5]);
  });
});

describe('computeHighlights', () => {
  const major = getScale('major')!;

  it('A major across the neck contains expected pitch classes only', () => {
    const grid = buildGrid(STANDARD);
    const highlights = computeHighlights(grid, 'A', major.intervals);
    // A major pitch classes: A=9, B=11, C#=1, D=2, E=4, F#=6, G#=8
    const expectedPCs = new Set([9, 11, 1, 2, 4, 6, 8]);
    for (const h of highlights) {
      const cell = grid[h.stringIndex][h.fret];
      expect(expectedPCs.has(cell.pitchClass)).toBe(true);
    }
  });

  it('low-E string in A major lights frets 0, 2, 4, 5, 7, 9, 11, 12 (and up)', () => {
    const grid = buildGrid(STANDARD);
    const highlights = computeHighlights(grid, 'A', major.intervals)
      .filter((h) => h.stringIndex === 0)
      .map((h) => h.fret)
      .sort((a, b) => a - b);
    // First octave on low E in A major:
    //   0=E (5th), 2=F# (6th), 4=G# (7th), 5=A (root), 7=B (2nd), 9=C# (3rd), 10=D (4th), 12=E (5th)
    expect(highlights.slice(0, 8)).toEqual([0, 2, 4, 5, 7, 9, 10, 12]);
  });

  it('marks the root pitch class with the "root" category', () => {
    const grid = buildGrid(STANDARD);
    const highlights = computeHighlights(grid, 'A', major.intervals);
    const roots = highlights.filter((h) => h.category === 'root');
    // Every A on the neck should be a root.
    for (const r of roots) {
      const cell = grid[r.stringIndex][r.fret];
      expect(cell.pitchClass).toBe(9); // A = 9
    }
    // 5th-fret low-E (A2) is a root.
    expect(roots.some((r) => r.stringIndex === 0 && r.fret === 5)).toBe(true);
  });

  it('Notes mode (intervals = [0]) lights only the chosen note', () => {
    const grid = buildGrid(STANDARD);
    const highlights = computeHighlights(grid, 'C', [0]);
    expect(highlights.every((h) => h.category === 'root')).toBe(true);
    // 1st fret B3 string → C4 ✓
    expect(highlights.some((h) => h.stringIndex === 4 && h.fret === 1)).toBe(true);
  });

  it('with capo at 5, hides cells before the capo', () => {
    const grid = buildGrid(STANDARD, 5);
    const highlights = computeHighlights(grid, 'A', major.intervals, 5);
    // No highlights at fret 0..4 on any string.
    expect(highlights.every((h) => h.fret >= 5)).toBe(true);
  });

  it('arpeggio (maj7 = [0,4,7,11]) only highlights those four pitch classes', () => {
    const grid = buildGrid(STANDARD);
    const highlights = computeHighlights(grid, 'C', [0, 4, 7, 11]);
    // C maj7: C=0, E=4, G=7, B=11
    const expected = new Set([0, 4, 7, 11]);
    for (const h of highlights) {
      const cell = grid[h.stringIndex][h.fret];
      expect(expected.has(cell.pitchClass)).toBe(true);
    }
  });
});

describe('fretX', () => {
  it('puts fret 0 at 0 and fret 22 at scaleLength', () => {
    expect(fretX(0, 1000)).toBe(0);
    expect(fretX(22, 1000)).toBe(1000);
  });

  it('is monotonically increasing', () => {
    let prev = -1;
    for (let f = 0; f <= 22; f++) {
      const x = fretX(f, 1000);
      expect(x).toBeGreaterThan(prev);
      prev = x;
    }
  });

  it('compresses higher frets (interval 1→2 wider than 21→22)', () => {
    const d_low = fretX(2, 1000) - fretX(1, 1000);
    const d_high = fretX(22, 1000) - fretX(21, 1000);
    expect(d_low).toBeGreaterThan(d_high);
  });
});

describe('fretCenterX', () => {
  it('is between adjacent fret lines', () => {
    const c = fretCenterX(5, 1000);
    expect(c).toBeGreaterThan(fretX(4, 1000));
    expect(c).toBeLessThan(fretX(5, 1000));
  });
});

describe('<Fretboard>', () => {
  const fretworkState = useFretworkStore.getState();
  const playbackState = usePlaybackStore.getState();

  afterEach(() => {
    cleanup();
    useFretworkStore.setState(fretworkState, true);
    usePlaybackStore.setState(playbackState, true);
  });

  afterAll(() => {
    _resetSharedPlaybackForTests();
  });

  const markers = (root: HTMLElement) => root.querySelectorAll('.fb-marker');
  const ghosted = (root: HTMLElement) => root.querySelectorAll('.fb-marker.fb-ghosted');
  const filler = (root: HTMLElement) => root.querySelectorAll('.fb-marker.fb-dimmed');
  const playheads = (root: HTMLElement) => root.querySelectorAll('.fb-marker.fb-playhead');
  // 6 strings × frets 0..22 — the whole grid dimNonHighlighted must fill.
  const GRID = 6 * 23;
  const ROOT_A: Highlight = {
    stringIndex: 0,
    fret: 5,
    noteName: 'A2',
    intervalLabel: 'R',
    degreeNumber: 1,
    category: 'root',
  };

  it('does not construct the Playback singleton, though usePlayback still does', () => {
    _resetSharedPlaybackForTests();
    const before = playbackSpy.constructed;

    render(createElement(Fretboard));
    expect(playbackSpy.constructed - before).toBe(0);
    cleanup();

    // Control: the counter is live. The call the model used to make DOES build the
    // singleton, so the zero above is evidence the path is gone, not that the spy
    // is inert. Deltas, not absolute counts, so test order can't invert the meaning.
    function Probe() {
      usePlayback();
      return null;
    }
    render(createElement(Probe));
    expect(playbackSpy.constructed - before).toBe(1);
    cleanup();
    _resetSharedPlaybackForTests();
  });

  it('hands the injected Playback straight back out on the model', () => {
    const stub = { addCustomCell: vi.fn() } as unknown as Playback;
    const { result } = renderHook(() => useFretboardModel({ playback: stub }));
    expect(result.current.playback).toBe(stub);

    const { result: bare } = renderHook(() => useFretboardModel());
    expect(bare.current.playback).toBeNull();
  });

  it('routes legacy click-to-program into the injected Playback', () => {
    const addCustomCell = vi.fn();
    const stub = { addCustomCell } as unknown as Playback;
    usePlaybackStore.setState({ isProgramming: true, customSequence: [] });

    const { container } = render(
      createElement(Fretboard, { highlights: [ROOT_A], playback: stub }),
    );
    const marker = container.querySelector('.fb-marker');
    expect(marker).not.toBeNull();
    fireEvent.click(marker!);

    expect(addCustomCell).toHaveBeenCalledWith({ stringIndex: 0, fret: 5 });
    // The store mirror is what draws the badge; both halves must fire.
    expect(usePlaybackStore.getState().customSequence).toEqual([
      { stringIndex: 0, fret: 5 },
    ]);
  });

  it('derives highlights from the store when the prop is absent', () => {
    const { container } = render(createElement(Fretboard));
    expect(markers(container).length).toBeGreaterThan(0);
  });

  it('draws no markers when highlights is explicitly empty', () => {
    const { container } = render(createElement(Fretboard, { highlights: [] }));
    expect(markers(container)).toHaveLength(0);
  });

  it('uses the derived aria-label by default', () => {
    const { container } = render(createElement(Fretboard));
    expect(container.querySelector('svg')?.getAttribute('aria-label')).toMatch(
      /^Fretboard showing A .+ in .+$/,
    );
  });

  it('lets ariaLabel override the derived label', () => {
    const { container } = render(
      createElement(Fretboard, { highlights: [], ariaLabel: 'Pattern footprint' }),
    );
    expect(container.querySelector('svg')?.getAttribute('aria-label')).toBe(
      'Pattern footprint',
    );
  });

  it('dimNonHighlighted renders the whole grid and fades everything outside the highlights', () => {
    const plain = render(createElement(Fretboard, { highlights: [ROOT_A] }));
    expect(markers(plain.container)).toHaveLength(1);
    expect(filler(plain.container)).toHaveLength(0);
    cleanup();

    const dim = render(
      createElement(Fretboard, { highlights: [ROOT_A], dimNonHighlighted: true }),
    );
    expect(markers(dim.container)).toHaveLength(GRID);
    expect(filler(dim.container)).toHaveLength(GRID - 1);
  });

  it('dimNonHighlighted still renders the filler neutrally when the store shows intervals', () => {
    // Filler cells carry no interval label, so `labels: 'intervals'` would render them
    // blank if the dim path stopped forcing neutral styling.
    useFretworkStore.setState({ labels: 'intervals' });
    const { container } = render(
      createElement(Fretboard, { highlights: [ROOT_A], dimNonHighlighted: true }),
    );
    const labelled = Array.from(filler(container)).filter(
      (g) => (g.querySelector('text')?.textContent ?? '') !== '',
    );
    expect(labelled).toHaveLength(GRID - 1);
  });

  it('dimNonHighlighted leaves activeCells bright, not faded', () => {
    const active = [{ stringIndex: 3, fret: 7 }];
    const { container } = render(
      createElement(Fretboard, {
        highlights: [ROOT_A],
        dimNonHighlighted: true,
        activeCells: active,
      }),
    );
    // The grid stays complete: filler + highlight + the activity layer's own marker.
    expect(markers(container)).toHaveLength(GRID);
    expect(playheads(container)).toHaveLength(1);
    expect(container.querySelectorAll('.fb-playhead.fb-dimmed')).toHaveLength(0);
    expect(container.querySelectorAll('.fb-playhead.fb-ghosted')).toHaveLength(0);
  });

  it('dimNonHighlighted keeps footprintCells distinguishable from the filler', () => {
    const { container } = render(
      createElement(Fretboard, {
        highlights: [ROOT_A],
        dimNonHighlighted: true,
        footprintCells: [{ stringIndex: 3, fret: 7 }],
      }),
    );
    expect(markers(container)).toHaveLength(GRID);
    // Footprint keeps the ghosted tier; the filler sits in its own fainter tier.
    expect(ghosted(container)).toHaveLength(1);
    expect(filler(container)).toHaveLength(GRID - 2);
  });

  it('dimNonHighlighted fills CAGED-hidden cells rather than leaving holes', () => {
    useFretworkStore.setState({
      mode: 'scales',
      key: 'A',
      type: 'major',
      shapeId: 'caged-c',
      settings: { ...fretworkState.settings, showGhostMarkers: false },
    });
    const { container } = render(createElement(Fretboard, { dimNonHighlighted: true }));
    expect(markers(container)).toHaveLength(GRID);
  });
});
