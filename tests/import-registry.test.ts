import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerParser,
  getParser,
  getParsers,
  findParserForFile,
  _clearRegistry,
  type ImportParser,
} from '../src/import/parser-registry';
import type { ImportIR } from '../src/import/types';

const stubIR: ImportIR = {
  meta: { sourceFormat: 'guitar-pro' },
  ticksPerQuarter: 480,
  totalTicks: 0,
  tempos: [],
  timeSignatures: [],
  keySignatures: [],
  sections: [],
  tracks: [],
};

const makeStubParser = (overrides: Partial<ImportParser> = {}): ImportParser => ({
  id: 'guitar-pro',
  label: 'Guitar Pro',
  extensions: ['.gp', '.gp5'],
  parse: async () => stubIR,
  ...overrides,
});

describe('parser-registry', () => {
  beforeEach(() => _clearRegistry());

  it('register + getParser round-trips', () => {
    const p = makeStubParser();
    registerParser(p);
    expect(getParser('guitar-pro')).toBe(p);
  });

  it('returns null for an unregistered format', () => {
    expect(getParser('midi')).toBeNull();
  });

  it('getParsers lists registered parsers', () => {
    registerParser(makeStubParser());
    registerParser(makeStubParser({ id: 'midi', label: 'MIDI', extensions: ['.mid'] }));
    expect(getParsers().map((p) => p.id).sort()).toEqual(['guitar-pro', 'midi']);
  });

  it('findParserForFile dispatches by format', () => {
    const gp = makeStubParser();
    registerParser(gp);
    expect(
      findParserForFile({ name: 'song.gp5', head: new Uint8Array(), format: 'guitar-pro' }),
    ).toBe(gp);
  });

  it('canHandle veto causes extension fallback', () => {
    const vetoed = makeStubParser({ canHandle: () => false });
    const fallback = makeStubParser({
      id: 'midi',
      label: 'MIDI',
      extensions: ['.gp5'],
    });
    registerParser(vetoed);
    registerParser(fallback);
    expect(
      findParserForFile({ name: 'song.gp5', head: new Uint8Array(), format: 'guitar-pro' }),
    ).toBe(fallback);
  });

  it('returns null when nothing matches', () => {
    expect(
      findParserForFile({ name: 'mystery', head: new Uint8Array(), format: 'unknown' }),
    ).toBeNull();
  });
});
