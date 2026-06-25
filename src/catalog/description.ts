/**
 * Soft length cap for shareable content descriptions. Enforced at the UI layer
 * (`maxLength` on the textarea). The DB doesn't constrain — a malicious client
 * could write more, but RLS-level enforcement isn't worth the complexity here.
 *
 * 256 is deliberately tight: descriptions for a guitar pattern shouldn't be
 * essays, and a short cap discourages spam ad copy.
 */
export const DESCRIPTION_MAX_LENGTH = 256;
