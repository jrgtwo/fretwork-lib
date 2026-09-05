/**
 * The circuit-amp registry's contract.
 *
 * An amp here is a CIRCUIT DESCRIPTION, not a curve plus two frequencies — see
 * `circuit-amp/types.ts`. What this file holds is the part the rest of the
 * system depends on: that lookup always yields a real amp (the chain has to
 * build), that an amp's declared controls are what the pane will draw, and
 * that every declared default is inside its own declared range.
 */
import { describe, it, expect } from 'vitest';
import {
  CIRCUIT_AMPS,
  getCircuitAmp,
  DEFAULT_CIRCUIT_AMP_ID,
} from '../src/playback/voices/circuit-amp/registry';

describe('circuit amp registry', () => {
  it('ships the Princeton 5F2-A as the default', () => {
    expect(DEFAULT_CIRCUIT_AMP_ID).toBe('princeton-5f2a');
    expect(getCircuitAmp(DEFAULT_CIRCUIT_AMP_ID).name).toBe('Princeton 5F2-A');
  });

  it('falls back to the default for an unknown or missing id', () => {
    expect(getCircuitAmp('no-such-amp').id).toBe(DEFAULT_CIRCUIT_AMP_ID);
    expect(getCircuitAmp(undefined).id).toBe(DEFAULT_CIRCUIT_AMP_ID);
  });

  it('declares exactly the controls a 5F2-A has', () => {
    const ids = getCircuitAmp('princeton-5f2a').controls.map((c) => c.id);
    expect(ids).toEqual(['volume', 'tone']);
  });

  it('gives every control a default inside its own range', () => {
    for (const amp of CIRCUIT_AMPS) {
      for (const control of amp.controls) {
        expect(control.min).toBeLessThan(control.max);
        expect(control.default).toBeGreaterThanOrEqual(control.min);
        expect(control.default).toBeLessThanOrEqual(control.max);
      }
    }
  });

  it('gives every amp a unique id', () => {
    const ids = CIRCUIT_AMPS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
