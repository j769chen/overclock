import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, render, screen } from '@testing-library/react-native';

import { CalendarIcon } from '../components/Icons';
import { Hud } from '../components/Hud';
import { metrics } from '../theme';

jest.mock('../components/Icons', () => {
  const actual = jest.requireActual<typeof import('../components/Icons')>('../components/Icons');
  return { ...actual, CalendarIcon: jest.fn(actual.CalendarIcon) };
});

const m = metrics(390, 800);
const noop = () => {};
const hud = (score: number) => (
  <Hud
    score={score}
    best={0}
    armed={false}
    daily={null}
    dailyNew={false}
    m={m}
    onHelp={noop}
    onRestart={noop}
    onDaily={noop}
    onStats={noop}
  />
);

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('Hud', () => {
  it('counts the score up without redrawing the rest of the top bar', async () => {
    await render(hud(0));
    await screen.rerender(hud(1500));
    expect(screen.getByLabelText('Score 1,500')).toBeTruthy();
    for (let t = 0; t < 600; t += 60) {
      await act(async () => {
        jest.advanceTimersByTime(60);
      });
    }
    expect(screen.getByText('1,500')).toBeTruthy();
    expect(CalendarIcon).toHaveBeenCalledTimes(2);
  });
});
