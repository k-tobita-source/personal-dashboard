import type { Task } from "../types/task";
import {
  DEFAULT_DURATION_MINUTES,
  GRID_START_HOUR,
  MIN_DURATION_MINUTES,
  PX_PER_MINUTE,
  SNAP_MINUTES,
} from "../configs/board";

/** Date を当日 0:00 起点の分に変換 */
export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** 分を SNAP_MINUTES 単位（既定）に丸める */
export function snapMinutes(minutes: number, snap = SNAP_MINUTES): number {
  return Math.round(minutes / snap) * snap;
}

/** 開始時刻に対応するグリッド上の top(px) */
export function topPx(startAt: Date): number {
  return (minutesOfDay(startAt) - GRID_START_HOUR * 60) * PX_PER_MINUTE;
}

/** 工数(分)。endAt が無ければ既定値。endAt<=startAt の場合は 0 を返す（負値を防ぐ） */
export function durationMinutes(startAt: Date, endAt: Date | null): number {
  if (!endAt) return DEFAULT_DURATION_MINUTES;
  return Math.max(0, Math.round((endAt.getTime() - startAt.getTime()) / 60000));
}

/** 工数(分)に対応する高さ(px)。最小工数でクランプ */
export function heightPx(duration: number): number {
  return Math.max(duration, MIN_DURATION_MINUTES) * PX_PER_MINUTE;
}

/** px を分に変換 */
export function pxToMinutes(px: number): number {
  return px / PX_PER_MINUTE;
}

/**
 * base と同じ日付で、当日0:00から minutes 分の Date を返す。
 * minutes は 0〜1439（当日内）を前提（呼び出し側でクランプする）。1440 以上は翌日へ繰り上がる。
 */
export function dateAtMinutesOfDay(minutes: number, base = new Date()): Date {
  const d = new Date(base);
  d.setHours(0, minutes, 0, 0);
  return d;
}

/** Date を minutes 分だけずらした新しい Date */
export function shiftMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60000);
}

/** 当日の分(0〜1439)に収める */
export function clampDayMinutes(minutes: number): number {
  return Math.min(Math.max(minutes, 0), 24 * 60 - 1);
}

/** Schedule 描画判定に必要な最小フィールド */
export type ScheduleCandidate = Pick<Task, "lane" | "startAt" | "endAt">;

/** Schedule タイムラインに描画する 1 エントリ */
export interface ScheduleBlockItem<T extends ScheduleCandidate = Task> {
  task: T;
  /** 開始済み（in_progress）の残像なら true */
  isGhost: boolean;
}

/**
 * Schedule タイムラインに描画する対象を導出する。
 * - schedule レーン + startAt あり → 通常表示（isGhost=false）
 * - in_progress レーン + startAt あり + 終了時刻 > now → ゴースト表示（isGhost=true）
 * 終了時刻 = startAt + durationMinutes(startAt, endAt)（endAt 無しは既定60分）。
 * now を引数に取るため、now の更新で終了時刻超過のゴーストは自然に外れる。
 */
export function selectScheduleBlocks<T extends ScheduleCandidate>(
  tasks: T[],
  now: Date,
): ScheduleBlockItem<T>[] {
  const nowMs = now.getTime();
  const items: ScheduleBlockItem<T>[] = [];
  for (const task of tasks) {
    if (!task.startAt) continue;
    if (task.lane === "schedule") {
      items.push({ task, isGhost: false });
      continue;
    }
    if (task.lane === "in_progress") {
      const endMs = shiftMinutes(
        task.startAt,
        durationMinutes(task.startAt, task.endAt),
      ).getTime();
      if (endMs > nowMs) items.push({ task, isGhost: true });
    }
  }
  return items;
}

/**
 * 背景クリック/ドラッグの開始分・現在分から、作成する時間帯（分）を導出する。
 * - クリック（isDrag=false）: 開始から既定60分
 * - ドラッグ（isDrag=true）: min/max で正規化（逆方向ドラッグ対応）
 * いずれも最小工数15分を保証し、当日内に収める（endMin は最大1440=翌0:00）。
 */
export function selectionToRange(
  startMin: number,
  currentMin: number,
  isDrag: boolean,
): { startMin: number; endMin: number } {
  const a = clampDayMinutes(startMin);
  const lo = isDrag ? Math.min(a, clampDayMinutes(currentMin)) : a;
  const hi = isDrag ? Math.max(a, clampDayMinutes(currentMin)) : a;
  const dayEnd = 24 * 60;
  const start = Math.min(lo, dayEnd - MIN_DURATION_MINUTES);
  const minEnd =
    start + (isDrag ? MIN_DURATION_MINUTES : DEFAULT_DURATION_MINUTES);
  const end = Math.min(Math.max(hi, minEnd), dayEnd);
  return { startMin: start, endMin: end };
}

/**
 * Schedule タイムライン上の重なりブロックに列を割り当てる（カレンダー風の左右分割）。
 * - 実効区間 = startAt 〜 startAt + max(durationMinutes, MIN_DURATION_MINUTES)
 *   （描画される高さと一致させ、見た目の重なり＝計算上の重なりとする）。
 * - start 昇順（同 start は end 昇順）で安定ソートし、連続して重なる塊（クラスタ）を切り出す。
 * - クラスタ内は貪欲に「空いた一番左の列」へ詰める。総列数がそのクラスタの cols。
 * 戻り値は taskId -> { col, cols }。重なりが無いブロックは { col: 0, cols: 1 }。
 */
export function assignScheduleColumns<
  T extends ScheduleCandidate & { id: string },
>(items: ScheduleBlockItem<T>[]): Map<string, { col: number; cols: number }> {
  const result = new Map<string, { col: number; cols: number }>();

  // 描画対象（startAt あり）だけを実効区間(ms)に変換
  const intervals: { id: string; start: number; end: number }[] = [];
  for (const { task } of items) {
    const s = task.startAt;
    if (!s) continue;
    const dur = Math.max(
      durationMinutes(s, task.endAt),
      MIN_DURATION_MINUTES,
    );
    intervals.push({
      id: task.id,
      start: s.getTime(),
      end: s.getTime() + dur * 60000,
    });
  }
  intervals.sort((a, b) => a.start - b.start || a.end - b.end);

  let cluster: typeof intervals = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (cluster.length === 0) return;
    const colEnds: number[] = []; // 列ごとの「最後に置いた end」
    const placedCol = new Map<string, number>();
    for (const ev of cluster) {
      let col = colEnds.findIndex((end) => end <= ev.start);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(ev.end);
      } else {
        colEnds[col] = ev.end;
      }
      placedCol.set(ev.id, col);
    }
    const cols = colEnds.length;
    for (const [id, col] of placedCol) {
      result.set(id, { col, cols });
    }
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const ev of intervals) {
    // 現クラスタの最大 end 以上から始まるブロックは別クラスタ（境界は排他）
    if (cluster.length > 0 && ev.start >= clusterEnd) flush();
    cluster.push(ev);
    clusterEnd = Math.max(clusterEnd, ev.end);
  }
  flush();

  return result;
}
