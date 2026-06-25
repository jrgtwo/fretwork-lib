// tsc emits JS/d.ts but not CSS. Copy the design-token stylesheet into dist so
// the `./styles/tokens.css` export resolves for consumers.
import { mkdirSync, copyFileSync } from 'node:fs';

mkdirSync('dist/styles', { recursive: true });
copyFileSync('src/styles/tokens.css', 'dist/styles/tokens.css');
console.log('[copy-assets] dist/styles/tokens.css');
