import { describe, expect, it, jest } from '@jest/globals';
import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Gesture } from 'react-native-gesture-handler';
import { makeMutable } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Board } from '../components/Board';
import { Help } from '../components/Help';
import { Hud } from '../components/Hud';
import { Stats } from '../components/Stats';
import { Tray } from '../components/Tray';
import { describeCell, describePiece, describePlacement, PART_NAMES } from '../describe';
import { NO_CELL, OFFSCREEN, type Clears, type DragShared, type Point, type Preview, type SlotGeo } from '../drag';
import {
  cellIndex,
  COLOR_COUNT,
  makePiece,
  N,
  placePiece,
  type CoreKind,
  type GameState,
  type Piece,
  type Terminals,
} from '../engine';
import { emptyStats } from '../stats';
import { C, metrics, PART_COLORS } from '../theme';

const m = metrics(390, 800);
const single = (): Piece => makePiece(0, 0);
const activate = { nativeEvent: { actionName: 'activate' } };

function drag(): DragShared {
  const slots = [0, 1, 2];
  return {
    slot: makeMutable(-1),
    touch: makeMutable({ x: 0, y: 0 }),
    origin: makeMutable({ x: 0, y: 0 }),
    pitch: makeMutable(m.pitch),
    mouse: makeMutable(false),
    geo: makeMutable<(SlotGeo | null)[]>(slots.map(() => null)),
    landing: makeMutable<(Point | null)[]>(slots.map(() => null)),
    slots: makeMutable(slots.map(() => ({ x: 0, y: 0, w: 0, h: 0 }))),
    missFrom: makeMutable(slots.map(() => ({ x: OFFSCREEN, y: OFFSCREEN }))),
    back: makeMutable(slots.map(() => 1)),
    shrink: makeMutable(0.5),
    target: makeMutable(NO_CELL),
    lines: makeMutable<Clears>({ rows: [], cols: [], circuit: [] }),
  };
}

async function board(
  placing: Piece | null,
  terminals: Terminals = { plus: { side: 'left', at: 4 }, minus: { side: 'top', at: 2 } },
  preview: Preview | null = null,
) {
  const onPlaceAt = jest.fn();
  const grid = Array<number>(N * N).fill(-1);
  const cores = Array<CoreKind | null>(N * N).fill(null);
  grid[cellIndex(1, 1)] = 0;
  cores[cellIndex(1, 1)] = 'area';
  await render(
    <Board
      grid={grid}
      cores={cores}
      preview={preview}
      m={m}
      fieldRef={null}
      onBoardLayout={() => {}}
      fx={[]}
      tray={[null, null, null]}
      drag={drag()}
      placing={placing}
      onPlaceAt={onPlaceAt}
      terminals={terminals}
    />,
  );
  return onPlaceAt;
}

describe('screen reader descriptions', () => {
  it('names parts and squares', () => {
    expect(describePiece({ ...makePiece(3, 1), core: 0, coreKind: 'line' })).toBe(
      'orange 3-cell part, 3 wide by 1 tall, line core',
    );
    expect(describeCell(0, 0, -1, null)).toBe('A1, empty');
    expect(describeCell(7, 7, 6, 'area')).toBe('H8, white, area core');
  });

  it('has a name and a colour for every part colour', () => {
    expect(PART_NAMES).toHaveLength(COLOR_COUNT);
    expect(PART_COLORS).toHaveLength(COLOR_COUNT);
  });

  it('sums up a placement', () => {
    const grid = Array<number>(N * N).fill(-1);
    for (let c = 1; c < N; c++) grid[c] = 2;
    grid[cellIndex(5, 5)] = 1;
    const res = placePiece(
      {
        grid,
        cores: Array(N * N).fill(null),
        terminals: { plus: { side: 'left', at: 7 }, minus: { side: 'top', at: 7 } },
        tray: [single(), single(), single()],
        score: 0,
        best: 0,
        combo: 0,
        idle: 0,
        over: false,
      },
      0,
      0,
      0,
    )!;
    expect(describePlacement(res)).toBe('Placed. 1 line cleared. Score 110.');
  });

  it('counts lines in the plural and says when the game is over', () => {
    const state = (grid: number[], tray: (Piece | null)[]): GameState => ({
      grid,
      cores: Array(N * N).fill(null),
      terminals: { plus: { side: 'left', at: 0 }, minus: { side: 'top', at: 7 } },
      tray,
      score: 0,
      best: 0,
      combo: 0,
      idle: 0,
      over: false,
    });
    const corner = Array<number>(N * N).fill(-1);
    for (let i = 0; i < N - 1; i++) corner[cellIndex(7, i)] = corner[cellIndex(i, 7)] = 1;
    corner[cellIndex(3, 3)] = 2;
    const two = placePiece(state(corner, [single(), single(), single()]), 0, 7, 7)!;
    expect(describePlacement(two)).toBe('Placed. 2 lines cleared. Score 310.');

    const checks = Array.from({ length: N * N }, (_, k) => ((Math.floor(k / N) + (k % N)) % 2 ? 3 : -1));
    const last = placePiece(state(checks, [single(), makePiece(1, 2), null]), 0, 3, 3)!;
    expect(describePlacement(last)).toBe('Placed. Score 10. No part fits. Game over.');
  });
});

