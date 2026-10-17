import { N, type CoreKind, type Piece, type PlaceResult } from './engine';
import { fmt } from './format';

export const PART_NAMES = ['red', 'orange', 'yellow', 'blue', 'cyan', 'pink', 'white'];
export const COL_LABELS = Array.from({ length: N }, (_, c) => String(c + 1));
export const ROW_LABELS = Array.from({ length: N }, (_, r) => String.fromCharCode(65 + r));

const CORE_NAMES: Record<CoreKind, string> = { line: 'line core', area: 'area core' };

export function describePiece(p: Piece) {
  const core = p.core >= 0 ? `, ${CORE_NAMES[p.coreKind]}` : '';
  return `${PART_NAMES[p.c]} ${p.cells.length}-cell part, ${p.w} wide by ${p.h} tall${core}`;
}

export const describeFit = (turns: number) => (turns < 0 ? ", doesn't fit" : turns > 0 ? ', fits after rotating' : '');

export function describeCell(r: number, c: number, color: number, core: CoreKind | null, note = '') {
  const name = `${ROW_LABELS[r]}${COL_LABELS[c]}`;
  const contents = color < 0 ? 'empty' : `${PART_NAMES[color]}${core ? `, ${CORE_NAMES[core]}` : ''}`;
  return `${name}, ${contents}${note ? `, ${note}` : ''}`;
}

export function describePlacement(res: PlaceResult) {
  const circuit = res.circuit.length ? 'Circuit complete. ' : '';
  const cleared = res.lineCount ? `${res.lineCount} ${res.lineCount > 1 ? 'lines' : 'line'} cleared. ` : '';
  const over = res.state.over ? ' No part fits. Game over.' : '';
  return `Placed. ${circuit}${cleared}Score ${fmt(res.state.score)}.${over}`;
}
