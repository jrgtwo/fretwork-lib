import type { CircuitAmp } from '../types';

/**
 * Fender 5E3 Deluxe — tweed, about 15 watts, 1957.
 *
 *   Normal in ─> V1a ─> Normal Volume ─┐
 *                                       ├─> shared node (V2a grid) ─> V2a ─> cathodyne
 *   Bright in ─> V1b ─┬> Bright Volume ─┤                                      │   │
 *                     └> .0005 ─> tone pot ─┘                    6V6 push-pull <┘   │
 *                                    │                                  │ <─────────┘
 *                                  .005                                 OT ─> out
 *                                    │
 *                                   gnd     supply (5Y3) feeds preamp and power stage
 *
 * The second amp on this engine, and the one that made it express a topology
 * rather than a straight line: two parallel input channels summing at ONE
 * node, a cathodyne phase inverter, and a push-pull output pair.
 *
 * ── ⚠ THE VOLUME POTS ARE V2a'S GRID LEAK ───────────────────────────────────
 *
 * Each pot's track runs from the shared grid node to ground and the channel's
 * signal arrives at the WIPER. So the interaction is the OPPOSITE way round
 * from a conventional volume pot: a channel turned DOWN presents its full
 * megohm and leaves the other alone, and a channel turned UP clamps the node
 * with V1's plate impedance and swamps it. `sharedNodeResponse` in
 * `circuit-math.ts` carries the model; `docs/SPEC-circuit-amp.md` carries the
 * schematic reading it came from.
 *
 * ── ⚠ THE TONE CONTROL IS ON THAT SAME NODE ─────────────────────────────────
 *
 * Not a filter in series. Its wiper joins the volume pots at V2a's grid, the
 * .005 below it shunts treble to ground and the .0005 above it injects treble
 * from V1b's plate. So tone and volume are mutually interactive — which is why
 * `coupling` is component values and there is no separate `tone` block.
 *
 * ── ⚠ SHARED CONTROL IDS SHARE THEIR RANGE AND THEIR DEFAULT ────────────────
 *
 * `tone` is also declared by the Princeton. `circuitAmpControlPath` does not
 * namespace by amp, so the two share ONE schema row and one stored value —
 * wanted (the pot keeps its position across an amp switch), but it means the
 * label, range and default must match. `circuit-amp-registry.test.ts` enforces
 * it.
 *
 * ── ⚠ EVERY NUMBER IN `circuit` IS PROVISIONAL ──────────────────────────────
 *
 * The TOPOLOGY is the schematic's and so are the component values. What is
 * still open is listed in the spec: the tone pot's taper, `plateSourceOhms`,
 * the wiper floor, and the whole `inputPad` block — see below.
 *
 * V1 is a 12AY7, confirmed — materially lower gain than the Princeton's 12AX7,
 * and part of why a Deluxe cleans up differently.
 */
