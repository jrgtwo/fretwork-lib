/**
 * Public surface for the music-import pipeline.
 *
 * See `docs/superpowers/specs/2026-05-22-music-import-design.md` for the design.
 *
 * Layers:
 *   - `types`           — `ImportIR` and its children, format-agnostic.
 *   - `errors`          — `ImportError` taxonomy used across the pipeline.
 *   - `file-guard`      — file-size assertion, magic-number sniff.
 *   - `parser-registry` — pluggable per-format parser registration.
 *   - `validator`       — defense-in-depth range + sanitization checks on parsed IR.
 *
 * Format parsers register themselves at module load when imported by the
 * worker entry; they're not re-exported here.
 */

export * from './types';
export * from './errors';
export * from './file-guard';
export {
  registerParser,
  getParsers,
  getParser,
  findParserForFile,
  type ImportParser,
  type ParserInput,
} from './parser-registry';
export { validateImportIR, LIMITS, type ValidationResult } from './validator';
export {
  mapImportToLibrary,
  type MapInput,
  type MapTopology,
  type MapperResult,
} from './mapper';
export {
  parseChordChart,
  type ChordChart,
  type ChordChartSection,
} from './chord-chart/parse-chord-chart';
export {
  mapChordChartToLibrary,
  defaultGripsForChart,
  prettifyFileName,
  type ChordMapInput,
  type ChordMapResult,
} from './chord-chart/map-chord-chart';
export { parseAsciiTab } from './ascii-tab/parse-ascii-tab';
