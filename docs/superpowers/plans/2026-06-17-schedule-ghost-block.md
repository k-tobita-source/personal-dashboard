# Schedule ゴーストブロック Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 開始済み（in_progress）のスケジュールタスクを、終了時刻まで Schedule タイムラインに半透明のゴーストとして残す。

**Architecture:** 描画対象を純粋関数 `selectScheduleBlocks(tasks, now)` で `{ task, isGhost }[]` として導出し、`now` の毎分更新で終了時刻超過のゴーストを自然に消す。`ScheduleBlock` に `isGhost` を渡して dim 表示＋レーン D&D 無効化（同一 id 衝突回避）。追加 state・タイマーは不要。

**Tech Stack:** React (Next.js) / TypeScript / dnd-kit / Vitest / Tailwind。`@acme/web` パッケージ。

設計: [docs/superpowers/specs/2026-06-17-schedule-ghost-block-design.md](../specs/2026-06-17-schedule-ghost-block-design.md)

---

## File Structure

- `apps/web/src/features/board/utils/schedule.ts` — 既存の px/時刻計算 util。**追記**: `ScheduleCandidate` 型と `selectScheduleBlocks` 関数。
- `apps/web/src/features/board/utils/schedule.test.ts` — 既存テスト。**追記**: `selectScheduleBlocks` の describe ブロック。
- `apps/web/src/features/board/components/ScheduleBlock.tsx` — **修正**: `isGhost` prop（dim スタイル＋レーン D&D 無効化）。
- `apps/web/src/features/board/components/ScheduleColumn.tsx` — **修正**: props を `{ task, isGhost }[]` に変更し `ScheduleBlock` へ `isGhost` を渡す。
- `apps/web/src/features/board/components/Board.tsx` — **修正**: `groups.schedule` の代わりに `selectScheduleBlocks(tasks, now)` を渡す。

全コマンドはリポジトリルートから実行。作業前に `nvm use`（Node 22 系）。

---

## Task 1: `selectScheduleBlocks` 純粋関数とテスト

**Files:**
- Modify: `apps/web/src/features/board/utils/schedule.ts`
- Test: `apps/web/src/features/board/utils/schedule.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/features/board/utils/schedule.test.ts` の import 文を更新し、ファイル末尾にテストを追記する。

import 文（既存の `from "./schedule"` の import リストに `selectScheduleBlocks` を追加。`Lane` 型も使うため追加 import を先頭付近に置く）:

```ts
import type { Lane } from "@acme/db/schema";

import {
  clampDayMinutes,
  dateAtMinutesOfDay,
  durationMinutes,
  heightPx,
  minutesOfDay,
  pxToMinutes,
  selectScheduleBlocks,
  shiftMinutes,
  snapMinutes,
  topPx,
} from "./schedule";
```

ファイル末尾に追記:

