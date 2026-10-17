import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { View } from 'react-native';
import { Gesture, PointerType } from 'react-native-gesture-handler';
import { Easing, useAnimatedReaction, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import {
  clearPreview,
  completedLines,
  decodeCell,
  ghostFrame,
  MOVE_SLOP,
  NO_CELL,
  NO_SLOT,
  NO_TERMINALS,
  sameLines,
  targetCell,
  type Clears,
  type DragShared,
  type Preview,
  type Point,
  type Slot,
  type SlotGeo,
} from './drag';
import { TRAY_SIZE, type GameState, type Piece, type Terminals } from './engine';
import { PART_COLORS, span, type Metrics } from './theme';

const SLOTS = Array.from({ length: TRAY_SIZE }, (_, i) => i);
const DONE = SLOTS.map(() => 1);
const RETURN = { duration: 200, easing: Easing.out(Easing.cubic) };

interface DragEvent {
  slot: number;
  code: number;
  end: boolean;
}

interface Options {
  state: GameState | null;
  stateRef: RefObject<GameState | null>;
  m: Metrics;
  onPlace: (i: number, r: number, c: number) => void;
  onLift: () => void;
}

export function useDragGestures({ state, stateRef, m, onPlace, onLift }: Options) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [held, setHeld] = useState<(Piece | null)[]>(SLOTS.map(() => null));
  const [releaseSeq, setReleaseSeq] = useState(0);
  const released = useRef<number[]>([]);
  const dragRef = useRef<{ i: number; p: Piece } | null>(null);
  const rootRef = useRef<View>(null);
  const fieldRef = useRef<View>(null);
  const slotViews = useRef<(View | null)[]>([]);
  const slotRefs = useMemo(
    () =>
      SLOTS.map((i) => (view: View | null) => {
        slotViews.current[i] = view;
      }),
    [],
  );

  const dragSlot = useSharedValue(NO_SLOT);
  const touch = useSharedValue<Point>({ x: 0, y: 0 });
  const origin = useSharedValue<Point>({ x: 0, y: 0 });
  const finger = useSharedValue<Point>({ x: 0, y: 0 });
  const pitch = useSharedValue(m.pitch);
  const geo = useSharedValue<(SlotGeo | null)[]>(SLOTS.map(() => null));
  const field = useSharedValue<Point>({ x: 0, y: 0 });
  const grid = useSharedValue<number[]>([]);
  const slots = useSharedValue<Slot[]>(SLOTS.map(() => ({ x: 0, y: 0, w: 0, h: 0 })));
  const missFrom = useSharedValue<Point[]>(SLOTS.map(() => ({ x: 0, y: 0 })));
  const back = useSharedValue(DONE);
  const shrink = useSharedValue((m.mini + m.miniGap) / m.pitch);
  const target = useSharedValue(NO_CELL);
  const lines = useSharedValue<Clears>({ rows: [], cols: [], circuit: [] });
  const terminals = useSharedValue<Terminals>(NO_TERMINALS);
  const enabled = useSharedValue(false);
  const moved = useSharedValue(false);
  const mouse = useSharedValue(false);
  const landing = useSharedValue<(Point | null)[]>(SLOTS.map(() => null));
  const events = useSharedValue<DragEvent[]>([]);
  const drag = useMemo<DragShared>(
    () => ({
      slot: dragSlot,
      touch,
      origin,
      pitch,
      mouse,
      geo,
      landing,
      slots,
      missFrom,
      back,
      shrink,
      target,
      lines,
    }),
    [dragSlot, touch, origin, pitch, mouse, geo, landing, slots, missFrom, back, shrink, target, lines],
  );

  useEffect(() => {
    geo.set(
      (state ? state.tray : SLOTS.map(() => null)).map((p) =>
        p ? { w: span(p.w, m), h: span(p.h, m), pw: p.w, ph: p.h, cells: p.cells.flat() } : null,
      ),
    );
    grid.set(state?.grid ?? []);
    terminals.set(state?.terminals ?? NO_TERMINALS);
    pitch.set(m.pitch);
    shrink.set((m.mini + m.miniGap) / m.pitch);
    enabled.set(!!state && !state.over);
  }, [state, m, geo, grid, terminals, pitch, shrink, enabled]);

  useEffect(() => {
    const done = released.current.splice(0);
    if (!done.length) return;
    scheduleOnUI(() => {
      'worklet';
      landing.set(landing.get().map((f, k) => (done.includes(k) ? null : f)));
    });
  }, [releaseSeq, landing]);

  const measureLayout = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    fieldRef.current?.measureLayout(root, (x, y) => field.set({ x, y }));
    const next: (Slot | null)[] = SLOTS.map(() => null);
    slotViews.current.forEach((view, i) =>
      view?.measureLayout(root, (x, y, w, h) => {
        next[i] = { x, y, w, h };
        if (next.every((v): v is Slot => v !== null)) slots.set(next);
      }),
    );
  }, [field, slots]);

  const onDragStart = useCallback(
    (i: number) => {
      const s = stateRef.current;
      const p = s ? s.tray[i] : null;
      if (!p) return;
      dragRef.current = { i, p };
      setPreview(null);
      setHeld((h) => h.map((x, k) => (k === i ? p : x)));
      onLift();
    },
    [stateRef, onLift],
  );

  const onLines = useCallback(
    (next: Clears) => {
      const d = dragRef.current;
      const s = stateRef.current;
      if (!d || !s || (!next.rows.length && !next.cols.length && !next.circuit.length)) {
        setPreview(null);
        return;
      }
      setPreview(clearPreview(s.grid, next, PART_COLORS[d.p.c]));
    },
    [stateRef],
  );

  const onDragEnd = useCallback(
    (i: number, code: number) => {
      if (dragRef.current?.i === i) {
        dragRef.current = null;
        setPreview(null);
      }
      if (code !== NO_CELL) {
        const { r, c } = decodeCell(code);
        onPlace(i, r, c);
      }
      setHeld((h) => h.map((x, k) => (k === i ? null : x)));
      released.current.push(i);
      setReleaseSeq((n) => n + 1);
    },
    [onPlace],
  );

  const onDragEvents = useCallback(
    (list: DragEvent[]) => list.forEach((e) => (e.end ? onDragEnd(e.slot, e.code) : onDragStart(e.slot))),
    [onDragStart, onDragEnd],
  );

  const isDragging = useCallback(() => dragRef.current !== null, []);

  useAnimatedReaction(
    () => events.get(),
    (list) => {
      if (!list.length) return;
      events.set([]);
      scheduleOnRN(onDragEvents, list);
    },
  );

  useAnimatedReaction(
    () => {
      const i = dragSlot.get();
      if (i < 0 || !moved.get()) return NO_CELL;
      return targetCell(ghostFrame(drag, i), field.get(), pitch.get(), grid.get(), geo.get()[i]);
    },
    (code, prev) => {
      if (code === prev) return;
      target.set(code);
      const i = dragSlot.get();
      const next = completedLines(grid.get(), i < 0 ? null : geo.get()[i], code, terminals.get());
      if (sameLines(next, lines.get())) return;
      lines.set(next);
      scheduleOnRN(onLines, next);
    },
  );

  const gestures = useMemo(
    () =>
      SLOTS.map((i) =>
        Gesture.Pan()
          .minDistance(0)
          .maxPointers(1)
          .onBegin((e) => {
            if (!enabled.get() || !geo.get()[i] || dragSlot.get() !== NO_SLOT || landing.get()[i]) return;
            if (back.get()[i] < 1) {
              back.set(back.get().map((t, k) => (k === i ? 1 : t)));
              back.set(withTiming(DONE, RETURN));
            }
            const s = slots.get()[i];
            const start = { x: s.x + e.x, y: s.y + e.y };
            origin.set(start);
            touch.set(start);
            finger.set({ x: e.absoluteX, y: e.absoluteY });
            moved.set(false);
            mouse.set(e.pointerType === PointerType.MOUSE);
            dragSlot.set(i);
            events.set([...events.get(), { slot: i, code: NO_CELL, end: false }]);
          })
          .onUpdate((e) => {
            if (dragSlot.get() !== i) return;
            const o = origin.get();
            const f0 = finger.get();
            const dx = e.absoluteX - f0.x;
            const dy = e.absoluteY - f0.y;
            if (!moved.get() && Math.hypot(dx, dy) > MOVE_SLOP) moved.set(true);
            touch.set({ x: o.x + dx, y: o.y + dy });
          })
          .onFinalize((_e, success) => {
            if (dragSlot.get() !== i) return;
            const f = ghostFrame(drag, i);
            const code =
              success && moved.get() ? targetCell(f, field.get(), pitch.get(), grid.get(), geo.get()[i]) : NO_CELL;
            if (code !== NO_CELL) {
              landing.set(landing.get().map((prev, k) => (k === i ? f : prev)));
            } else {
              missFrom.set(missFrom.get().map((prev, k) => (k === i ? f : prev)));
              back.set(back.get().map((t, k) => (k === i ? 0 : t)));
              back.set(withTiming(DONE, RETURN));
            }
            dragSlot.set(NO_SLOT);
            events.set([...events.get(), { slot: i, code, end: true }]);
          }),
      ),
    [
      slots,
      geo,
      enabled,
      dragSlot,
      origin,
      finger,
      touch,
      moved,
      mouse,
      drag,
      field,
      pitch,
      grid,
      landing,
      missFrom,
      back,
      events,
    ],
  );

  return { rootRef, fieldRef, slotRefs, measureLayout, gestures, drag, held, preview, isDragging };
}
