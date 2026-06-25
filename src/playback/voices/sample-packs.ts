/**
 * Sample packs — pre-authored note → URL maps that can be loaded into a
 * Sampler-kind voice source. Adding a new pack here surfaces it as a one-click
 * option in the Sound Lab's SamplerControls. Users can also bring their own
 * pack via the "Custom JSON…" editor.
 *
 * A pack's `samples` is a `ReadonlyArray` of note→URL maps. Each entry is a
 * "bank" — a round-robin take of the same instrument at the same dynamic.
 * Single-take packs use one map (`[oneMap]`); multi-bank packs list all takes
 * (e.g. Karoryfer rr1..rr4 = 4 banks) and the Voice rotates between them
 * per-pitch at trigger time to humanize repeated-note passages.
 *
 * Hosting recipe:
 *   1. Drop .mp3 (or .ogg) sample files into `example/public/samples/<pack-id>/`.
 *      For multi-bank packs use per-take subfolders: `samples/<pack-id>/rr1/`,
 *      `samples/<pack-id>/rr2/`, etc. Filenames should be note names like
 *      `A2.mp3`, `Cs3.mp3` (use lowercase `s` for sharp in filenames to avoid
 *      `#` URL issues).
 *   2. Add an entry below mapping note names (e.g. `A2`, `C#3`) to the served
 *      URL paths. For multi-bank packs, register all banks in the array.
 *   3. Three notes per octave (every 3 semitones) is enough; Tone.Sampler
 *      pitch-shifts between them with minimal artifacts.
 *
 * For production, sample assets can move to Vercel Blob or any CDN — replace
 * the URLs here with the public Blob URLs and you're done.
 *
 * ── Free sample-pack sources for self-hosting ────────────────────────────────
 *
 * Public CDN-hosted (works immediately, piano only):
 *   - Tone.js Salamander Piano  https://tonejs.github.io/audio/salamander/
 *   - Tone.js Casio Piano       https://tonejs.github.io/audio/casio/
 *
 * Download-and-host (the realistic path for guitar):
 *   - Karoryfer Samples         https://www.karoryfer.com/karoryfer-samples
 *     (Salinas acoustic, several electrics, basses — CC-BY-SA)
 *   - FreePats Classical Guitar https://freepats.zenvoid.org/Guitar/
 *     (CC0 / GPL)
 *   - Philharmonia Orchestra    https://philharmonia.co.uk/resources/sound-samples/
 *     (Single notes, non-commercial CC)
 *   - University of Iowa MIS    https://theremin.music.uiowa.edu/MISguitar.html
 *     (Academic recordings, educational use)
 *
 * Conversion: `ffmpeg -i NOTE.wav -codec:a libmp3lame -b:a 128k NOTE.mp3` per file,
 * keep ~14 samples spanning E2 → E6 (every 3 semitones).
 */
export interface SamplePack {
  /** Stable id (used to key the UI). */
  readonly id: string;
  /** Human-readable label for the picker. */
  readonly label: string;
  /** Short description shown under the picker — what the pack sounds like. */
  readonly description: string;
  /** One-or-more note → URL maps. Each entry is a round-robin bank. Voice
   *  rotates per-pitch between banks at trigger time. */
  readonly samples: ReadonlyArray<Readonly<Record<string, string>>>;
}

/** Tone.js's public demo set — Salamander piano. Hosted by the Tone.js team at
 *  https://tonejs.github.io/audio/salamander/ and used in every Tone example.
 *  Note: this is PIANO, not guitar — the pipeline plays cleanly but the sound
 *  is piano. Useful for proving the sampler path end-to-end before authoring a
 *  real guitar sample pack. */
const CASIO_PIANO_DEMO: Readonly<Record<string, string>> = {
  A1: 'https://tonejs.github.io/audio/casio/A1.mp3',
  A2: 'https://tonejs.github.io/audio/casio/A2.mp3',
  'A#1': 'https://tonejs.github.io/audio/casio/As1.mp3',
  B1: 'https://tonejs.github.io/audio/casio/B1.mp3',
  C2: 'https://tonejs.github.io/audio/casio/C2.mp3',
  'C#2': 'https://tonejs.github.io/audio/casio/Cs2.mp3',
  D2: 'https://tonejs.github.io/audio/casio/D2.mp3',
  'D#2': 'https://tonejs.github.io/audio/casio/Ds2.mp3',
  E2: 'https://tonejs.github.io/audio/casio/E2.mp3',
  F2: 'https://tonejs.github.io/audio/casio/F2.mp3',
  'F#2': 'https://tonejs.github.io/audio/casio/Fs2.mp3',
  G2: 'https://tonejs.github.io/audio/casio/G2.mp3',
  'G#2': 'https://tonejs.github.io/audio/casio/Gs2.mp3',
};

