import { describe, it, expect } from 'vitest';
import { splitChordSymbol, joinChordSymbol } from '../src/lib/chord-vocab';

describe('chord-vocab split/join', () => {
  it('splits a plain major chord', () => {
    expect(splitChordSymbol('G')).toEqual({ root: 'G', quality: '', bass: null });
  });
  it('splits a quality chord', () => {
    expect(splitChordSymbol('Am7')).toEqual({ root: 'A', quality: 'm7', bass: null });
  });
  it('splits a slash chord (imported G/B)', () => {
    expect(splitChordSymbol('G/B')).toEqual({ root: 'G', quality: '', bass: 'B' });
  });
  it('splits a flat root', () => {
    expect(splitChordSymbol('Bbmaj7')).toEqual({ root: 'Bb', quality: 'maj7', bass: null });
  });
  it('round-trips split → join', () => {
    for (const s of ['G', 'Am7', 'G/B', 'Bbmaj7', 'F#m7b5', 'Csus4']) {
      expect(joinChordSymbol(splitChordSymbol(s))).toBe(s);
    }
  });
  it('joins parts into a slash chord', () => {
    expect(joinChordSymbol({ root: 'D', quality: 'm', bass: 'F' })).toBe('Dm/F');
  });
});
