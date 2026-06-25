# @fretwork/lib

Reusable fretboard visualization + audio/metronome library — components, music theory, Zustand
stores, Tone.js playback, and tab/chord import. Consumed by the Fretwork apps as a **git dependency**
(no npm registry): cloning the repo runs the `prepare` build, so consumers get compiled `dist/`.

## Install (git dependency)

```jsonc
// consumer package.json
"dependencies": {
  "@fretwork/lib": "github:jrgtwo/fretwork-lib#v0.1.0"
}
```

Peer deps: `react`, `react-dom`.

## Exports

```ts
import { Fretboard, useMetronome, /* … */ } from '@fretwork/lib';
import { /* importers */ } from '@fretwork/lib/import';
import '@fretwork/lib/styles/tokens.css';   // design tokens (CSS variables)
```

## Consumers using lib's Tailwind classes

This package ships React components that use Tailwind utility classes. An app that renders those
components must add the built output to its Tailwind `content` so the classes are generated:

```ts
content: ['./src/**/*.{ts,tsx}', './node_modules/@fretwork/lib/dist/**/*.js'],
```

(Apps that only use the hooks/engine — e.g. the metronome — don't need this.)

## Scripts

```bash
pnpm build       # tsc -> dist/ + copies tokens.css (also runs on install via `prepare`)
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
```

> Known: ~60 audio tests fail on a Tone.js `Meter` mock — pre-existing, unrelated to packaging.

## Releasing

```bash
git tag v0.2.0 && git push --tags
# consumers bump #v0.1.0 -> #v0.2.0 and reinstall
```
