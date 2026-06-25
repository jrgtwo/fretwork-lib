import { describe, it, expect } from 'vitest';
import { MAX_FILE_SIZE, assertFileSize, sniffFormat } from '../src/import/file-guard';
import { FileTooLargeError } from '../src/import/errors';

describe('assertFileSize', () => {
  it('passes when under cap', () => {
    expect(() => assertFileSize(1000)).not.toThrow();
  });
  it('passes at exactly the cap', () => {
    expect(() => assertFileSize(MAX_FILE_SIZE)).not.toThrow();
  });
  it('throws FileTooLargeError over the cap', () => {
    expect(() => assertFileSize(MAX_FILE_SIZE + 1)).toThrow(FileTooLargeError);
  });
  it('respects an overridden cap', () => {
    expect(() => assertFileSize(200, 100)).toThrow(FileTooLargeError);
  });
});

describe('sniffFormat', () => {
  const enc = new TextEncoder();

  it('detects Guitar Pro 3/4/5 by FICHIER GUITAR PRO preamble', () => {
    const head = new Uint8Array(32);
    head[0] = 19; // pascal-style length byte (value unused by sniff)
    const written = enc.encodeInto('FICHIER GUITAR PRO', head.subarray(1));
    expect(written.written).toBeGreaterThan(0);
    expect(sniffFormat(head, 'song.gp5')).toBe('guitar-pro');
  });

  it('detects GP6/GP7 zip-style files by PK header (extension disambiguates)', () => {
    const head = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(sniffFormat(head, 'song.gp')).toBe('guitar-pro');
  });

  it('detects MIDI by MThd', () => {
    const head = new Uint8Array(16);
    enc.encodeInto('MThd', head);
    expect(sniffFormat(head, 'song.mid')).toBe('midi');
  });

  it('detects uncompressed MusicXML by <?xml prefix', () => {
    const head = enc.encode('<?xml version="1.0"');
    expect(sniffFormat(head.slice(0, 16), 'song.musicxml')).toBe('musicxml');
  });

  it('detects uncompressed MusicXML by <score-partwise prefix', () => {
    const head = enc.encode('<score-partwise');
    expect(sniffFormat(head.slice(0, 16), 'song.xml')).toBe('musicxml');
  });

  it('falls back to ASCII tab on .txt extension', () => {
    const head = enc.encode('e|---0---|');
    expect(sniffFormat(head.slice(0, 16), 'riff.txt')).toBe('ascii-tab');
  });

  it('falls back to ASCII tab on .tab extension', () => {
    const head = enc.encode('e|---0---|');
    expect(sniffFormat(head.slice(0, 16), 'riff.tab')).toBe('ascii-tab');
  });

  it('returns unknown for unrecognized content + extension', () => {
    const head = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
    expect(sniffFormat(head, 'random.bin')).toBe('unknown');
  });
});