/** Philharmonia Orchestra classical guitar samples (CC-BY-NC), hosted on
 *  Supabase Storage. Full chromatic E2 → C6 means Tone.Sampler hits an exact
 *  match for every note in the guitar range — zero pitch-shift artifacts.
 *  Files renamed from Philharmonia's `guitar_<note>_very-long_forte_normal.mp3`
 *  to short `<note>.mp3` at upload time. Sharps use `s` in filenames (As2 = A♯2)
 *  to avoid `#` URL encoding. Single-take pack (one bank). */
const PHILHARMONIA_BASE = 'https://ssszubkbregwjgkrpqop.supabase.co/storage/v1/object/public/samples/philharmonia';
function philharmoniaUrl(noteFile: string): string {
  return `${PHILHARMONIA_BASE}/${noteFile}.mp3`;
}
const PHILHARMONIA_CLASSICAL_BANK: Readonly<Record<string, string>> = {
  E2: philharmoniaUrl('E2'),
  F2: philharmoniaUrl('F2'),
  'F#2': philharmoniaUrl('Fs2'),
  G2: philharmoniaUrl('G2'),
  'G#2': philharmoniaUrl('Gs2'),
  A2: philharmoniaUrl('A2'),
  'A#2': philharmoniaUrl('As2'),
  B2: philharmoniaUrl('B2'),
  C3: philharmoniaUrl('C3'),
  'C#3': philharmoniaUrl('Cs3'),
  D3: philharmoniaUrl('D3'),
  'D#3': philharmoniaUrl('Ds3'),
  E3: philharmoniaUrl('E3'),
  F3: philharmoniaUrl('F3'),
  'F#3': philharmoniaUrl('Fs3'),
  G3: philharmoniaUrl('G3'),
  'G#3': philharmoniaUrl('Gs3'),
  A3: philharmoniaUrl('A3'),
  'A#3': philharmoniaUrl('As3'),
  B3: philharmoniaUrl('B3'),
  C4: philharmoniaUrl('C4'),
  'C#4': philharmoniaUrl('Cs4'),
  D4: philharmoniaUrl('D4'),
  'D#4': philharmoniaUrl('Ds4'),
  E4: philharmoniaUrl('E4'),
  F4: philharmoniaUrl('F4'),
  'F#4': philharmoniaUrl('Fs4'),
  G4: philharmoniaUrl('G4'),
  'G#4': philharmoniaUrl('Gs4'),
  A4: philharmoniaUrl('A4'),
  'A#4': philharmoniaUrl('As4'),
  B4: philharmoniaUrl('B4'),
  // C5, C#5, F5, F#5, A5, A#5, B5, C6 not uploaded — Tone.Sampler pitch-shifts
  // from the nearest available sample (G#5) for anything above. Add entries
  // back here if those files are uploaded later.
  D5: philharmoniaUrl('D5'),
  'D#5': philharmoniaUrl('Ds5'),
  E5: philharmoniaUrl('E5'),
  G5: philharmoniaUrl('G5'),
  'G#5': philharmoniaUrl('Gs5'),
};
export const PHILHARMONIA_CLASSICAL: ReadonlyArray<Readonly<Record<string, string>>> = [
  PHILHARMONIA_CLASSICAL_BANK,
];

/** Karoryfer's mf-dynamic coverage isn't uniform across takes: rr1+rr2 ship
 *  the full chromatic E2..D6 (47 notes); rr3+rr4 stop at E5 (37 notes, top
 *  octave absent). Banks declare only the notes they actually have so Voice's
 *  coverage-aware rotation skips a bank when it lacks an exact pitch match —
 *  avoiding audible pitch-shifting (Tone.Sampler chipmunks ≥6 semitones up). */
