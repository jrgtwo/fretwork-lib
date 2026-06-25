import { describe, it, expect } from 'vitest';
import { parseChordSymbol, detectChordName } from '../src/lib/chords';

describe('parseChordSymbol', () => {
  it('parses a major triad to root + pitch classes', () => {
    const c = parseChordSymbol('G');
    expect(c).not.toBeNull();
    expect(c!.root).toBe('G');
    expect(c!.bass).toBeNull();
    expect(c!.pitchClasses).toEqual([7, 11, 2]); // G B D
  });

  it('captures the slash bass and lists it first', () => {
    const c = parseChordSymbol('G/B');
    expect(c!.root).toBe('G');
    expect(c!.bass).toBe('B');
    expect(c!.notes).toEqual(['B', 'D', 'G']); // bass-first
  });

  it('strips a trailing footnote marker', () => {
    const c = parseChordSymbol('Asus4*');
    expect(c!.symbol).toBe('Asus4');
    expect(c!.pitchClasses).toEqual([9, 2, 4]); // A D E
  });

  it('drops a non-quality parenthetical (no3rd)', () => {
    const c = parseChordSymbol('Gmaj7(no3rd)');
    expect(c!.symbol).toBe('Gmaj7');
    expect(c!.pitchClasses).toEqual([7, 11, 2, 6]); // G B D F#
  });

  it('inlines a real parenthetical modifier (add9)', () => {
    const c = parseChordSymbol('F(add9)');
    expect(c!.symbol).toBe('Fadd9');
    expect(c!.pitchClasses).toEqual([5, 9, 0, 7]); // F A C G
  });

  it('returns null for non-chord text', () => {
    expect(parseChordSymbol('There')).toBeNull();
    expect(parseChordSymbol('organ')).toBeNull();
    expect(parseChordSymbol('N.C.')).toBeNull();
  });
});

describe('detectChordName', () => {
  it('names a major triad without the M suffix', () => {
    expect(detectChordName(['C', 'E', 'G'])).toBe('C');
  });

  it('names a minor triad', () => {
    expect(detectChordName(['A', 'C', 'E'])).toBe('Am');
  });

  it('names sevenths', () => {
    expect(detectChordName(['G', 'B', 'D', 'F'])).toBe('G7');
    expect(detectChordName(['C', 'E', 'G', 'B'])).toBe('Cmaj7');
  });

  it('returns null when there is no chord', () => {
    expect(detectChordName(['C'])).toBeNull();
    expect(detectChordName([])).toBeNull();
  });
});
