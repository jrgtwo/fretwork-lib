/**
 * ID generators.
 *
 * Two distinct shapes:
 *
 *   - `generateUuid()` — RFC 4122 v4 UUID. Used for entities that map to a
 *     Postgres `uuid` column (patterns, compositions, placements). Required
 *     so the in-memory ID matches the DB row ID without translation.
 *
 *   - `generateId(prefix)` — short URL-safe base36 string with optional
 *     prefix (e.g. `ev_abc123def456`). Used for entities that live inside
 *     a jsonb `data` blob (events, lanes) and never become DB row IDs.
 *     Cheaper, more readable in logs, no DB-format requirement.
 *
 * Neither is cryptographic. Collisions within a single user's library are
 * astronomically unlikely.
 */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ID_LENGTH = 12;
const HEX = '0123456789abcdef';

/**
 * UUID v4 — for entities whose ID is a DB row primary key (patterns,
 * compositions, placements, voice_presets). Uses `crypto.randomUUID()`
 * when available (browsers, modern Node, jsdom); falls back to a manual
 * implementation otherwise.
 */
export function generateUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Fallback v4 — random bytes with version + variant bits set.
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = (Math.random() * 256) | 0;
  }
  // Per RFC 4122 v4:
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10x
  let out = '';
  for (let i = 0; i < 16; i++) {
    const b = bytes[i];
    out += HEX[b >> 4] + HEX[b & 0x0f];
    if (i === 3 || i === 5 || i === 7 || i === 9) out += '-';
  }
  return out;
}

/** Short prefixed ID for jsonb-embedded entities (events, lanes, etc). */
export function generateId(prefix?: string): string {
  let out = '';
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    const bytes = new Uint8Array(ID_LENGTH);
    globalThis.crypto.getRandomValues(bytes);
    for (let i = 0; i < ID_LENGTH; i++) {
      out += ALPHABET[bytes[i] % ALPHABET.length];
    }
  } else {
    for (let i = 0; i < ID_LENGTH; i++) {
      out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
  }
  return prefix ? `${prefix}_${out}` : out;
}
