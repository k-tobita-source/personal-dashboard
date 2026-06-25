import { describe, expect, it } from "vitest";

import type { Lane } from "@acme/db/schema";

import { moveItemToLane, ordersEqual, resolveColumnDrop } from "./reorder";

function order(
  partial: Partial<Record<Lane, string[]>>,
): Record<Lane, string[]> {
  return {
    inbox: [],
    schedule: [],
    in_progress: [],
    done: [],
    ...partial,
  };
}

describe("moveItemToLane", () => {
  it("別レーンの指定インデックスへ差し込む", () => {
    const base = order({ inbox: ["a"], in_progress: ["x", "y"] });
    const next = moveItemToLane(base, "a", "in_progress", 1);
    expect(next.inbox).toEqual([]);
    expect(next.in_progress).toEqual(["x", "a", "y"]);
  });

  it("削除してから挿入するので index は削除後の配列基準", () => {
    // 実運用では同一レーン移動には使わない（cross-lane のみ）。挙動の確認用。
    const base = order({ inbox: ["a", "b", "c"] });
    const next = moveItemToLane(base, "a", "inbox", 2);
    expect(next.inbox).toEqual(["b", "c", "a"]);
  });

  it("インデックスが範囲外なら末尾へクランプ", () => {
    const base = order({ inbox: ["a"], done: ["d"] });
    const next = moveItemToLane(base, "a", "done", 99);
    expect(next.done).toEqual(["d", "a"]);
  });

  it("元の order を破壊しない（新しい配列を返す）", () => {
    const base = order({ inbox: ["a"], done: [] });
    moveItemToLane(base, "a", "done", 0);
    expect(base.inbox).toEqual(["a"]);
    expect(base.done).toEqual([]);
  });
});

describe("ordersEqual", () => {
  it("全レーンの並びが一致すれば true", () => {
    expect(
      ordersEqual(order({ inbox: ["a", "b"] }), order({ inbox: ["a", "b"] })),
    ).toBe(true);
  });

  it("並びが違えば false", () => {
    expect(
      ordersEqual(order({ inbox: ["a", "b"] }), order({ inbox: ["b", "a"] })),
    ).toBe(false);
  });
});

describe("resolveColumnDrop", () => {
  // A=inbox(pos1), X=in_progress(pos1), Y=in_progress(pos2)
  const positions: Record<string, number> = { A: 1, X: 1, Y: 2, Z: 3 };
  const positionOf = (id: string) => positions[id] ?? null;

  it("クロスレーン: over が active 自身でも preview の位置に確定する（snap back しない）", () => {
    const preview = order({ inbox: [], in_progress: ["X", "A", "Y"] });
    const result = resolveColumnDrop({
      id: "A",
      over: "A", // ドロップ時に collision が自身を返すケース
      originalLane: "inbox",
      laneOrder: order({ inbox: ["A"], in_progress: ["X", "Y"] }),
      preview,
      positionOf,
    });
    expect(result).toEqual({
      kind: "move",
      id: "A",
      lane: "in_progress",
      position: 1.5, // X(1) と Y(2) の中間
      startAt: undefined,
    });
  });

  it("クロスレーン: over が null でも preview の位置に確定する", () => {
    const preview = order({ inbox: [], in_progress: ["X", "A", "Y"] });
    const result = resolveColumnDrop({
      id: "A",
      over: null,
      originalLane: "inbox",
      laneOrder: order({ inbox: ["A"], in_progress: ["X", "Y"] }),
      preview,
      positionOf,
    });
    expect(result).toEqual({
      kind: "move",
      id: "A",
      lane: "in_progress",
      position: 1.5,
      startAt: undefined,
    });
  });

  it("クロスレーン: over が兄弟カードなら最終インデックスを補正する", () => {
    const preview = order({ inbox: [], in_progress: ["A", "X", "Y"] });
    const result = resolveColumnDrop({
      id: "A",
      over: "X", // built-in sortable の見た目に合わせ X の位置へ
      originalLane: "inbox",
      laneOrder: order({ inbox: ["A"], in_progress: ["X", "Y"] }),
      preview,
      positionOf,
    });
    expect(result).toEqual({
      kind: "move",
      id: "A",
      lane: "in_progress",
      position: 1.5, // X(1) と Y(2) の間へ
      startAt: undefined,
    });
  });

  it("クロスレーン: inbox へ移動すると startAt を null クリアする", () => {
    const preview = order({ inbox: ["A"], in_progress: [] });
    const result = resolveColumnDrop({
      id: "A",
      over: null,
      originalLane: "in_progress",
      laneOrder: order({ inbox: [], in_progress: ["A"] }),
      preview,
      positionOf,
    });
    expect(result).toEqual({
      kind: "move",
      id: "A",
      lane: "inbox",
      position: 1, // 単独
      startAt: null,
    });
  });

  it("同一レーン: preview 無しで兄弟へドロップすると reorder", () => {
    const laneOrder = order({ in_progress: ["X", "Y", "Z"] });
    const result = resolveColumnDrop({
      id: "X",
      over: "Z",
      originalLane: "in_progress",
      laneOrder,
      preview: null,
      positionOf,
    });
    // [X,Y,Z] -> [Y,Z,X]、末尾なので Z(3)+1
    expect(result).toEqual({ kind: "reorder", id: "X", position: 4 });
  });

  it("同一レーン: over が自身（移動なし）なら null（no-op）", () => {
    const laneOrder = order({ in_progress: ["X", "Y", "Z"] });
    const result = resolveColumnDrop({
      id: "X",
      over: "X",
      originalLane: "in_progress",
      laneOrder,
      preview: null,
      positionOf,
    });
    expect(result).toBeNull();
  });

  it("クロスレーン: 空きエリア(lane droppable)へのドロップは preview 末尾位置に確定", () => {
    const preview = order({ inbox: [], in_progress: ["X", "Y", "A"] });
    const result = resolveColumnDrop({
      id: "A",
      over: "lane:in_progress",
      originalLane: "inbox",
      laneOrder: order({ inbox: ["A"], in_progress: ["X", "Y"] }),
      preview,
      positionOf,
    });
    expect(result).toEqual({
      kind: "move",
      id: "A",
      lane: "in_progress",
      position: 3, // Y(2) の後ろ
      startAt: undefined,
    });
  });
});
