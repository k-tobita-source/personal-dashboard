# Schedule クイック追加 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Schedule レーンの空き時間をクリック／上下ドラッグして、その場の Popover からタスク（タイトル＋時刻範囲＋本文）を作成できるようにする。

**Architecture:** 背景の pointer 操作を `useScheduleSelection` フックに隔離し、純粋な範囲計算は `selectionToRange` util に置く。`ScheduleColumn` は選択ゴースト矩形と Radix Popover アンカーを描画するだけ。作成フォームは `ScheduleQuickAdd` に分離し、既存の `useCreateTask` を使う。終了時刻を作成時に渡せるよう、サービス層の `create` 契約に `endAt` を追加する。

**Tech Stack:** Next.js / React 19 / TypeScript / tRPC + TanStack Query / Radix UI (`radix-ui` umbrella) / Vitest / dnd-kit（既存）。

## Global Constraints

- Node 22 系（`.nvmrc` = 22.21.0）。作業前に `nvm use`。
- pnpm 10 / TypeScript 5.9。パッケージ名は `@acme/*`。
- ファイル名: `.tsx` は PascalCase、`.ts` は camelCase、フックは `use` プレフィックス、定数は UPPER_SNAKE_CASE。
- 手動 memo は入れない（React Compiler 方針）。
- `startAt`/`endAt` は三値規約（undefined=据え置き / null=クリア / Date=設定）。
- ビジネスロジックはルーターでなく service 層へ。入力スキーマも service 層に置く。
- 品質チェック（PR 前に全通過）: `pnpm typecheck` / `pnpm lint` / `pnpm format` / `pnpm -F @acme/web build`。
- DB スキーマ変更なし → マイグレーション不要。

---

### Task 1: `create` 契約に `endAt` を追加

**Files:**
- Modify: `packages/api/src/service/task.ts:15-23`（`CreateTodoInput`）, `:103-117`（`taskService.create`）
- Test: `packages/api/src/service/task.test.ts`（新規）

**Interfaces:**
- Consumes: 既存の `CreateTodoInput`（`title`/`body`/`startAt`/`lane`）。
- Produces: `CreateTodoInput` に `endAt?: Date`。`taskService.create` は `endAt` を insert に渡す。

- [ ] **Step 1: 失敗するテストを書く**

`packages/api/src/service/task.test.ts` を新規作成:

```ts
import { describe, expect, it } from "vitest";

import { CreateTodoInput } from "./task";

describe("CreateTodoInput", () => {
  it("endAt（Date）を受け付ける", () => {
    const parsed = CreateTodoInput.parse({
      title: "会議",
      startAt: new Date("2026-06-17T10:00:00+09:00"),
      endAt: new Date("2026-06-17T11:00:00+09:00"),
    });
    expect(parsed.endAt).toBeInstanceOf(Date);
  });

  it("endAt は任意（省略可）", () => {
    const parsed = CreateTodoInput.parse({ title: "メモ" });
    expect(parsed.endAt).toBeUndefined();
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `pnpm -F @acme/api test -- task.test.ts`
Expected: FAIL（`endAt` が未知キーで剥がれ `toBeInstanceOf(Date)` が落ちる）

- [ ] **Step 3: `CreateTodoInput` に `endAt` を追加**

`packages/api/src/service/task.ts` の `CreateTodoInput` を修正（`startAt` の直後に追加）:

```ts
export const CreateTodoInput = z.object({
  title: z.string().min(1).max(512),
  body: z.string().max(2000).optional(),
  /** 指定時は Schedule への時刻確定タスクとして作成 */
  startAt: z.date().optional(),
  /** 工数の終端。startAt とセットで Schedule 作成時に使用 */
  endAt: z.date().optional(),
  /** 明示しない場合は startAt の有無で inbox/schedule を自動判定 */
  lane: z.enum(LANES).optional(),
});
```

- [ ] **Step 4: `taskService.create` で `endAt` を insert**

`packages/api/src/service/task.ts` の `create` の `.values({...})` に `endAt` を追加:

```ts
  async create(input: CreateTodoInput) {
    const lane = input.lane ?? (input.startAt ? "schedule" : "inbox");
    const [row] = await db
      .insert(Task)
      .values({
        source: "todo",
        lane,
        title: input.title,
        body: input.body,
        startAt: input.startAt,
        endAt: input.endAt,
        position: await nextPosition(lane),
      })
      .returning();
    return row;
  },
