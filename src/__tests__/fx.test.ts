import { describe, expect, it } from '@jest/globals';

import { cellIndex, makePiece, N, placePiece, type GameState, type Piece } from '../engine';
import { buildFx, CIRCUIT_STEP, circuitDelay, FX_DURATION, fxEnd } from '../fx';
import { metrics, span } from '../theme';

const m = metrics(390, 800);
const single = () => makePiece(0, 0);

function state(tray: (Piece | null)[], over: Partial<GameState> = {}): GameState {
  return {
    grid: Array(N * N).fill(-1),
    cores: Array(N * N).fill(null),
    terminals: { plus: { side: 'left', at: 3 }, minus: { side: 'top', at: 3 } },
    tray,
    score: 0,
    best: 0,
    combo: 0,
    idle: 0,
    over: false,
    ...over,
  };
}

const texts = (s: GameState, r: number, c: number) =>
  buildFx(
    placePiece(s, 0, r, c, () => 0.5)!,
    m,
  ).flatMap((it) => ('text' in it ? [`${it.kind}:${it.text}`] : []));

describe('buildFx', () => {
  it('adds nothing when no line clears', () => {
    expect(buildFx(placePiece(state([single(), single(), single()]), 0, 3, 3)!, m)).toEqual([]);
  });

  it('shows points for a single clear, and praise plus combo for a double', () => {
    const one = state([single(), single(), single()], { combo: 0 });
    for (let c = 1; c < N; c++) one.grid[c] = 1;
    one.grid[cellIndex(5, 5)] = 2;
    expect(texts(one, 0, 0)).toEqual(['points:+110']);

    const two = state([single(), single(), single()], { combo: 1 });
    for (let i = 0; i < N - 1; i++) {
      two.grid[cellIndex(7, i)] = 1;
      two.grid[cellIndex(i, 7)] = 1;
    }
    two.grid[cellIndex(5, 5)] = 2;
    expect(texts(two, 7, 7)).toEqual(['points:+610', 'praise:Double!', 'combo:Combo 2']);
  });

  it('headlines surges and board clears', () => {
    const surge = state([single(), single(), single()]);
    for (let c = 1; c < N; c++) surge.grid[c] = 1;
    surge.cores[3] = 'line';
    surge.grid[cellIndex(5, 3)] = 2;
    surge.grid[cellIndex(6, 6)] = 2;
    expect(texts(surge, 0, 0)).toContain('praise:Surge!');

    const clear = state([single(), single(), single()]);
    for (let c = 1; c < N; c++) clear.grid[c] = 1;
    expect(texts(clear, 0, 0)).toContain('praise:Board clear!');
  });

  it('counts chained surges, and headlines a board clear over a surge', () => {
    const chain = state([single(), single(), single()]);
    for (let c = 1; c < N; c++) chain.grid[c] = 1;
    for (let r = 1; r <= 5; r++) chain.grid[cellIndex(r, 3)] = 2;
    chain.cores[cellIndex(0, 3)] = 'line';
    chain.cores[cellIndex(5, 3)] = 'line';
    chain.grid[cellIndex(7, 7)] = 4;
    const praise = (s: GameState) =>
      buildFx(
        placePiece(s, 0, 0, 0, () => 0.5)!,
        m,
      ).find((it) => it.kind === 'praise');
    expect(praise(chain)?.text).toBe('Surge ×2!');

    const clear = state([single(), single(), single()]);
    for (let c = 1; c < N; c++) clear.grid[c] = 1;
    clear.grid[cellIndex(4, 2)] = 3;
    clear.cores[cellIndex(0, 2)] = 'line';
    expect(praise(clear)?.text).toBe('Board clear!');
  });

  it('draws one trace per cleared line and one burst per cleared cell', () => {
    const s = state([single(), single(), single()]);
    for (let c = 1; c < N; c++) s.grid[c] = 1;
    s.grid[cellIndex(5, 5)] = 2;
    const items = buildFx(placePiece(s, 0, 0, 0)!, m);
    expect(items.filter((it) => it.kind === 'trace' && it.axis === 'h')).toHaveLength(1);
    expect(items.filter((it) => it.kind === 'burst')).toHaveLength(N);
    expect(new Set(items.map((it) => it.id)).size).toBe(items.length);
  });

  it('draws a 3×3 blast square for an area core', () => {
    const s = state([single(), single(), single()]);
    for (let c = 1; c < N; c++) s.grid[c] = 1;
    s.cores[4] = 'area';
    s.grid[cellIndex(5, 5)] = 2;
    const items = buildFx(placePiece(s, 0, 0, 0)!, m);
    const blast = items.find((it) => it.kind === 'blast');
    expect(blast).toMatchObject({ x: 3 * m.pitch, y: 0, w: span(3, m), h: span(2, m) });
    expect(items.some((it) => it.kind === 'trace' && it.surge)).toBe(false);
  });

  it('runs a bolt from + to − along a circuit, then clears the path and arc together', () => {
    const s = state([single(), single(), single()], {
      terminals: { plus: { side: 'left', at: 3 }, minus: { side: 'top', at: 3 } },
    });
    [
      [3, 0],
      [2, 0],
      [1, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 1],
      [6, 6],
    ].forEach(([r, c]) => (s.grid[cellIndex(r, c)] = 2));
    const res = placePiece(s, 0, 0, 0, () => 0.5)!;
    const items = buildFx(res, m);
    const boom = circuitDelay(res.circuit);
    const mid = (n: number) => n * m.pitch + m.cell / 2;
    expect(boom).toBe((res.circuit.length + 1) * CIRCUIT_STEP);
    expect(items.filter((it) => it.kind === 'spark')).toHaveLength(res.circuit.length);
    const [bolt] = items.flatMap((it) => (it.kind === 'bolt' ? [it] : []));
    expect(bolt.duration).toBe(boom);
    expect([bolt.xs[0], bolt.ys[0]]).toEqual([-m.gut / 2, mid(3)]);
    expect([bolt.xs.at(-1), bolt.ys.at(-1)]).toEqual([mid(3), -m.gut / 2]);
    const burstAt = (r: number, c: number) =>
      items.flatMap((it) => (it.kind === 'burst' && it.x === c * m.pitch && it.y === r * m.pitch ? [it.delay] : []))[0];
    expect(res.circuit.map((idx) => burstAt(Math.floor(idx / N), idx % N))).toEqual(res.circuit.map(() => boom));
    expect(burstAt(1, 1)).toBe(boom + 70);
    expect(burstAt(6, 6)).toBeUndefined();
    expect(items.find((it) => it.kind === 'praise')).toMatchObject({ text: 'Circuit!', delay: boom });
  });
});

