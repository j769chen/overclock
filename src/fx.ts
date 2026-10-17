import { blastCells, N, neighbours, type PlaceResult } from './engine';
import { fmt } from './format';
import { PART_COLORS, portCentre, span, type Metrics } from './theme';

const PRAISE = ['', '', 'Double!', 'Triple!', 'Quad!', 'Overload!', 'Meltdown!'];

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  delay?: number;
}

interface Label {
  x: number;
  y: number;
  text: string;
  delay?: number;
}

export type Fx =
  | ({ kind: 'burst'; color: string; cell: number } & Box)
  | ({ kind: 'trace'; axis: 'h' | 'v'; surge: boolean } & Box)
  | ({ kind: 'ring' } & Box)
  | ({ kind: 'blast' } & Box)
  | ({ kind: 'spark'; hold: number; cell: number } & Box)
  | { kind: 'bolt'; xs: number[]; ys: number[]; size: number; duration: number }
  | ({ kind: 'points' | 'combo' } & Label)
  | ({ kind: 'praise'; surge: boolean } & Label);

export type FxSpec = Fx & { id: number };

export const FX_DURATION: Record<Exclude<Fx['kind'], 'bolt'>, number> = {
  burst: 500,
  trace: 450,
  ring: 600,
  blast: 550,
  spark: 300,
  points: 900,
  praise: 1100,
  combo: 900,
};
export const FX_TAIL = 200;
export const CIRCUIT_STEP = 35;

export const circuitDelay = (circuit: number[]) => (circuit.length ? (circuit.length + 1) * CIRCUIT_STEP : 0);

const endOf = (it: Fx) =>
  it.kind === 'bolt' ? it.duration : (it.delay ?? 0) + FX_DURATION[it.kind] + (it.kind === 'spark' ? it.hold : 0);

export const fxEnd = (items: Fx[]) => Math.max(0, ...items.map(endOf));

let fxId = 0;

export function buildFx(res: PlaceResult, m: Metrics): FxSpec[] {
  const items: FxSpec[] = [];
  if (!res.lineCount && !res.circuit.length) return items;
  const add = (it: Fx) => items.push({ ...it, id: ++fxId });
  const boom = circuitDelay(res.circuit);

  res.lines.rows.forEach((r) =>
    add({ kind: 'trace', axis: 'h', surge: false, x: 0, y: r * m.pitch, w: m.field, h: m.cell }),
  );
  res.lines.cols.forEach((c) =>
    add({ kind: 'trace', axis: 'v', surge: false, x: c * m.pitch, y: 0, w: m.cell, h: m.field }),
  );
  const surgeAt = (n: number) => boom + 120 + n * 120;
  const blastAt = new Map<number, number>();
  res.surges.forEach(({ idx, kind }, n) => {
    blastCells(idx, kind).forEach((k) => blastAt.has(k) || blastAt.set(k, surgeAt(n)));
    const kr = Math.floor(idx / N);
    const kc = idx % N;
    const delay = surgeAt(n);
    if (kind === 'line') {
      add({ kind: 'trace', axis: 'h', surge: true, x: 0, y: kr * m.pitch, w: m.field, h: m.cell, delay });
      add({ kind: 'trace', axis: 'v', surge: true, x: kc * m.pitch, y: 0, w: m.cell, h: m.field, delay });
    } else {
      const r0 = Math.max(0, kr - 1);
      const c0 = Math.max(0, kc - 1);
      const rows = Math.min(N - 1, kr + 1) - r0 + 1;
      const cols = Math.min(N - 1, kc + 1) - c0 + 1;
      add({ kind: 'blast', x: c0 * m.pitch, y: r0 * m.pitch, w: span(cols, m), h: span(rows, m), delay });
    }
    add({ kind: 'ring', x: kc * m.pitch, y: kr * m.pitch, w: m.cell, h: m.cell, delay });
  });

  const onPath = new Set(res.circuit);
  const nearPath = new Set(res.circuit.flatMap(neighbours));

  const { r: pr, c: pc } = res.center;
  res.cleared.forEach(({ idx, color }) => {
    const r = Math.floor(idx / N);
    const c = idx % N;
    const dist = Math.hypot(r + 0.5 - pr, c + 0.5 - pc);
    add({
      kind: 'burst',
      cell: idx,
      x: c * m.pitch,
      y: r * m.pitch,
      w: m.cell,
      h: m.cell,
      color: PART_COLORS[color],
      delay: onPath.has(idx)
        ? boom
        : res.lineSet.has(idx)
          ? dist * 28
          : nearPath.has(idx)
            ? boom + 70
            : (blastAt.get(idx) ?? boom) + 140 + dist * 20,
    });
  });

  if (res.circuit.length) {
    const xs = res.circuit.map((idx) => (idx % N) * m.pitch + m.cell / 2);
    const ys = res.circuit.map((idx) => Math.floor(idx / N) * m.pitch + m.cell / 2);
    const start = portCentre(res.wired.plus, m);
    const end = portCentre(res.wired.minus, m);
    xs.unshift(start.x);
    ys.unshift(start.y);
    xs.push(end.x);
    ys.push(end.y);
    res.circuit.forEach((idx, k) => {
      const delay = (k + 1) * CIRCUIT_STEP;
      add({
        kind: 'spark',
        cell: idx,
        x: (idx % N) * m.pitch,
        y: Math.floor(idx / N) * m.pitch,
        w: m.cell,
        h: m.cell,
        delay,
        hold: boom - delay + 60,
      });
    });
    add({ kind: 'bolt', xs, ys, size: m.cell * 0.5, duration: boom });
    add({
      kind: 'ring',
      x: end.x - m.cell / 2,
      y: end.y - m.cell / 2,
      w: m.cell,
      h: m.cell,
      delay: boom,
    });
  }

  add({ kind: 'points', x: pc * m.pitch, y: pr * m.pitch, text: `+${fmt(res.gained)}`, delay: boom });
  const surges = res.surges.length;
  const headline = res.perfect
    ? 'Board clear!'
    : res.circuit.length
      ? 'Circuit!'
      : surges > 1
        ? `Surge ×${surges}!`
        : surges
          ? 'Surge!'
          : res.lineCount >= 2
            ? PRAISE[Math.min(res.lineCount, PRAISE.length - 1)]
            : '';
  let y = m.pitch * 3.2;
  if (headline) {
    add({
      kind: 'praise',
      x: m.field / 2,
      y,
      text: headline,
      surge: surges > 0 && !res.perfect && !res.circuit.length,
      delay: boom,
    });
    y += m.pitch * 1.2;
  }
  if (res.state.combo >= 2) add({ kind: 'combo', x: m.field / 2, y, text: `Combo ${res.state.combo}`, delay: boom });
  return items;
}
