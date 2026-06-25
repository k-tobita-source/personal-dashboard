import { arrayMove } from "@dnd-kit/sortable";

import type { Lane } from "@pdash/db/schema";
import { LANES } from "@pdash/db/schema";

import { positionBetween } from "./position";

/** ドラッグ中の表示順（レーンごとの id 配列） */
export type LaneOrder = Record<Lane, string[]>;

/** すべてのレーン配列を浅くコピーする */
function clone(order: LaneOrder): LaneOrder {
  return {
    inbox: [...order.inbox],
    schedule: [...order.schedule],
    in_progress: [...order.in_progress],
    done: [...order.done],
  };
}

/**
 * `id` を現在いるレーンから取り除き、`toLane` の `toIndex` へ差し込んだ
 * 新しい LaneOrder を返す（元は破壊しない）。toIndex は [0, len] にクランプ。
 */
export function moveItemToLane(
  order: LaneOrder,
  id: string,
  toLane: Lane,
  toIndex: number,
): LaneOrder {
  const next = clone(order);
  for (const lane of LANES) {
    const i = next[lane].indexOf(id);
    if (i !== -1) next[lane].splice(i, 1);
  }
  const clamped = Math.max(0, Math.min(toIndex, next[toLane].length));
  next[toLane].splice(clamped, 0, id);
  return next;
}

/** 4レーンすべての並びが一致するか（再レンダー抑制の no-op 判定に使う） */
export function ordersEqual(a: LaneOrder, b: LaneOrder): boolean {
  return LANES.every(
    (lane) =>
      a[lane].length === b[lane].length &&
      a[lane].every((id, i) => id === b[lane][i]),
  );
}

/** order 上で id が属するレーンを返す（無ければ undefined） */
export function laneOf(order: LaneOrder, id: string): Lane | undefined {
  return LANES.find((lane) => order[lane].includes(id));
}

/** 1レーン分の id 配列が一致するか */
function sameSequence(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** ドロップ確定の入力。`preview` があればクロスレーン中のプレビュー、無ければ同一レーン並び替え */
export interface DropContext {
  /** ドラッグ中のカード id */
  id: string;
  /** ドロップ先の droppable id（カード id / `lane:<lane>` / null） */
  over: string | null;
  /** ドラッグ元のレーン（サーバー上の確定状態） */
  originalLane: Lane;
  /** 確定済みの表示順 */
  laneOrder: LaneOrder;
  /** クロスレーン中のプレビュー順（同一レーン内のみのドラッグでは null） */
  preview: LaneOrder | null;
  /** id から position を引く */
  positionOf: (id: string) => number | null;
}

/** ドロップ確定の結果。null は no-op（並びに変化なし） */
export type DropResult =
  | { kind: "reorder"; id: string; position: number }
  | {
      kind: "move";
      id: string;
      lane: Lane;
      position: number;
      startAt: null | undefined;
    }
  | null;

/**
 * カラムレーンへのドロップを確定する純粋関数。
 *
 * クロスレーン移動では `preview`（ユーザーが見ている並び）を真実として位置を確定する。
 * ドロップ時の collision がドラッグ中カード自身や null を返しても snap back しないよう、
 * `over` は「有効な兄弟カード」のときだけ最終インデックスの補正に使う（built-in sortable の
 * 見た目に合わせる）。それ以外（自身 / null / `lane:<lane>` の空きエリア）は preview の位置を使う。
 */
export function resolveColumnDrop(ctx: DropContext): DropResult {
  const { id, over, originalLane, laneOrder, preview, positionOf } = ctx;
  const base = preview ?? laneOrder;
  const finalLane = laneOf(base, id) ?? originalLane;
  let ids = [...base[finalLane]];

  // over が finalLane 内の別カードなら、その位置へ寄せる（同一レーン並び替え相当）
  if (over && over !== id && ids.includes(over)) {
    ids = arrayMove(ids, ids.indexOf(id), ids.indexOf(over));
  }

  // 同一レーンで並びが変わっていなければ no-op
  if (finalLane === originalLane && sameSequence(ids, laneOrder[finalLane])) {
    return null;
  }

  const pos = ids.indexOf(id);
  const beforeId = pos > 0 ? ids[pos - 1] : undefined;
  const afterId = pos < ids.length - 1 ? ids[pos + 1] : undefined;
  const before = beforeId !== undefined ? positionOf(beforeId) : null;
  const after = afterId !== undefined ? positionOf(afterId) : null;
  const position = positionBetween(before, after);

  if (finalLane === originalLane) {
    return { kind: "reorder", id, position };
  }
  return {
    kind: "move",
    id,
    lane: finalLane,
    position,
    startAt: finalLane === "inbox" ? null : undefined,
  };
}
