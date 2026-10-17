import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, render } from '@testing-library/react-native';
import { DeviceEventEmitter, View } from 'react-native';
import { GestureDetector, PointerType, State } from 'react-native-gesture-handler';

import { decodeCell, ghostFrame, NO_CELL, returnFrame, type Point, type Slot } from '../drag';
import { cellIndex, makePiece, N, rotate, SHAPES, type GameState, type Piece } from '../engine';
import { metrics, PART_COLORS, span } from '../theme';
import { useDragGestures } from '../useDragGestures';

const m = metrics(390, 800);
const FIELD: Point = { x: 20, y: 100 };
const SLOTS: Slot[] = [0, 1, 2].map((i) => ({ x: 20 + i * 125, y: FIELD.y + m.field + 12, w: 115, h: 120 }));

const BAR3 = SHAPES.findIndex((s) => s.w === 3 && s.h === 1);
const single = (c = 1) => makePiece(0, c);
const bar3 = () => makePiece(BAR3, 4);

function game(tray: (Piece | null)[], over: Partial<GameState> = {}): GameState {
  return {
    grid: Array(N * N).fill(-1),
    cores: Array(N * N).fill(null),
    terminals: { plus: { side: 'left', at: 7 }, minus: { side: 'top', at: 7 } },
    tray,
    score: 0,
    best: 0,
    combo: 0,
    idle: 0,
    over: false,
    ...over,
  };
}

type Hook = ReturnType<typeof useDragGestures>;
let hook: Hook;
let onPlace: jest.Mock<(i: number, r: number, c: number) => void>;
let onLift: jest.Mock<() => void>;

function Harness({ state, take }: { state: GameState; take: (h: Hook) => void }) {
  const h = useDragGestures({ state, stateRef: { current: state }, m, onPlace, onLift });
  take(h);
  return (
    <>
      {h.gestures.map((g, i) => (
        <GestureDetector key={i} gesture={g}>
          <View />
        </GestureDetector>
      ))}
    </>
  );
}

const take = (h: Hook) => {
  hook = h;
};

async function settle() {
  for (let round = 0; round < 2; round++) {
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
  }
}

const placedAt = (x: number, y: number, w = 0, h = 0) =>
  ({ measureLayout: (_root: unknown, done: (...v: number[]) => void) => done(x, y, w, h) }) as unknown as View;

async function mount(state: GameState) {
  const screen = await render(<Harness state={state} take={take} />);
  await settle();
  await act(async () => {
    hook.rootRef.current = placedAt(0, 0);
    hook.fieldRef.current = placedAt(FIELD.x, FIELD.y);
    SLOTS.forEach((s, i) => hook.slotRefs[i](placedAt(s.x, s.y, s.w, s.h)));
    hook.measureLayout();
  });
  return async (next: GameState) => {
    await screen.rerender(<Harness state={next} take={take} />);
    await settle();
  };
}

const centreOver = (r: number, c: number, w = 1, h = 1): Point => ({
  x: FIELD.x + c * m.pitch + span(w, m) / 2,
  y: FIELD.y + r * m.pitch + span(h, m) / 2,
});
const socket = (i: number): Point => ({ x: SLOTS[i].x + SLOTS[i].w / 2, y: SLOTS[i].y + 10 });