```

- [ ] **Step 5: テストを実行して成功を確認**

Run: `pnpm -F @acme/api test -- task.test.ts`
Expected: PASS（2 件）

- [ ] **Step 6: コミット**

```bash
git add packages/api/src/service/task.ts packages/api/src/service/task.test.ts
git commit -m "feat(api): accept endAt in task create input"
```

---

### Task 2: `selectionToRange` 純粋関数

**Files:**
- Modify: `apps/web/src/features/board/utils/schedule.ts`（末尾に関数追加）
- Test: `apps/web/src/features/board/utils/schedule.test.ts`（テスト追加）

**Interfaces:**
- Consumes: 既存 `clampDayMinutes`、定数 `DEFAULT_DURATION_MINUTES` / `MIN_DURATION_MINUTES`（schedule.ts で import 済み）。
- Produces: `selectionToRange(startMin: number, currentMin: number, isDrag: boolean): { startMin: number; endMin: number }`。

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/features/board/utils/schedule.test.ts` の import に `selectionToRange` を追加し、ファイル末尾に追記:

```ts
describe("selectionToRange", () => {
  it("クリック（isDrag=false）は開始から既定60分", () => {
    expect(selectionToRange(600, 600, false)).toEqual({
      startMin: 600,
      endMin: 660,
    });
  });

  it("ドラッグは下方向にそのまま範囲化", () => {
    expect(selectionToRange(600, 690, true)).toEqual({
      startMin: 600,
      endMin: 690,
    });
  });

  it("逆方向ドラッグは min/max で正規化", () => {
    expect(selectionToRange(690, 600, true)).toEqual({
      startMin: 600,
      endMin: 690,
    });
  });

  it("幅が15分未満なら最小15分にクランプ", () => {
    expect(selectionToRange(600, 605, true)).toEqual({
      startMin: 600,
      endMin: 615,
    });
  });

  it("日付末尾のクリックは当日内に収め endMin は最大1440", () => {
    expect(selectionToRange(1439, 1439, false)).toEqual({
      startMin: 1425,
      endMin: 1440,
    });
  });
});
```

import 行（既存の `from "./schedule"` ブロック）に `selectionToRange,` を追加すること。

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `pnpm -F @acme/web test -- schedule.test.ts`
Expected: FAIL（`selectionToRange is not a function`）

- [ ] **Step 3: `selectionToRange` を実装**

`apps/web/src/features/board/utils/schedule.ts` の末尾に追加:

```ts
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
  const minEnd = start + (isDrag ? MIN_DURATION_MINUTES : DEFAULT_DURATION_MINUTES);
  const end = Math.min(Math.max(hi, minEnd), dayEnd);
  return { startMin: start, endMin: end };
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `pnpm -F @acme/web test -- schedule.test.ts`
Expected: PASS（既存テスト + 新規 5 件）

- [ ] **Step 5: コミット**

```bash
git add apps/web/src/features/board/utils/schedule.ts apps/web/src/features/board/utils/schedule.test.ts
git commit -m "feat(board): add selectionToRange for schedule quick-add"
```

---

### Task 3: `@acme/ui` Popover コンポーネント

**Files:**
- Create: `packages/ui/src/popover.tsx`
- Modify: `packages/ui/package.json:5-15`（exports）

**Interfaces:**
- Consumes: `radix-ui` の `Popover` namespace、`@acme/ui` の `cn`。
- Produces: `Popover` / `PopoverAnchor` / `PopoverTrigger` / `PopoverContent` を named export（`@acme/ui/popover`）。

- [ ] **Step 1: `popover.tsx` を作成**

`dropdown-menu.tsx` と同じ流儀でラップ:

```tsx
"use client";

import { Popover as PopoverPrimitive } from "radix-ui";

import { cn } from "@acme/ui";

export function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

export function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

export function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

