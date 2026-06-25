import { describe, it, expect } from 'vitest';
import { sanitizeActiveVariants } from '../src/cloud/sync';

describe('sanitizeActiveVariants', () => {
  it('returns all-defaults when raw is null', () => {
    const out = sanitizeActiveVariants(null, []);
    expect(out.guitar.kind).toBe('default');
    expect(out.bass.kind).toBe('default');
    expect(out.ukulele.kind).toBe('default');
  });

  it('falls back to default when a user ref points to a missing variant', () => {
    const raw = {
      guitar: { kind: 'user' as const, id: 'missing-id' },
      bass: { kind: 'default' as const, slotId: 'acoustic-bass' as const },
      ukulele: { kind: 'default' as const, slotId: 'acoustic-ukulele' as const },
    };
    const out = sanitizeActiveVariants(raw, []);
    expect(out.guitar).toEqual({ kind: 'default', slotId: 'acoustic-guitar' });
  });

  it('preserves a user ref when the variant exists', () => {
    const raw = {
      guitar: { kind: 'user' as const, id: 'real-id' },
      bass: { kind: 'default' as const, slotId: 'acoustic-bass' as const },
      ukulele: { kind: 'default' as const, slotId: 'acoustic-ukulele' as const },
    };
    const out = sanitizeActiveVariants(raw, [
      {
        id: 'real-id',
        name: 'foo',
        instrumentId: 'guitar',
        family: 'electric',
        collectionId: null,
        preset: {} as never,
      },
    ]);
    expect(out.guitar).toEqual({ kind: 'user', id: 'real-id' });
  });
});