function finger(i: number, pointerType = PointerType.MOUSE) {
  const handlerTag = hook.gestures[i].handlerTag;
  let state: State = State.UNDETERMINED;
  let pos: Point = socket(i);
  const send = (next: State, to: Point) => {
    const e = {
      handlerTag,
      state: next,
      numberOfPointers: 1,
      pointerType,
      x: to.x - SLOTS[i].x,
      y: to.y - SLOTS[i].y,
      absoluteX: to.x,
      absoluteY: to.y,
    };
    if (next === state) DeviceEventEmitter.emit('onGestureHandlerEvent', e);
    else DeviceEventEmitter.emit('onGestureHandlerStateChange', { ...e, oldState: state });
    state = next;
    pos = to;
  };
  const step = async (run: () => void) => {
    await act(async () => run());
    await settle();
  };
  return {
    down: (to = pos) =>
      step(() => {
        send(State.BEGAN, to);
        send(State.ACTIVE, to);
      }),
    move: (to: Point) => step(() => send(State.ACTIVE, to)),
    up: () => step(() => send(State.END, pos)),
    cancel: () => step(() => send(State.CANCELLED, pos)),
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  onPlace = jest.fn();
  onLift = jest.fn();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('dragging a part', () => {
  it('drops a mouse-dragged part on the square under it', async () => {
    await mount(game([single(), single(), single()]));
    const f = finger(0);
    await f.down();
    await f.move(centreOver(3, 4));
    expect(hook.drag.target.get()).toBe(cellIndex(3, 4));
    await f.up();
    expect(onPlace.mock.calls).toEqual([[0, 3, 4]]);
  });

  it('draws a touch-dragged part above the finger and drops it where its shadow shows', async () => {
    await mount(game([single(), single(), single()]));
    const f = finger(1, PointerType.TOUCH);
    await f.down();
    const to = { x: FIELD.x + 4 * m.pitch, y: FIELD.y + 6 * m.pitch };
    await f.move(to);
    const shadow = hook.drag.target.get();
    expect(shadow).not.toBe(NO_CELL);
    expect(ghostFrame(hook.drag, 1).y + m.cell).toBeLessThan(to.y - m.pitch);
    expect(decodeCell(shadow).r).toBeLessThan(6);
    await f.up();
    const { r, c } = decodeCell(shadow);
    expect(onPlace.mock.calls).toEqual([[1, r, c]]);
  });

  it('drops a rotated part using its new shape', async () => {
    const rerender = await mount(game([bar3(), null, null]));
    await rerender(game([rotate(bar3()), null, null]));
    const f = finger(0);
    await f.down();
    await f.move(centreOver(3, 4, 1, 3));
    await f.up();
    expect(onPlace.mock.calls).toEqual([[0, 3, 4]]);
  });

  it('avoids squares that were filled since the last render', async () => {
    const rerender = await mount(game([single(), single(), single()]));
    const filled = game([single(), single(), single()]);
    filled.grid[cellIndex(3, 4)] = 0;
    await rerender(filled);
    const f = finger(0);
    await f.down();
    await f.move(centreOver(3, 4));
    await f.up();
    expect(onPlace).toHaveBeenCalledTimes(1);
    expect(onPlace).not.toHaveBeenCalledWith(0, 3, 4);
  });

  it('leaves a tapped part in its socket, even when the tap is next to the board', async () => {
    await mount(game([single(), single(), single()]));
    for (const pointer of [PointerType.MOUSE, PointerType.TOUCH]) {
      const f = finger(0, pointer);
      await f.down({ x: socket(0).x, y: SLOTS[0].y + 2 });
      await f.move({ x: socket(0).x + 3, y: SLOTS[0].y + 2 });
      await f.up();
    }
    expect(onPlace).not.toHaveBeenCalled();
  });

  it('sends a part dropped off the board back to its socket', async () => {
    await mount(game([single(), single(), single()]));
    const f = finger(2);
    await f.down();
    await f.move({ x: FIELD.x + m.field + 80, y: FIELD.y - 80 });
    await f.up();
    expect(onPlace).not.toHaveBeenCalled();
    expect(returnFrame(hook.drag, 2)).not.toBeNull();
    expect(hook.isDragging()).toBe(false);
  });

  it('sends a cancelled drag back without placing it', async () => {
    await mount(game([single(), single(), single()]));
    const f = finger(0);
    await f.down();
    await f.move(centreOver(3, 4));
    await f.cancel();
    expect(onPlace).not.toHaveBeenCalled();
    expect(returnFrame(hook.drag, 0)).not.toBeNull();
    expect(hook.isDragging()).toBe(false);
  });

  it('reports dragging only while a part is held', async () => {
    await mount(game([single(), single(), single()]));
    const f = finger(0);
    expect(hook.isDragging()).toBe(false);
    await f.down();
    expect(hook.isDragging()).toBe(true);
    expect(onLift).toHaveBeenCalledTimes(1);
    await f.move(centreOver(3, 4));
    await f.up();
    expect(hook.isDragging()).toBe(false);
  });

  it('ignores a second finger while a part is being dragged', async () => {
    await mount(game([single(), single(), single()]));
    const first = finger(0);
    const second = finger(1);
    await first.down();
    await second.down();
    await second.move(centreOver(1, 1));
    await second.up();
    await first.move(centreOver(3, 4));
    await first.up();
    expect(onPlace.mock.calls).toEqual([[0, 3, 4]]);
    expect(onLift).toHaveBeenCalledTimes(1);
  });

  it('ignores an empty socket', async () => {
    await mount(game([single(), null, single()]));
    const f = finger(1);
    await f.down();
    await f.move(centreOver(3, 4));
    await f.up();
    expect(onPlace).not.toHaveBeenCalled();
    expect(onLift).not.toHaveBeenCalled();
  });

  it('ignores drags once the game is over', async () => {
    const rerender = await mount(game([single(), single(), single()]));
    await rerender(game([single(), single(), single()], { over: true }));
    const f = finger(0);
    await f.down();
    await f.move(centreOver(3, 4));
    await f.up();
    expect(onPlace).not.toHaveBeenCalled();
    expect(onLift).not.toHaveBeenCalled();
  });

  it('holds the dropped part where it landed until the board takes it, then lets go', async () => {
    await mount(game([single(), single(), single()]));
    let heldAt: Point | null = null;
    onPlace.mockImplementation(() => {
      heldAt = hook.drag.landing.get()[0];
    });
    const f = finger(0);
    await f.down();
    expect(hook.held[0]).toEqual(single());
    await f.move(centreOver(3, 4));
    const dropped = ghostFrame(hook.drag, 0);
    await f.up();
    expect(heldAt).toEqual(dropped);
    expect(hook.drag.landing.get()).toEqual([null, null, null]);
    expect(hook.held).toEqual([null, null, null]);
  });
});

describe('the clear preview', () => {
  it('lights the squares a drop would clear in the part colour, and goes out on release', async () => {
    const s = game([single(5), single(), single()]);
    for (let c = 0; c < N; c++) if (c !== 4) s.grid[cellIndex(3, c)] = 2;
    await mount(s);
    const f = finger(0);
    await f.down();
    await f.move(centreOver(6, 4));
    expect(hook.preview).toBeNull();
    await f.move(centreOver(3, 4));
    const row = [0, 1, 2, 3, 5, 6, 7].map((c) => cellIndex(3, c));
    expect(hook.preview).toEqual(new Map(row.map((k) => [k, PART_COLORS[5]])));
    await f.move(centreOver(6, 4));
    expect(hook.preview).toBeNull();
    await f.move(centreOver(3, 4));
    await f.up();
    expect(hook.preview).toBeNull();
  });
});
