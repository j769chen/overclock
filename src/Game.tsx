import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Background } from './components/Background';
import { Board } from './components/Board';
import { GameOver } from './components/GameOver';
import { GhostLayer } from './components/Ghost';
import { Help } from './components/Help';
import { Hud } from './components/Hud';
import { Stats } from './components/Stats';
import { Tray, type SlotAnim } from './components/Tray';
import {
  anyMove,
  cellIndex,
  newGame,
  placePiece,
  spinPiece,
  TRAY_SIZE,
  type GameState,
  type PlaceResult,
  type Terminals,
} from './engine';
import {
  advanceDaily,
  currentStreak,
  dailyRand,
  dayNumber,
  finishDaily,
  startDaily,
  type DailyRecord,
  type DailyRun,
} from './daily';
import { describePlacement } from './describe';
import { buildFx, circuitDelay, FX_LIFETIME, type FxSpec } from './fx';
import { buzz, type Buzz } from './haptics';
import { comboRate, loadSounds, play, type Sfx } from './sound';
import { emptyStats, recordDaily, recordGame, recordMove, type Stats as StatsData } from './stats';
import { loadSaved, saveDaily, saveGame, saveHaptics, saveHelpSeen, saveRecord, saveSound, saveStats } from './storage';
import { C, metrics } from './theme';
import { useDragGestures } from './useDragGestures';
import { useToday } from './useToday';