describe('effect timing', () => {
  const bursts = (items: ReturnType<typeof buildFx>) =>
    new Map(items.flatMap((it) => (it.kind === 'burst' ? [[it.cell, it.delay ?? 0] as const] : [])));

  it('ripples out from the centre of the placed part', () => {
    const s = state([single(), single(), single()]);
    for (let c = 1; c < N; c++) s.grid[c] = 1;
    const delays = bursts(
      buildFx(
        placePiece(s, 0, 0, 0, () => 0.5)!,
        m,
      ),
    );
    for (let c = 1; c < N; c++) expect(delays.get(c)!).toBeGreaterThan(delays.get(c - 1)!);
  });

  it('bursts squares only after the core that blasted them goes off', () => {
    const s = state([single(), single(), single()]);
    for (let c = 1; c < N; c++) s.grid[c] = 1;
    s.cores[cellIndex(0, 1)] = 'line';
    s.grid[cellIndex(2, 1)] = 2;
    s.cores[cellIndex(2, 1)] = 'area';
    s.grid[cellIndex(3, 2)] = 2;
    s.cores[cellIndex(3, 2)] = 'area';
    s.grid[cellIndex(4, 3)] = 3;
    const items = buildFx(
      placePiece(s, 0, 0, 0, () => 0.5)!,
      m,
    );
    const [third] = items.flatMap((it) =>
      it.kind === 'ring' && it.x === 2 * m.pitch && it.y === 3 * m.pitch ? [it.delay ?? 0] : [],
    );
    const delays = bursts(items);
    expect(delays.get(cellIndex(4, 3))!).toBeGreaterThan(third);
    expect(delays.get(cellIndex(3, 2))!).toBeGreaterThan(third);
  });

  it('lasts until the last effect has played, however long the circuit', () => {
    const s = state([single(), single(), single()], {
      terminals: { plus: { side: 'right', at: 5 }, minus: { side: 'left', at: 1 } },
    });
    ['###.###.', '#.#.#.##', '.##...##', '##.##.##', '#.##.##.', '#.#.##.#', '#.#.#..#', '###.####'].forEach((row, r) =>
      [...row].forEach((ch, c) => ch === '#' && (s.grid[cellIndex(r, c)] = 2)),
    );
    const res = placePiece(s, 0, 2, 4, () => 0.5)!;
    expect(res.circuit).toHaveLength(40);
    const items = buildFx(res, m);
    const praise = items.find((it) => it.kind === 'praise')!;
    expect(fxEnd(items)).toBe(praise.delay! + FX_DURATION.praise);
    expect(fxEnd(items)).toBeGreaterThan(2400);
  });
});
