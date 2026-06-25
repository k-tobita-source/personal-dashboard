# 別レーンへのライブプレビュー挿入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 別レーンへの D&D 移動で、ドラッグ中にライブプレビュー（移動先カードが隙間を空ける）を出しつつ、任意の中間位置へ差し込めるようにする。

**Architecture:** dnd-kit のマルチコンテナ Sortable パターン。ドラッグ中だけ有効なローカルの並び順 override（`previewOrder`）を `onDragOver` で更新し、各カラムをその順で描画。`onDragEnd` で前後カードの position から `positionBetween` を計算し、レーン変化なら `move`（position 付き）、レーン不変なら `reorder` へ流す。同一レーン内の並び替えは dnd-kit 組み込み sortable に任せ、`onDragOver` はクロスレーン移動のみ扱う。Schedule レーンは対象外（時刻が状態）。

**Tech Stack:** React 19 / dnd-kit (@dnd-kit/core, @dnd-kit/sortable) / tRPC + TanStack Query / Zod / Vitest / Drizzle(SQLite)。

参照スペック: [docs/superpowers/specs/2026-06-17-cross-lane-drag-insert-design.md](../specs/2026-06-17-cross-lane-drag-insert-design.md)

---

## File Structure

- Create: `apps/web/src/features/board/utils/reorder.ts` — `previewOrder`（`Record<Lane, string[]>`）を操作する純粋関数（`moveItemToLane`, `ordersEqual`）。
- Create: `apps/web/src/features/board/utils/reorder.test.ts` — 上記のユニットテスト。
- Modify: `packages/api/src/service/task.ts` — `MoveTaskInput` に `position` 追加、`move()` が position を尊重。
- Modify: `apps/web/src/features/board/api/mutations.ts` — `applyMove` が `vars.position` を尊重。
- Modify: `apps/web/src/features/board/hooks/useBoardDnd.ts` — `previewOrder` state / `handleDragOver` / `handleDragEnd` 書き換え / `displayOrder` 返却。
- Modify: `apps/web/src/features/board/components/Board.tsx` — `onDragOver` 接続、3カラムを `displayOrder` から描画。

`packages/api/src/router/task.ts` は `MoveTaskInput` をそのまま使うため**変更不要**（position が自動的に契約へ伝播する）。

---

## Task 1: 並び順 override の純粋ユーティリティ（TDD）

**Files:**
- Create: `apps/web/src/features/board/utils/reorder.ts`
- Test: `apps/web/src/features/board/utils/reorder.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/features/board/utils/reorder.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { Lane } from "@acme/db/schema";

import { moveItemToLane, ordersEqual } from "./reorder";

function order(partial: Partial<Record<Lane, string[]>>): Record<Lane, string[]> {
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

  it("同一レーン内で位置を変える（削除してから挿入）", () => {
    const base = order({ inbox: ["a", "b", "c"] });
    const next = moveItemToLane(base, "a", "inbox", 2);
    expect(next.inbox).toEqual(["b", "a", "c"]);
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
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm -F @acme/web test reorder`
Expected: FAIL（`./reorder` が存在しない / `moveItemToLane is not a function`）

- [ ] **Step 3: 実装を書く**

`apps/web/src/features/board/utils/reorder.ts`:

```ts
import type { Lane } from "@acme/db/schema";
import { LANES } from "@acme/db/schema";

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
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm -F @acme/web test reorder`
Expected: PASS（6 件）

- [ ] **Step 5: コミット**

```bash
git add apps/web/src/features/board/utils/reorder.ts apps/web/src/features/board/utils/reorder.test.ts
git commit -m "feat(board): add lane-order helpers for cross-lane drag preview"
```

---

## Task 2: サービス層 `move` が position を受け取る

**Files:**
- Modify: `packages/api/src/service/task.ts:25-33`（`MoveTaskInput`）
- Modify: `packages/api/src/service/task.ts:117-150`（`move`）