```ts
describe("selectScheduleBlocks", () => {
  const now = new Date(2026, 5, 17, 12, 0); // 2026-06-17 12:00

  function cand(overrides: {
    id: string;
    lane: Lane;
    startAt?: Date | null;
    endAt?: Date | null;
  }) {
    return {
      id: overrides.id,
      lane: overrides.lane,
      startAt: overrides.startAt ?? null,
      endAt: overrides.endAt ?? null,
    };
  }

  it("schedule レーンで startAt があれば通常表示（isGhost=false）", () => {
    const t = cand({ id: "a", lane: "schedule", startAt: new Date(2026, 5, 17, 14, 0) });
    expect(selectScheduleBlocks([t], now)).toEqual([{ task: t, isGhost: false }]);
  });

  it("schedule レーンでも startAt が無ければ除外", () => {
    const t = cand({ id: "a", lane: "schedule", startAt: null });
    expect(selectScheduleBlocks([t], now)).toEqual([]);
  });

  it("in_progress で終了時刻 > now ならゴースト表示（isGhost=true）", () => {
    // 11:00開始 + endAt 13:00 -> 終了13:00 > 12:00
    const t = cand({
      id: "a",
      lane: "in_progress",
      startAt: new Date(2026, 5, 17, 11, 0),
      endAt: new Date(2026, 5, 17, 13, 0),
    });
    expect(selectScheduleBlocks([t], now)).toEqual([{ task: t, isGhost: true }]);
  });

  it("in_progress で終了時刻 <= now なら除外", () => {
    // 9:00開始 + endAt 10:00 -> 終了10:00 < 12:00
    const t = cand({
      id: "a",
      lane: "in_progress",
      startAt: new Date(2026, 5, 17, 9, 0),
      endAt: new Date(2026, 5, 17, 10, 0),
    });
    expect(selectScheduleBlocks([t], now)).toEqual([]);
  });

  it("endAt 無し in_progress は開始+60分まで表示（既定工数）", () => {
    // 11:30開始 -> 終了12:30 > 12:00 -> ゴースト
    const fresh = cand({ id: "a", lane: "in_progress", startAt: new Date(2026, 5, 17, 11, 30) });
    // 10:30開始 -> 終了11:30 < 12:00 -> 除外
    const old = cand({ id: "b", lane: "in_progress", startAt: new Date(2026, 5, 17, 10, 30) });
    expect(selectScheduleBlocks([fresh, old], now)).toEqual([{ task: fresh, isGhost: true }]);
  });

  it("in_progress でも startAt が無ければ除外", () => {
    const t = cand({ id: "a", lane: "in_progress", startAt: null });
    expect(selectScheduleBlocks([t], now)).toEqual([]);
  });

  it("inbox / done は対象外", () => {
    const inbox = cand({ id: "a", lane: "inbox", startAt: new Date(2026, 5, 17, 14, 0) });
    const done = cand({ id: "b", lane: "done", startAt: new Date(2026, 5, 17, 11, 0) });
    expect(selectScheduleBlocks([inbox, done], now)).toEqual([]);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `pnpm -F @acme/web test -- schedule.test.ts`
Expected: FAIL（`selectScheduleBlocks` が export されていない旨のエラー）

- [ ] **Step 3: 最小実装を書く**

`apps/web/src/features/board/utils/schedule.ts` の先頭に Task 型 import を追加:

```ts
import type { Task } from "../types/task";
```

（既存の `import { ... } from "../configs/board";` の下に置く）

ファイル末尾に追記:

```ts
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
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `pnpm -F @acme/web test -- schedule.test.ts`
Expected: PASS（`selectScheduleBlocks` の全 7 ケースが green）

- [ ] **Step 5: コミット**

```bash
git add apps/web/src/features/board/utils/schedule.ts apps/web/src/features/board/utils/schedule.test.ts
git commit -m "feat(board): selectScheduleBlocks for schedule ghost rendering"
```

---

## Task 2: `ScheduleBlock` に `isGhost` prop（dim ＋ レーン D&D 無効化）

**Files:**
- Modify: `apps/web/src/features/board/components/ScheduleBlock.tsx`

UI コンポーネントのため自動テストは無し（目視は Task 5）。

- [ ] **Step 1: Props に `isGhost` を追加**

`apps/web/src/features/board/components/ScheduleBlock.tsx` の `interface Props` を変更:

```ts
interface Props {
  task: Task;
  onOpen?: (id: string) => void;
  /** 伸縮確定時に新しい endAt を保存 */
  onResize: (id: string, endAt: Date) => void;
  /** 開始済み（in_progress）の残像表示。半透明＋レーン D&D 無効 */
  isGhost?: boolean;
}
```

関数シグネチャを変更:

```ts
export function ScheduleBlock({ task, onOpen, onResize, isGhost = false }: Props) {
```

- [ ] **Step 2: `useDraggable` の id をゴースト時に分離**

`const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });` を次に変更:

```ts
  // ゴースト（in_progress）は In Progress カラムの実カードと同一 task.id で
  // draggable が衝突するため、別 id で登録し listeners も無効化してレーン移動を封じる。
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: isGhost ? `ghost:${task.id}` : task.id,
  });
```

- [ ] **Step 3: dim スタイルを追加し、ゴースト時は drag listeners/attributes を外す**

