import type { CircuitAmp } from './types';
import { PRINCETON_5F2A } from './amps/princeton-5f2a';

export const CIRCUIT_AMPS: readonly CircuitAmp[] = [PRINCETON_5F2A];

export const DEFAULT_CIRCUIT_AMP_ID = 'princeton-5f2a';

/** Look up by id, falling back to the default so the chain always builds with
 *  a real circuit even when a stored preset names an amp that has been renamed
 *  or removed. Same contract as `getAmpModel` in `amp-models.ts`. */
export function getCircuitAmp(id: string | undefined): CircuitAmp {
  const found = id ? CIRCUIT_AMPS.find((a) => a.id === id) : undefined;
  return found ?? CIRCUIT_AMPS.find((a) => a.id === DEFAULT_CIRCUIT_AMP_ID)!;
}