- [ ] **Step 1: 入力スキーマに position を追加**

[packages/api/src/service/task.ts:25-33](../../../packages/api/src/service/task.ts#L25-L33) の `MoveTaskInput` を次に置き換える:

```ts
export const MoveTaskInput = z.object({
  id: z.string(),
  lane: z.enum(LANES),
  /** undefined=変更しない / null=クリア / Date=設定 */
  startAt: z.date().nullish(),
  /** undefined=変更しない / null=クリア / Date=設定（工数の終端） */
  endAt: z.date().nullish(),
  /** カラム内の挿入位置（クライアントが前後の中間値を計算して渡す）。未指定なら末尾/Done は先頭 */
  position: z.number().optional(),
});
export type MoveTaskInput = z.infer<typeof MoveTaskInput>;
```

- [ ] **Step 2: `move` で position を尊重**

[packages/api/src/service/task.ts:117-150](../../../packages/api/src/service/task.ts#L117-L150) の `move` を次に置き換える:

```ts
  /** レーン移動（D&D）。position 指定があればその位置へ、無ければ末尾（Done は先頭）へ */
  async move(input: MoveTaskInput) {
    const position =
      input.position ??
      (input.lane === "done"
        ? await firstPosition(input.lane)
        : await nextPosition(input.lane));
    const values: {
      lane: Lane;
      position: number;
      startAt?: Date | null;
      endAt?: Date | null;
    } = {
      lane: input.lane,
      position,
    };
    // startAt / endAt は三値規約でマージ（undefined は据え置き）
    applyPatch(values, { startAt: input.startAt, endAt: input.endAt });

    // Schedule へ時刻付きで入れる際、工数(endAt)未指定なら既定1時間を補完
    if (
      input.lane === "schedule" &&
      input.startAt instanceof Date &&
      input.endAt === undefined
    ) {
      values.endAt = new Date(input.startAt.getTime() + DEFAULT_DURATION_MS);
    }

    const [row] = await db
      .update(Task)
      .set(values)
      .where(eq(Task.id, input.id))
      .returning();
    return row;
  },
```

- [ ] **Step 3: 型チェック**

Run: `pnpm -F @acme/api typecheck`
Expected: PASS（エラーなし）

- [ ] **Step 4: コミット**

```bash
git add packages/api/src/service/task.ts
git commit -m "feat(api): accept optional position in task move"
```

---

## Task 3: 楽観的更新 `applyMove` が position を尊重

**Files:**
- Modify: `apps/web/src/features/board/api/mutations.ts:64-83`

- [ ] **Step 1: `applyMove` を書き換える**

[mutations.ts:64-83](../../../apps/web/src/features/board/api/mutations.ts#L64-L83) の `applyMove` を次に置き換える:

```ts
/** レーン移動。position 指定があればそれを反映、無ければ Done は先頭・他は据え置き。時刻は三値規約でマージ */
function applyMove(list: Task[], vars: MoveVars): Task[] {
  const doneFallback =
    vars.lane === "done"
      ? Math.min(0, ...list.filter((t) => t.lane === "done").map((t) => t.position)) - 1
      : undefined;
  const targetPosition = vars.position ?? doneFallback;
  return list
    .map((task) =>
      task.id === vars.id
        ? {
            ...task,
            lane: vars.lane,
            position: targetPosition ?? task.position,
            startAt: mergeNullable(task.startAt, vars.startAt),
            endAt: mergeNullable(task.endAt, vars.endAt),
          }
        : task,
    )
    .sort(byLaneThenPosition);
}
```

- [ ] **Step 2: 型チェック**

Run: `pnpm -F @acme/web typecheck`
Expected: PASS（`MoveVars` に `position` が含まれることを確認。Task 2 のスキーマ変更により `RouterInputs["task"]["move"]` へ自動伝播する）

- [ ] **Step 3: コミット**

```bash
git add apps/web/src/features/board/api/mutations.ts
git commit -m "feat(board): honor explicit position in optimistic move"
```

---

## Task 4: DnD フックにライブプレビューを実装

**Files:**
- Modify: `apps/web/src/features/board/hooks/useBoardDnd.ts`（全面）

このタスクはフック全体を書き換える。下記の内容で [useBoardDnd.ts](../../../apps/web/src/features/board/hooks/useBoardDnd.ts) を置き換える。

- [ ] **Step 1: フックを書き換える**

`apps/web/src/features/board/hooks/useBoardDnd.ts` の全内容を次に置き換える:

```ts
"use client";

import type {
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import { useState } from "react";
import { PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";

import type { Lane } from "@acme/db/schema";
import { LANES } from "@acme/db/schema";

import type { Task } from "../types/task";
import { positionBetween } from "../utils/position";
import type { LaneOrder } from "../utils/reorder";
import { moveItemToLane, ordersEqual } from "../utils/reorder";
import {
  clampDayMinutes,
  dateAtMinutesOfDay,
  durationMinutes,
  minutesOfDay,
  pxToMinutes,
  shiftMinutes,
  snapMinutes,
} from "../utils/schedule";

export interface MoveArgs {
  id: string;
  lane: Lane;
  startAt?: Date | null;
  endAt?: Date | null;
  position?: number;
}
export interface ReorderArgs {
  id: string;
  position: number;
}

interface Params {
  /** レーン移動（lane / 時刻 / 工数 / position の変更） */
  onMove: (args: MoveArgs) => void;
  /** 同一カラム内の並び替え */
  onReorder: (args: ReorderArgs) => void;
  /** id からタスクを引くためのマップ */
  tasksById: Map<string, Task>;
  /** レーンごとの表示順 id 配列（position 昇順） */
  laneOrder: LaneOrder;
}

/** ライブプレビュー（中間挿入）の対象となるカラムレーン。schedule は時刻が状態のため除外 */
const COLUMN_LANES: Lane[] = ["inbox", "in_progress", "done"];

/** active カードの中心 Y が over カードの中心より下なら true（= over の後ろへ挿入） */
function isBelowOverItem(event: DragOverEvent): boolean {
  const activeRect = event.active.rect.current.translated;
  const overRect = event.over?.rect;
  if (!activeRect || !overRect) return false;
  return (
    activeRect.top + activeRect.height / 2 > overRect.top + overRect.height / 2
  );
}

/** order 上で id が属するレーンを返す（無ければ undefined） */
function laneOf(order: LaneOrder, id: string): Lane | undefined {
  return LANES.find((lane) => order[lane].includes(id));
}

/**
 * ボードの D&D の振る舞い。
 *
 * - 同一カラム内の並び替えは dnd-kit 組み込みの sortable に任せ、`onDragEnd` で確定する。
 * - 別カラムへの移動は `onDragOver` で `previewOrder`（ドラッグ中だけの表示順 override）へ
 *   差し込み、ライブプレビュー（移動先カードが隙間を空ける）を出す。
 * - Schedule レーンは対象外。`lane:schedule` への/からのドロップは時刻ロジック（既存）で扱う。
 *
 * ドロップ先 id の規約:
 *  - `lane:schedule` … Schedule グリッド（時刻配置 / 縦移動）
 *  - `lane:<lane>` … カラムの空きエリア（末尾へ）
 *  - 上記以外（タスク id）… そのカードの前後へ挿入
 */
export function useBoardDnd({
  onMove,
  onReorder,
  tasksById,
  laneOrder,
}: Params) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [previewOrder, setPreviewOrder] = useState<LaneOrder | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  /** プレビュー適用後の表示順（ドラッグ中以外は素の laneOrder） */
  const displayOrder = previewOrder ?? laneOrder;

  const handleDragStart = (event: DragStartEvent) =>
    setActiveId(String(event.active.id));

  const handleDragCancel = () => {
    setActiveId(null);
    setPreviewOrder(null);
  };

  /** クロスレーン移動だけを previewOrder へ反映（同一レーン内は組み込み sortable に任せる） */
  const handleDragOver = (event: DragOverEvent) => {
    if (!event.over) return;
    const id = String(event.active.id);
    const over = String(event.over.id);

    const activeTask = tasksById.get(id);
    if (!activeTask || activeTask.lane === "schedule") return; // schedule ドラッグは対象外

    const base = previewOrder ?? laneOrder;
    const fromLane = laneOf(base, id) ?? activeTask.lane;

    let toLane: Lane;
    let toIndex: number;
    if (over.startsWith("lane:")) {
      const lane = over.slice(5) as Lane;
      if (!COLUMN_LANES.includes(lane)) return; // schedule droppable など
      toLane = lane;
      toIndex = base[lane].length; // 空きエリア → 末尾
    } else {
      const overLane = laneOf(base, over);
      if (!overLane || !COLUMN_LANES.includes(overLane)) return;
      toLane = overLane;
      toIndex = base[overLane].indexOf(over) + (isBelowOverItem(event) ? 1 : 0);
    }

    if (toLane === fromLane) return; // 同一レーン内は触らない

    const next = moveItemToLane(base, id, toLane, toIndex);
    if (ordersEqual(next, base)) return; // 変化なしなら再レンダーしない
    setPreviewOrder(next);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const preview = previewOrder;
    setActiveId(null);
    setPreviewOrder(null);

    const id = String(event.active.id);
    const over = event.over ? String(event.over.id) : null;
    if (!over || over === id) return;

    const activeTask = tasksById.get(id);
    if (!activeTask) return;

    if (over === "lane:schedule") {
      // カレンダー予定は時間変更不可。Schedule 内では何もせず、他レーンからは時刻を保持して戻す
      if (activeTask.source === "calendar") {
        if (activeTask.lane !== "schedule") onMove({ id, lane: "schedule" });
        return;
      }
      // 既に Schedule 上のブロック → 縦ドラッグ量で再配置（工数=高さは維持）
      if (activeTask.lane === "schedule" && activeTask.startAt) {
        const deltaMin = pxToMinutes(event.delta.y);
        const nextMin = clampDayMinutes(
          snapMinutes(minutesOfDay(activeTask.startAt) + deltaMin),
        );
        const duration = durationMinutes(
          activeTask.startAt,
          activeTask.endAt ?? null,
        );
        const newStart = dateAtMinutesOfDay(nextMin, activeTask.startAt);
        onMove({
          id,
          lane: "schedule",
          startAt: newStart,
          endAt: shiftMinutes(newStart, duration),
        });
        return;
      }
      // 他カラムから Schedule へ → ドロップされた Y 位置の時刻にスナップして配置
      const overRect = event.over?.rect;
      const activeRect = event.active.rect.current.translated;
      const dropMin =
        overRect && activeRect
          ? clampDayMinutes(
              snapMinutes(pxToMinutes(activeRect.top - overRect.top)),
            )
          : clampDayMinutes(snapMinutes(minutesOfDay(new Date())));
      onMove({ id, lane: "schedule", startAt: dateAtMinutesOfDay(dropMin) });
      return;
    }

    // Schedule ブロックを列へドロップ → 末尾へ（中間挿入は対象外）
    if (activeTask.lane === "schedule") {
      if (over.startsWith("lane:")) {
        const lane = over.slice(5) as Lane;
        if (COLUMN_LANES.includes(lane)) {
          onMove({ id, lane, startAt: lane === "inbox" ? null : undefined });
        }
        return;
      }
      const overTask = tasksById.get(over);
      if (overTask && overTask.lane !== "schedule") {
        onMove({
          id,
          lane: overTask.lane,
          startAt: overTask.lane === "inbox" ? null : undefined,
        });
      }
      return;
    }

    // --- カラムレーン間: previewOrder を基に最終位置を確定 ---
    const base = preview ?? laneOrder;
    const finalLane = laneOf(base, id) ?? activeTask.lane;
    let ids = [...base[finalLane]];

    // over がそのレーンのカードなら arrayMove で最終インデックスを確定（同一レーン並び替え相当）
    if (tasksById.has(over) && base[finalLane].includes(over)) {
      const oldIndex = ids.indexOf(id);
      const newIndex = ids.indexOf(over);
      if (oldIndex !== -1 && newIndex !== -1) {
        ids = arrayMove(ids, oldIndex, newIndex);
      }
    }
    // over が "lane:<col>"（空きエリア）なら preview の注入位置（末尾）のまま

    // 同一レーンで並びが変わっていなければ何もしない
    if (
      finalLane === activeTask.lane &&
      ids.every((x, i) => x === laneOrder[finalLane][i])
    ) {
      return;
    }

    const pos = ids.indexOf(id);
    const beforeId = ids[pos - 1];
    const afterId = ids[pos + 1];
    const before = beforeId
      ? (tasksById.get(beforeId)?.position ?? null)
      : null;
    const after = afterId ? (tasksById.get(afterId)?.position ?? null) : null;
    const position = positionBetween(before, after);

    if (finalLane === activeTask.lane) {
      onReorder({ id, position });
    } else {
      onMove({
        id,
        lane: finalLane,
        position,
        startAt: finalLane === "inbox" ? null : undefined,
      });
    }
  };

  return {
    activeId,
    sensors,
    displayOrder,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  };
}
```

- [ ] **Step 2: 型チェック**

Run: `pnpm -F @acme/web typecheck`
Expected: FAIL（[Board.tsx](../../../apps/web/src/features/board/components/Board.tsx) がまだ `handleDragOver` / `displayOrder` を使っておらず、`onMove` の型が更新される。Board は Task 5 で修正する）。フック自身に起因する型エラーが無いことだけ確認する。

> 注: Board の修正前なので typecheck は Board 由来のエラーで失敗してよい。フック単体の型崩れ（`moveItemToLane` の引数不一致など）が無いことを確認する。

- [ ] **Step 3: コミット**

```bash
git add apps/web/src/features/board/hooks/useBoardDnd.ts
git commit -m "feat(board): live cross-lane drag preview in useBoardDnd"
```

---

## Task 5: Board をプレビュー順で描画し onDragOver を接続

**Files:**
- Modify: `apps/web/src/features/board/components/Board.tsx`

- [ ] **Step 1: フックの返り値を受け取り onDragOver を分割代入に追加**

[Board.tsx:67-78](../../../apps/web/src/features/board/components/Board.tsx#L67-L78) の `useBoardDnd` 呼び出しブロックを次に置き換える:

```tsx
  const {
    activeId,
    sensors,
    displayOrder,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  } = useBoardDnd({
    onMove: (args) => move.mutate(args),
    onReorder: (args) => reorder.mutate(args),
    tasksById,
    laneOrder,
  });

  /** displayOrder（プレビュー反映後）の id 列を Task に解決する */
  const columnTasks = (lane: Lane): Task[] =>
    displayOrder[lane]
      .map((id) => tasksById.get(id))
      .filter((t): t is Task => t !== undefined);
```

- [ ] **Step 2: `Task` 型を import に追加**

[Board.tsx:6](../../../apps/web/src/features/board/components/Board.tsx#L6) の `import type { Lane } from "@acme/db/schema";` の直後に追加する:

```tsx
import type { Task } from "../types/task";
```

- [ ] **Step 3: `DndContext` に `onDragOver` を接続**

[Board.tsx:106-111](../../../apps/web/src/features/board/components/Board.tsx#L106-L111) の `<DndContext ...>` を次に置き換える:

```tsx
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
```

- [ ] **Step 4: 3カラムを `columnTasks(...)` で描画**

[Board.tsx:113-137](../../../apps/web/src/features/board/components/Board.tsx#L113-L137) の3つの `<BoardColumn>` の `tasks` prop を差し替える（Schedule は従来どおり `groups.schedule`）:

- `tasks={groups.inbox}` → `tasks={columnTasks("inbox")}`
- `tasks={groups.in_progress}` → `tasks={columnTasks("in_progress")}`
- `tasks={groups.done}` → `tasks={columnTasks("done")}`

具体的には次の3箇所:

```tsx
          <BoardColumn
            lane="inbox"
            title="Todo"
            tasks={columnTasks("inbox")}
            onOpenTask={setSelectedTaskId}
            footer={<AddTodoForm />}
          />
```

```tsx
          <BoardColumn
            lane="in_progress"
            title="In Progress"
            tasks={columnTasks("in_progress")}
            onOpenTask={setSelectedTaskId}
          />
```

```tsx
          <BoardColumn
            lane="done"
            title="Done"
            tasks={columnTasks("done")}
            onOpenTask={setSelectedTaskId}
          />
```

- [ ] **Step 5: 型チェック**

Run: `pnpm -F @acme/web typecheck`
Expected: PASS（エラーなし）

- [ ] **Step 6: コミット**

```bash
git add apps/web/src/features/board/components/Board.tsx
git commit -m "feat(board): render columns from drag preview order"
```

---

## Task 6: 品質ゲートと手動確認

**Files:** なし（検証のみ）

- [ ] **Step 1: ユニットテスト全実行**

Run: `pnpm -F @acme/web test`
Expected: PASS（`reorder` / `position` / `schedule` / `autoAdvance` 含め全て緑）

- [ ] **Step 2: 型・Lint・Format・Build**

Run:
```bash
pnpm typecheck
pnpm lint
pnpm format
pnpm -F @acme/web build
```
Expected: いずれもエラーなし（format で差分が出たら `pnpm format:fix` 後に再確認しコミット）

- [ ] **Step 3: 手動確認（`nvm use` 後 `pnpm dev:next` → http://localhost:3000）**

次を目視で確認する:
1. Todo → In Progress のカード2枚の**間**にドラッグすると、ドラッグ中に隙間が開き（ライブプレビュー）、ドロップでその位置に入る。
2. ドロップ後にカードが一瞬元の位置へ飛ばない（楽観的更新と確定 position が一致）。
3. 同一カラム内の並び替えが従来どおり動く。
4. Done へのドロップで任意位置に差し込める（中間・先頭・末尾）。
5. Schedule への/からのドラッグ（時刻配置・縦リサイズ・列への移動）が従来どおり壊れていない。
6. リロード後も並び順が保持される（DB に反映）。

- [ ] **Step 4: メモリ更新（任意）**

[next-steps-card-sort](memory) の「次タスク」が完了した旨を反映、または削除する。

- [ ] **Step 5: 完了コミット（差分があれば）**

```bash
git add -A
git commit -m "chore(board): finalize cross-lane drag insert"
```

---

## Self-Review メモ

- **Spec カバレッジ**: position 契約(Task2) / 楽観更新(Task3) / preview+onDragOver+onDragEnd(Task4) / displayOrder 描画(Task5) / Schedule 除外(Task4 の早期 return) / テスト(Task1, Task6) — スペック各項目に対応タスクあり。
- **型整合**: `MoveArgs.position?`（Task4）↔ `MoveTaskInput.position`（Task2）↔ `MoveVars.position`（Task3, 自動伝播）。`LaneOrder` 型は reorder.ts(Task1) で定義しフック(Task4)で import。`displayOrder` はフックが返し Board(Task5) が消費。
- **同一レーン並び替え**: onDragOver では触らず（組み込み sortable）、onDragEnd の arrayMove で確定 — off-by-one を回避。
- **Schedule**: active が schedule の onDragOver は早期 return、onDragEnd は既存ロジック維持で回帰なし。
