import { describe, it, expect } from 'vitest';
import {
  wrapTick,
  currentIterationOffset,
  selectIterationEvents,
} from '../src/patterns/scheduler/loop-region';

describe('wrapTick', () => {
  it('wraps within a [0, len) region like a plain modulo', () => {
    expect(wrapTick(0, 0, 100)).toBe(0);
    expect(wrapTick(99, 0, 100)).toBe(99);
    expect(wrapTick(100, 0, 100)).toBe(0);
    expect(wrapTick(250, 0, 100)).toBe(50);
  });

  it('wraps within an offset region [start, end)', () => {
    // region [40, 100): length 60. tick 100 -> 40, tick 130 -> 70, tick 160 -> 40
    expect(wrapTick(40, 40, 100)).toBe(40);
    expect(wrapTick(100, 40, 100)).toBe(40);
    expect(wrapTick(130, 40, 100)).toBe(70);
    expect(wrapTick(160, 40, 100)).toBe(40);
  });

  it('returns the tick unchanged for a zero/negative-length region', () => {
    expect(wrapTick(55, 40, 40)).toBe(55);
  });
});

describe('currentIterationOffset', () => {
  it('returns the loopOffset of the iteration containing now', () => {
    // region [0,100): now=250 -> offset 200
    expect(currentIterationOffset(250, 0, 100)).toBe(200);
    // region [40,100): length 60. now=130 -> iterations start at 40,100,160...
    //   floor((130-40)/60)=1 -> 40 + 1*60 = 100
    expect(currentIterationOffset(130, 40, 100)).toBe(100);
  });
});

describe('selectIterationEvents', () => {
  it('keeps only indices whose absolute tick is strictly ahead of fromTick', () => {
    expect(selectIterationEvents([0, 100, 200], 100)).toEqual([2]);
    expect(selectIterationEvents([0, 100, 200], -Infinity)).toEqual([0, 1, 2]);
    expect(selectIterationEvents([0, 100, 200], 250)).toEqual([]);
  });
});