export const DELUXE_5E3: CircuitAmp = {
  id: 'deluxe-5e3',
  name: 'Deluxe 5E3',
  description:
    'Tweed Deluxe, about 15 watts. Two channels into a push-pull pair of 6V6s ' +
    'with a tube rectifier and no negative feedback. Both volume knobs are ' +
    'always live and they load each other — turning one UP is what steals from ' +
    'the other.',
  controls: [
    {
      kind: 'switch', id: 'input', label: 'Input', default: 'hi',
      options: [
        { value: 'hi', label: 'Hi', description: 'The full-sensitivity jack.' },
        { value: 'lo', label: 'Lo', description: 'About 6 dB down, and a little darker with it.' },
      ],
      description:
        'Which jack. The Lo input is a divider made by the two 68 kΩ grid ' +
        'stoppers, so it pads the signal AND loses a little top end — it is ' +
        'not the same as turning the input gain down.',
    },
    {
      kind: 'switch', id: 'bright', label: 'Bright', default: 'off',
      options: [
        { value: 'off', label: 'Off', description: 'Into the Normal channel.' },
        { value: 'on', label: 'On', description: 'Into the Bright channel, which feeds the tone stack.' },
      ],
      description:
        'Which channel receives signal. It does NOT take a channel out of the ' +
        'circuit: both volume pots load the shared node either way, so the ' +
        'unfed channel’s knob still shapes your tone. Ignored while Jumpered ' +
        'is on.',
    },
    {
      kind: 'switch', id: 'jumpered', label: 'Jumpered', default: 'off',
      options: [
        { value: 'off', label: 'Off', description: 'One channel, chosen by the Bright switch.' },
        { value: 'on', label: 'On', description: 'Both channels fed at once.' },
      ],
      description:
        'The patch-cable trick without the cable. Both channels are fed, and ' +
        'because they are in phase they add rather than cancel — the two volume ' +
        'knobs then set the blend and load each other while they do it.',
    },
    {
      kind: 'pot', id: 'volumeNormal', label: 'Normal vol', min: 0, max: 1, step: 0.01, default: 0.5,
      description:
        'The Normal channel’s volume, and a load on the Bright channel. Turned ' +
        'DOWN it presents a megohm and leaves the other channel alone; turned ' +
        'UP it clamps the shared node and swamps it.',
    },
    {
      kind: 'pot', id: 'volumeBright', label: 'Bright vol', min: 0, max: 1, step: 0.01, default: 0.5,
      description:
        'The Bright channel’s volume, and a load on the Normal channel the same ' +
        'way round. The treble lift lives on the Tone knob, not here.',
    },
    {
      kind: 'pot', id: 'tone', label: 'Tone', min: 0, max: 1, step: 0.01, default: 0.5,
      description:
        'One pot between two caps, sitting on the same node as both volumes. ' +
        'Down it shunts treble away; up it lets the bright cap through. It gets ' +
        'less effective as the volumes come up, which is the circuit and not a bug.',
    },
    {
      // ⚠ NOT A 5E3 PART, and declared as such. A real Deluxe has no inverter
      // switch; this one exists so the cathodyne's split can be heard against
      // the single composed curve it collapses to, which is otherwise a
      // recompile between two data values. It closed as the FIRST DECLARED MOD
      // on 2026-09-10 — the third of the three ways its deletion condition
      // allowed, taken because the A/B has not been judged by ear yet and a
      // control that cannot be heard yet should not be deleted on a guess.
      // See docs/SPEC-circuit-amp.md, "Mods".
      mod: true,
      kind: 'switch', id: 'inverter', label: 'Inverter', default: 'split',
      options: [
        { value: 'split', label: 'Split', description: 'The cathodyne’s two legs roll off differently.' },
        { value: 'composed', label: 'Composed', description: 'Legs matched — reduces to one curve.' },
      ],
      description:
        'Whether the phase inverter’s two legs differ. Split is the circuit; ' +
        'Composed flattens them, which is provably one shaper. Expect a subtle ' +
        'difference, mostly on the top strings.',
    },
  ],
  circuit: {
    topology: 'push-pull-dual-channel',
    // ⚠ THE ONLY BLOCK HERE WITH NO SCHEMATIC BEHIND ITS NUMBERS. The two 68 kΩ
    // grid stoppers and the 1 MΩ input resistor are on the schematic; what they
    // produce at the grid is not, and the backlog row deferred this control
    // precisely because a bare -6 dB pad is `inputGainDb - 6` with a new name.
    // The two corners are what make it a different control. Both provisional,
    // and the first numbers to move if Hi and Lo sound like the same thing.
    inputPad: { loPadDb: -6, hiCornerHz: 22000, loCornerHz: 9000 },
    channelNormal: { gainDb: 19, asymmetry: 0.25, couplingHpfHz: 14, millerLpfHz: 12000 },
    channelBright: { gainDb: 19, asymmetry: 0.25, couplingHpfHz: 14, millerLpfHz: 12000 },
    // Straight off the schematic. 1 MΩ volume pots, 1 MΩ tone pot, .005 tone
    // cap, .0005 bright cap. `plateSourceOhms` is a 12AY7's published r_p in
    // parallel with its 100 kΩ plate load, so it is the one derived value here.
    coupling: {
      volumePotOhms: 1_000_000,
      plateSourceOhms: 20_000,
      tonePotOhms: 1_000_000,
      toneCapFarads: 5e-9,
      brightCapFarads: 5e-10,
    },
    triode2: { gainDb: 24, asymmetry: 0.4, couplingHpfHz: 18, millerLpfHz: 10000 },
    phaseInverter: {
      // The cathode leg uses stage.millerLpfHz. The PLATE leg is the
      // high-impedance output and rolls off FIRST, so its corner is the lower
      // of the two. Confirmed: both legs are loaded equally, 56 kΩ plate and
      // 56 kΩ tail, so the difference is source impedance and nothing else.
      stage: { gainDb: 6, asymmetry: 0.3, couplingHpfHz: 16, millerLpfHz: 12000 },
      plateLegLpfHz: 8000,
      legSpread: 1,
    },
    // ⚠ powerGain was 14 in the first draft, which put 2.65 into the power
    // shaper at a chord peak — deep inside the flat-chop region, where
    // `headroom` and `imbalance` both stop doing anything. 11 keeps the stage
    // working where its parameters are still live. Provisional, like all of
    // these, and the first number to move if it is too clean.
    power: { gainDb: 11, headroom: 0.5, imbalance: 0.08 },
    supply: { sagDepth: 0.3, smoothingSeconds: 0.05 },
    transformer: { saturation: 0.25, lfCornerHz: 70, hfCornerHz: 7000 },
  },
};
