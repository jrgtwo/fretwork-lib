# Next release — draft notes

_Branch `migration/composer`. Written for whoever bumps the tag; delete or fold into a
CHANGELOG once the version is cut._

Everything here came out of a migration pass with the consumer app: it had been tagging
each defect in this library with a `LIB-GAP(n)` marker and a deletion condition, and this
release closes ten of them. Every workaround on that side is now deleted.

## BREAKING

**`FretboardModel.playback` is `null` unless injected.**
`useFretboardModel` no longer calls `usePlayback()`. It previously constructed the
Practice-page `Playback` singleton — plus a `PluckSynthInstrument`, a `Voice` and three
metronome subscriptions that unmounting never released — merely because a fretboard was
on screen. Its store defaults `enabled: true`, so that singleton played a scale walk on
every tick of whatever metronome was running.

Pass `playback` on `FretboardModelInput` (or the new `<Fretboard playback={…}>` prop) if
you want it. Anything reading `model.playback` and expecting it to be populated
automatically will get `null`.

**`<Fretboard>` legacy click-to-program needs the new `playback` prop.**
In `isProgramming` mode without an `onCellClickOverride`, clicks still mirror into
`usePlaybackStore` — so the numbered badges appear and the UI looks correct — but no
engine records them and the sequence will not play back. **This failure is silent.** Apps
using that path must pass their own `usePlayback().playback`.

**`dimNonHighlighted` now renders the whole grid.**
It was documented as applying "a dimmed/ghosted styling to the rest" but only gated the
editor's hover-preview marker. It now fills in the non-highlighted cells and flags them
dim, so `renderHighlights` and `renderedKeys` return the full grid in that mode rather
than just the highlights. Custom renderers built on `useFretboardModel` will start drawing
~6×(fretCount+1) markers with no change on their side.

The dim filler deliberately skips the activity and footprint cells — without that, the
playhead renders at 22% opacity and the footprint becomes indistinguishable from the grid.

**`Voice.swapPreset` rebuilds instead of disposing.**
On a source-**kind** change it used to call `dispose()` and return, leaving the caller
holding a dead voice. It now tears down and rebuilds, and only rebuilds if the voice was
already built. It also compares a sampler's `samples` and `release` rather than only the
`kind`, so a pack change is applied instead of silently ignored.

## Added

- **`Metronome.onBeforeStart(handler)`** — work awaited inside `start()` *before* it waits
  on buffer loads. The `'start'` event fires after the transport is already running, so it
  was too late to warm anything; consumers had to call `ensureBuilt()` themselves in the
  right order, and getting it wrong produced a silent first note with no error.
  `EventScheduler` now registers its instrument here, so the engine warms itself.
- **`GuitarInstrument.ensureBuilt?()`** — optional; meaningful for sample-backed
  instruments.
- **`Voice.ready()`** — builds the graph and resolves once buffers are decoded, for paths
  that don't run the transport (auditioning, previewing). Note `Tone.loaded()` is global,
  so a concurrently-loading voice delays it.
- **`<Fretboard ariaLabel>`** — overrides the label previously hardcoded from global scale
  state ("Fretboard showing A major in Standard"), which forced consumers showing
  something else to hide the board from the accessibility tree.
- **`FretboardModel.dimmedKeys`**.
- **`prefetchSampleBanks`** exported from the barrels (was reachable only from the lib's
  own `setActiveVariantRef`).
- **`DYNAMIC_VELOCITY` / `dynamicToVelocity`** exported. The pattern model documents that
  authoring a dynamic must back-fill `velocity` "via the same curve the mapper uses", but
  the curve was private to the importer, so consumers had to copy the numbers and drift.
- **`MasterBus.onDispose(listener)`**.

## Fixed

- **`getTransportTicks` no longer throws without an AudioContext**, and never returns a
  non-finite number. Callers are rAF loops, where an exception escapes their try/catch and
  a `NaN` propagates silently into layout maths.
- **`EventScheduler` emits the head during playback.** There was a `_visualRafId` loop
  that nothing ever started — only `_stopVisualLoop` existed — so `onHead` fired exactly
  twice per session and every consumer ran its own rAF reading the transport. Head now
  comes from the same poll as the highlights, already folded into the loop region, so the
  playhead and the lit notes cannot disagree.
- **`EventScheduler` emits a `null` placement on stop.** It used to leave the id at
  whatever was last under the head, so a consumer highlighting the current placement kept
  it lit for the rest of the session.
- **`parseSlotId` was wrong for 9 of 14 slots.** It split on `-` assuming
  `<family>-<instrumentId>`, so every amp slot reported instrument `"amp"` and the
  Karoryfer guitars reported `"green"`/`"black"`. It now reads the preset.
- **`NotesBus` no longer feeds a disposed `MasterBus`.** It cached its gain and
  short-circuited forever, so a bus teardown left every voice silent while the metronome
  click — which bypasses the bus — kept playing.
- **`setActiveVariantRef` no longer throws on a malformed persisted variant.** It
  dereferenced `resolveActiveVoice(...).source.kind` unguarded, purely to warm the sample
  cache; variants rehydrate from localStorage, so an older-schema preset crashed the store
  *after* the ref had been committed.

## Test baseline

The suite went from **59 failures to 0** (565 passing, 1 skipped). `CLAUDE.md` used to say
~60 audio tests failed on a Tone.js `Meter` mock and that you shouldn't treat them as
regressions; that is no longer true and the note is corrected. **Any failure is now a
regression.**

## Dependencies

`tone` and `zustand` moved from `dependencies` to `peerDependencies` (kept in
`devDependencies` for this repo's own tests). Both are imported by `dist`, so consumers
were previously getting our copy. Two copies of Tone means two AudioContexts and two
transports — notes scheduled on one nobody is listening to. `zustand` is worse
conceptually: the public API *is* zustand stores, so two copies is two registries.

npm 7+ and pnpm 8+ auto-install peers, so this costs consumers nothing at install; it
converts a silent runtime duplication into a loud install-time conflict.