describe('Board', () => {
  it('reads every square', async () => {
    await board(null);
    expect(screen.getByLabelText('A1, empty')).toBeTruthy();
    expect(screen.getByLabelText('B2, red, area core')).toBeTruthy();
    expect(screen.getByLabelText('E1, empty, next to power in')).toBeTruthy();
    expect(screen.getByLabelText('A3, empty, next to power out')).toBeTruthy();
    expect(screen.getByLabelText('A1, empty').props.accessibilityActions).toBeUndefined();
  });

  it('marks the squares next to terminals on the right and bottom edges', async () => {
    await board(null, { plus: { side: 'right', at: 4 }, minus: { side: 'bottom', at: 2 } });
    expect(screen.getByLabelText('E8, empty, next to power in')).toBeTruthy();
    expect(screen.getByLabelText('H3, empty, next to power out')).toBeTruthy();
  });

  it('places the chosen part on a square where it fits', async () => {
    const onPlaceAt = await board(single());
    await fireEvent(screen.getByLabelText('C4, empty'), 'accessibilityAction', activate);
    expect(onPlaceAt).toHaveBeenCalledWith(2, 3);
    expect(screen.getByLabelText('B2, red, area core').props.accessibilityActions).toBeUndefined();
  });

  it('marks squares a circuit will clear with a bolt, so the preview does not rely on colour alone', async () => {
    const preview: Preview = new Map([
      [cellIndex(1, 1), C.circuit],
      [cellIndex(2, 2), PART_COLORS[3]],
    ]);
    await board(null, undefined, preview);
    expect(screen.getAllByTestId('circuit-mark')).toHaveLength(1);
  });
});

function tray(parts: (Piece | null)[], grid = Array<number>(N * N).fill(-1), selected: number | null = null) {
  const onSelect = jest.fn();
  return render(
    <Tray
      tray={parts}
      grid={grid}
      m={m}
      anims={[0, 1, 2].map(() => ({ key: 0, kind: 'deal' as const }))}
      gestures={[0, 1, 2].map(() => Gesture.Pan())}
      slotRefs={[0, 1, 2].map(() => null)}
      onTrayLayout={() => {}}
      drag={drag()}
      onRotate={() => {}}
      selected={selected}
      onSelect={onSelect}
    />,
  ).then(() => onSelect);
}

describe('Tray', () => {
  it('lets a screen reader choose a part', async () => {
    const onSelect = await tray([single(), null, makePiece(3, 4)], undefined, 2);
    await fireEvent(screen.getByLabelText('U1, red 1-cell part, 1 wide by 1 tall'), 'accessibilityAction', activate);
    expect(onSelect).toHaveBeenCalledWith(0);
    expect(screen.getByLabelText('U2, empty').props.accessibilityActions).toBeUndefined();
    expect(screen.getByLabelText(/^U3, cyan 3-cell part/).props['aria-selected']).toBe(true);
    expect(screen.getByLabelText(/^U3, cyan/).props.accessibilityActions).toEqual([
      { name: 'activate', label: 'Choose' },
    ]);
  });

  it('says when a part only fits after rotating or does not fit at all', async () => {
    const grid = Array<number>(N * N).fill(0);
    for (let r = 0; r < 3; r++) grid[cellIndex(r, 0)] = -1;
    await tray([single(), makePiece(3, 1), makePiece(9, 2)], grid);
    expect(screen.getByLabelText('U1, red 1-cell part, 1 wide by 1 tall')).toBeTruthy();
    expect(screen.getByLabelText('U2, orange 3-cell part, 3 wide by 1 tall, fits after rotating')).toBeTruthy();
    expect(screen.getByLabelText("U3, yellow 4-cell part, 2 wide by 2 tall, doesn't fit")).toBeTruthy();
  });
});