const KARORYFER_NOTES_FULL = [
  ['E2','E2'],['F2','F2'],['F#2','Fs2'],['G2','G2'],['G#2','Gs2'],['A2','A2'],['A#2','As2'],['B2','B2'],
  ['C3','C3'],['C#3','Cs3'],['D3','D3'],['D#3','Ds3'],['E3','E3'],['F3','F3'],['F#3','Fs3'],['G3','G3'],['G#3','Gs3'],['A3','A3'],['A#3','As3'],['B3','B3'],
  ['C4','C4'],['C#4','Cs4'],['D4','D4'],['D#4','Ds4'],['E4','E4'],['F4','F4'],['F#4','Fs4'],['G4','G4'],['G#4','Gs4'],['A4','A4'],['A#4','As4'],['B4','B4'],
  ['C5','C5'],['C#5','Cs5'],['D5','D5'],['D#5','Ds5'],['E5','E5'],['F5','F5'],['F#5','Fs5'],['G5','G5'],['G#5','Gs5'],['A5','A5'],['A#5','As5'],['B5','B5'],
  ['C6','C6'],['C#6','Cs6'],['D6','D6'],
] as const;
const KARORYFER_NOTES_LOW = KARORYFER_NOTES_FULL.slice(0, 37);

/** Builds one Karoryfer bank from a notes list. URL pattern is
 *  `<base>/rr<n>/<fileBase>.mp3`. */
function karoryferBank(
  base: string,
  rr: number,
  notes: ReadonlyArray<readonly [string, string]>,
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [sciNote, fileBase] of notes) {
    out[sciNote] = `${base}/rr${rr}/${fileBase}.mp3`;
  }
  return out;
}

/** Karoryfer "Black And Green Guitars" — green Gretsch Anniversary hollowbody.
 *  Clean DI samples, mf dynamic, 4 round-robin takes (rr1..rr4). Full chromatic
 *  E2 → D6 (47 notes per bank — every note in the guitar range is an exact
 *  match, no pitch-shifting). Royalty-free (Karoryfer Lecolds). Self-hosted on
 *  Supabase under `samples/karoryfer-green/rr<n>/<note>.mp3`. */
const KARORYFER_GREEN_BASE = 'https://ssszubkbregwjgkrpqop.supabase.co/storage/v1/object/public/samples/karoryfer-green';
export const KARORYFER_GREEN: ReadonlyArray<Readonly<Record<string, string>>> = [
  karoryferBank(KARORYFER_GREEN_BASE, 1, KARORYFER_NOTES_FULL),
  karoryferBank(KARORYFER_GREEN_BASE, 2, KARORYFER_NOTES_FULL),
  karoryferBank(KARORYFER_GREEN_BASE, 3, KARORYFER_NOTES_LOW),
  karoryferBank(KARORYFER_GREEN_BASE, 4, KARORYFER_NOTES_LOW),
];

/** Karoryfer "Black And Green Guitars" — black Hofner Club hollowbody.
 *  Same coverage and conventions as the green pack — sibling tone (slightly
 *  louder, darker). 4 round-robin takes (rr1..rr4). Royalty-free, self-hosted
 *  on Supabase under `samples/karoryfer-black/rr<n>/<note>.mp3`. */
const KARORYFER_BLACK_BASE = 'https://ssszubkbregwjgkrpqop.supabase.co/storage/v1/object/public/samples/karoryfer-black';
export const KARORYFER_BLACK: ReadonlyArray<Readonly<Record<string, string>>> = [
  karoryferBank(KARORYFER_BLACK_BASE, 1, KARORYFER_NOTES_FULL),
  karoryferBank(KARORYFER_BLACK_BASE, 2, KARORYFER_NOTES_FULL),
  karoryferBank(KARORYFER_BLACK_BASE, 3, KARORYFER_NOTES_LOW),
  karoryferBank(KARORYFER_BLACK_BASE, 4, KARORYFER_NOTES_LOW),
];

/** OFFSET_P90 — owner-recorded offset-body P90 electric DI samples.
 *  Clean DI signal recorded direct to Cubase, 4 round-robin takes per pitch,
 *  damped between takes. Full chromatic E2 → D#5 (36 notes per bank) — every
 *  pitch in the electric guitar's usable range is an exact sample, no
 *  pitch-shifting. Self-hosted on Supabase under
 *  `samples/offsetp-90/rr<n>/<note>.mp3`. */
