import { useMemo } from 'react';
import { useFretworkStore } from '../../store/useFretworkStore';
import { SCALES } from '../../lib/scales';
import { ARPEGGIOS } from '../../lib/arpeggios';
import { CHROMATIC_KEYS } from '../../lib/tunings';
import { SelectControl } from './SelectControl';

export function TypeSelect() {
  const mode = useFretworkStore((s) => s.mode);
  const type = useFretworkStore((s) => s.type);
  const setType = useFretworkStore((s) => s.setType);

  const options = useMemo(() => {
    if (mode === 'scales') return SCALES.map((s) => ({ value: s.id, label: s.name }));
    if (mode === 'arpeggios') return ARPEGGIOS.map((a) => ({ value: a.id, label: a.name }));
    return CHROMATIC_KEYS.map((k) => ({ value: k, label: k }));
  }, [mode]);

  const label = mode === 'notes' ? 'Note' : 'Type';

  return (
    <SelectControl
      label={label}
      value={type}
      options={options}
      onChange={setType}
      triggerClassName="min-w-[140px]"
    />
  );
}
