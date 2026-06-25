import { describe, it, expect } from 'vitest';
import { noteAt, pitchClass, spellInKey, intervalLabel } from '../src/lib/theory';

describe('noteAt', () => {
  it('returns the open string when fret is 0', () => {
    expect(noteAt('E2', 0)).toBe('E2');
    expect(noteAt('A2', 0)).toBe('A2');
  });

  it('shifts up by semitones', () => {
    expect(noteAt('E2', 1)).toBe('F2');
    expect(noteAt('E2', 5)).toBe('A2');   // low E, fret 5 = A
    expect(noteAt('E2', 12)).toBe('E3');  // octave up
    expect(noteAt('A2', 12)).toBe('A3');
  });

  it('handles enharmonic open strings (Eb tuning)', () => {
    expect(noteAt('Eb2', 5)).toBe('Ab2');
  });

  it('throws on invalid pitch', () => {
    expect(() => noteAt('not-a-note', 3)).toThrow();
  });
});

describe('pitchClass', () => {
  it('maps notes to 0-11', () => {
    expect(pitchClass('C')).toBe(0);
    expect(pitchClass('C#')).toBe(1);
    expect(pitchClass('Db')).toBe(1);
    expect(pitchClass('E')).toBe(4);
    expect(pitchClass('B')).toBe(11);
  });

  it('ignores octave', () => {
    expect(pitchClass('A2')).toBe(pitchClass('A4'));
  });
});

describe('spellInKey', () => {
  it('spells A major correctly', () => {
    // A B C# D E F# G#
    const intervals = [0, 2, 4, 5, 7, 9, 11];
    const expected = ['A', 'B', 'C#', 'D', 'E', 'F#', 'G#'];
    intervals.forEach((iv, i) => {
      expect(spellInKey('A', iv)).toBe(expected[i]);
    });
  });

  it('spells F major with flats', () => {
    // F G A Bb C D E
    const intervals = [0, 2, 4, 5, 7, 9, 11];
    const expected = ['F', 'G', 'A', 'Bb', 'C', 'D', 'E'];
    intervals.forEach((iv, i) => {
      expect(spellInKey('F', iv)).toBe(expected[i]);
    });
  });

  it('spells minor scale correctly in C', () => {
    // C D Eb F G Ab Bb (natural minor: 0,2,3,5,7,8,10)
    const intervals = [0, 2, 3, 5, 7, 8, 10];
    const expected = ['C', 'D', 'Eb', 'F', 'G', 'Ab', 'Bb'];
    intervals.forEach((iv, i) => {
      expect(spellInKey('C', iv)).toBe(expected[i]);
    });
  });

  it('spells the blues scale in A correctly', () => {
    // A C D Eb E G  (intervals 0,3,5,6,7,10)
    const intervals = [0, 3, 5, 6, 7, 10];
    // Tonal will pick the conventional spelling; we accept either Eb or D# for the blue note,
    // but 6 semitones from A is most often spelled Eb in this context.
    const result = intervals.map((iv) => spellInKey('A', iv));
    expect(result[0]).toBe('A');
    expect(result[1]).toBe('C');
    expect(result[2]).toBe('D');
    // Blue note: accept either spelling.
    expect(['Eb', 'D#']).toContain(result[3]);
    expect(result[4]).toBe('E');
    expect(result[5]).toBe('G');
  });
});

describe('intervalLabel', () => {
  it('produces guitar-friendly degree shorthands', () => {
    expect(intervalLabel(0)).toBe('1');
    expect(intervalLabel(2)).toBe('2');
    expect(intervalLabel(3)).toBe('b3');
    expect(intervalLabel(4)).toBe('3');
    expect(intervalLabel(5)).toBe('4');
    expect(intervalLabel(6)).toBe('b5');
    expect(intervalLabel(7)).toBe('5');
    expect(intervalLabel(10)).toBe('b7');
    expect(intervalLabel(11)).toBe('7');
  });

  it('wraps around the octave', () => {
    expect(intervalLabel(12)).toBe('1');
    expect(intervalLabel(14)).toBe('2');
  });
});
