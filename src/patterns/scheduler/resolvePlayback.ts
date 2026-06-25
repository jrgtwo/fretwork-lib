/**
 * Resolve the effective bpm + groove for a single placement inside a
 * composition. Pure function — no side effects, no I/O. Consumed by both the
 * scheduler (for live metronome updates at placement boundaries) and the
 * arranger UI (for read-only inheritance annotations on placement rows).
 *
 * Resolution rules per the spec:
 *   - bpm:   global → comp.bpm
 *            inherit → snapshot.suggestedBpm ?? comp.bpm
 *   - groove: global → comp.groove
 *             inherit → snapshot.groove ?? comp.groove
 */
import type { Composition, GrooveSpec, Placement } from '../types';

export interface EffectivePlayback {
  bpm: number;
  groove: GrooveSpec | null;
}

export function resolveEffectivePlayback(
  composition: Composition,
  placement: Placement,
): EffectivePlayback {
  const bpm =
    composition.tempoMode === 'global'
      ? composition.bpm
      : placement.patternSnapshot.suggestedBpm ?? composition.bpm;

  const groove =
    composition.grooveMode === 'global'
      ? composition.groove
      : placement.patternSnapshot.groove ?? composition.groove;

  return { bpm, groove };
}