const safeArea = { frame: { x: 0, y: 0, width: 390, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

function help(props: Partial<ComponentProps<typeof Help>> = {}) {
  return render(
    <SafeAreaProvider initialMetrics={safeArea}>
      <Help
        visible
        onClose={() => {}}
        hapticsOn
        onToggleHaptics={() => {}}
        soundOn
        onToggleSound={() => {}}
        {...props}
      />
    </SafeAreaProvider>,
  );
}

describe('Help', () => {
  it('opens from the top bar', async () => {
    const onHelp = jest.fn();
    await render(
      <Hud
        score={0}
        best={0}
        armed={false}
        daily={null}
        dailyNew={false}
        m={m}
        onHelp={onHelp}
        onRestart={() => {}}
        onDaily={() => {}}
        onStats={() => {}}
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'How to play' }));
    expect(onHelp).toHaveBeenCalled();
  });

  it('explains the rules and closes', async () => {
    const onClose = jest.fn();
    await help({ onClose });
    for (const title of ['How to play', 'Place parts', 'Rotate', 'Circuits', 'Cores', 'Daily circuit', 'Scoring']) {
      expect(screen.getByRole('header', { name: title })).toBeTruthy();
    }
    expect(screen.getByLabelText('4 lines at once: 1,000')).toBeTruthy();
    expect(screen.getByLabelText('Emptying the board: 3,000')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Got it' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('holds the sound and vibration settings', async () => {
    const onToggleSound = jest.fn();
    const onToggleHaptics = jest.fn();
    await help({ soundOn: false, onToggleSound, onToggleHaptics });
    expect(screen.getByText('Sound off')).toBeTruthy();
    expect(screen.getByText('Vibration on')).toBeTruthy();
    await fireEvent.press(screen.getByRole('switch', { name: 'Sound', checked: false }));
    expect(onToggleSound).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('switch', { name: 'Vibration', checked: true }));
    expect(onToggleHaptics).toHaveBeenCalled();
  });
});

describe('Stats', () => {
  it('opens from the peak score in the top bar', async () => {
    const onStats = jest.fn();
    await render(
      <Hud
        score={0}
        best={4200}
        armed={false}
        daily={null}
        dailyNew={false}
        m={m}
        onHelp={() => {}}
        onRestart={() => {}}
        onDaily={() => {}}
        onStats={onStats}
      />,
    );
    const peak = screen.getByRole('button', { name: 'Peak score 4,200' });
    expect(peak.props.accessibilityHint).toBe('Opens your stats');
    await fireEvent.press(peak);
    expect(onStats).toHaveBeenCalled();
  });

  it('reads each stat under its heading and closes', async () => {
    const onClose = jest.fn();
    const stats = { ...emptyStats(), games: 4, total: 9001, lines: 1234, dailies: 2, bestStreak: 5 };
    await render(
      <SafeAreaProvider initialMetrics={safeArea}>
        <Stats visible onClose={onClose} stats={stats} peak={5000} streak={3} />
      </SafeAreaProvider>,
    );
    for (const title of ['Stats', 'Endless', 'Daily circuit', 'All games']) {
      expect(screen.getByRole('header', { name: title })).toBeTruthy();
    }
    for (const label of [
      'Games played: 4',
      'Average score: 2,250',
      'Peak score: 5,000',
      'Dailies played: 2',
      'Current streak: 3',
      'Best streak: 5',
      'Lines cleared: 1,234',
      'Boards emptied: 0',
    ]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });
});
