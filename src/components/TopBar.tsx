import { Button } from '../components/ui/button';
import { InstrumentSelect } from '../components/controls/InstrumentSelect';
import { ModeSelect } from '../components/controls/ModeSelect';
import { KeySelect } from '../components/controls/KeySelect';
import { TypeSelect } from '../components/controls/TypeSelect';
import { ShapeSelect } from '../components/controls/ShapeSelect';
import { TuningSelect } from '../components/controls/TuningSelect';
import { CapoSelect } from '../components/controls/CapoSelect';
import { LabelsSelect } from '../components/controls/LabelsSelect';
import { SettingsDialog } from './SettingsDialog';

export function TopBar() {
  return (
    <header className="flex flex-wrap items-end gap-3 px-4 sm:px-6 py-3 bg-charcoal-raised/70 backdrop-blur border-b border-border/40">
      <div className="flex items-center gap-3 mr-2">
        <Brand />
      </div>

      <div className="flex flex-wrap items-end gap-3 flex-1 min-w-0">
        <InstrumentSelect />
        <ModeSelect />
        <KeySelect />
        <TypeSelect />
        <ShapeSelect />
        <TuningSelect />
        <CapoSelect />
        <LabelsSelect />
      </div>

      <div className="flex items-center gap-2">
        <SettingsDialog />
        <Button variant="secondary" size="sm" disabled aria-label="Sign in (coming soon)">
          Sign in
        </Button>
      </div>
    </header>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <div className="h-9 w-9 rounded-md bg-degree-root/90 flex items-center justify-center text-charcoal-deep font-bold tracking-tighter shadow-md">
        F
      </div>
      <div className="flex flex-col leading-none">
        <span className="font-bold tracking-tight">FRETWORK</span>
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          full-neck visualization
        </span>
      </div>
    </div>
  );
}
