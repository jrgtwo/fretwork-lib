import { describe, it, expect } from 'vitest';
import { parseAsciiTab } from '../src/import/ascii-tab/parse-ascii-tab';

describe('parseAsciiTab', () => {
  it('extracts notes from a single guitar block in order', () => {
    const text = [
      'e|-0-2-3-|',
      'B|-------|',
      'G|-------|',
      'D|-------|',
      'A|-------|',
      'E|-------|',
    ].join('\n');

    const ir = parseAsciiTab(text);

    expect(ir.meta.sourceFormat).toBe('ascii-tab');
    expect(ir.tracks).toHaveLength(1);
    const events = ir.tracks[0].events;
    expect(events).toHaveLength(3);
    // high e is string index 5 (top line of a 6-line block)
    expect(events.map((e) => e.notes[0].string)).toEqual([5, 5, 5]);
    expect(events.map((e) => e.notes[0].fret)).toEqual([0, 2, 3]);
    // events are time-ordered
    expect(events[0].atTick).toBeLessThan(events[1].atTick);
  });

  it('groups notes in the same column into a chord event', () => {
    const text = [
      'e|---3----|',
      'B|---3----|',
      'G|---0----|',
      'D|--------|',
      'A|--------|',
      'E|--------|',
    ].join('\n');
    const ir = parseAsciiTab(text);
    expect(ir.tracks[0].events).toHaveLength(1);
    const notes = ir.tracks[0].events[0].notes;
    expect(notes.map((n) => n.string).sort()).toEqual([3, 4, 5]);
  });

  it('reads multi-digit frets as one note', () => {
    const text = [
      'e|---12----|',
      'B|---------|',
      'G|---------|',
      'D|---------|',
      'A|---------|',
      'E|---------|',
    ].join('\n');
    const ir = parseAsciiTab(text);
    const events = ir.tracks[0].events;
    expect(events).toHaveLength(1);
    expect(events[0].notes[0].fret).toBe(12);
  });

  it('extracts articulations (hammer, bend, vibrato, slide, dead)', () => {
    const text = [
      'e|---5h7--9b11--12~~--3/5--x----|',
      'B|------------------------------|',
      'G|------------------------------|',
      'D|------------------------------|',
      'A|------------------------------|',
      'E|------------------------------|',
    ].join('\n');
    const ir = parseAsciiTab(text);
    const notes = ir.tracks[0].events.flatMap((e) => e.notes);
    const byFret = (f: number) => notes.find((n) => n.fret === f);

    expect(byFret(7)?.hammerOn).toBe(true);
    expect(byFret(9)?.bend?.semitones).toBe(2); // 9 bent to 11
    expect(notes.some((n) => n.fret === 11)).toBe(false); // bend target is not its own note
    expect(byFret(12)?.vibrato).toBe('wide');
    expect(byFret(3)?.slide?.type).toContain('slide');
    expect(notes.some((n) => n.dead)).toBe(true);
  });

  it('treats a delayed hammer-on (4h=5) as a normal hammer-on', () => {
    const text = [
      'e|----4h=5----|',
      'B|------------|',
      'G|------------|',
      'D|------------|',
      'A|------------|',
      'E|------------|',
    ].join('\n');
    const notes = parseAsciiTab(text).tracks[0].events.flatMap((e) => e.notes);
    expect(notes.map((n) => n.fret)).toEqual([4, 5]);
    expect(notes.find((n) => n.fret === 5)?.hammerOn).toBe(true); // `=` skipped, sees the `h`
  });

  it('reads "s" slides (8s7, 3s5) with direction + target as its own note', () => {
    const text = [
      'e|-8s7--3s5-|',
      'B|----------|',
      'G|----------|',
      'D|----------|',
      'A|----------|',
      'E|----------|',
    ].join('\n');
    const notes = parseAsciiTab(text).tracks[0].events.flatMap((e) => e.notes);
    expect(notes.find((n) => n.fret === 8)?.slide?.type).toBe('slide-out-down'); // 8→7
    expect(notes.find((n) => n.fret === 3)?.slide?.type).toBe('slide-out-up'); // 3→5
    expect(notes.some((n) => n.fret === 7)).toBe(true); // slide target is played
    expect(notes.some((n) => n.fret === 5)).toBe(true);
  });

  it('reads inline time-signature changes (2/4 then 4/4)', () => {
    const text = [
      ' 2/4 4/4',
      'e|-5-|-7-|',
      'B|---|---|',
      'G|---|---|',
      'D|---|---|',
      'A|---|---|',
      'E|---|---|',
    ].join('\n');
    const ir = parseAsciiTab(text);
    expect(ir.timeSignatures.some((t) => t.numerator === 2 && t.denominator === 4)).toBe(true);
    // the 4/4 measure starts after one 2/4 bar = 2 * 480 = 960 ticks
    expect(ir.timeSignatures.find((t) => t.numerator === 4 && t.atTick > 0)?.atTick).toBe(960);
  });

  it('ignores fractions buried in prose (e.g. "Tuned down 1/2 step")', () => {
    const text = [
      'Tuned down 1/2 step',
      '',
      'e|-5---5---5---5---|',
      'B|----------------|',
      'G|----------------|',
      'D|----------------|',
      'A|----------------|',
      'E|----------------|',
    ].join('\n');
    const ir = parseAsciiTab(text);
    // the 1/2 in the tuning note must NOT become a time signature
    expect(ir.timeSignatures.some((t) => t.numerator === 1 && t.denominator === 2)).toBe(false);
    expect(ir.timeSignatures[0]).toEqual({ atTick: 0, numerator: 4, denominator: 4 });
  });

  it('harvests chord names above the staff into ir.chords (beat-snapped)', () => {
    const text = [
      'C       G       Am      F',
      'e|--0-------0-------0-------0-----|',
      'B|-------------------------------|',
      'G|-------------------------------|',
      'D|-------------------------------|',
      'A|-------------------------------|',
      'E|-------------------------------|',
    ].join('\n');
    const chords = parseAsciiTab(text).chords ?? [];
    expect(chords.map((c) => c.symbol)).toEqual(['C', 'G', 'Am', 'F']);
    expect(chords[0].atTick).toBe(0); // first chord on the downbeat
    for (let i = 1; i < chords.length; i++) {
      expect(chords[i].atTick % 480).toBe(0); // beat-snapped (quarter = 480)
      expect(chords[i].atTick).toBeGreaterThan(chords[i - 1].atTick);
    }
  });

  it('does not harvest chords from a lyric line', () => {
    const text = [
      'Blackbird singing in the dead of night',
      'e|--0-------0-------0-------0-----|',
      'B|-------------------------------|',
      'G|-------------------------------|',
      'D|-------------------------------|',
      'A|-------------------------------|',
      'E|-------------------------------|',
    ].join('\n');
    expect(parseAsciiTab(text).chords ?? []).toHaveLength(0);
  });

  it('reads time sigs even when mixed with chord names on a line', () => {
    const text = [
      '  3/4 G       Am7      4/4 G',
      'e|-5-|-6-|-7-|-8-|',
      'B|---|---|---|---|',
      'G|---|---|---|---|',
      'D|---|---|---|---|',
      'A|---|---|---|---|',
      'E|---|---|---|---|',
    ].join('\n');
    const ir = parseAsciiTab(text);
    expect(ir.timeSignatures.some((t) => t.numerator === 3 && t.denominator === 4)).toBe(true);
    expect(ir.timeSignatures.some((t) => t.numerator === 4 && t.denominator === 4 && t.atTick > 0)).toBe(true);
  });

  it('snaps the first note of each bar to the downbeat (no lead-gap)', () => {
    const text = [
      'e|---5---|---7---|',
      'B|-------|-------|',
      'G|-------|-------|',
      'D|-------|-------|',
      'A|-------|-------|',
      'E|-------|-------|',
    ].join('\n');
    const ev = parseAsciiTab(text).tracks[0].events;
    expect(ev[0].atTick).toBe(0); // first note on the downbeat, not offset by padding
  });

  it('aligns notes to bar lines — one segment per measure', () => {
    // bar dividers at the same column in every line; a note in measure 1 and one
    // in measure 2, regardless of how the chars are spaced.
    const text = [
      'e|-5---|-------7---|',
      'B|-----|-----------|',
      'G|-----|-----------|',
      'D|-----|-----------|',
      'A|-----|-----------|',
      'E|-----|-----------|',
    ].join('\n');
    const ev = parseAsciiTab(text).tracks[0].events;
    expect(ev).toHaveLength(2);
    // 4/4 at 480 ppq = 1920 ticks/bar
    expect(ev[0].atTick).toBeLessThan(1920); // measure 1
    expect(ev[1].atTick).toBeGreaterThanOrEqual(1920); // measure 2
  });

  it('treats a `||` double-barline as one boundary, not a phantom measure', () => {
    // Two `3/4` then `4/4` measures, but the block opens with `||` (like a
    // repeat / section start). The adjacent pipes must NOT spawn a zero-width
    // measure that eats a full bar of ticks and shifts every later TS change.
    const text = [
      '  3/4 G      4/4 G',
      'e||-5-------|-7-------|',
      'B||---------|---------|',
      'G||---------|---------|',
      'D||---------|---------|',
      'A||---------|---------|',
      'E||---------|---------|',
    ].join('\n');
    const ir = parseAsciiTab(text);
    const ev = ir.tracks[0].events;
    expect(ev).toHaveLength(2); // two real measures, no phantom
    expect(ev[0].atTick).toBe(0); // measure 1 on the downbeat
    // measure 2 (4/4) starts exactly one 3/4 bar in = 3 * 480 = 1440 ticks,
    // and the 4/4 change is emitted at that same tick — not a bar late.
    expect(ev[1].atTick).toBe(1440);
    expect(ir.timeSignatures.find((t) => t.numerator === 4 && t.atTick > 0)?.atTick).toBe(1440);
  });

  it('evens out minor spacing jitter into a steady run (no legend)', () => {
    // Gaps 3,2,2 — the first note has one extra dash of padding (typical of tab
    // edges). With no beat legend it should still come out as 4 EVEN notes, not
    // a long first note then short ones.
    const text = [
      'e|-0--0-0-0-|',
      'B|----------|',
      'G|----------|',
      'D|----------|',
      'A|----------|',
      'E|----------|',
    ].join('\n');
    const ev = parseAsciiTab(text).tracks[0].events;
    expect(ev).toHaveLength(4);
    const d = ev.map((e) => e.durationTicks);
    expect(Math.max(...d) - Math.min(...d)).toBeLessThanOrEqual(1); // evenly spaced
  });

  it('keeps an obviously wider gap between notes (no legend)', () => {
    // Three tight notes, then a clearly wider gap before the last — that space
    // must be preserved, not flattened to even.
    const text = [
      'e|-0-0-0------0-|',
      'B|--------------|',
      'G|--------------|',
      'D|--------------|',
      'A|--------------|',
      'E|--------------|',
    ].join('\n');
    const ev = parseAsciiTab(text).tracks[0].events;
    expect(ev).toHaveLength(4);
    const g1 = ev[1].atTick - ev[0].atTick;
    const gLast = ev[3].atTick - ev[2].atTick;
    expect(gLast).toBeGreaterThan(g1 * 1.5); // wide gap kept
  });

  it('derives timing from column spacing (wider gaps = longer)', () => {
    // 5 at col, 7 two chars later, 9 four chars after that → second gap ≈ 2× first
    const text = [
      'e|-5--7----9-|',
      'B|-----------|',
      'G|-----------|',
      'D|-----------|',
      'A|-----------|',
      'E|-----------|',
    ].join('\n');
    const ev = parseAsciiTab(text).tracks[0].events;
    expect(ev).toHaveLength(3);
    const gap1 = ev[1].atTick - ev[0].atTick;
    const gap2 = ev[2].atTick - ev[1].atTick;
    expect(gap2).toBeGreaterThan(gap1); // wider char spacing → later in time
    expect(Math.round(gap2 / gap1)).toBe(2);
  });

  it('does not inflate the last note of a bar with trailing alignment padding', () => {
    // Bar 1: four evenly-spaced notes, then ~8 dashes of readability padding before
    // the bar line. Bar 2 has a note. The last note of bar 1 must NOT stretch across
    // that padding up to bar 2's onset (the "extra half beat" bug — Blackbird's E5).
    const text = [
      'e|-0--0--0--0--------|-5----------------|',
      'B|------------------|------------------|',
      'G|------------------|------------------|',
      'D|------------------|------------------|',
      'A|------------------|------------------|',
      'E|------------------|------------------|',
    ].join('\n');
    const ev = parseAsciiTab(text).tracks[0].events;
    expect(ev).toHaveLength(5); // 4 in bar 1 + 1 in bar 2
    const midDur = ev[1].durationTicks; // an interior note of bar 1
    // bar 1's last note (ev[3]) is within 50% of an interior note — not ~2-3× from
    // swallowing trailing padding all the way to bar 2's downbeat.
    expect(ev[3].durationTicks).toBeLessThan(midDur * 1.5);
  });

  it('lets a lone note sustain toward the next onset (no inter-onset gap to copy)', () => {
    // Each bar holds a single note: with no rhythm to copy, the note SHOULD ring
    // most of its bar — the trailing-padding heuristic must not shorten a genuine
    // sustain down to a token length.
    const text = [
      'e|-5-----------------|-3-----------------|',
      'B|-------------------|-------------------|',
      'G|-------------------|-------------------|',
      'D|-------------------|-------------------|',
      'A|-------------------|-------------------|',
      'E|-------------------|-------------------|',
    ].join('\n');
    const ev = parseAsciiTab(text).tracks[0].events;
    expect(ev).toHaveLength(2);
    // 4/4 = 1920 ticks/bar; bar 1's lone note rings most of the bar.
    expect(ev[0].durationTicks).toBeGreaterThan(1920 * 0.75);
  });

  it('uses the +/. beat legend to snap notes to the subdivision grid', () => {
    // 4/4 bar with an 8-marker (eighth-note) legend. Three notes sit under the
    // FIRST three markers. Content-fill would spread them across the whole bar
    // (≈0, 640, 1280); the legend pins them to subdivisions 0,1,2 → 0,240,480.
    const e = 'e|5---7---9' + '-'.repeat(23) + '|';
    const empty = '|' + '-'.repeat(32) + '|';
    const text = [
      e,
      'B' + empty,
      'G' + empty,
      'D' + empty,
      'A' + empty,
      'E' + empty,
      '  +   .   +   .   +   .   +   .',
    ].join('\n');
    const ev = parseAsciiTab(text).tracks[0].events;
    expect(ev).toHaveLength(3);
    expect(ev[0].atTick).toBe(0);
    expect(ev[1].atTick).toBe(240); // subdivision 1, not spread to ~640
    expect(ev[2].atTick).toBe(480); // subdivision 2, not spread to ~1280
  });

  it('treats a 4-line block as bass', () => {
    const text = ['G|-----|', 'D|--5--|', 'A|-7---|', 'E|-----|'].join('\n');
    const ir = parseAsciiTab(text);
    expect(ir.tracks[0].instrumentHint).toBe('bass');
    // lowest line E is string index 0; A is index 1
    const aNote = ir.tracks[0].events.find((e) => e.notes[0].fret === 7)!;
    expect(aNote.notes[0].string).toBe(1);
  });
});
