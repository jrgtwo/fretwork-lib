/**
 * Cabinet impulse responses — pre-authored cab+mic IR convolutions that can be
 * loaded into a voice's effects chain via `effects.cabIR`. Adding a new IR
 * here surfaces it as a one-click option in the Sound Lab's Cabinet section.
 *
 * IRs are short audio files (~10–50 ms) captured from a real speaker cabinet
 * with a mic. Convolving the dry guitar signal with an IR makes the guitar
 * sound as if it came out of that cab through that mic.
 *
 * Bundled set: 8 IRs from two free-redistributable packs, all single-cab
 * Mesa-style V30 4×12s recorded with different mics / positions / presence
 * settings. Stored on Supabase Storage as 48kHz mono 24-bit PCM wav. Each
 * file is ~3–7 KB; the whole pack is under 35 KB total.
 *
 * Future palette expansion: a Tweed/AC30/Fender Twin pack would complete the
 * clean-amp coverage. None bundled today.
 */

const CABINET_IR_BASE = 'https://ssszubkbregwjgkrpqop.supabase.co/storage/v1/object/public/samples/cabinet-irs';
function irUrl(name: string): string {
  return `${CABINET_IR_BASE}/${name}.wav`;
}

export interface CabinetIR {
  /** Stable id (used as the value in dropdowns). */
  readonly id: string;
  /** Human-readable label for the picker. */
  readonly label: string;
  /** Short description of the tonal character. */
  readonly description: string;
  /** Public URL of the IR audio file. Fed straight into `Tone.Convolver`. */
  readonly url: string;
}

export const CABINET_IRS: readonly CabinetIR[] = [
  // ─── Twin — Fender-style clean combo ───────────────────────────────────────
  {
    id: 'twin-clean',
    label: 'Twin clean',
    description: 'Fender Twin-style clean combo — pristine headroom, glassy top, tight low end. The reference clean-cab character.',
    url: irUrl('twin'),
  },

  // ─── God's Cab — Mesa-style V30 4×12, multi-mic ────────────────────────────
  {
    id: 'gods-warm-421',
    label: "God's Cab — Warm (MD421 cone-near)",
    description: 'Warm, balanced dynamic-mic capture on the speaker cone. The best all-around choice for clean to mild-crunch tones.',
    url: irUrl('warm-421'),
  },
  {
    id: 'gods-dark-421',
    label: "God's Cab — Dark (MD421 cone-far)",
    description: 'Off-axis dynamic mic — bigger body, softer attack, less presence. Good for fingerstyle and hollowbody jazz tones.',
    url: irUrl('dark-421'),
  },
  {
    id: 'gods-bright-57',
    label: "God's Cab — Bright (SM57 cap)",
    description: 'Classic close-mic on the speaker cap. The "Marshall sound" — bright, present, in-your-face bite for rock tones.',
    url: irUrl('bright-57'),
  },
  {
    id: 'gods-room-87',
    label: "God's Cab — Room (U87 at 2ft)",
    description: 'Large-diaphragm condenser at 2 feet — adds air, room, and a more "in front of the amp" perspective.',
    url: irUrl('room-87'),
  },
  {
    id: 'gods-crunch-57-ts',
    label: "God's Cab — Crunch (SM57 + Tube Screamer)",
    description: 'SM57 cap with a Tube Screamer pre-amp baked in. Instant break-up character without dialing drive separately.',
    url: irUrl('crunch-57-ts'),
  },

  // ─── Catharsis (Maciek Pekalski) — Mesa Recto 4×12, pre-mixed sums ────────
  {
    id: 'catharsis-mellow',
    label: 'Catharsis — Mellow',
    description: "Maciek Pekalski's Recto cab, pre-mixed mics with low presence. Warmest of the Catharsis options — dialed back the bite.",
    url: irUrl('catharsis-mellow'),
  },
  {
    id: 'catharsis-balanced',
    label: 'Catharsis — Balanced',
    description: "Maciek Pekalski's Recto cab, pre-mixed mics with medium presence. The all-around Catharsis tone — tight and mix-ready.",
    url: irUrl('catharsis-balanced'),
  },
  {
    id: 'catharsis-bright',
    label: 'Catharsis — Bright',
    description: "Maciek Pekalski's Recto cab, pre-mixed mics with high presence. Aggressive modern rock / metal cab tone.",
    url: irUrl('catharsis-bright'),
  },
];

/** Look up a cabinet IR by id. Returns undefined if not registered. */
export function getCabinetIR(id: string): CabinetIR | undefined {
  return CABINET_IRS.find((ir) => ir.id === id);
}

/** Find which pre-registered IR (if any) matches a given URL. Used by the
 *  Lab UI to highlight the active IR in the picker after the preset hydrates
 *  from storage. Returns `null` if no match. */
export function detectCabinetIR(url: string): CabinetIR | null {
  return CABINET_IRS.find((ir) => ir.url === url) ?? null;
}
