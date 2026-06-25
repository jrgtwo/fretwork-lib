import { useFretworkStore } from '../../store/useFretworkStore';
import type { LabelMode } from '../../types';
import { SelectControl } from './SelectControl';

const OPTIONS: readonly { value: LabelMode; label: string }[] = [
  { value: 'intervals', label: 'Intervals' },
  { value: 'notes', label: 'Notes' },
  { value: 'blank', label: 'Blank' },
];

export function LabelsSelect() {
  const labels = useFretworkStore((s) => s.labels);
  const setLabels = useFretworkStore((s) => s.setLabels);
  return (
    <SelectControl
      label="Labels"
      value={labels}
      options={OPTIONS}
      onChange={(v) => setLabels(v as LabelMode)}
    />
  );
}
