/**
 * File-level security guards run **before** any parser executes.
 *
 *   - `assertFileSize` rejects oversized files before allocating parser memory.
 *   - `readFileHead` reads only the first few bytes (no full-file read for the sniff).
 *   - `sniffFormat` identifies the format by byte signature, with a text-prefix fallback
 *     for uncompressed MusicXML and an extension fallback for plain-text ASCII tab.
 *
 * The signatures here are deliberately conservative. False positives cost more than
 * false negatives — a misdetected format gets handed to the wrong parser and crashes;
 * an unrecognized format gets a clear "unsupported" error.
 */

import { FileTooLargeError } from './errors';

/** 10 MB — the hard upload-equivalent cap on imported files. */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Bytes read from the head of the file for magic-number detection. */
export const HEAD_BYTES = 16;

export type FormatId = 'guitar-pro' | 'musicxml' | 'midi' | 'ascii-tab' | 'unknown';

interface Signature {
  format: FormatId;
  bytes: Uint8Array;
  offset: number;
}

/**
 * First-match-wins. Order matters: more specific signatures first.
 *
 * GP3/4/5 files start with a length-prefixed ASCII version string. The literal
 * "FICHIER GUITAR PRO" starts at offset 1 (offset 0 is the length byte).
 *
 * GP6/GP7 (.gpx / .gp) and compressed MusicXML (.mxl) both share the zip magic.
 * That's fine: the parser layer disambiguates via extension and zip directory
 * inspection.
 */
const SIGNATURES: Signature[] = [
  { format: 'guitar-pro', bytes: new TextEncoder().encode('FICHIER GUITAR PRO'), offset: 1 },
  { format: 'guitar-pro', bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]), offset: 0 },
  { format: 'midi', bytes: new TextEncoder().encode('MThd'), offset: 0 },
];

export function assertFileSize(sizeBytes: number, max: number = MAX_FILE_SIZE): void {
  if (sizeBytes > max) throw new FileTooLargeError(sizeBytes, max);
}

export async function readFileHead(file: File, bytes: number = HEAD_BYTES): Promise<Uint8Array> {
  const slice = file.slice(0, bytes);
  const buf = await slice.arrayBuffer();
  return new Uint8Array(buf);
}

function startsWithAt(haystack: Uint8Array, needle: Uint8Array, offset: number): boolean {
  if (offset + needle.length > haystack.length) return false;
  for (let i = 0; i < needle.length; i++) {
    if (haystack[offset + i] !== needle[i]) return false;
  }
  return true;
}

export function sniffFormat(head: Uint8Array, fileName: string): FormatId {
  for (const sig of SIGNATURES) {
    if (startsWithAt(head, sig.bytes, sig.offset)) return sig.format;
  }
  // Text sniffs (uncompressed MusicXML + tolerant XML detect)
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const text = decoder.decode(head).trim();
  if (text.startsWith('<?xml') || text.startsWith('<score-partwise') || text.startsWith('<score-timewise')) {
    return 'musicxml';
  }
  // ASCII tab is plain text with no reliable magic; fall back to extension.
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (ext === 'txt' || ext === 'tab') return 'ascii-tab';
  return 'unknown';
}
