/**
 * Parser registry — the pluggability surface for format-specific parsers.
 *
 * A format parser is a single object that knows how to turn raw bytes into an
 * `ImportIR`. Parsers register themselves at module load (typically inside the
 * Web Worker entry, where they're isolated from the page). Registration is a
 * side-effect import: the parser module calls `registerParser(...)` at top
 * level. The worker imports the parser module and the registry is populated.
 *
 * Dispatch is two-tier:
 *   1. Magic-number sniff in `file-guard.sniffFormat` returns a `FormatId`.
 *   2. `findParserForFile` looks up the parser registered for that id, allowing
 *      a `canHandle` veto. If no parser claims the format, falls back to
 *      extension match across all registered parsers.
 */

import type { ImportIR } from './types';
import type { FormatId } from './file-guard';

export interface ParserInput {
  readonly bytes: ArrayBuffer;
  readonly fileName: string;
  readonly format: FormatId;
}

export interface ImportParser {
  readonly id: FormatId;
  readonly label: string;
  readonly extensions: readonly string[];
  /** Optional finer dispatch beyond magic-number sniff. */
  canHandle?(file: { name: string; head: Uint8Array }): boolean;
  /** Must be safe to invoke inside a Web Worker (no DOM access, no privileged APIs). */
  parse(input: ParserInput): Promise<ImportIR>;
}

const REGISTRY = new Map<FormatId, ImportParser>();

export function registerParser(parser: ImportParser): void {
  REGISTRY.set(parser.id, parser);
}

export function getParsers(): readonly ImportParser[] {
  return Array.from(REGISTRY.values());
}

export function getParser(id: FormatId): ImportParser | null {
  return REGISTRY.get(id) ?? null;
}

export function findParserForFile(file: {
  name: string;
  head: Uint8Array;
  format: FormatId;
}): ImportParser | null {
  const byFormat = REGISTRY.get(file.format);
  if (byFormat && byFormat.canHandle?.(file) !== false) return byFormat;
  // Fall back to extension match if format dispatch was ambiguous or vetoed.
  const ext = '.' + (file.name.toLowerCase().split('.').pop() ?? '');
  for (const p of REGISTRY.values()) {
    if (p.extensions.includes(ext) && p.canHandle?.(file) !== false) return p;
  }
  return null;
}

/** Test-only — clears the registry between tests. Not re-exported from the lib barrel. */
export function _clearRegistry(): void {
  REGISTRY.clear();
}
