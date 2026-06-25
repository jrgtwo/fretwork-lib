import { describe, it, expect } from 'vitest';
import { mergeTies, type MergeableEvent } from '../src/patterns/tie-merge';

function ev(
  id: string,
  startTick: number,
  durationTicks: number,
  stringIndex: number,
  fret: number,
  extra: Partial<MergeableEvent> = {},
): MergeableEvent {
  return { id, startTick, durationTicks, stringIndex, fret, ...extra };
}

describe('mergeTies', () => {
  it('passes events through unchanged when no ties are set', () => {
    const input = [ev('a', 0, 480, 0, 5), ev('b', 480, 480, 0, 7)];
    const out = mergeTies(input);
    expect(out).toHaveLength(2);
    expect(out[0].durationTicks).toBe(480);
    expect(out[1].durationTicks).toBe(480);
  });

  it('collapses a two-event tied chain into one sustained note', () => {
    const input = [
      ev('a', 0, 480, 0, 5, { tieToNext: true }),
      ev('b', 480, 480, 0, 5),
    ];
    const out = mergeTies(input);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('a');
    expect(out[0].durationTicks).toBe(960);
    expect(out[0].tieToNext).toBeUndefined();
  });

  it('collapses a three-event tied chain', () => {
    const input = [
      ev('a', 0, 240, 0, 5, { tieToNext: true }),
      ev('b', 240, 240, 0, 5, { tieToNext: true }),
      ev('c', 480, 480, 0, 5),
    ];
    const out = mergeTies(input);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('a');
    expect(out[0].durationTicks).toBe(960);
  });

  it('refuses to merge if frets differ (treats tie as no-op)', () => {
    const input = [
      ev('a', 0, 480, 0, 5, { tieToNext: true }),
      ev('b', 480, 480, 0, 7),
    ];
    const out = mergeTies(input);
    expect(out).toHaveLength(2);
  });

  it('refuses to merge if there is a gap', () => {
    const input = [
      ev('a', 0, 240, 0, 5, { tieToNext: true }),
      ev('b', 480, 240, 0, 5), // gap from 240..480
    ];
    const out = mergeTies(input);
    expect(out).toHaveLength(2);
    expect(out[0].durationTicks).toBe(240);
  });

  it('refuses to merge if strings differ', () => {
    const input = [
      ev('a', 0, 480, 0, 5, { tieToNext: true }),
      ev('b', 480, 480, 1, 5),
    ];
    const out = mergeTies(input);
    expect(out).toHaveLength(2);
  });

  it('leaves an unrelated event between a tie chain alone', () => {
    const input = [
      ev('a', 0, 480, 0, 5, { tieToNext: true }),
      ev('b', 0, 480, 1, 3), // different string, unrelated
      ev('c', 480, 480, 0, 5),
    ];
    const out = mergeTies(input);
    // a + c merge → 1 event; b unaffected → 2 total
    expect(out).toHaveLength(2);
    const merged = out.find((e) => e.id === 'a');
    const unrelated = out.find((e) => e.id === 'b');
    expect(merged?.durationTicks).toBe(960);
    expect(unrelated?.durationTicks).toBe(480);
  });

  it('preserves hammerOn/pullOff flags on the leader event', () => {
    const input = [
      ev('a', 0, 480, 0, 5, { tieToNext: true, hammerOn: true }),
      ev('b', 480, 480, 0, 5),
    ];
    const out = mergeTies(input);
    expect(out[0].hammerOn).toBe(true);
  });
});
