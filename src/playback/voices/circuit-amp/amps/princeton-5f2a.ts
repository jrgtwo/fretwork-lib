import type { CircuitAmp } from '../types';

/**
 * Fender Princeton 5F2-A — tweed, about 5 watts.
 *
 *   input -> triode 1 -> Volume -> tone network -> triode 2 -> 6V6 SE -> OT -> out
 *                        supply (5Y3) feeds both triodes and the power stage
 *
 * No phase splitter — the output stage is single-ended. No tremolo, no reverb.
 * That is exactly why it is the first amp built on this engine: nothing in it
 * is optional scaffolding, so the frame is proven by an amp that needs all of
 * it and none of anything else.
 *
 * ── ⚠ EVERY NUMBER IN `circuit` IS PROVISIONAL ──────────────────────────────
 *
 * A starting point to be played and then corrected, not a measured model.
 * These are the values the design is waiting on, and each is a one-line edit:
 *
 *   - the cathode-bypass values on both triode halves, which set how much low
 *     end each stage passes (`couplingHpfHz`, `millerLpfHz`),
 *   - the 6V6's cathode-bias point (`power.headroom`),
 *   - the 5Y3's reservoir capacitance and the sag time constant it produces
 *     (`supply.sagDepth`, `supply.smoothingSeconds`),
 *   - the tone pot's value, taper and cap (`tone.minCutoffHz`,
 *     `tone.maxCutoffHz`),
 *   - whether this amp has NO negative-feedback loop. It is built here as
 *     though it does not, which is part of why a tweed Princeton is loose and
 *     compressed rather than tight. If that is wrong, the power stage needs
 *     damping it currently has nowhere.
 *   - the output transformer's primary impedance and the LF corner where its
 *     core starts to saturate.
 */
export const PRINCETON_5F2A: CircuitAmp = {
  id: 'princeton-5f2a',
  name: 'Princeton 5F2-A',
  description:
    'Tweed Princeton, about 5 watts. One 12AX7 into a single-ended 6V6 with a ' +
    'tube rectifier, so it compresses hard when you dig in. Two knobs and no ' +
    'headroom to speak of — it breaks up early and stays touch-sensitive.',
  controls: [
    {
      id: 'volume',
      label: 'Volume',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
      description:
        'Inside the circuit, between the first triode and the tone network. ' +
        'Sets how hard the second stage and the power tube are driven — this ' +
        'is where the breakup comes from, not the input gain.',
    },
    {
      id: 'tone',
      label: 'Tone',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
      description:
        'One pot and one cap — a variable treble cut, not a three-band stack. ' +
        'Turned down it rolls the top off; there is no boost anywhere in it.',
    },
  ],
  circuit: {
    triode1: { gainDb: 26, asymmetry: 0.35, couplingHpfHz: 12, millerLpfHz: 11000 },
    triode2: { gainDb: 22, asymmetry: 0.45, couplingHpfHz: 20, millerLpfHz: 9000 },
    tone: { minCutoffHz: 900, maxCutoffHz: 12000 },
    power: { gainDb: 12, headroom: 0.45 },
    supply: { sagDepth: 0.35, smoothingSeconds: 0.06 },
    transformer: { saturation: 0.3, lfCornerHz: 90, hfCornerHz: 6500 },
  },
};
