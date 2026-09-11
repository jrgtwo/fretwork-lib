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
import type { CircuitAmpControl } from '../src/playback/voices/circuit-amp/types';

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

  it('gives every amp a unique id', () => {
    const ids = CIRCUIT_AMPS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('control declarations', () => {
  // A switch whose default is not one of its own options would fall back to a
  // value the amp cannot build, silently, at the one moment nobody is looking:
  // seeding a fresh preset.
  it('gives every switch a default that is one of its options', () => {
    for (const amp of CIRCUIT_AMPS) {
      for (const control of amp.controls) {
        if (control.kind !== 'switch') continue;
        expect(control.options.map((o) => o.value)).toContain(control.default);
      }
    }
  });

  it('gives every pot a default inside its own range', () => {
    for (const amp of CIRCUIT_AMPS) {
      for (const control of amp.controls) {
        if (control.kind !== 'pot') continue;
        expect(control.min).toBeLessThan(control.max);
        expect(control.default).toBeGreaterThanOrEqual(control.min);
        expect(control.default).toBeLessThanOrEqual(control.max);
      }
    }
  });

  // ⚠ `circuitAmpControlPath` does not namespace by amp id, so two amps
  // declaring one id share ONE schema row — and that row carries a single
  // range, default and label whichever amp is selected. An amp that needs a
  // different default needs a different id. This is that decision's tripwire.
  it('never lets two amps declare one control id with different shapes', () => {
    const seen = new Map<string, CircuitAmpControl>();
    for (const amp of CIRCUIT_AMPS) {
      for (const control of amp.controls) {
        const prior = seen.get(control.id);
        if (!prior) {
          seen.set(control.id, control);
          continue;
        }
        expect(prior.kind).toBe(control.kind);
        expect(prior.label).toBe(control.label);
        expect(prior.default).toBe(control.default);
        // A shared row carries ONE answer about whether it is a mod. Two amps
        // disagreeing would mark a stock control as modded on one of them.
        expect(prior.mod ?? false).toBe(control.mod ?? false);
        if (prior.kind === 'pot' && control.kind === 'pot') {
          expect([prior.min, prior.max, prior.step]).toEqual([control.min, control.max, control.step]);
        }
      }
    }
  });
});

describe('mods', () => {
  // A mod is a control that is real but not original. The rule it bends — an
  // amp's controls are the amp's controls — is right, so bending it has to be
  // DECLARED rather than smuggled in behind a description nobody reads.
  it('declares the 5E3 inverter as a mod and nothing else', () => {
    const mods = CIRCUIT_AMPS.flatMap((amp) =>
      amp.controls.filter((c) => c.mod).map((c) => `${amp.id}.${c.id}`),
    );
    expect(mods).toEqual(['deluxe-5e3.inverter']);
  });

  it('leaves every stock control unmarked rather than marked false', () => {
    // `mod?: true` — omitted means stock. A literal `false` would be a third
    // state the pane would have to interpret.
    for (const amp of CIRCUIT_AMPS) {
      for (const control of amp.controls) {
        expect(control.mod === undefined || control.mod === true).toBe(true);
      }
    }
  });
});
