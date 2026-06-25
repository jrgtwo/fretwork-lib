import { describe, it, expect } from 'vitest';
import { parseChordChart } from '../src/import/chord-chart/parse-chord-chart';

describe('parseChordChart', () => {
  it('extracts ordered chords and the unique set from a simple section', () => {
    const text = [
      '[Intro]',
      'G       G       Em      Em',
      'C       D       G       G',
    ].join('\n');

    const chart = parseChordChart(text);

    expect(chart.sections.map((s) => s.name)).toEqual(['Intro']);
    expect(chart.sections[0].chords).toEqual(['G', 'G', 'Em', 'Em', 'C', 'D', 'G', 'G']);
    expect(chart.uniqueSymbols).toEqual(['G', 'Em', 'C', 'D']);
  });

  it('extracts chords above a lyric line and skips the lyric', () => {
    const text = [
      '[Verse]',
      '    D                   A           A7',
      'Hey Jude, dont make it bad, take a sad song',
    ].join('\n');

    const chart = parseChordChart(text);
    expect(chart.sections[0].chords).toEqual(['D', 'A', 'A7']);
  });

  it('ignores transposition/legend lines containing "="', () => {
    const text = ['[Capo notes]', 'D     = E', 'A     = B'].join('\n');
    const chart = parseChordChart(text);
    expect(chart.uniqueSymbols).toEqual([]);
  });

  it('ignores metadata lines like "Tuning: E A D G B E"', () => {
    const text = ['Tuning: E A D G B EKey: G', '[Intro]', 'G  Am7  C'].join('\n');
    const chart = parseChordChart(text);
    expect(chart.uniqueSymbols).toEqual(['G', 'Am7', 'C']);
  });

  it('does not treat lowercase words like "(a tempo)" as chords', () => {
    const text = ['[Coda]', '| Am | Dm |', '   (a tempo)'].join('\n');
    const chart = parseChordChart(text);
    expect(chart.uniqueSymbols).toEqual(['Am', 'Dm']);
  });
});
