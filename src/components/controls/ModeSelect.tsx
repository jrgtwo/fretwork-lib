import { useFretworkStore } from '../../store/useFretworkStore';
import type { Mode } from '../../types';
import { SelectControl } from './SelectControl';

const OPTIONS: readonly { value: Mode; label: string }[] = [
  { value: 'scales', label: 'Scales' },
  { value: 'arpeggios', label: 'Arpeggios' },
  { value: 'notes', label: 'Notes' },
];

export function ModeSelect() {
  const mode = useFretworkStore((s) => s.mode);
  const setMode = useFretworkStore((s) => s.setMode);
  return (
    <SelectControl
      label="Mode"
      value={mode}
      options={OPTIONS}
      onChange={(v) => setMode(v as Mode)}
    />
  );
}