const OFFSET_P90_NOTES = [
  ['E2','E2'],['F2','F2'],['F#2','Fs2'],['G2','G2'],['G#2','Gs2'],['A2','A2'],['A#2','As2'],['B2','B2'],
  ['C3','C3'],['C#3','Cs3'],['D3','D3'],['D#3','Ds3'],['E3','E3'],['F3','F3'],['F#3','Fs3'],['G3','G3'],['G#3','Gs3'],['A3','A3'],['A#3','As3'],['B3','B3'],
  ['C4','C4'],['C#4','Cs4'],['D4','D4'],['D#4','Ds4'],['E4','E4'],['F4','F4'],['F#4','Fs4'],['G4','G4'],['G#4','Gs4'],['A4','A4'],['A#4','As4'],['B4','B4'],
  ['C5','C5'],['C#5','Cs5'],['D5','D5'],['D#5','Ds5'],
] as const;
const OFFSET_P90_BASE = 'https://ssszubkbregwjgkrpqop.supabase.co/storage/v1/object/public/samples/offsetp-90';
export const OFFSET_P90: ReadonlyArray<Readonly<Record<string, string>>> = [
  karoryferBank(OFFSET_P90_BASE, 1, OFFSET_P90_NOTES),
  karoryferBank(OFFSET_P90_BASE, 2, OFFSET_P90_NOTES),
  karoryferBank(OFFSET_P90_BASE, 3, OFFSET_P90_NOTES),
  karoryferBank(OFFSET_P90_BASE, 4, OFFSET_P90_NOTES),
];

/** OFFSET_P90_V2 — second take of the owner-recorded P90 DI pack. Re-recorded
 *  at hotter input gain after the first take's noise-floor issues at high
 *  notes. Same chromatic range (E2 → D#5, 36 notes/bank, 4 RR), same canonical
 *  "lowest fret per pitch" bundle. Self-hosted on Supabase under
 *  `samples/offsetp90-2/rr<n>/<note>.mp3` (note the slug differs from the
 *  original pack's `offsetp-90`). Shares the bank-note list with OFFSET_P90. */
const OFFSET_P90_V2_BASE = 'https://ssszubkbregwjgkrpqop.supabase.co/storage/v1/object/public/samples/offsetp90-2';
export const OFFSET_P90_V2: ReadonlyArray<Readonly<Record<string, string>>> = [
  karoryferBank(OFFSET_P90_V2_BASE, 1, OFFSET_P90_NOTES),
  karoryferBank(OFFSET_P90_V2_BASE, 2, OFFSET_P90_NOTES),
  karoryferBank(OFFSET_P90_V2_BASE, 3, OFFSET_P90_NOTES),
  karoryferBank(OFFSET_P90_V2_BASE, 4, OFFSET_P90_NOTES),
];

const SALAMANDER_PIANO_DEMO: Readonly<Record<string, string>> = {
  A1: 'https://tonejs.github.io/audio/salamander/A1.mp3',
  A2: 'https://tonejs.github.io/audio/salamander/A2.mp3',
  A3: 'https://tonejs.github.io/audio/salamander/A3.mp3',
  A4: 'https://tonejs.github.io/audio/salamander/A4.mp3',
  A5: 'https://tonejs.github.io/audio/salamander/A5.mp3',
  C2: 'https://tonejs.github.io/audio/salamander/C2.mp3',
  C3: 'https://tonejs.github.io/audio/salamander/C3.mp3',
  C4: 'https://tonejs.github.io/audio/salamander/C4.mp3',
  C5: 'https://tonejs.github.io/audio/salamander/C5.mp3',
  'D#2': 'https://tonejs.github.io/audio/salamander/Ds2.mp3',
  'D#3': 'https://tonejs.github.io/audio/salamander/Ds3.mp3',
  'D#4': 'https://tonejs.github.io/audio/salamander/Ds4.mp3',
  'F#2': 'https://tonejs.github.io/audio/salamander/Fs2.mp3',
  'F#3': 'https://tonejs.github.io/audio/salamander/Fs3.mp3',
  'F#4': 'https://tonejs.github.io/audio/salamander/Fs4.mp3',
};