ルート `<div>` の `className={cn(...)}` を次に変更（`isGhost` のスタイルと、`cursor-grab` をゴースト時に外す）:

```tsx
      className={cn(
        "bg-card text-foreground ring-border touch-none overflow-hidden rounded-[4px] border-l-4 px-2 py-1 text-xs ring-1",
        accentBorder(task),
        // 通常ブロックは掴めてホバーで明るくなる
        !isGhost && "hover:bg-muted/50 cursor-grab",
        // ゴーストは半透明＋落ち着いた背景で「動作中の残像」を表現
        isGhost && "bg-muted/40 cursor-pointer opacity-50",
        // ドラッグ中は DragOverlay が前面に出るので、元ブロックは薄く残す
        isDragging && "opacity-40",
      )}
```

同じ `<div>` の `{...attributes}` / `{...listeners}` をゴースト時は展開しないよう変更:

```tsx
      {...(isGhost ? {} : attributes)}
      {...(isGhost ? {} : listeners)}
```

`onPointerDown` ハンドラを変更（ゴースト時は listeners を呼ばない＝レーン移動しない。クリック判定用の位置記録は残す）:

```tsx
      onPointerDown={(e) => {
        // クリック判定用に押下位置を記録（resize ハンドルは stopPropagation 済み）
        downPos.current = { x: e.clientX, y: e.clientY };
        // 通常ブロックのみレーン D&D を起動。ゴーストは掴ませない。
        if (!isGhost) listeners?.onPointerDown?.(e);
      }}
```

（注: `onClick` の drawer オープン、`handleResizePointerDown` による下端リサイズは `task.id` を直接参照しており、ゴーストでもそのまま動作する。変更不要。）

- [ ] **Step 4: 型チェックで壊れていないことを確認**

Run: `pnpm -F @acme/web typecheck`
Expected: PASS（型エラー無し）

- [ ] **Step 5: コミット**

```bash
git add apps/web/src/features/board/components/ScheduleBlock.tsx
git commit -m "feat(board): isGhost styling and lane-drag disable on ScheduleBlock"
```

---

## Task 3: `ScheduleColumn` を `{ task, isGhost }[]` 受け取りに変更

**Files:**
- Modify: `apps/web/src/features/board/components/ScheduleColumn.tsx`

- [ ] **Step 1: import と Props を変更**

`apps/web/src/features/board/components/ScheduleColumn.tsx` の `import { minutesOfDay } from "../utils/schedule";` を変更:

```ts
import { minutesOfDay } from "../utils/schedule";
import type { ScheduleBlockItem } from "../utils/schedule";
```

`interface Props` の `tasks` を変更:

```ts
interface Props {
  blocks: ScheduleBlockItem[];
  now: Date;
  onOpenTask?: (id: string) => void;
  onResizeTask: (id: string, endAt: Date) => void;
}
```

関数の分割代入を変更:

```ts
export function ScheduleColumn({
  blocks,
  now,
  onOpenTask,
  onResizeTask,
}: Props) {
```

- [ ] **Step 2: 描画ループを `blocks` ベースに変更**

`{/* タスクブロック */}` 直後の `tasks.map(...)` ブロックを次に置き換え:

```tsx
          {/* タスクブロック（通常＋開始済みゴースト） */}
          {blocks.map(({ task, isGhost }) =>
            task.startAt ? (
              <ScheduleBlock
                key={task.id}
                task={task}
                isGhost={isGhost}
                onOpen={onOpenTask}
                onResize={onResizeTask}
              />
            ) : null,
          )}
```

- [ ] **Step 3: 型チェック**

Run: `pnpm -F @acme/web typecheck`
Expected: FAIL — `Board.tsx` が `tasks` prop を渡しているため `blocks` 不足のエラーが出る（Task 4 で解消）。`ScheduleColumn.tsx` 自体の構文エラーが無いことを確認する。

- [ ] **Step 4: コミット**

```bash
git add apps/web/src/features/board/components/ScheduleColumn.tsx
git commit -m "refactor(board): ScheduleColumn takes ScheduleBlockItem[] blocks"
```

