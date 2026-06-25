import { useMemo } from 'react';
import { useFretworkStore } from '../../store/useFretworkStore';
import { CHROMATIC_KEYS } from '../../lib/tunings';
import { SelectControl } from './SelectControl';

export function KeySelect() {
  const key = useFretworkStore((s) => s.key);
  const setKey = useFretworkStore((s) => s.setKey);
  const mode = useFretworkStore((s) => s.mode);

  const options = useMemo(
    () => CHROMATIC_KEYS.map((k) => ({ value: k, label: k })),
    [],
  );

  // In Notes mode the "key" doesn't apply — the chosen note IS the type. Hide the control.
  if (mode === 'notes') return null;

  return <SelectControl label="Key" value={key} options={options} onChange={setKey} />;
}
