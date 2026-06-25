const ITEMS = [
  { var: '--degree-root', label: 'Root', sub: 'Interval 1' },
  { var: '--degree-third', label: 'Major 3rd', sub: 'Interval 3' },
  { var: '--degree-fifth', label: 'Perfect 5th', sub: 'Interval 5' },
  { var: '--degree-tone', label: 'Scale tone', sub: 'Intervals 2, 4, 6, 7' },
];

export function Legend() {
  return (
    <div className="rounded-lg border border-border/50 bg-card/60 p-5">
      <h3 className="text-xs font-mono uppercase tracking-[0.14em] text-muted-foreground">
        Legend
      </h3>
      <ul className="mt-3 space-y-2">
        {ITEMS.map((item) => (
          <li key={item.label} className="flex items-center gap-3">
            <span
              className="inline-block h-3.5 w-3.5 rounded-full ring-1 ring-black/30"
              style={{ background: `hsl(var(${item.var}))` }}
              aria-hidden="true"
            />
            <span className="flex flex-col leading-tight">
              <span className="text-sm">{item.label}</span>
              <span className="text-[10px] font-mono text-muted-foreground">{item.sub}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
