import type { ReactNode } from 'react';

interface Props {
  label: string;
  children: ReactNode;
}

/**
 * Wrapper used by every control on the Setup and Patterns ribbons. Renders the
 * small uppercased label inline-left of the control so the ribbon reads as a
 * flowing line of label+input pairs rather than stacked vertical columns.
 */
export function ControlGroup({ label, children }: Props) {
  return (
    <div className="inline-flex items-center gap-2">
      <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground/80 whitespace-nowrap">
        {label}
      </span>
      {children}
    </div>
  );
}
