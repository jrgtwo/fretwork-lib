import type { Highlight, Mode, TuningDef } from '../types';
import type { ResolveInput, PlayableCell } from './types';

export interface BuildResolveInputArgs {
  highlights: readonly Highlight[];
  tuning: TuningDef;
  key: string;
  capo: number;
  mode: Mode;
  instrumentId: string;
  fretCount: number;
  /** Active scale/arpeggio id; mapped to `scaleType`/`arpeggioType` by `mode`. */
  type: string;
  /** Custom-pattern sequence, when applicable. */
  customSequence?: readonly PlayableCell[];
}

/**
 * Assemble a {@link ResolveInput} from flat fretboard state. Centralizes the
 * `mode === 'scales' ? scaleType : arpeggioType` mapping that several call sites
 * (the fretboard render model, the CAGED shape selector) would otherwise
 * duplicate by hand.
 */
export function buildResolveInput({
  highlights,
  tuning,
  key,
  capo,
  mode,
  instrumentId,
  fretCount,
  type,
  customSequence,
}: BuildResolveInputArgs): ResolveInput {
  return {
    highlights,
    tuning,
    key,
    capo,
    mode,
    instrumentId,
    fretCount,
    scaleType: mode === 'scales' ? type : undefined,
    arpeggioType: mode === 'arpeggios' ? type : undefined,
    ...(customSequence !== undefined ? { customSequence } : {}),
  };
}
