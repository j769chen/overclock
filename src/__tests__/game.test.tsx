import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { AccessibilityInfo, DeviceEventEmitter, Dimensions, Share } from 'react-native';
import { Gesture, PointerType, State, type PanGesture } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { advanceDaily, dailyRand, shareText, startDaily } from '../daily';
import { cellIndex, fits, makePiece, N, placePiece, type GameState } from '../engine';
import { fmt } from '../format';
import { FX_LIFETIME } from '../fx';
import Game from '../Game';
import { comboRate, loadSounds, play } from '../sound';
import * as storage from '../storage';
import { emptyStats } from '../stats';
import { metrics } from '../theme';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Error: 'error' },
}));

jest.mock('../sound', () => ({
  ...jest.requireActual<typeof import('../sound')>('../sound'),
  play: jest.fn(),
  loadSounds: jest.fn(),
}));

const safeArea = { frame: { x: 0, y: 0, width: 390, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const activate = { nativeEvent: { actionName: 'activate' } };
const tick = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

function blankGame(over: Partial<GameState> = {}): GameState {
  return {
    grid: Array<number>(N * N).fill(-1),
    cores: Array(N * N).fill(null),
    terminals: { plus: { side: 'left', at: 7 }, minus: { side: 'top', at: 7 } },
    tray: [makePiece(0, 1), makePiece(0, 2), makePiece(0, 3)],
    score: 0,
    best: 0,
    combo: 0,
    idle: 0,
    over: false,
    ...over,
  };
}

function circuitGame(): GameState {
  const game = blankGame({ terminals: { plus: { side: 'left', at: 0 }, minus: { side: 'top', at: 6 } } });
  for (let c = 0; c <= 6; c++) if (c !== 3) game.grid[c] = 0;
  return game;
}

function lastMoveGame(over: Partial<GameState> = {}): GameState {
  const game = blankGame({ tray: [makePiece(0, 1), makePiece(1, 2), null], ...over });
  game.grid = game.grid.map((_, k) => ((Math.floor(k / N) + (k % N)) % 2 ? 3 : -1));
  return game;
}

async function mount({
  game = circuitGame(),
  startBest = 0,
  saved = {},
}: { game?: GameState | null; startBest?: number; saved?: Record<string, string> } = {}) {
  await AsyncStorage.setItem('overclock.helpSeen', 'true');
  if (game) {
    await AsyncStorage.setItem('overclock.game', JSON.stringify({ v: storage.SAVE_VERSION, game, startBest }));
  }
  for (const [key, value] of Object.entries(saved)) await AsyncStorage.setItem(`overclock.${key}`, value);
  await render(
    <SafeAreaProvider initialMetrics={safeArea}>
      <Game />
    </SafeAreaProvider>,
  );
  await screen.findByLabelText(/^U1, /);
}

const slot = (n: number) => screen.getByLabelText(new RegExp(`^U${n}, `));
const place = async (n: number, square: string) => {
  await fireEvent(slot(n), 'accessibilityAction', activate);
  await fireEvent(screen.getByLabelText(new RegExp(`^${square}, `)), 'accessibilityAction', activate);
};
const restart = async () => {
  await fireEvent.press(screen.getByRole('button', { name: 'New game' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Confirm new game' }));
};
function capturePans() {
  const pans: PanGesture[] = [];
  const pan = Gesture.Pan;
  jest.spyOn(Gesture, 'Pan').mockImplementation(() => {
    const g = pan();
    pans.push(g);
    return g;
  });
  return pans;
}

const savedGame = async () => storage.parseSave(await AsyncStorage.getItem('overclock.game'))!.game;
const savedStats = async () => storage.parseStats(await AsyncStorage.getItem('overclock.stats'));

function pointer(pans: PanGesture[], n: number) {
  const { handlerTag } = pans.slice(-3)[n - 1];
  let state: State = State.UNDETERMINED;
  let at = { x: 0, y: 0 };
  const send = (next: State, to = at) => {
    const e = {
      handlerTag,
      state: next,
      numberOfPointers: 1,
      pointerType: PointerType.MOUSE,
      x: to.x,
      y: to.y,
      absoluteX: to.x,
      absoluteY: to.y,
    };
    if (next === state) DeviceEventEmitter.emit('onGestureHandlerEvent', e);
    else DeviceEventEmitter.emit('onGestureHandlerStateChange', { ...e, oldState: state });
    state = next;
    at = to;
  };
  const step = async (run: () => void) => {
    await act(async () => run());
    await tick(0);
  };
  return {
    down: () =>
      step(() => {
        send(State.BEGAN);
        send(State.ACTIVE);
      }),
    moveOver: (r: number, c: number) => {
      const { width, height } = Dimensions.get('window');
      const m = metrics(width, height);
      return step(() => send(State.ACTIVE, { x: c * m.pitch + m.cell / 2, y: r * m.pitch + m.cell / 2 }));
    },
    up: () => step(() => send(State.END)),
  };
}

const vibrations = () =>
  [Haptics.selectionAsync, Haptics.impactAsync, Haptics.notificationAsync].reduce(
    (n, fn) => n + jest.mocked(fn).mock.calls.length,
    0,
  );

const sounds = () =>
  jest
    .mocked(play)
    .mock.calls.filter(([on]) => on)
    .map(([, kind]) => kind);

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('Game', () => {
  let announce: jest.SpiedFunction<typeof AccessibilityInfo.announceForAccessibility>;

  beforeEach(() => {
    announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  });

  it('says when a second activation puts a chosen part back', async () => {
    await mount();
    await fireEvent(slot(1), 'accessibilityAction', activate);
    await fireEvent(slot(1), 'accessibilityAction', activate);
    expect(slot(1).props['aria-selected']).toBe(false);
    expect(announce.mock.calls.map(([text]) => text)).toEqual(['Chose U1. Pick a board square.', 'Put back U1.']);
  });

  it('asks for confirmation before restarting and says so', async () => {
    await mount();
    await fireEvent.press(screen.getByRole('button', { name: 'New game' }));
    expect(screen.getByRole('button', { name: 'Confirm new game' })).toBeTruthy();
    expect(announce).toHaveBeenLastCalledWith('Tap again to start a new game.');
  });

  it('lets the restart confirmation lapse after a couple of seconds', async () => {
    await mount({ game: blankGame({ score: 300, best: 300 }) });
    await fireEvent.press(screen.getByRole('button', { name: 'New game' }));
    await tick(2500);
    await fireEvent.press(screen.getByRole('button', { name: 'New game' }));
    expect(screen.getByLabelText('Score 300')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm new game' })).toBeTruthy();
  });

  it('forgets the chosen part when a new game starts', async () => {
    await mount();
    await fireEvent(slot(1), 'accessibilityAction', activate);
    await restart();
    expect(slot(1).props['aria-selected']).toBe(false);
  });

  it('drops a pending circuit haptic when the game restarts', async () => {
    await mount();
    await place(1, 'A4');
    expect(announce).toHaveBeenLastCalledWith(expect.stringContaining('Circuit complete.'));
    await restart();
    jest.mocked(Haptics.impactAsync).mockClear();
    await tick(400);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it('places a part dragged onto the board', async () => {
    const pans = capturePans();
    await mount({ game: blankGame() });
    const p = pointer(pans, 1);
    await p.down();
    await p.moveOver(2, 4);
    await p.up();
    expect(screen.getByLabelText('C5, orange')).toBeTruthy();
    expect(screen.getByLabelText('Score 10')).toBeTruthy();
    expect(slot(1).props.accessibilityLabel).toBe('U1, empty');
  });

  it('ignores Rotate while that part is being dragged', async () => {
    const pans = capturePans();
    await mount({ game: blankGame({ tray: [makePiece(3, 1), null, null] }) });
    const p = pointer(pans, 1);
    await p.down();
    await fireEvent.press(screen.getByRole('button', { name: 'Rotate U1' }));
    expect(slot(1).props.accessibilityLabel).toContain('3 wide by 1 tall');
    await p.up();
    await fireEvent.press(screen.getByRole('button', { name: 'Rotate U1' }));
    expect(slot(1).props.accessibilityLabel).toContain('1 wide by 3 tall');
  });

  it('ignores a restart confirmed while a part is being dragged', async () => {
    const pans = capturePans();
    await mount({ game: blankGame({ score: 300, best: 300 }) });
    const p = pointer(pans, 1);
    await fireEvent.press(screen.getByRole('button', { name: 'New game' }));
    await p.down();
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm new game' }));
    expect(screen.getByLabelText('Score 300')).toBeTruthy();
    await p.moveOver(2, 4);
    await p.up();
    expect(screen.getByLabelText('C5, orange')).toBeTruthy();
    expect(screen.getByLabelText('Score 310')).toBeTruthy();
  });

  it('turns a part and saves the turn', async () => {
    await mount({ game: blankGame({ tray: [makePiece(3, 1), null, null] }) });
    expect(slot(1).props.accessibilityLabel).toContain('3 wide by 1 tall');
    await fireEvent.press(screen.getByRole('button', { name: 'Rotate U1' }));
    expect(slot(1).props.accessibilityLabel).toContain('1 wide by 3 tall');
    expect((await savedGame()).tray[0]).toMatchObject({ w: 1, h: 3 });
  });

  it('clears the effects of a line clear once they have played', async () => {
    const game = blankGame();
    for (let c = 1; c < N; c++) game.grid[c] = 2;
    game.grid[cellIndex(5, 5)] = 4;
    await mount({ game });
    await place(1, 'A1');
    expect(screen.getByText('+110')).toBeTruthy();
    await tick(FX_LIFETIME);
    expect(screen.queryByText('+110')).toBeNull();
  });
});

describe('saved games', () => {
  it('resumes the saved game with the higher of the two peak scores', async () => {
    await mount({ game: blankGame({ score: 1234, best: 2000 }), saved: { best: '5000' } });
    expect(screen.getByLabelText('Score 1,234')).toBeTruthy();
    expect(screen.getByLabelText('Peak score 5,000')).toBeTruthy();
  });

  it('saves every move, so a placed part is still there after relaunching', async () => {
    await mount({ game: blankGame() });
    await place(1, 'C5');
    await screen.unmount();
    await render(
      <SafeAreaProvider initialMetrics={safeArea}>
        <Game />
      </SafeAreaProvider>,
    );
    expect(await screen.findByLabelText('C5, orange')).toBeTruthy();
    expect(screen.getByLabelText('Score 10')).toBeTruthy();
  });

  it('starts a new game when the saved one had ended, keeping the peak', async () => {
    await mount({ game: blankGame({ score: 700, best: 900, over: true }), saved: { best: '900' } });
    expect(screen.getByLabelText('Score 0')).toBeTruthy();
    expect(screen.getByLabelText('Peak score 900')).toBeTruthy();
    expect(screen.queryByText('Short circuit')).toBeNull();
    expect((await savedGame()).score).toBe(0);
  });

  it('ends a resumed game that has no move left', async () => {
    const game = lastMoveGame({ tray: [makePiece(1, 2), null, null], score: 40, best: 40 });
    await mount({ game });
    await tick(1000);
    expect(screen.getByText('Short circuit')).toBeTruthy();
  });

  it('still starts a game when loading fails', async () => {
    jest.spyOn(storage, 'loadSaved').mockRejectedValue(new Error('io'));
    await mount({ game: null });
    expect(screen.getByLabelText('Score 0')).toBeTruthy();
    expect(screen.getByLabelText('Peak score 0')).toBeTruthy();
  });
});

describe('game over', () => {
  it('shows the final score and a new peak after the last move, then plays again', async () => {
    await mount({ game: lastMoveGame() });
    await place(1, 'D4');
    expect(screen.queryByText('Short circuit')).toBeNull();
    await tick(1000);
    expect(screen.getByText('Short circuit')).toBeTruthy();
    expect(screen.getByText('Peak 10')).toBeTruthy();
    expect(screen.getByText('New peak score!')).toBeTruthy();
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('error');

    await fireEvent.press(screen.getByRole('button', { name: 'Play again' }));
    expect(screen.queryByText('Short circuit')).toBeNull();
    expect(screen.getByLabelText('Score 0')).toBeTruthy();
    expect(screen.getByLabelText('Peak score 10')).toBeTruthy();
    expect(await savedGame()).toMatchObject({ score: 0, best: 10, over: false });
  });

  it('still claims a new peak after switching to the daily and back before the result shows', async () => {
    await mount({ game: lastMoveGame() });
    await place(1, 'D4');
    await fireEvent.press(screen.getByRole('button', { name: "Today's daily circuit" }));
    await fireEvent.press(screen.getByRole('button', { name: 'Back to endless game' }));
    expect(screen.getByText('Short circuit')).toBeTruthy();
    expect(screen.getByText('New peak score!')).toBeTruthy();
  });

  it('does not claim a new peak when the starting peak was not beaten', async () => {
    await mount({ game: lastMoveGame({ best: 500 }), startBest: 500 });
    await place(1, 'D4');
    await tick(1000);
    expect(screen.getByText('Short circuit')).toBeTruthy();
    expect(screen.getByText('Peak 500')).toBeTruthy();
    expect(screen.queryByText('New peak score!')).toBeNull();
  });
});

describe('stats', () => {
  it('count a finished game, but not a restart before any part was placed', async () => {
    await mount({ game: lastMoveGame() });
    await place(1, 'D4');
    await tick(1000);
    expect(screen.getByText('Short circuit')).toBeTruthy();
    expect(await savedStats()).toMatchObject({ games: 1, total: 10 });

    await fireEvent.press(screen.getByRole('button', { name: 'Play again' }));
    await restart();
    expect((await savedStats()).games).toBe(1);
  });

  it('count a restarted game with its line clear and emptied board', async () => {
    const game = blankGame();
    for (let c = 1; c < N; c++) game.grid[c] = 2;
    await mount({ game });
    await place(1, 'A1');
    await restart();
    expect(await savedStats()).toMatchObject({
      games: 1,
      total: 3110,
      lines: 1,
      perfects: 1,
      bestCombo: 1,
    });
  });

  it('open from the peak score with the totals so far', async () => {
    const stats = { ...emptyStats(), games: 3, total: 3000, circuits: 7 };
    await mount({ game: blankGame({ best: 2500 }), saved: { stats: JSON.stringify(stats) } });
    await fireEvent.press(screen.getByRole('button', { name: 'Peak score 2,500' }));
    expect(screen.getByLabelText('Games played: 3')).toBeTruthy();
    expect(screen.getByLabelText('Average score: 1,000')).toBeTruthy();
    expect(screen.getByLabelText('Peak score: 2,500')).toBeTruthy();
    expect(screen.getByLabelText('Circuits completed: 7')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByLabelText('Games played: 3')).toBeNull();
  });
});

describe('help and settings', () => {
  it('opens the rules on first launch and remembers they were seen', async () => {
    await mount({ saved: { helpSeen: 'false' } });
    expect(screen.getByRole('button', { name: 'Got it' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('button', { name: 'Got it' })).toBeNull();
    expect(await AsyncStorage.getItem('overclock.helpSeen')).toBe('true');
  });

  it('stays quiet once vibration is switched off, and remembers the setting', async () => {
    await mount({ game: blankGame() });
    await fireEvent.press(screen.getByRole('button', { name: 'How to play' }));
    await fireEvent.press(screen.getByRole('switch', { name: 'Vibration' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Got it' }));
    expect(await AsyncStorage.getItem('overclock.haptics')).toBe('false');
    await place(1, 'C5');
    expect(vibrations()).toBe(0);
  });

  it('starts quiet when vibration was switched off last time', async () => {
    await mount({ game: blankGame(), saved: { haptics: 'false' } });
    await place(1, 'C5');
    expect(vibrations()).toBe(0);
    await fireEvent.press(screen.getByRole('button', { name: 'How to play' }));
    expect(screen.getByRole('switch', { name: 'Vibration', checked: false })).toBeTruthy();
  });

  it('vibrates on placement while vibration is on', async () => {
    await mount({ game: blankGame() });
    await place(1, 'C5');
    expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
  });

  it('clicks on placement while sound is on', async () => {
    await mount({ game: blankGame() });
    expect(loadSounds).toHaveBeenCalled();
    await place(1, 'C5');
    expect(sounds()).toEqual(['place']);
  });

  it('sparks along a circuit, then sounds the emptied board when the spark lands', async () => {
    await mount();
    await place(1, 'A4');
    expect(sounds()).toEqual(['spark']);
    await tick(400);
    expect(sounds()).toEqual(['spark', 'perfect']);
  });

  it('raises the pitch of a line clear with the combo', async () => {
    const game = blankGame({ combo: 2 });
    for (let c = 0; c < N - 1; c++) game.grid[c] = 0;
    game.grid[cellIndex(3, 3)] = 0;
    await mount({ game });
    await place(1, 'A8');
    expect(play).toHaveBeenCalledWith(true, 'clear', comboRate(3));
  });

  it('stays silent once sound is switched off, and remembers the setting', async () => {
    await mount({ game: blankGame() });
    await fireEvent.press(screen.getByRole('button', { name: 'How to play' }));
    await fireEvent.press(screen.getByRole('switch', { name: 'Sound' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Got it' }));
    expect(await AsyncStorage.getItem('overclock.sound')).toBe('false');
    await place(1, 'C5');
    expect(sounds()).toEqual([]);
  });

  it('starts silent, without loading sounds, when sound was switched off last time', async () => {
    await mount({ game: blankGame(), saved: { sound: 'false' } });
    expect(loadSounds).not.toHaveBeenCalled();
    await place(1, 'C5');
    expect(sounds()).toEqual([]);
    await fireEvent.press(screen.getByRole('button', { name: 'How to play' }));
    expect(screen.getByRole('switch', { name: 'Sound', checked: false })).toBeTruthy();
  });
});

describe('daily circuit', () => {
  const DAY = 7;
  const dailyButton = () => screen.getByRole('button', { name: "Today's daily circuit" });
  const backButton = () => screen.getByRole('button', { name: 'Back to endless game' });
  const savedRun = (game: GameState, record?: object) => ({
    daily: JSON.stringify({ v: storage.SAVE_VERSION, run: { day: DAY, moves: 5, circuits: 2, game } }),
    ...(record && { dailyRecord: JSON.stringify(record) }),
  });

  beforeEach(() => {
    jest.setSystemTime(new Date(2026, 9, 20, 12));
  });

  it("switches to today's daily circuit without a restart button, and back to the endless game", async () => {
    await mount({ game: blankGame({ score: 1234, best: 2000 }) });
    await fireEvent.press(dailyButton());
    expect(screen.getByLabelText(`Daily circuit ${DAY}`)).toBeTruthy();
    expect(screen.getByLabelText('Score 0')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New game' })).toBeNull();
    expect(storage.parseDaily(await AsyncStorage.getItem('overclock.daily'))).toEqual(startDaily(DAY));

    await fireEvent.press(backButton());
    expect(screen.getByLabelText('Score 1,234')).toBeTruthy();
    expect(screen.getByLabelText('Peak score 2,000')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New game' })).toBeTruthy();
  });

  it('deals the seeded daily and resumes it after relaunching, leaving the endless save alone', async () => {
    let expected = startDaily(DAY);
    const squares: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { grid, tray } = expected.game;
      const k = grid.findIndex((_, k) => fits(grid, tray[i]!, Math.floor(k / N), k % N));
      squares.push(`${'ABCDEFGH'[Math.floor(k / N)]}${(k % N) + 1}`);
      const res = placePiece(expected.game, i, Math.floor(k / N), k % N, dailyRand(DAY, expected.moves))!;
      expected = advanceDaily(expected, res);
    }

    await mount({ game: blankGame() });
    await fireEvent.press(dailyButton());
    for (const [i, square] of squares.entries()) await place(i + 1, square);
    expect(storage.parseDaily(await AsyncStorage.getItem('overclock.daily'))).toEqual(expected);
    expect((await savedGame()).score).toBe(0);

    await screen.unmount();
    await render(
      <SafeAreaProvider initialMetrics={safeArea}>
        <Game />
      </SafeAreaProvider>,
    );
    await fireEvent.press(await screen.findByRole('button', { name: "Today's daily circuit" }));
    expect(screen.getByLabelText(`Score ${fmt(expected.game.score)}`)).toBeTruthy();
  });

  it('gives one try a day: the finished daily extends the streak and opens on its result after that', async () => {
    await mount({ saved: savedRun(lastMoveGame(), { day: DAY - 1, score: 900, circuits: 1, streak: 4 }) });
    await fireEvent.press(dailyButton());
    await place(1, 'D4');
    await tick(1000);
    expect(screen.getByText(`Daily #${DAY}`)).toBeTruthy();
    expect(screen.getByText('5-day streak')).toBeTruthy();
    expect(storage.parseRecord(await AsyncStorage.getItem('overclock.dailyRecord'))).toEqual({
      day: DAY,
      score: 10,
      circuits: 2,
      streak: 5,
    });

    await fireEvent.press(screen.getByRole('button', { name: 'Back to endless' }));
    expect(screen.queryByText(`Daily #${DAY}`)).toBeNull();
    jest.clearAllMocks();
    await fireEvent.press(dailyButton());
    expect(screen.getByText(`Daily #${DAY}`)).toBeTruthy();
    await tick(1000);
    expect(vibrations()).toBe(0);
    expect(sounds()).toEqual([]);
  });

  it('counts a finished daily in the stats once, apart from endless games', async () => {
    await mount({ saved: savedRun(lastMoveGame(), { day: DAY - 1, score: 900, circuits: 1, streak: 4 }) });
    await fireEvent.press(dailyButton());
    await place(1, 'D4');
    await tick(1000);
    expect(await savedStats()).toMatchObject({ games: 0, dailies: 1, bestDaily: 10, bestStreak: 5 });

    await fireEvent.press(screen.getByRole('button', { name: 'Back to endless' }));
    await fireEvent.press(dailyButton());
    await fireEvent.press(screen.getByRole('button', { name: 'Back to endless' }));
    expect((await savedStats()).dailies).toBe(1);
    await fireEvent.press(screen.getByRole('button', { name: /^Peak score/ }));
    expect(screen.getByLabelText('Dailies played: 1')).toBeTruthy();
    expect(screen.getByLabelText('Current streak: 5')).toBeTruthy();
  });

  it('marks the next daily as not played yet once midnight passes', async () => {
    await mount({
      saved: savedRun({ ...lastMoveGame(), over: true }, { day: DAY, score: 10, circuits: 2, streak: 1 }),
    });
    expect(dailyButton().props.accessibilityHint).toBeUndefined();
    await tick(12 * 60 * 60 * 1000 + 1000);
    expect(dailyButton().props.accessibilityHint).toBe('Not played yet');
  });

  it('shares the result, or copies it where sharing is not available', async () => {
    const record = { day: DAY, score: 10, circuits: 2, streak: 1 };
    await mount({ saved: savedRun({ ...lastMoveGame(), over: true }, record) });
    await fireEvent.press(dailyButton());
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
    await fireEvent.press(screen.getByRole('button', { name: 'Share result' }));
    expect(share).toHaveBeenCalledWith({ message: shareText(record) });

    const writeText = jest.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    share.mockRejectedValue(new Error('Share is not supported in this browser'));
    await fireEvent.press(screen.getByRole('button', { name: 'Share result' }));
    await tick(0);
    expect(writeText).toHaveBeenCalledWith(shareText(record));
    expect(screen.getByRole('button', { name: 'Result copied' })).toBeTruthy();
  });
});