export function PopoverContent({
  className,
  align = "start",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "bg-popover text-popover-foreground z-50 rounded-md border p-3 shadow-md outline-none",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
```

- [ ] **Step 2: package.json の exports に `./popover` を追加**

`packages/ui/package.json` の `exports` に 1 行追加（`./label` の後あたり、キー順は既存に倣う）:

```json
  "exports": {
    ".": "./src/index.ts",
    "./button": "./src/button.tsx",
    "./dropdown-menu": "./src/dropdown-menu.tsx",
    "./field": "./src/field.tsx",
    "./input": "./src/input.tsx",
    "./label": "./src/label.tsx",
    "./popover": "./src/popover.tsx",
    "./separator": "./src/separator.tsx",
    "./theme": "./src/theme.tsx",
    "./toast": "./src/toast.tsx"
  },
```

- [ ] **Step 3: 型チェックで検証**

Run: `pnpm -F @acme/ui typecheck`
Expected: エラーなし

- [ ] **Step 4: コミット**

```bash
git add packages/ui/src/popover.tsx packages/ui/package.json
git commit -m "feat(ui): add Popover wrapper over radix-ui"
```

---

### Task 4: `useScheduleSelection` フック

**Files:**
- Create: `apps/web/src/features/board/hooks/useScheduleSelection.ts`

**Interfaces:**
- Consumes: `PX_PER_MINUTE`（configs）、`clampDayMinutes` / `snapMinutes` / `selectionToRange`（utils, Task 2）。
- Produces: `useScheduleSelection(): { selection, draft, onBackgroundPointerDown, clear }`。
  - `selection: { startMin: number; endMin: number } | null` — 確定した範囲（Popover を開くトリガ）。
  - `draft: { startMin: number; endMin: number } | null` — ドラッグ中プレビュー（ゴースト矩形用、非ドラッグ中は null）。
  - `onBackgroundPointerDown(e: React.PointerEvent<HTMLDivElement>): void` — 背景 div に渡す。
  - `clear(): void` — `selection` を null に戻す。

- [ ] **Step 1: フックを作成**

`apps/web/src/features/board/hooks/useScheduleSelection.ts`:

```ts
"use client";

import { useEffect, useRef, useState } from "react";

import { PX_PER_MINUTE } from "../configs/board";
import { clampDayMinutes, selectionToRange, snapMinutes } from "../utils/schedule";

/** クリックとドラッグを区別する移動量しきい値(px) */
const DRAG_THRESHOLD_PX = 4;

export interface ScheduleSelection {
  startMin: number;
  endMin: number;
}

interface DragState {
  /** pointerdown 時点の背景要素 top（viewport 基準）。スクロールに追随する */
  top: number;
  startY: number;
  startMin: number;
  moved: boolean;
}

/**
 * Schedule グリッド背景上の pointer 操作から、作成する時間帯を導出する。
 * ScheduleBlock の resize と同じく useEffect で window listener を着脱する。
 * フックは「分」だけを扱い、Date 変換は描画/送信側に委ねて純粋性を保つ。
 */
export function useScheduleSelection() {
  const [selection, setSelection] = useState<ScheduleSelection | null>(null);
  const [draft, setDraft] = useState<ScheduleSelection | null>(null);
  const [active, setActive] = useState(false);
  const drag = useRef<DragState | null>(null);

  const minutesAt = (clientY: number, top: number) =>
    clampDayMinutes(snapMinutes((clientY - top) / PX_PER_MINUTE));

  const onBackgroundPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // 左ボタンかつ「背景そのもの」を掴んだときだけ開始（ブロック等の上は無視）
    if (e.button !== 0) return;
    if (e.currentTarget !== e.target) return;
    const rect = e.currentTarget.getBoundingClientRect();
    drag.current = {
      top: rect.top,
      startY: e.clientY,
      startMin: minutesAt(e.clientY, rect.top),
      moved: false,
    };
    setActive(true);
  };

  useEffect(() => {
    if (!active) return;
    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      if (Math.abs(ev.clientY - d.startY) >= DRAG_THRESHOLD_PX) d.moved = true;
      if (d.moved) {
        setDraft(selectionToRange(d.startMin, minutesAt(ev.clientY, d.top), true));
      }
    };
    const up = (ev: PointerEvent) => {
      const d = drag.current;
      setActive(false);
      setDraft(null);
      drag.current = null;
      if (!d) return;
      setSelection(
        selectionToRange(d.startMin, minutesAt(ev.clientY, d.top), d.moved),
      );
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [active]);

  const clear = () => setSelection(null);

  return { selection, draft, onBackgroundPointerDown, clear };
}
```

- [ ] **Step 2: 型チェックで検証**

Run: `pnpm -F @acme/web typecheck`
Expected: エラーなし（フックはまだ未使用だが import 整合を確認）

- [ ] **Step 3: コミット**

```bash
git add apps/web/src/features/board/hooks/useScheduleSelection.ts
git commit -m "feat(board): add useScheduleSelection pointer hook"
```

---

### Task 5: `ScheduleQuickAdd` フォーム

**Files:**
- Create: `apps/web/src/features/board/components/ScheduleQuickAdd.tsx`

**Interfaces:**
- Consumes: `useCreateTask`（mutations）、`dateAtMinutesOfDay`（utils）、`MIN_DURATION_MINUTES`（configs）、`Button` / `Input`（@acme/ui）。
- Produces: `ScheduleQuickAdd({ selection, now, onCreated, onCancel })` コンポーネント。
  - `selection: { startMin: number; endMin: number }`
  - `now: Date`、`onCreated(): void`、`onCancel(): void`

- [ ] **Step 1: コンポーネントを作成**

`apps/web/src/features/board/components/ScheduleQuickAdd.tsx`:

```tsx
"use client";

import { useState } from "react";

import { Button } from "@acme/ui/button";
import { Input } from "@acme/ui/input";

import { MIN_DURATION_MINUTES } from "../configs/board";
import { useCreateTask } from "../api/mutations";
import { dateAtMinutesOfDay } from "../utils/schedule";

/** 当日0:00起点の分を <input type="time"> 用の "HH:mm" に変換 */
function toTimeValue(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "HH:mm" を当日0:00起点の分に変換 */
function fromTimeValue(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

interface Props {
  selection: { startMin: number; endMin: number };
  now: Date;
  onCreated: () => void;
  onCancel: () => void;
}

/** Schedule の空き時間クリックで開く、その場のタスク作成フォーム */
export function ScheduleQuickAdd({ selection, now, onCreated, onCancel }: Props) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [startMin, setStartMin] = useState(selection.startMin);
  const [endMin, setEndMin] = useState(selection.endMin);
  const createTask = useCreateTask();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    // 開始≥終了は終了=開始+最小工数へ補正
    const end = endMin > startMin ? endMin : startMin + MIN_DURATION_MINUTES;
    createTask.mutate(
      {
        title: trimmed,
        body: body.trim() || undefined,
        startAt: dateAtMinutesOfDay(startMin, now),
        endAt: dateAtMinutesOfDay(end, now),
        lane: "schedule",
      },
      { onSuccess: () => onCreated() },
    );
  };

  return (
    <form onSubmit={handleSubmit} className="flex w-64 flex-col gap-2">
      <Input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="タイトル"
        className="h-8 text-sm"
      />
      <div className="flex items-center gap-1 text-sm tabular-nums">
        <input
          type="time"
          step={900}
          value={toTimeValue(startMin)}
          onChange={(e) => setStartMin(fromTimeValue(e.target.value))}
          className="rounded-md border border-gray-300 bg-transparent px-1 py-0.5"
        />
        <span className="text-muted-foreground">–</span>
        <input
          type="time"
          step={900}
          value={toTimeValue(endMin)}
          onChange={(e) => setEndMin(fromTimeValue(e.target.value))}
          className="rounded-md border border-gray-300 bg-transparent px-1 py-0.5"
        />
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="メモ（任意）"
        className="focus:ring-ring w-full resize-y rounded-md border border-gray-300 bg-transparent px-2 py-1.5 text-sm focus:ring-2 focus:outline-none"
      />
      <div className="flex justify-end gap-1">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          キャンセル
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={!title.trim() || createTask.isPending}
        >
          作成
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: 型チェックで検証**

Run: `pnpm -F @acme/web typecheck`
Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add apps/web/src/features/board/components/ScheduleQuickAdd.tsx
git commit -m "feat(board): add ScheduleQuickAdd popover form"
```

---

### Task 6: `ScheduleColumn` へ配線（選択ゴースト＋Popover）

**Files:**
- Modify: `apps/web/src/features/board/components/ScheduleColumn.tsx`

**Interfaces:**
- Consumes: `useScheduleSelection`（Task 4）、`ScheduleQuickAdd`（Task 5）、`Popover` / `PopoverAnchor` / `PopoverContent`（Task 3）、既存 `topPx` / `heightPx`（utils）、`TIME_GUTTER_PX`（configs）。
- Produces: 背景クリック／ドラッグでの作成 UI（外部 props 変更なし。`now` は既存 props を流用）。

- [ ] **Step 1: import と装飾レイヤの pointer 透過を追加**

`apps/web/src/features/board/components/ScheduleColumn.tsx` の import 群に追加:

```tsx
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@acme/ui/popover";

import { useScheduleSelection } from "../hooks/useScheduleSelection";
import { heightPx, minutesOfDay, topPx } from "../utils/schedule";
import { ScheduleQuickAdd } from "./ScheduleQuickAdd";
```

※ 既存の `import { minutesOfDay } from "../utils/schedule";` は上の行に統合し、重複 import を残さないこと。

時間目盛りの装飾 div（`HOURS.map` 内の className）に `pointer-events-none` を足し、クリックを背景へ通す:

```tsx
            className="text-muted-foreground pointer-events-none absolute left-0 w-full border-t text-[10px] tabular-nums"
```

- [ ] **Step 2: フックを呼び、背景 div にハンドラを付ける**

`ScheduleColumn` 関数の冒頭（`useDroppable` の近く）に追加:

```tsx
  const { selection, draft, onBackgroundPointerDown, clear } =
    useScheduleSelection();
```

`setNodeRef` を付けている relative な div に `onPointerDown` を付与:

```tsx
        <div
          ref={setNodeRef}
          onPointerDown={onBackgroundPointerDown}
          className={cn("relative", isOver && "bg-primary/5")}
          style={{ height: HOURS.length * PX_PER_HOUR }}
        >
```

- [ ] **Step 3: ドラッグ中のゴースト矩形を描画**

`{blocks.map(...)}` の直後（同じ relative div 内）に追加:

```tsx
          {/* ドラッグ選択中のプレビュー矩形 */}
          {draft && (
            <div
              className="bg-primary/15 border-primary/40 pointer-events-none absolute rounded-[4px] border"
              style={{
                left: TIME_GUTTER_PX,
                right: 4,
                top: topPx(dateAtMinutesOfDay(draft.startMin, now)),
                height: heightPx(draft.endMin - draft.startMin),
              }}
            />
          )}
```

`dateAtMinutesOfDay` を import に追加（Step 1 の utils import に含める）:

```tsx
import {
  dateAtMinutesOfDay,
  heightPx,
  minutesOfDay,
  topPx,
} from "../utils/schedule";
```

- [ ] **Step 4: Popover アンカー＋コンテンツを描画**

同じ relative div 内、ゴースト矩形の後に追加:

```tsx
          {/* クリック/ドラッグ確定で開く作成 Popover */}
          <Popover
            open={selection !== null}
            onOpenChange={(open) => {
              if (!open) clear();
            }}
          >
            {selection && (
              <PopoverAnchor
                className="pointer-events-none absolute"
                style={{
                  left: TIME_GUTTER_PX,
                  top: topPx(dateAtMinutesOfDay(selection.startMin, now)),
                  height: heightPx(selection.endMin - selection.startMin),
                  width: 1,
                }}
              />
            )}
            <PopoverContent align="start" side="right">
              {selection && (
                <ScheduleQuickAdd
                  selection={selection}
                  now={now}
                  onCreated={clear}
                  onCancel={clear}
                />
              )}
            </PopoverContent>
          </Popover>
```

※ `PopoverAnchor` は `style` を渡すため `asChild` ではなく素の DOM を内部に持つラッパとして使う。Radix の `Anchor` は子要素が無い場合 `span` を描画するので `style`/`className` がそのまま乗る。

- [ ] **Step 5: 型チェック・lint・format**

Run: `pnpm -F @acme/web typecheck && pnpm lint && pnpm format`
Expected: いずれもエラーなし（format は差分があれば `pnpm format:fix`）

- [ ] **Step 6: ビルド確認**

Run: `pnpm -F @acme/web build`
Expected: ビルド成功

- [ ] **Step 7: 手動確認**

Run: `pnpm dev:next` → http://localhost:3000
確認項目:
1. Schedule の空き時間を**クリック** → その時刻を開始に Popover が開き、開始〜+60分が入っている。
2. 空き時間を**上下ドラッグ** → ドラッグ中に矩形プレビューが出て、離すとその範囲で Popover が開く。
3. タイトル＋（必要なら時刻調整・本文）→「作成」→ Schedule にブロックが現れる。
4. 外側クリック / Esc /「キャンセル」で作成せず閉じる。
5. 既存ブロックのクリック（ドロワー）・D&D・下端リサイズが従来どおり動く。

- [ ] **Step 8: コミット**

```bash
git add apps/web/src/features/board/components/ScheduleColumn.tsx
git commit -m "feat(board): empty-slot click/drag to quick-add schedule task"
```

---

## 完了条件

- 全タスクのテスト・型チェック・lint・format・build が通る。
- 手動確認（Task 6 Step 7）の 1〜5 が満たされる。
- `git log` に Task 単位のコミットが並ぶ。
