import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { ControlGroup } from './ControlGroup';

interface Option {
  readonly value: string;
  readonly label: string;
}

interface Props {
  label: string;
  value: string;
  options: readonly Option[];
  onChange: (value: string) => void;
  triggerClassName?: string;
  /** Placeholder shown when `value` is empty (no item matches). Radix renders this
   *  in the trigger when no selection is active. */
  placeholder?: string;
}

const ITEM_CLASS = 'font-mono uppercase tracking-wider text-xs';

/**
 * Shared `<ControlGroup> + <Select>` wrapper used by every TopBar dropdown. Keeps
 * styling consistent (mono/uppercase) across the trigger and every item, so
 * individual controls don't have to remember to apply the className to each
 * `<SelectItem>`. Callers handle conditional rendering, option derivation, and
 * any non-string ↔ string coercion themselves.
 *
 * For optional/nullable values, pass `value=""` plus a `placeholder` — Radix will
 * render the placeholder text in the trigger when no item matches. Never include
 * an empty-string option in `options`; Radix forbids it.
 */
export function SelectControl({
  label,
  value,
  options,
  onChange,
  triggerClassName,
  placeholder,
}: Props) {
  const triggerClass = triggerClassName ? `${ITEM_CLASS} ${triggerClassName}` : ITEM_CLASS;
  return (
    <ControlGroup label={label}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className={triggerClass}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} className={ITEM_CLASS}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </ControlGroup>
  );
}
