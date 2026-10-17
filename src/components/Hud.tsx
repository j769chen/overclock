import { memo, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { fmt } from '../format';
import { C, F, type Metrics } from '../theme';
import { CalendarIcon, RestartIcon, StatsIcon } from './Icons';

interface HudProps {
  score: number;
  best: number;
  armed: boolean;
  daily: number | null;
  dailyNew: boolean;
  m: Metrics;
  onHelp: () => void;
  onRestart: () => void;
  onDaily: () => void;
  onStats: () => void;
}

const STAT_FONT = 20;
const DIGIT_EM = 0.6;
const COUNT_MS = 450;
const COUNT_STEP = 60;

function useCountUp(target: number) {
  const [shown, setShown] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    const from = cur.current;
    if (from === target) return;
    const start = Date.now();
    const id = setInterval(() => {
      const k = Math.min(1, (Date.now() - start) / COUNT_MS);
      cur.current = Math.round(from + (target - from) * (1 - (1 - k) ** 3));
      setShown(cur.current);
      if (k === 1) clearInterval(id);
    }, COUNT_STEP);
    return () => clearInterval(id);
  }, [target]);
  return shown;
}

const Score = memo(function Score({ score, size }: { score: number; size: number }) {
  const shown = useCountUp(score);
  const bump = useSharedValue(1);
  const bumpStyle = useAnimatedStyle(() => ({ transform: [{ scale: bump.get() }] }));

  useEffect(() => {
    if (!score) return;
    bump.set(withSequence(withTiming(1.1, { duration: 0 }), withSpring(1, { stiffness: 230, damping: 16 })));
  }, [score, bump]);

  return (
    <Animated.Text
      style={[styles.score, { fontSize: Math.min(54, Math.max(38, size * 0.12)), maxWidth: size * 0.46 }, bumpStyle]}
      numberOfLines={1}
      adjustsFontSizeToFit
      accessibilityLabel={`Score ${fmt(score)}`}
    >
      {fmt(shown)}
    </Animated.Text>
  );
});

export const Hud = memo(function Hud({
  score,
  best,
  armed,
  daily,
  dailyNew,
  m,
  onHelp,
  onRestart,
  onDaily,
  onStats,
}: HudProps) {
  const [statWidth, setStatWidth] = useState(0);
  const stat = daily === null ? fmt(best) : `#${daily}`;
  const statFont = statWidth ? Math.min(STAT_FONT, statWidth / (stat.length * DIGIT_EM)) : STAT_FONT;

  return (
    <View style={[styles.hud, { width: m.size }]}>
      <View style={[styles.side, styles.lead]}>
        <Pressable
          onPress={onDaily}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={daily === null ? "Today's daily circuit" : 'Back to endless game'}
          accessibilityHint={dailyNew && daily === null ? 'Not played yet' : undefined}
          style={[styles.btn, daily !== null && styles.on]}
        >
          <CalendarIcon color={daily === null ? C.silk : C.pad} />
          {dailyNew && daily === null && <View style={styles.dot} />}
        </Pressable>
        <Pressable
          onPress={onStats}
          hitSlop={4}
          style={styles.stat}
          onLayout={(e) => setStatWidth(e.nativeEvent.layout.width)}
          accessibilityRole="button"
          accessibilityLabel={daily === null ? `Peak score ${fmt(best)}` : `Daily circuit ${daily}`}
          accessibilityHint="Opens your stats"
        >
          <View style={styles.label}>
            <Text style={styles.silk}>{daily === null ? 'Peak' : 'Daily'}</Text>
            <StatsIcon size={11} color={C.silkLabel} />
          </View>
          <Text style={[styles.best, { fontSize: statFont }]} numberOfLines={1}>
            {stat}
          </Text>
        </Pressable>
      </View>
      <View style={styles.center}>
        <Score score={score} size={m.size} />
      </View>
      <View style={[styles.side, styles.tools]}>
        <Pressable
          onPress={onHelp}
          accessibilityRole="button"
          accessibilityLabel="How to play"
          hitSlop={4}
          style={styles.btn}
        >
          <Text style={styles.help}>?</Text>
        </Pressable>
        {daily === null && (
          <Pressable
            onPress={onRestart}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={armed ? 'Confirm new game' : 'New game'}
            style={[styles.btn, armed && styles.armed]}
          >
            {armed ? <Text style={styles.btnText}>Restart?</Text> : <RestartIcon color={C.silk} />}
          </Pressable>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  hud: { flexDirection: 'row', alignItems: 'center' },
  side: { flex: 1, gap: 2 },
  lead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stat: { flex: 1, gap: 2 },
  label: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tools: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  center: { alignItems: 'center', gap: 6, paddingHorizontal: 6 },
  silk: { fontFamily: F.mono, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: C.silkLabel },
  best: { fontFamily: F.bold, color: C.pad, fontVariant: ['tabular-nums'] },
  score: {
    fontFamily: F.bold,
    color: C.silk,
    fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(255,226,161,0.35)',
    textShadowRadius: 18,
    textShadowOffset: { width: 0, height: 0 },
  },
  btn: {
    height: 36,
    minWidth: 36,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.silkLine,
    backgroundColor: C.silkFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  armed: { backgroundColor: C.danger, borderColor: C.danger },
  on: { borderColor: C.pad },
  dot: { position: 'absolute', top: 4, right: 4, width: 6, height: 6, borderRadius: 3, backgroundColor: C.pad },
  btnText: { fontFamily: F.mono, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: C.silk },
  help: { fontFamily: F.bold, fontSize: 19, lineHeight: 22, color: C.silk },
});
