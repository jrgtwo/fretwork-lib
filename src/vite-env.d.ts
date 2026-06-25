// Ambient typing for `import.meta.env`. In an app this comes from `vite/client`,
// but this library is built standalone (no Vite), so we declare the minimal shape
// its source touches. This .d.ts is NOT emitted to `dist` (files: ["dist"]), so it
// never reaches consumers or conflicts with their own Vite env types.
interface ImportMetaEnv {
  readonly [key: string]: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
