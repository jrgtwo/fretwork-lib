import { describe, it, expect, beforeEach } from 'vitest';
import { usePatternsStore, DEFAULT_PATTERNS_STATE } from '../src/patterns/store/usePatternsStore';
import { useFretworkStore } from '../src/store/useFretworkStore';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  usePatternsStore.setState({ ...DEFAULT_PATTERNS_STATE });
});

describe('ensureEditingComposition', () => {
  it('auto-seeds an Untitled composition when library is empty', () => {
    const { ensureEditingComposition } = usePatternsStore.getState();
    ensureEditingComposition();
    const s = usePatternsStore.getState();
    expect(s.library.compositions).toHaveLength(1);
    expect(s.editingCompositionId).toBe(s.library.compositions[0].id);
    expect(s.library.compositions[0].name).toBe('Untitled composition');
    expect(s.library.compositions[0].instrumentId).toBe(
      useFretworkStore.getState().instrumentId,
    );
  });

  it('no-ops when editingCompositionId points to an existing composition', () => {
    const { createComposition, ensureEditingComposition } = usePatternsStore.getState();
    const id = createComposition('Song A');
    const before = usePatternsStore.getState().library.compositions.length;
    ensureEditingComposition();
    const after = usePatternsStore.getState().library.compositions.length;
    expect(after).toBe(before);
    expect(usePatternsStore.getState().editingCompositionId).toBe(id);
  });

  it('picks the most-recent composition when editingCompositionId is stale', () => {
    const { createComposition, deleteComposition, ensureEditingComposition } = usePatternsStore.getState();
    const a = createComposition('A');
    const b = createComposition('B');
    deleteComposition(b); // editingCompositionId now stale-or-null
    usePatternsStore.setState({ editingCompositionId: b });
    ensureEditingComposition();
    expect(usePatternsStore.getState().editingCompositionId).toBe(a);
  });
});