export default function Game() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const m = useMemo(
    () => metrics(width, height - insets.top - insets.bottom),
    [width, height, insets.top, insets.bottom],
  );

  const [state, setState] = useState<GameState | null>(null);
  const [fx, setFx] = useState<FxSpec[]>([]);
  const [overVisible, setOverVisible] = useState(false);
  const [newBest, setNewBest] = useState(false);
  const [hapticsOn, setHapticsOn] = useState(true);
  const [soundOn, setSoundOn] = useState(true);
  const [anims, setAnims] = useState<SlotAnim[]>(() =>
    Array.from({ length: TRAY_SIZE }, () => ({ key: 0, kind: 'deal' as const })),
  );
  const [armed, setArmed] = useState(false);
  const [chosen, setChosen] = useState<number | null>(null);
  const [wired, setWired] = useState<Terminals | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [dailyDay, setDailyDay] = useState<number | null>(null);
  const [record, setRecord] = useState<DailyRecord | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [shown, setShown] = useState({ stats: emptyStats(), peak: 0 });
  const today = useToday();

  const stateRef = useRef<GameState | null>(null);
  const mRef = useRef(m);
  const hapticsRef = useRef(true);
  const soundRef = useRef(true);
  const helpSeen = useRef(true);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const startBest = useRef(0);
  const inDaily = useRef(false);
  const runRef = useRef<DailyRun | null>(null);
  const endlessRef = useRef<GameState | null>(null);
  const recordRef = useRef<DailyRecord | null>(null);
  const statsRef = useRef<StatsData>(emptyStats());
  useEffect(() => {
    mRef.current = m;
  }, [m]);
  useEffect(() => {
    hapticsRef.current = hapticsOn;
  }, [hapticsOn]);
  useEffect(() => {
    soundRef.current = soundOn;
  }, [soundOn]);

  const haptic = useCallback((kind: Buzz) => buzz(hapticsRef.current, kind), []);
  const sfx = useCallback((kind: Sfx, rate?: number) => play(soundRef.current, kind, rate), []);

  const later = useCallback((run: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      run();
    }, ms);
    timers.current.add(t);
  }, []);

  const cancelTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
  }, []);

  useEffect(() => cancelTimers, [cancelTimers]);

  const track = useCallback((next: StatsData) => {
    statsRef.current = next;
    saveStats(next);
  }, []);

  const commit = useCallback(
    (next: GameState, res?: PlaceResult) => {
      stateRef.current = next;
      setState(next);
      let stats = res ? recordMove(statsRef.current, res) : statsRef.current;
      const run = runRef.current;
      if (!inDaily.current || !run) {
        endlessRef.current = next;
        saveGame(next, startBest.current);
        if (next.over) stats = recordGame(stats, next.score);
      } else {
        const after = res ? advanceDaily(run, res) : { ...run, game: next };
        runRef.current = after;
        saveDaily(after);
        if (next.over) {
          const done = finishDaily(recordRef.current, after);
          recordRef.current = done;
          setRecord(done);
          saveRecord(done);
          stats = recordDaily(stats, done);
        }
      }
      if (stats !== statsRef.current) track(stats);
    },
    [track],
  );

  const dealAll = useCallback(() => setAnims((a) => a.map((x) => ({ key: x.key + 1, kind: 'deal' }))), []);

  const startGame = useCallback(
    (best: number) => {
      cancelTimers();
      startBest.current = best;
      commit(newGame(best));
      setOverVisible(false);
      setFx([]);
      setWired(null);
      setChosen(null);
      dealAll();
    },
    [commit, dealAll, cancelTimers],
  );

  useEffect(() => {
    let alive = true;
    loadSaved()
      .then(({ saved, best, haptics, sound, helpSeen: seen, daily, record: last, stats }) => {
        if (!alive) return;
        statsRef.current = stats;
        if (!haptics) setHapticsOn(false);
        if (sound) loadSounds();
        else setSoundOn(false);
        runRef.current = daily;
        recordRef.current = last;
        setRecord(last);
        if (!seen) {
          helpSeen.current = false;
          setHelpOpen(true);
        }
        if (saved && !saved.game.over) {
          const game = { ...saved.game, best: Math.max(saved.game.best, best) };
          startBest.current = saved.startBest;
          commit({ ...game, over: !anyMove(game) });
        } else {
          startGame(best);
        }
      })
      .catch(() => {
        if (alive) startGame(0);
      });
    return () => {
      alive = false;
    };
  }, [commit, startGame]);

  const isNewBest = useCallback((s: GameState) => !inDaily.current && s.score > 0 && s.score > startBest.current, []);

  const over = state?.over ?? false;
  useEffect(() => {
    if (!over || overVisible) return;
    const t = setTimeout(() => {
      const s = stateRef.current;
      setNewBest(!!s && isNewBest(s));
      setOverVisible(true);
      haptic('error');
      sfx('over');
    }, 900);
    return () => clearTimeout(t);
  }, [over, overVisible, haptic, sfx, isNewBest]);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 2200);
    return () => clearTimeout(t);
  }, [armed]);

  const place = useCallback(
    (i: number, r: number, c: number) => {
      const s = stateRef.current;
      if (!s) return null;
      const p = s.tray[i];
      const run = inDaily.current ? runRef.current : null;
      const res = placePiece(s, i, r, c, run ? dailyRand(run.day, run.moves) : undefined);
      if (!p || !res) return null;
      commit(res.state, res);
      setChosen((cur) => (cur === i || res.dealt ? null : cur));
      if (res.dealt) dealAll();
      const covered = new Set(p.cells.map(([dr, dc]) => cellIndex(r + dr, c + dc)));
      const items = buildFx(res, mRef.current);
      setFx((f) => [...f.filter((it) => !('cell' in it && covered.has(it.cell))), ...items]);
      if (items.length) {
        const ids = new Set(items.map((it) => it.id));
        later(() => setFx((f) => f.filter((it) => !ids.has(it.id))), FX_LIFETIME);
      }
      const kind =
        res.surges.length || res.perfect || res.circuit.length ? 'heavy' : res.lineCount ? 'medium' : 'light';
      const sound: Sfx = res.perfect
        ? 'perfect'
        : res.surges.length
          ? 'blast'
          : res.lineCount || res.circuit.length
            ? 'clear'
            : 'place';
      const rate = sound === 'clear' ? comboRate(res.state.combo) : 1;
      const boom = circuitDelay(res.circuit);
      if (boom) {
        haptic('light');
        sfx('spark');
        setWired(res.wired);
        later(() => {
          haptic(kind);
          sfx(sound, rate);
          setWired((w) => (w === res.wired ? null : w));
        }, boom);
      } else {
        haptic(kind);
        sfx(sound, rate);
      }
      return res;
    },
    [commit, dealAll, haptic, sfx, later],
  );

  const lift = useCallback(() => {
    haptic('select');
    sfx('lift');
  }, [haptic, sfx]);

  const { rootRef, fieldRef, slotRefs, measureLayout, gestures, drag, held, preview, isDragging } = useDragGestures({
    state,
    stateRef,
    m,
    onPlace: place,
    onLift: lift,
  });

  const spin = useCallback(
    (i: number) => {
      const s = stateRef.current;
      if (!s || isDragging()) return;
      const next = spinPiece(s, i);
      if (!next) return;
      commit(next);
      setAnims((a) => a.map((x, k) => (k === i ? { key: x.key + 1, kind: 'spin' } : x)));
      haptic('select');
      sfx('rotate');
    },
    [commit, haptic, sfx, isDragging],
  );

  const toggleDaily = useCallback(() => {
    const endless = endlessRef.current;
    if (!endless || isDragging()) return;
    cancelTimers();
    setFx([]);
    setWired(null);
    setChosen(null);
    setArmed(false);
    const day = dayNumber(new Date());
    let game = endless;
    if (inDaily.current) {
      inDaily.current = false;
      setDailyDay(null);
      AccessibilityInfo.announceForAccessibility('Back to your endless game.');
    } else {
      let run = runRef.current;
      if (run?.day !== day) {
        run = startDaily(day);
        runRef.current = run;
        saveDaily(run);
      }
      game = run.game;
      inDaily.current = true;
      setDailyDay(day);
      AccessibilityInfo.announceForAccessibility(`Daily circuit ${day}.`);
    }
    stateRef.current = game;
    setState(game);
    setOverVisible(game.over);
    setNewBest(game.over && isNewBest(game));
    dealAll();
  }, [cancelTimers, dealAll, isDragging, isNewBest]);

  const selected = chosen !== null && state?.tray[chosen] && !state.over ? chosen : null;

  const choose = useCallback(
    (i: number) => {
      const s = stateRef.current;
      if (!s?.tray[i] || s.over) return;
      const next = selected === i ? null : i;
      setChosen(next);
      AccessibilityInfo.announceForAccessibility(
        next === null ? `Put back U${i + 1}.` : `Chose U${i + 1}. Pick a board square.`,
      );
    },
    [selected],
  );

  const placeAt = useCallback(
    (r: number, c: number) => {
      if (selected === null) return;
      const res = place(selected, r, c);
      setChosen(null);
      if (res) AccessibilityInfo.announceForAccessibility(describePlacement(res));
    },
    [selected, place],
  );

  const toggleHaptics = useCallback(() => {
    const next = !hapticsOn;
    setHapticsOn(next);
    saveHaptics(next);
    buzz(next, 'select');
  }, [hapticsOn]);

  const toggleSound = useCallback(() => {
    const next = !soundOn;
    setSoundOn(next);
    saveSound(next);
    play(next, 'rotate');
  }, [soundOn]);

  const openHelp = useCallback(() => setHelpOpen(true), []);
  const openStats = useCallback(() => {
    setShown({ stats: statsRef.current, peak: endlessRef.current?.best ?? 0 });
    setStatsOpen(true);
  }, []);
  const closeStats = useCallback(() => setStatsOpen(false), []);
  const closeHelp = useCallback(() => {
    setHelpOpen(false);
    if (helpSeen.current) return;
    helpSeen.current = true;
    saveHelpSeen();
  }, []);

  const restart = useCallback(() => {
    const s = stateRef.current;
    if (!s || isDragging()) return;
    if (s.over || armed) {
      setArmed(false);
      if (!s.over && s.score > 0) track(recordGame(statsRef.current, s.score));
      startGame(s.best);
    } else {
      setArmed(true);
      AccessibilityInfo.announceForAccessibility('Tap again to start a new game.');
    }
  }, [armed, startGame, track, isDragging]);

  if (!state) {
    return (
      <View style={styles.root}>
        <Background />
      </View>
    );
  }

  return (
    <View ref={rootRef} onLayout={measureLayout} style={styles.root}>
      <Background />
      <View
        aria-hidden={overVisible}
        style={[styles.column, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}
      >
        <Hud
          score={state.score}
          best={state.best}
          armed={armed}
          daily={dailyDay}
          dailyNew={record?.day !== today}
          m={m}
          onHelp={openHelp}
          onRestart={restart}
          onDaily={toggleDaily}
          onStats={openStats}
        />
        <Board
          grid={state.grid}
          cores={state.cores}
          preview={preview}
          m={m}
          fieldRef={fieldRef}
          onBoardLayout={measureLayout}
          fx={fx}
          tray={state.tray}
          drag={drag}
          placing={selected === null ? null : state.tray[selected]}
          onPlaceAt={placeAt}
          terminals={wired ?? state.terminals}
        />
        <Tray
          tray={state.tray}
          grid={state.grid}
          m={m}
          anims={anims}
          gestures={gestures}
          slotRefs={slotRefs}
          onTrayLayout={measureLayout}
          drag={drag}
          onRotate={spin}
          selected={selected}
          onSelect={choose}
        />
      </View>
      <GhostLayer tray={state.tray} held={held} m={m} drag={drag} />
      <GameOver
        visible={overVisible}
        score={state.score}
        best={state.best}
        newBest={newBest}
        daily={dailyDay !== null && record?.day === dailyDay ? record : null}
        onAgain={dailyDay === null ? () => startGame(state.best) : toggleDaily}
      />
      <Help
        visible={helpOpen}
        onClose={closeHelp}
        hapticsOn={hapticsOn}
        onToggleHaptics={toggleHaptics}
        soundOn={soundOn}
        onToggleSound={toggleSound}
      />
      <Stats
        visible={statsOpen}
        onClose={closeStats}
        stats={shown.stats}
        peak={shown.peak}
        streak={currentStreak(record, today)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.maskDeep },
  column: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 5 },
});