---

## Task 4: `Board` で `selectScheduleBlocks` を配線

**Files:**
- Modify: `apps/web/src/features/board/components/Board.tsx`

- [ ] **Step 1: import を追加**

`apps/web/src/features/board/components/Board.tsx` の `import { groupByLane } from "../utils/groupTasks";` の下のブロックに `selectScheduleBlocks` を追加。既存の schedule import を次に変更:

```ts
import {
  clampDayMinutes,
  dateAtMinutesOfDay,
  minutesOfDay,
  selectScheduleBlocks,
  snapMinutes,
} from "../utils/schedule";
```

- [ ] **Step 2: ゴースト込みの描画リストを算出**

`const now = useNow();` の直後（`useAutoAdvance` 呼び出しの前後どちらでも可）に追加:

```ts
  // Schedule に描画するブロック（schedule の通常表示＋in_progress のゴースト）。
  // now 依存で終了時刻を過ぎたゴーストは自動的に外れる。
  const scheduleBlocks = useMemo(
    () => selectScheduleBlocks(tasks, now),
    [tasks, now],
  );
```

- [ ] **Step 3: `ScheduleColumn` の prop を差し替え**

`<ScheduleColumn>` の `tasks={groups.schedule}` を次に変更:

```tsx
          <ScheduleColumn
            blocks={scheduleBlocks}
            now={now}
            onOpenTask={setSelectedTaskId}
            onResizeTask={(id, endAt) => update.mutate({ id, endAt })}
          />
```

- [ ] **Step 4: 型チェックが通ることを確認**

Run: `pnpm -F @acme/web typecheck`
Expected: PASS（Task 3 で出ていたエラーが解消）

- [ ] **Step 5: コミット**

```bash
git add apps/web/src/features/board/components/Board.tsx
git commit -m "feat(board): render started tasks as schedule ghosts"
```

---

## Task 5: 品質チェックと目視確認

**Files:** なし（検証のみ）

- [ ] **Step 1: 全テスト**

Run: `pnpm -F @acme/web test`
Expected: PASS（既存＋新規テストすべて green）

- [ ] **Step 2: 型・Lint・Format・ビルド**

Run:
```bash
pnpm typecheck
pnpm lint
pnpm format
pnpm -F @acme/web build
```
Expected: いずれもエラー無し（`format` で差分が出たら `pnpm format:fix` 後に該当ファイルを commit）

- [ ] **Step 3: 目視確認（`pnpm dev:next` → http://localhost:3000）**

確認項目:
- Schedule のタスクが開始時刻に到達すると In Progress に入りつつ、Schedule 上では半透明のゴーストとして残る。
- ゴーストは終了時刻（calendar=endAt / その他=開始+60分）を過ぎると Schedule から消える（タスクは In Progress に残る）。
- ゴーストをクリックするとドロワーが開く。
- ゴーストの下端ドラッグで `endAt` を伸ばせ、伸ばすとゴーストの消える時刻も後ろにずれる。
- ゴーストをブロックごとドラッグしてもレーン移動が起きない（In Progress の実カードからは従来どおり移動できる）。

- [ ] **Step 4: 差分が出ていれば最終コミット**

```bash
git add -A && git commit -m "chore(board): format/lint fixes for schedule ghost block"
```
（差分が無ければスキップ）

---

## Self-Review 結果

- **Spec coverage:** 表示ルール=Task 1 / dim スタイル=Task 2 / クリック・リサイズ維持＝Task 2（既存ロジック流用、変更不要を明記）/ レーン D&D 無効化＝Task 2 / 配線=Task 3,4 / 検証=Task 5。spec の全項目をカバー。
- **Placeholder scan:** プレースホルダ無し。各ステップに実コードを記載。
- **Type consistency:** `selectScheduleBlocks` / `ScheduleBlockItem` / `ScheduleCandidate` / `isGhost` の名称・シグネチャを Task 1〜4 で一致させた。`ScheduleColumn` の prop は `tasks` → `blocks` に統一。
