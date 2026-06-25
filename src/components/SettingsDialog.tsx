import { useState, type ReactNode } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group';
import { Switch } from '../components/ui/switch';
import { Label } from '../components/ui/label';
import { useFretworkStore } from '../store/useFretworkStore';
import type { Handedness } from '../types';

export function SettingsDialog({ audioSection }: { audioSection?: ReactNode } = {}) {
  const [open, setOpen] = useState(false);
  const settings = useFretworkStore((s) => s.settings);
  const setHandedness = useFretworkStore((s) => s.setHandedness);
  const setColorByDegree = useFretworkStore((s) => s.setColorByDegree);
  const setHighlightRoot = useFretworkStore((s) => s.setHighlightRoot);
  const setShowGhostMarkers = useFretworkStore((s) => s.setShowGhostMarkers);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Settings">
          <SettingsIcon className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Configure how the fretboard is rendered.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-2">
          <section className="grid gap-3">
            <h3 className="text-xs font-mono uppercase tracking-[0.14em] text-muted-foreground">Display</h3>

            <div className="grid gap-2">
              <Label>Handedness</Label>
              <RadioGroup
                value={settings.handedness}
                onValueChange={(v) => setHandedness(v as Handedness)}
                className="flex gap-6"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="right" id="hand-right" />
                  <Label htmlFor="hand-right" className="font-normal">Right</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="left" id="hand-left" />
                  <Label htmlFor="hand-left" className="font-normal">Left</Label>
                </div>
              </RadioGroup>
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="color-by-degree">Color by scale degree</Label>
              <Switch
                id="color-by-degree"
                checked={settings.colorByDegree}
                onCheckedChange={setColorByDegree}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="highlight-root">Highlight root note</Label>
              <Switch
                id="highlight-root"
                checked={settings.highlightRoot}
                onCheckedChange={setHighlightRoot}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col leading-tight">
                <Label htmlFor="ghost-markers" className="cursor-pointer">Show ghost markers</Label>
                <span className="text-[10px] font-mono text-muted-foreground">
                  When a CAGED shape is active, render the rest of the scale at low opacity instead of hiding it.
                </span>
              </div>
              <Switch
                id="ghost-markers"
                checked={settings.showGhostMarkers}
                onCheckedChange={setShowGhostMarkers}
              />
            </div>
          </section>

          <section className="grid gap-2">
            <h3 className="text-xs font-mono uppercase tracking-[0.14em] text-muted-foreground">Audio</h3>
            {audioSection ?? (
              <p className="text-sm text-muted-foreground opacity-50">Coming in a future release.</p>
            )}
          </section>

          <section className="grid gap-2 opacity-50 pointer-events-none">
            <h3 className="text-xs font-mono uppercase tracking-[0.14em] text-muted-foreground">Account</h3>
            <p className="text-sm text-muted-foreground">Coming in a future release.</p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