export const SAMPLE_PACKS: readonly SamplePack[] = [
  {
    id: 'empty',
    label: 'Empty (falls back to PluckSynth)',
    description:
      'No samples loaded — Sampler-kind voice plays as a neutral PluckSynth until a pack is attached.',
    samples: [{}],
  },
  {
    id: 'salamander-piano-demo',
    label: 'Salamander Piano (demo)',
    description:
      'Tone.js example samples — piano, not guitar. Proves the Sampler pipeline end-to-end. Replace with a real guitar pack hosted at /samples/<pack-id>/ for production.',
    samples: [SALAMANDER_PIANO_DEMO],
  },
  {
    id: 'casio-piano-demo',
    label: 'Casio Piano (demo)',
    description:
      'Tone.js example samples — Casio CT-X3000 piano. Sparser than Salamander but more characterful. CC-BY hosted at tonejs.github.io.',
    samples: [CASIO_PIANO_DEMO],
  },
  {
    id: 'philharmonia-classical',
    label: 'Philharmonia Classical Guitar',
    description:
      'Nylon-string classical guitar samples from the Philharmonia Orchestra (CC-BY-NC). Self-hosted on Supabase. Full chromatic E2 → C6 — no pitch-shifting needed for any note in the guitar range.',
    samples: PHILHARMONIA_CLASSICAL,
  },
  {
    id: 'karoryfer-green',
    label: 'Karoryfer — Green Gretsch (electric)',
    description:
      'Green Gretsch Anniversary hollowbody electric, clean DI. From Karoryfer Lecolds\' free "Black And Green Guitars" pack. 4 round-robin takes (rr1..rr4) for humanized repeated notes. Full chromatic E2 → D6 — every guitar-range note is an exact sample, no pitch-shifting.',
    samples: KARORYFER_GREEN,
  },
  {
    id: 'karoryfer-black',
    label: 'Karoryfer — Black Hofner (electric)',
    description:
      'Black Hofner Club hollowbody electric, clean DI. From Karoryfer Lecolds\' free "Black And Green Guitars" pack. Sibling to the green pack — slightly louder and darker. 4 round-robin takes (rr1..rr4) for humanized repeated notes.',
    samples: KARORYFER_BLACK,
  },
  {
    id: 'offset-p90',
    label: 'Offset P90 (electric)',
    description:
      'Owner-recorded offset-body P90 electric, clean DI direct to Cubase. 4 round-robin takes (rr1..rr4) for humanized repeated notes. Full chromatic E2 → D#5 — every pitch in the usable range is an exact sample, no pitch-shifting.',
    samples: OFFSET_P90,
  },
  {
    id: 'offsetp90-2',
    label: 'offset90-2',
    description:
      'Second take of the owner-recorded P90 DI pack — re-recorded at hotter input gain after the first take had noise-floor issues on the high notes. Same coverage as Offset P90 (E2 → D#5, 4 RR).',
    samples: OFFSET_P90_V2,
  },
];

/** Eagerly populate the browser HTTP cache for every URL across all banks of a
 *  sample-bank array. Fire-and-forget: doesn't await, swallows errors. Idempotent
 *  (cached responses are fine). Call when the user picks a voice so the
 *  eventual Tone.Sampler fetch (at first play, possibly in a fresh Voice
 *  instance) hits cache instead of the network. */
export function prefetchSampleBanks(
  banks: ReadonlyArray<Readonly<Record<string, string>>>,
): void {
  if (typeof fetch === 'undefined') return;
  for (const bank of banks) {
    for (const url of Object.values(bank)) {
      fetch(url).catch(() => {});
    }
  }
}

/** Look up a pack by id. Returns undefined if not registered. */
export function getSamplePack(id: string): SamplePack | undefined {
  return SAMPLE_PACKS.find((p) => p.id === id);
}

/** Find which pre-registered pack (if any) matches a given sample-bank array by
 *  deep shape. Banks within a pack share keys and only differ by URL prefix, so
 *  identifying a pack only requires matching bank 0 against the input's bank 0
 *  (plus a bank-count check to disambiguate multi-bank packs from single-bank
 *  custom maps that happen to look like one of the banks). Used by the Lab UI
 *  to highlight the active pack in the picker after the preset hydrates from
 *  storage. Returns `null` if no match. */
export function detectSamplePack(
  samples: ReadonlyArray<Readonly<Record<string, string>>>,
): SamplePack | null {
  if (samples.length === 0) return null;
  const inputBank0 = samples[0];
  const inputKeys = Object.keys(inputBank0);
  for (const pack of SAMPLE_PACKS) {
    if (pack.samples.length !== samples.length) continue;
    const packBank0 = pack.samples[0];
    const packKeys = Object.keys(packBank0);
    if (packKeys.length !== inputKeys.length) continue;
    const allMatch = packKeys.every((k) => packBank0[k] === inputBank0[k]);
    if (allMatch) return pack;
  }
  return null;
}
