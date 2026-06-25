# カンバン改修 実装計画（白基調・詳細ドロワー・Schedule可変高さ・ソートアニメ）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** レビュー指摘の4点（白基調デザイン化／タスク詳細ドロワー＋自動保存／Scheduleの工数連動・可変高さ＆伸縮／ソートのアニメーション）を実装する。

**Architecture:** フロントは feature ベース（`apps/web/src/features/board`）。ドメインロジックは `packages/api` の `taskService` に集約し tRPC ルーターは薄いラッパー。DB は単一 `task` テーブルで `body`/`startAt`/`endAt` は既存（**スキーマ変更なし**）。Schedule は「1時間バケツ」から「連続タイムグリッド＋絶対配置ブロック」へ作り替える。並び替えは dnd-kit `useSortable`+`SortableContext` で標準のレイアウトアニメーションを得る。

**Tech Stack:** Next.js 16 / React 19 / Tailwind v4（oklch テーマ変数）/ tRPC + TanStack Query / dnd-kit(core+sortable) / Drizzle + better-sqlite3 / Vitest（純関数のみ・新規導入）。

**設計ドキュメント:** [docs/superpowers/specs/2026-06-11-kanban-review-improvements-design.md](../specs/2026-06-11-kanban-review-improvements-design.md)

---

## ファイル構成（作成/変更の責務）

| ファイル | 区分 | 責務 |
|---------|------|------|
| `apps/web/vitest.config.ts` | 作成 | 純関数ユニットテストの実行設定（node 環境） |
| `apps/web/package.json` | 変更 | `vitest` devDep と `test` script 追加 |
| `tooling/tailwind/theme.css` | 変更 | ライトモードのテーマ変数を GitHub Primer 相当へ |
| `apps/web/src/features/board/configs/board.ts` | 変更 | グリッド定数（PX_PER_HOUR 等）追加 |
| `apps/web/src/features/board/utils/schedule.ts` | 変更 | 時刻⇔px・スナップ・duration の純関数群 |
| `apps/web/src/features/board/utils/schedule.test.ts` | 作成 | schedule 純関数のテスト |
| `apps/web/src/features/board/utils/position.ts` | 作成 | 並び替えの position 計算（純関数） |
| `apps/web/src/features/board/utils/position.test.ts` | 作成 | position 純関数のテスト |
| `packages/api/src/service/task.ts` | 変更 | `UpdateTaskInput`/`MoveTaskInput` に `endAt` 追加・サービス反映 |
| `apps/web/src/features/board/api/mutations.ts` | 変更 | `useUpdateTask`（楽観的）・`useReorderTask`（楽観的）追加 |
| `apps/web/src/features/board/hooks/useBoardDnd.ts` | 変更 | reorder/lane移動/schedule retime のドロップ解決 |
| `apps/web/src/features/board/components/TaskCard.tsx` | 変更 | `useDraggable`→`useSortable`、クリックで詳細を開く |
| `apps/web/src/features/board/components/BoardColumn.tsx` | 変更 | `SortableContext` でラップ |
| `apps/web/src/features/board/components/Board.tsx` | 変更 | `selectedTaskId` 状態・ドロワー描画・hook へ並び情報を渡す |
| `apps/web/src/features/board/components/TaskDrawer.tsx` | 作成 | 右スライドイン詳細ドロワー＋自動保存 |
| `apps/web/src/features/board/components/ScheduleColumn.tsx` | 変更 | 連続グリッド＋絶対配置ブロック |
| `apps/web/src/features/board/components/ScheduleBlock.tsx` | 作成 | Schedule タスク1件（高さ可変・下端リサイズ・ドラッグ移動） |

**スコープ外（YAGNI）:** 同時刻に重なる複数タスクの左右分割表示。ダークモードの再配色。リッチテキストエディタ。

---

## Task 1: Vitest 基盤（純関数のみ）

**Files:**
- Create: `apps/web/vitest.config.ts`
- Modify: `apps/web/package.json`
- Create: `apps/web/src/features/board/utils/smoke.test.ts`（疎通確認用・最後に削除）

- [ ] **Step 1: vitest を devDependencies に追加**

`apps/web/package.json` の `devDependencies` に1行追加（末尾、`typescript` の後）:

```jsonc
    "typescript": "catalog:",
    "vitest": "^3.2.0"
```

- [ ] **Step 2: test スクリプトを追加**

`apps/web/package.json` の `scripts` に追加（`typecheck` の後ろ）:

```jsonc
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
```

- [ ] **Step 3: 依存をインストール**

Run: `pnpm install`
Expected: 成功し `vitest` が解決される。

- [ ] **Step 4: vitest 設定を作成**

`apps/web/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

// 純関数のユニットテストのみを対象とする最小構成（DOM/React は対象外）。
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: 疎通用の smoke テストを作成**

`apps/web/src/features/board/utils/smoke.test.ts`:

```ts
import { expect, it } from "vitest";

it("vitest runs", () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 6: テストを実行して通ることを確認**

Run: `pnpm -F @acme/web test`
Expected: PASS（1 passed）。

- [ ] **Step 7: smoke テストを削除**

Run: `rm apps/web/src/features/board/utils/smoke.test.ts`

- [ ] **Step 8: コミット**

```bash
git add apps/web/package.json apps/web/vitest.config.ts pnpm-lock.yaml
git commit -m "test: 純関数向けに Vitest を導入"
```

---

## Task 2: 白基調デザイン（GitHubライトモード風）

**Files:**
- Modify: `tooling/tailwind/theme.css:1-49`（`:root` のライトモード変数。`@variant dark` ブロックは変更しない）

ライトモード変数を GitHub Primer 相当の oklch 値へ差し替える。`@theme inline`（101行〜）とコンポーネントは変数参照なので変更不要。

- [ ] **Step 1: `:root` のライトモード変数を置換**

`tooling/tailwind/theme.css` の2〜33行目（`--background` 〜 `--sidebar-ring`）を以下へ置き換える（`--radius` 以降は据え置き、`@variant dark` も据え置き）:

```css
  /* GitHub ライトモード(Primer)相当の白基調パレット */
  --background: oklch(1 0 0); /* #ffffff */
  --foreground: oklch(0.2435 0.0086 248); /* #1f2328 */
  --card: oklch(1 0 0); /* #ffffff */
  --card-foreground: oklch(0.2435 0.0086 248);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.2435 0.0086 248);
  --primary: oklch(0.5413 0.1856 257.5); /* #0969da accent blue */
  --primary-foreground: oklch(1 0 0);
  --secondary: oklch(0.9716 0.0013 248); /* #f6f8fa subtle */
  --secondary-foreground: oklch(0.3771 0.0145 252); /* #424a53 */
  --muted: oklch(0.9716 0.0013 248); /* #f6f8fa */
  --muted-foreground: oklch(0.5096 0.0155 252); /* #656d76 */
  --accent: oklch(0.9716 0.0013 248);
  --accent-foreground: oklch(0.5413 0.1856 257.5);
  --destructive: oklch(0.5755 0.211 22.5); /* #cf222e */
  --destructive-foreground: oklch(1 0 0);
  --border: oklch(0.8703 0.0058 248); /* #d0d7de */
  --input: oklch(1 0 0);
  --ring: oklch(0.5413 0.1856 257.5); /* accent blue */
  --chart-1: oklch(0.5413 0.1856 257.5);
  --chart-2: oklch(0.6 0.13 256);
  --chart-3: oklch(0.68 0.1 256);
  --chart-4: oklch(0.78 0.07 255);
  --chart-5: oklch(0.88 0.04 254);
  --sidebar: oklch(0.9716 0.0013 248);
  --sidebar-foreground: oklch(0.3771 0.0145 252);
  --sidebar-primary: oklch(0.5413 0.1856 257.5);
  --sidebar-primary-foreground: oklch(1 0 0);
  --sidebar-accent: oklch(0.9716 0.0013 248);
  --sidebar-accent-foreground: oklch(0.5413 0.1856 257.5);
  --sidebar-border: oklch(0.8703 0.0058 248);
  --sidebar-ring: oklch(0.5413 0.1856 257.5);
```

- [ ] **Step 2: コンポーネント側にハードコード色が無いか確認**

Run: `grep -rnE "#[0-9a-fA-F]{3,6}|bg-(pink|rose|fuchsia)" apps/web/src`
Expected: ボード関連で色のハードコードが無い（あれば変数/トークン参照へ直す）。ヒットしたものを確認し、テーマ変数経由でない直書き色があれば対応する。

- [ ] **Step 3: 型・ビルドで壊れていないか確認**

Run: `pnpm -F @acme/web typecheck`
Expected: PASS。

- [ ] **Step 4: 目視確認**

Run: `pnpm dev:next`（別ターミナル）→ http://localhost:3000
Expected: 背景が白、カラム背景が薄グレー、リンク/選択リング/ドラッグ中リングがブルー、現在時刻線が赤。ピンクが残っていない。

- [ ] **Step 5: コミット**

```bash
git add tooling/tailwind/theme.css
git commit -m "feat(theme): ライトモードを GitHub 風の白基調・ブルーアクセントへ"
```

---

## Task 3: Schedule の純関数（時刻⇔px・スナップ・duration）

**Files:**
- Modify: `apps/web/src/features/board/configs/board.ts`
- Modify: `apps/web/src/features/board/utils/schedule.ts`
- Create: `apps/web/src/features/board/utils/schedule.test.ts`

- [ ] **Step 1: グリッド定数を追加**

`apps/web/src/features/board/configs/board.ts` の末尾（20行目 `HOURS` 定義の後ろ）に追加:

```ts
/** Schedule グリッドの 1 時間あたりの高さ(px) */
export const PX_PER_HOUR = 48;
/** 1 分あたりの高さ(px) */
export const PX_PER_MINUTE = PX_PER_HOUR / 60;
/** 伸縮・移動のスナップ単位(分) */
export const SNAP_MINUTES = 15;
/** タスクの最小工数(分) */
export const MIN_DURATION_MINUTES = 15;
/** endAt 未設定タスクの既定工数(分) */
export const DEFAULT_DURATION_MINUTES = 60;
/** グリッド表示の開始時刻(時)。0:00 起点 */
export const GRID_START_HOUR = 0;
```

- [ ] **Step 2: 失敗するテストを書く**

`apps/web/src/features/board/utils/schedule.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  dateAtMinutesOfDay,
  durationMinutes,
  heightPx,
  minutesOfDay,
  pxToMinutes,
  shiftMinutes,
  snapMinutes,
  topPx,
} from "./schedule";

describe("minutesOfDay", () => {
  it("時:分を当日0:00からの分に変換する", () => {
    expect(minutesOfDay(new Date(2026, 5, 11, 10, 30))).toBe(630);
    expect(minutesOfDay(new Date(2026, 5, 11, 0, 0))).toBe(0);
  });
});

describe("snapMinutes", () => {
  it("15分刻みに丸める", () => {
    expect(snapMinutes(607)).toBe(600); // 10:07 -> 10:00
    expect(snapMinutes(623)).toBe(630); // 10:23 -> 10:30
    expect(snapMinutes(638)).toBe(645); // 10:38 -> 10:45
  });
});

describe("topPx", () => {
  it("開始時刻に応じた top(px) を返す(48px/時)", () => {
    expect(topPx(new Date(2026, 5, 11, 10, 0))).toBeCloseTo(480); // 10*48
    expect(topPx(new Date(2026, 5, 11, 10, 30))).toBeCloseTo(504); // 10.5*48
  });
});

describe("durationMinutes", () => {
  it("endAt があれば差分(分)、無ければ既定60分", () => {
    const s = new Date(2026, 5, 11, 10, 0);
    expect(durationMinutes(s, new Date(2026, 5, 11, 11, 30))).toBe(90);
    expect(durationMinutes(s, null)).toBe(60);
  });
});

describe("heightPx", () => {
  it("工数(分)を高さ(px)に変換し、最小15分を保証する", () => {
    expect(heightPx(60)).toBeCloseTo(48);
    expect(heightPx(90)).toBeCloseTo(72);
    expect(heightPx(5)).toBeCloseTo(12); // 15分にクランプ -> 15*0.8
  });
});

describe("pxToMinutes", () => {
  it("px を分に変換する", () => {
    expect(pxToMinutes(48)).toBeCloseTo(60);
    expect(pxToMinutes(24)).toBeCloseTo(30);
  });
});

describe("dateAtMinutesOfDay", () => {
  it("基準日の当日0:00から指定分の Date を返す", () => {
    const base = new Date(2026, 5, 11, 15, 0);
    const d = dateAtMinutesOfDay(630, base); // 10:30
    expect(d.getHours()).toBe(10);
    expect(d.getMinutes()).toBe(30);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getDate()).toBe(11);
  });
});

describe("shiftMinutes", () => {
  it("Date を分だけずらす", () => {
    const d = shiftMinutes(new Date(2026, 5, 11, 10, 0), 90);
    expect(d.getHours()).toBe(11);
    expect(d.getMinutes()).toBe(30);
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `pnpm -F @acme/web test`
Expected: FAIL（`dateAtMinutesOfDay` 等が未定義 / 既存 `schedule.ts` には無い）。

- [ ] **Step 4: 純関数を実装**

`apps/web/src/features/board/utils/schedule.ts` の内容を以下で**全置換**（既存 `dateAtHour` は使用箇所を Task 8 で置き換えるため削除）:

```ts
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

/** 分をスナップ単位(既定15分)に丸める */
export function snapMinutes(minutes: number, snap = SNAP_MINUTES): number {
  return Math.round(minutes / snap) * snap;
}

/** 開始時刻に対応するグリッド上の top(px) */
export function topPx(startAt: Date): number {
  return (minutesOfDay(startAt) - GRID_START_HOUR * 60) * PX_PER_MINUTE;
}

/** 工数(分)。endAt が無ければ既定値 */
export function durationMinutes(startAt: Date, endAt: Date | null): number {
  if (!endAt) return DEFAULT_DURATION_MINUTES;
  return Math.round((endAt.getTime() - startAt.getTime()) / 60000);
}

/** 工数(分)に対応する高さ(px)。最小工数でクランプ */
export function heightPx(duration: number): number {
  return Math.max(duration, MIN_DURATION_MINUTES) * PX_PER_MINUTE;
}

/** px を分に変換 */
export function pxToMinutes(px: number): number {
  return px / PX_PER_MINUTE;
}

/** base と同じ日付で、当日0:00から minutes 分の Date を返す */
export function dateAtMinutesOfDay(minutes: number, base = new Date()): Date {
  const d = new Date(base);
  d.setHours(0, minutes, 0, 0);
  return d;
}

/** Date を minutes 分だけずらした新しい Date */
export function shiftMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60000);
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm -F @acme/web test`
Expected: PASS（全 describe が緑）。

- [ ] **Step 6: コミット**

```bash
git add apps/web/src/features/board/configs/board.ts apps/web/src/features/board/utils/schedule.ts apps/web/src/features/board/utils/schedule.test.ts
git commit -m "feat(board): Schedule グリッドの時刻⇔px 純関数を追加(TDD)"
```

---

## Task 4: 並び替えの position 計算（純関数）

**Files:**
- Create: `apps/web/src/features/board/utils/position.ts`
- Create: `apps/web/src/features/board/utils/position.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/features/board/utils/position.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { positionBetween } from "./position";

describe("positionBetween", () => {
  it("両隣がある場合は中間値", () => {
    expect(positionBetween(2, 4)).toBe(3);
  });
  it("先頭(beforeなし)は after より小さい値", () => {
    expect(positionBetween(null, 4)).toBe(3);
  });
  it("末尾(afterなし)は before より大きい値", () => {
    expect(positionBetween(2, null)).toBe(3);
  });
  it("両隣なし(空カラム)は 1", () => {
    expect(positionBetween(null, null)).toBe(1);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm -F @acme/web test position`
Expected: FAIL（`positionBetween` 未定義）。

- [ ] **Step 3: 実装**

`apps/web/src/features/board/utils/position.ts`:

```ts
/**
 * 並び替え後の position を、前後の要素の position から算出する。
 * position は real（中間値方式）。前後が無い端は ±1 する。
 */
export function positionBetween(
  before: number | null,
  after: number | null,
): number {
  if (before === null && after === null) return 1;
  if (before === null) return after! - 1;
  if (after === null) return before + 1;
  return (before + after) / 2;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm -F @acme/web test position`
Expected: PASS。

- [ ] **Step 5: コミット**

```bash
git add apps/web/src/features/board/utils/position.ts apps/web/src/features/board/utils/position.test.ts
git commit -m "feat(board): 並び替え position 計算の純関数を追加(TDD)"
```

---

## Task 5: API — 詳細編集と工数の永続化に対応

**Files:**
- Modify: `packages/api/src/service/task.ts:40-45`（`UpdateTaskInput`）
- Modify: `packages/api/src/service/task.ts:25-31`（`MoveTaskInput`）
- Modify: `packages/api/src/service/task.ts:85-124`（`move` / `update`）

注: `router/task.ts` は `UpdateTaskInput`/`MoveTaskInput` を再エクスポート参照しているだけなので変更不要。

- [ ] **Step 1: `UpdateTaskInput` に startAt/endAt を追加**

`packages/api/src/service/task.ts` の `UpdateTaskInput`（40〜45行目）を置換:

```ts
export const UpdateTaskInput = z.object({
  id: z.string(),
  title: z.string().min(1).max(512).optional(),
  body: z.string().max(2000).nullish(),
  /** undefined=据え置き / null=クリア / Date=設定 */
  startAt: z.date().nullish(),
  /** 工数の終端。undefined=据え置き / null=クリア / Date=設定 */
  endAt: z.date().nullish(),
});
export type UpdateTaskInput = z.infer<typeof UpdateTaskInput>;
```

- [ ] **Step 2: `MoveTaskInput` に endAt を追加**

`packages/api/src/service/task.ts` の `MoveTaskInput`（25〜31行目）を置換:

```ts
export const MoveTaskInput = z.object({
  id: z.string(),
  lane: z.enum(LANES),
  /** undefined=変更しない / null=クリア / Date=設定 */
  startAt: z.date().nullish(),
  /** undefined=変更しない / null=クリア / Date=設定（工数の終端） */
  endAt: z.date().nullish(),
});
export type MoveTaskInput = z.infer<typeof MoveTaskInput>;
```

- [ ] **Step 3: `move` を更新（Schedule 移動時に endAt 既定 +1h）**

`packages/api/src/service/task.ts` の `move`（85〜100行目）を置換:

```ts
  /** レーン移動（D&D）。移動先の末尾に置く */
  async move(input: MoveTaskInput) {
    const values: {
      lane: Lane;
      position: number;
      startAt?: Date | null;
      endAt?: Date | null;
    } = {
      lane: input.lane,
      position: await nextPosition(input.lane),
    };
    // startAt は明示指定された場合のみ更新（undefined は据え置き）
    if (input.startAt !== undefined) values.startAt = input.startAt;
    if (input.endAt !== undefined) values.endAt = input.endAt;

    // Schedule へ時刻付きで入れる際、工数(endAt)未指定なら既定1時間を補完
    if (
      input.lane === "schedule" &&
      input.startAt instanceof Date &&
      input.endAt === undefined
    ) {
      values.endAt = new Date(input.startAt.getTime() + 60 * 60 * 1000);
    }

    const [row] = await db
      .update(Task)
      .set(values)
      .where(eq(Task.id, input.id))
      .returning();
    return row;
  },
```

- [ ] **Step 4: `update` を更新（startAt/endAt 反映）**

`packages/api/src/service/task.ts` の `update`（112〜124行目）を置換:

```ts
  /** タイトル・本文・時刻・工数の編集 */
  async update(input: UpdateTaskInput) {
    const values: {
      title?: string;
      body?: string | null;
      startAt?: Date | null;
      endAt?: Date | null;
    } = {};
    if (input.title !== undefined) values.title = input.title;
    if (input.body !== undefined) values.body = input.body;
    if (input.startAt !== undefined) values.startAt = input.startAt;
    if (input.endAt !== undefined) values.endAt = input.endAt;

    const [row] = await db
      .update(Task)
      .set(values)
      .where(eq(Task.id, input.id))
      .returning();
    return row;
  },
```

- [ ] **Step 5: 型チェック**

Run: `pnpm -F @acme/api typecheck`
Expected: PASS。

- [ ] **Step 6: コミット**

```bash
git add packages/api/src/service/task.ts
git commit -m "feat(api): タスク詳細(時刻・工数)の更新と Schedule 既定工数を追加"
```

---

## Task 6: 楽観的更新ミューテーション（update / reorder）

**Files:**
- Modify: `apps/web/src/features/board/api/mutations.ts`（末尾に2つ追加）

- [ ] **Step 1: `useUpdateTask` と `useReorderTask` を追加**

`apps/web/src/features/board/api/mutations.ts` の末尾（59行目 `useCreateTask` の後）に追加:

```ts
/**
 * タスク詳細（タイトル/本文/時刻/工数）の更新。ドロワー編集・Schedule伸縮で使用。
 * 入力の undefined フィールドは据え置き、null はクリアとして即時にキャッシュへ反映する。
 */
export function useUpdateTask() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const queryKey = trpc.task.all.queryKey();

  return useMutation(
    trpc.task.update.mutationOptions({
      onMutate: async (vars) => {
        await queryClient.cancelQueries({ queryKey });
        const previous = queryClient.getQueryData<Task[]>(queryKey);
        queryClient.setQueryData<Task[]>(queryKey, (old) =>
          (old ?? []).map((task) =>
            task.id === vars.id
              ? {
                  ...task,
                  title: vars.title ?? task.title,
                  body: vars.body === undefined ? task.body : (vars.body ?? null),
                  startAt:
                    vars.startAt === undefined
                      ? task.startAt
                      : (vars.startAt ?? null),
                  endAt:
                    vars.endAt === undefined ? task.endAt : (vars.endAt ?? null),
                }
              : task,
          ),
        );
        return { previous };
      },
      onError: (_err, _vars, context) => {
        if (context?.previous) {
          queryClient.setQueryData(queryKey, context.previous);
        }
      },
      onSettled: () => queryClient.invalidateQueries({ queryKey }),
    }),
  );
}

/**
 * カラム内の並び替え。position を即時反映し、レーン内を (lane, position) 順に
 * 並べ替えて SortableContext のレイアウトアニメーションを滑らかにする。
 */
export function useReorderTask() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const queryKey = trpc.task.all.queryKey();

  return useMutation(
    trpc.task.reorder.mutationOptions({
      onMutate: async (vars) => {
        await queryClient.cancelQueries({ queryKey });
        const previous = queryClient.getQueryData<Task[]>(queryKey);
        queryClient.setQueryData<Task[]>(queryKey, (old) => {
          const next = (old ?? []).map((task) =>
            task.id === vars.id ? { ...task, position: vars.position } : task,
          );
          return [...next].sort((a, b) =>
            a.lane === b.lane
              ? a.position - b.position
              : a.lane.localeCompare(b.lane),
          );
        });
        return { previous };
      },
      onError: (_err, _vars, context) => {
        if (context?.previous) {
          queryClient.setQueryData(queryKey, context.previous);
        }
      },
      onSettled: () => queryClient.invalidateQueries({ queryKey }),
    }),
  );
}
```

- [ ] **Step 2: 型チェック**

Run: `pnpm -F @acme/web typecheck`
Expected: PASS。

- [ ] **Step 3: コミット**

```bash
git add apps/web/src/features/board/api/mutations.ts
git commit -m "feat(board): update/reorder の楽観的更新ミューテーションを追加"
```

---

## Task 7: ソートアニメーション（useSortable + SortableContext）

リスト型カラム（受信箱 / In Progress / Done）のカードを sortable 化し、並び替え時に標準のレイアウトアニメーションを得る。Schedule は対象外（Task 8 で別コンポーネント化）。

**Files:**
- Modify: `apps/web/src/features/board/hooks/useBoardDnd.ts`
- Modify: `apps/web/src/features/board/components/TaskCard.tsx`
- Modify: `apps/web/src/features/board/components/BoardColumn.tsx`
- Modify: `apps/web/src/features/board/components/Board.tsx`

- [ ] **Step 1: `useBoardDnd` を並び替え対応へ拡張**

`apps/web/src/features/board/hooks/useBoardDnd.ts` を以下で**全置換**:

```ts
"use client";

import { useState } from "react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";

import type { Lane } from "@acme/db/schema";
import type { Task } from "../types/task";
import { positionBetween } from "../utils/position";
import { dateAtMinutesOfDay } from "../utils/schedule";

export interface MoveArgs {
  id: string;
  lane: Lane;
  startAt?: Date | null;
}
export interface ReorderArgs {
  id: string;
  position: number;
}

interface Params {
  /** レーン移動（lane / 時刻の変更） */
  onMove: (args: MoveArgs) => void;
  /** 同一カラム内の並び替え */
  onReorder: (args: ReorderArgs) => void;
  /** id からタスクを引くためのマップ */
  tasksById: Map<string, Task>;
  /** レーンごとの表示順 id 配列（position 昇順） */
  laneOrder: Record<Lane, string[]>;
}

/**
 * ボードの D&D の振る舞い。ドロップ先 id の規約:
 *  - `lane:<lane>` … 受信箱 / In Progress / Done のカラム（末尾へ移動）
 *  - `sched:<hour>` … Schedule の時間スロット（Task 8 で連続グリッドへ置換予定）
 *  - 上記以外（タスク id）… SortableContext 内の並び替え/別カラムのカードへドロップ
 */
export function useBoardDnd({ onMove, onReorder, tasksById, laneOrder }: Params) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const handleDragStart = (event: DragStartEvent) =>
    setActiveId(String(event.active.id));

  const handleDragCancel = () => setActiveId(null);

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const id = String(event.active.id);
    const over = event.over ? String(event.over.id) : null;
    if (!over || over === id) return;

    if (over.startsWith("sched:")) {
      const hour = Number(over.slice(6));
      onMove({ id, lane: "schedule", startAt: dateAtMinutesOfDay(hour * 60) });
      return;
    }

    if (over.startsWith("lane:")) {
      const lane = over.slice(5) as Lane;
      onMove({ id, lane, startAt: lane === "inbox" ? null : undefined });
      return;
    }

    // over はタスク id（sortable アイテム）
    const overTask = tasksById.get(over);
    const activeTask = tasksById.get(id);
    if (!overTask || !activeTask) return;

    if (overTask.lane === activeTask.lane) {
      // 同一カラム内の並び替え
      const ids = laneOrder[activeTask.lane];
      const oldIndex = ids.indexOf(id);
      const newIndex = ids.indexOf(over);
      if (oldIndex === -1 || newIndex === -1) return;
      const reordered = arrayMove(ids, oldIndex, newIndex);
      const pos = reordered.indexOf(id);
      const beforeId = reordered[pos - 1];
      const afterId = reordered[pos + 1];
      const before = beforeId ? (tasksById.get(beforeId)?.position ?? null) : null;
      const after = afterId ? (tasksById.get(afterId)?.position ?? null) : null;
      onReorder({ id, position: positionBetween(before, after) });
    } else {
      // 別カラムのカードへドロップ → そのカラムへ移動（末尾）
      onMove({
        id,
        lane: overTask.lane,
        startAt: overTask.lane === "inbox" ? null : undefined,
      });
    }
  };

  return { activeId, sensors, handleDragStart, handleDragEnd, handleDragCancel };
}
```

- [ ] **Step 2: `TaskCard` を `useSortable` 化 ＋ クリックで詳細を開く**

`apps/web/src/features/board/components/TaskCard.tsx` の3〜4行目の import と、52行目以降の `TaskCard` を置換。

import 部（3〜4行目）を:

```ts
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
```

`TaskCard`（52〜68行目）を:

```tsx
/** 並び替え可能なカード（dnd の振る舞い＋クリックで詳細を開く） */
export function TaskCard({
  task,
  onOpen,
}: {
  task: Task;
  onOpen?: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={cn("cursor-grab touch-none", isDragging && "opacity-40")}
      onClick={() => onOpen?.(task.id)}
      {...listeners}
      {...attributes}
    >
      <TaskCardView task={task} />
    </div>
  );
}
```

注: `useSortable` は `transition` を返す。並び替え時のレイアウト移動はこの `transition` により自動でアニメーションする。クリックとドラッグは PointerSensor の `distance: 4` で分離される（4px 未満で `onClick` 発火）。

- [ ] **Step 3: `BoardColumn` を `SortableContext` でラップ**

`apps/web/src/features/board/components/BoardColumn.tsx` を以下で**全置換**:

```tsx
"use client";

import type { ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import { cn } from "@acme/ui";

import type { Lane } from "@acme/db/schema";
import type { Task } from "../types/task";
import { TaskCard } from "./TaskCard";

interface Props {
  lane: Lane;
  title: string;
  hint?: string;
  tasks: Task[];
  /** カードクリックで詳細ドロワーを開く */
  onOpenTask?: (id: string) => void;
  /** カラム下部に置く追加 UI（受信箱の ToDo 追加フォームなど） */
  footer?: ReactNode;
}

/** 単純なカード積み上げ式のカラム（受信箱 / In Progress / Done） */
export function BoardColumn({
  lane,
  title,
  hint,
  tasks,
  onOpenTask,
  footer,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: `lane:${lane}` });

  return (
    <section className="flex min-h-0 min-w-0 flex-col">
      <header className="mb-2 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
        <span className="text-muted-foreground ml-auto text-xs">
          {tasks.length}
        </span>
      </header>

      <div
        ref={setNodeRef}
        className={cn(
          "bg-muted/30 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-md p-2",
          isOver && "ring-primary ring-2",
        )}
      >
        <SortableContext
          items={tasks.map((task) => task.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} onOpen={onOpenTask} />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <p className="text-muted-foreground/60 px-1 py-4 text-center text-xs">
            ここにドロップ
          </p>
        )}
        {footer}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: `Board` で reorder ミューテーションと並び情報を配線**

`apps/web/src/features/board/components/Board.tsx` を以下で**全置換**（`selectedTaskId` とドロワーは Task 9 で追加するため、ここでは hook 配線と props 受け渡しまで。`onOpenTask` は後タスクで使う）:

```tsx
"use client";

import { useMemo } from "react";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { format } from "date-fns";
import { ja } from "date-fns/locale";

import type { Lane } from "@acme/db/schema";
import { useMoveTask, useReorderTask } from "../api/mutations";
import { useTasks } from "../api/queries";
import { useBoardDnd } from "../hooks/useBoardDnd";
import { groupByLane } from "../utils/groupTasks";
import { AddTodoForm } from "./AddTodoForm";
import { BoardColumn } from "./BoardColumn";
import { ScheduleColumn } from "./ScheduleColumn";
import { TaskCardView } from "./TaskCard";

/**
 * カンバンボード本体（Container）。
 * データ取得・更新・D&D ロジックを束ね、各カラム（Presentational）へ渡す。
 */
export function Board() {
  const { data: tasks = [] } = useTasks();
  const move = useMoveTask();
  const reorder = useReorderTask();

  const groups = useMemo(() => groupByLane(tasks), [tasks]);
  const tasksById = useMemo(
    () => new Map(tasks.map((task) => [task.id, task])),
    [tasks],
  );
  const laneOrder = useMemo<Record<Lane, string[]>>(
    () => ({
      inbox: groups.inbox.map((t) => t.id),
      schedule: groups.schedule.map((t) => t.id),
      in_progress: groups.in_progress.map((t) => t.id),
      done: groups.done.map((t) => t.id),
    }),
    [groups],
  );

  const { activeId, sensors, handleDragStart, handleDragEnd, handleDragCancel } =
    useBoardDnd({
      onMove: (args) => move.mutate(args),
      onReorder: (args) => reorder.mutate(args),
      tasksById,
      laneOrder,
    });

  // 現在時刻ラインの基準。マウント時に固定（必要になれば定期更新を検討）
  const now = useMemo(() => new Date(), []);
  const activeTask = tasks.find((task) => task.id === activeId) ?? null;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <h1 className="text-lg font-bold">my-kanban</h1>
        <time className="text-muted-foreground text-sm tabular-nums">
          {format(now, "yyyy-MM-dd (EEE) HH:mm", { locale: ja })}
        </time>
      </header>

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 p-3">
          <BoardColumn
            lane="inbox"
            title="📥 受信箱"
            hint="時刻未定"
            tasks={groups.inbox}
            footer={<AddTodoForm />}
          />
          <ScheduleColumn tasks={groups.schedule} now={now} />
          <BoardColumn
            lane="in_progress"
            title="▶ In Progress"
            tasks={groups.in_progress}
          />
          <BoardColumn lane="done" title="✓ Done" tasks={groups.done} />
        </div>

        <DragOverlay>
          {activeTask ? <TaskCardView task={activeTask} dragging /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
```

- [ ] **Step 5: 型チェック**

Run: `pnpm -F @acme/web typecheck`
Expected: PASS。

- [ ] **Step 6: 目視確認（アニメーション）**

Run: `pnpm dev:next` → http://localhost:3000
Expected: 受信箱 / In Progress / Done 内でカードを上下にドラッグすると、他カードが滑らかにスライドして並び替わる。離すと新しい順序が保持される。カラム間移動も従来どおり可能。

- [ ] **Step 7: コミット**

```bash
git add apps/web/src/features/board/hooks/useBoardDnd.ts apps/web/src/features/board/components/TaskCard.tsx apps/web/src/features/board/components/BoardColumn.tsx apps/web/src/features/board/components/Board.tsx
git commit -m "feat(board): カード並び替えを useSortable 化しアニメーションを追加"
```

---

## Task 8: Schedule 連続タイムグリッド＋ブロック（可変高さ・伸縮・移動）

**Files:**
- Create: `apps/web/src/features/board/components/ScheduleBlock.tsx`
- Modify: `apps/web/src/features/board/components/ScheduleColumn.tsx`
- Modify: `apps/web/src/features/board/hooks/useBoardDnd.ts`（schedule 分岐を Y ベースへ）
- Modify: `apps/web/src/features/board/components/Board.tsx`（ScheduleColumn に onOpenTask を渡す）
- 不要化: `apps/web/src/features/board/utils/groupTasks.ts` の `groupByHour`（削除）

- [ ] **Step 1: `ScheduleBlock` を作成（高さ可変・下端リサイズ・クリックで詳細）**

`apps/web/src/features/board/components/ScheduleBlock.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { format } from "date-fns";

import { cn } from "@acme/ui";

import {
  MIN_DURATION_MINUTES,
  PX_PER_MINUTE,
  SNAP_MINUTES,
} from "../configs/board";
import type { Task } from "../types/task";
import { durationMinutes, heightPx, shiftMinutes, snapMinutes, topPx } from "../utils/schedule";

interface Props {
  task: Task;
  onOpen?: (id: string) => void;
  /** 伸縮確定時に新しい endAt を保存 */
  onResize: (id: string, endAt: Date) => void;
}

/** Schedule 上の 1 タスク。startAt=top, 工数=height。下端ハンドルで伸縮できる */
export function ScheduleBlock({ task, onOpen, onResize }: Props) {
  const start = task.startAt!;
  const baseDuration = durationMinutes(start, task.endAt ?? null);
  // 伸縮中はローカルの分でプレビュー、確定時に onResize
  const [draftDuration, setDraftDuration] = useState<number | null>(null);
  const duration = draftDuration ?? baseDuration;

  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: task.id });

  const handleResizePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startY = e.clientY;
    const startDuration = baseDuration;
    const move = (ev: PointerEvent) => {
      const deltaMin = (ev.clientY - startY) / PX_PER_MINUTE;
      const next = Math.max(
        MIN_DURATION_MINUTES,
        snapMinutes(startDuration + deltaMin, SNAP_MINUTES),
      );
      setDraftDuration(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDraftDuration((current) => {
        if (current !== null && current !== startDuration) {
          onResize(task.id, shiftMinutes(start, current));
        }
        return null;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        position: "absolute",
        left: 4,
        right: 4,
        top: topPx(start),
        height: heightPx(duration),
        transform: CSS.Translate.toString(transform),
        transition: isDragging ? undefined : "top 150ms ease, height 150ms ease",
        zIndex: isDragging ? 20 : 10,
      }}
      className={cn(
        "border-primary/40 bg-primary/10 hover:bg-primary/15 overflow-hidden rounded-md border px-2 py-1 text-xs",
        isDragging && "ring-primary opacity-80 shadow-md ring-2",
      )}
      onClick={() => onOpen?.(task.id)}
    >
      <div
        className="cursor-grab touch-none"
        {...listeners}
        {...attributes}
      >
        <div className="truncate font-medium">{task.title}</div>
        <div className="text-muted-foreground text-[10px] tabular-nums">
          {format(start, "HH:mm")} · {duration}m
        </div>
      </div>
      {/* 下端リサイズハンドル */}
      <div
        onPointerDown={handleResizePointerDown}
        className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
      >
        <div className="bg-primary/60 mx-auto h-1 w-6 rounded-full" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `ScheduleColumn` を連続グリッドへ作り替え**

`apps/web/src/features/board/components/ScheduleColumn.tsx` を以下で**全置換**:

```tsx
"use client";

import { useDroppable } from "@dnd-kit/core";

import { cn } from "@acme/ui";

import { GRID_START_HOUR, HOURS, PX_PER_HOUR } from "../configs/board";
import type { Task } from "../types/task";
import { minutesOfDay, PX_PER_MINUTE } from "../utils/schedule";
import { ScheduleBlock } from "./ScheduleBlock";

interface Props {
  tasks: Task[];
  now: Date;
  onOpenTask?: (id: string) => void;
  onResizeTask: (id: string, endAt: Date) => void;
}

/** Schedule カラム：当日 0:00〜24:00 の連続タイムライン（工数で高さ可変） */
export function ScheduleColumn({ tasks, now, onOpenTask, onResizeTask }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: "lane:schedule" });
  const nowTop = (minutesOfDay(now) - GRID_START_HOUR * 60) * PX_PER_MINUTE;

  return (
    <section className="flex min-h-0 min-w-0 flex-col">
      <header className="mb-2 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold">🗓 Schedule</h2>
        <span className="text-muted-foreground text-xs">タイムライン</span>
      </header>
      <div className="bg-muted/30 min-h-0 flex-1 overflow-y-auto rounded-md">
        <div
          ref={setNodeRef}
          className={cn("relative", isOver && "bg-primary/5")}
          style={{ height: HOURS.length * PX_PER_HOUR }}
        >
          {/* 時間目盛り */}
          {HOURS.map((hour) => (
            <div
              key={hour}
              className="text-muted-foreground absolute left-0 w-full border-t text-[10px] tabular-nums"
              style={{ top: (hour - GRID_START_HOUR) * PX_PER_HOUR }}
            >
              <span className="pl-1">{String(hour).padStart(2, "0")}:00</span>
            </div>
          ))}

          {/* 現在時刻ライン */}
          <div
            className="bg-destructive pointer-events-none absolute left-0 z-30 h-px w-full"
            style={{ top: nowTop }}
          >
            <span className="bg-destructive absolute -top-1 left-0 h-2 w-2 rounded-full" />
          </div>

          {/* タスクブロック */}
          {tasks.map((task) =>
            task.startAt ? (
              <ScheduleBlock
                key={task.id}
                task={task}
                onOpen={onOpenTask}
                onResize={onResizeTask}
              />
            ) : null,
          )}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: `clampDayMinutes` を schedule.ts に追加（純関数）＋テスト**

先に retime で使う純関数を追加する。`apps/web/src/features/board/utils/schedule.ts` の末尾に追加:

```ts
/** 当日の分(0〜1439)に収める */
export function clampDayMinutes(minutes: number): number {
  return Math.min(Math.max(minutes, 0), 24 * 60 - 1);
}
```

`apps/web/src/features/board/utils/schedule.test.ts` の import を次へ差し替え（`clampDayMinutes` 追加）:

```ts
import {
  clampDayMinutes,
  dateAtMinutesOfDay,
  durationMinutes,
  heightPx,
  minutesOfDay,
  pxToMinutes,
  shiftMinutes,
  snapMinutes,
  topPx,
} from "./schedule";
```

同テストファイルの末尾に追加:

```ts
describe("clampDayMinutes", () => {
  it("0〜1439 に収める", () => {
    expect(clampDayMinutes(-30)).toBe(0);
    expect(clampDayMinutes(2000)).toBe(1439);
    expect(clampDayMinutes(600)).toBe(600);
  });
});
```

Run: `pnpm -F @acme/web test`
Expected: PASS（clampDayMinutes 含む）。

- [ ] **Step 4: `useBoardDnd` を schedule retime 対応へ全置換**

`apps/web/src/features/board/hooks/useBoardDnd.ts` を以下で**全置換**（Task 7 版から `MoveArgs` に `endAt` 追加・`sched:` 分岐廃止・`lane:schedule` の Y ベース retime を追加した最終形）:

```ts
"use client";

import { useState } from "react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";

import type { Lane } from "@acme/db/schema";
import type { Task } from "../types/task";
import { positionBetween } from "../utils/position";
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
}
export interface ReorderArgs {
  id: string;
  position: number;
}

interface Params {
  /** レーン移動（lane / 時刻 / 工数の変更） */
  onMove: (args: MoveArgs) => void;
  /** 同一カラム内の並び替え */
  onReorder: (args: ReorderArgs) => void;
  /** id からタスクを引くためのマップ */
  tasksById: Map<string, Task>;
  /** レーンごとの表示順 id 配列（position 昇順） */
  laneOrder: Record<Lane, string[]>;
}

/**
 * ボードの D&D の振る舞い。ドロップ先 id の規約:
 *  - `lane:schedule` … Schedule グリッド。Schedule 内のブロックは縦移動で再配置、
 *    他カラムからは現在時刻にスナップして配置（既定1時間）
 *  - `lane:<lane>` … 受信箱 / In Progress / Done のカラム（末尾へ移動）
 *  - 上記以外（タスク id）… SortableContext 内の並び替え/別カラムのカードへドロップ
 */
export function useBoardDnd({ onMove, onReorder, tasksById, laneOrder }: Params) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const handleDragStart = (event: DragStartEvent) =>
    setActiveId(String(event.active.id));

  const handleDragCancel = () => setActiveId(null);

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const id = String(event.active.id);
    const over = event.over ? String(event.over.id) : null;
    if (!over || over === id) return;

    if (over === "lane:schedule") {
      const activeTask = tasksById.get(id);
      // 既に Schedule 上のブロック → 縦ドラッグ量で再配置（工数=高さは維持）
      if (activeTask?.lane === "schedule" && activeTask.startAt) {
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
      // 他カラムから Schedule へ → 現在時刻にスナップして配置（endAt は move 側で +1h 補完）
      const dropMin = clampDayMinutes(snapMinutes(minutesOfDay(new Date())));
      onMove({ id, lane: "schedule", startAt: dateAtMinutesOfDay(dropMin) });
      return;
    }

    if (over.startsWith("lane:")) {
      const lane = over.slice(5) as Lane;
      onMove({ id, lane, startAt: lane === "inbox" ? null : undefined });
      return;
    }

    // over はタスク id（sortable アイテム）
    const overTask = tasksById.get(over);
    const activeTask = tasksById.get(id);
    if (!overTask || !activeTask) return;

    if (overTask.lane === activeTask.lane && overTask.lane !== "schedule") {
      // 同一カラム内の並び替え
      const ids = laneOrder[activeTask.lane];
      const oldIndex = ids.indexOf(id);
      const newIndex = ids.indexOf(over);
      if (oldIndex === -1 || newIndex === -1) return;
      const reordered = arrayMove(ids, oldIndex, newIndex);
      const pos = reordered.indexOf(id);
      const beforeId = reordered[pos - 1];
      const afterId = reordered[pos + 1];
      const before = beforeId ? (tasksById.get(beforeId)?.position ?? null) : null;
      const after = afterId ? (tasksById.get(afterId)?.position ?? null) : null;
      onReorder({ id, position: positionBetween(before, after) });
    } else if (overTask.lane !== activeTask.lane) {
      // 別カラムのカードへドロップ → そのカラムへ移動（末尾）
      onMove({
        id,
        lane: overTask.lane,
        startAt: overTask.lane === "inbox" ? null : undefined,
      });
    }
  };

  return { activeId, sensors, handleDragStart, handleDragEnd, handleDragCancel };
}
```

- [ ] **Step 5: `Board` から ScheduleColumn に props を渡す**

`apps/web/src/features/board/components/Board.tsx` の `<ScheduleColumn .../>`（Task 7 後の状態）を置換:

```tsx
          <ScheduleColumn
            tasks={groups.schedule}
            now={now}
            onResizeTask={(id, endAt) =>
              move.mutate({ id, lane: "schedule", endAt })
            }
          />
```

注: `onOpenTask` は Task 9 でドロワー導入時に配線する（ここでは未指定でも可）。

- [ ] **Step 6: `groupByHour` を削除**

`apps/web/src/features/board/utils/groupTasks.ts` の `groupByHour`（19〜28行目）を削除（`groupByLane` のみ残す）。他に参照が無いことを確認:

Run: `grep -rn "groupByHour" apps/web/src`
Expected: ヒット 0。

- [ ] **Step 7: テスト・型チェック**

Run: `pnpm -F @acme/web test && pnpm -F @acme/web typecheck`
Expected: いずれも PASS。

- [ ] **Step 8: 目視確認**

Run: `pnpm dev:next` → http://localhost:3000
Expected:
- Schedule のタスクが startAt 位置に配置され、工数（endAt-startAt、未設定は60分）に応じた高さになる。
- ブロック下端のハンドルを上下ドラッグすると高さが15分刻みで変わり、離すと保持される。
- ブロック本体を縦ドラッグすると開始時刻が15分刻みで変わり、高さ（工数）は維持される。
- 受信箱等から Schedule へドロップすると配置され、既定1時間の高さになる。
- 赤い現在時刻ラインが分単位の位置に出る。

- [ ] **Step 9: コミット**

```bash
git add apps/web/src/features/board/components/ScheduleBlock.tsx apps/web/src/features/board/components/ScheduleColumn.tsx apps/web/src/features/board/hooks/useBoardDnd.ts apps/web/src/features/board/utils/schedule.ts apps/web/src/features/board/utils/schedule.test.ts apps/web/src/features/board/components/Board.tsx apps/web/src/features/board/utils/groupTasks.ts
git commit -m "feat(board): Schedule を連続グリッド化し工数連動の可変高さ・伸縮・再配置を実装"
```

---

## Task 9: タスク詳細ドロワー（自動保存・工数設定）

**Files:**
- Create: `apps/web/src/features/board/components/TaskDrawer.tsx`
- Modify: `apps/web/src/features/board/components/Board.tsx`（`selectedTaskId` 状態・ドロワー描画・`onOpenTask` 配線）

- [ ] **Step 1: `TaskDrawer` を作成**

`apps/web/src/features/board/components/TaskDrawer.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";

import { cn } from "@acme/ui";

import { DEFAULT_DURATION_MINUTES, MIN_DURATION_MINUTES } from "../configs/board";
import type { Task } from "../types/task";
import { durationMinutes, shiftMinutes } from "../utils/schedule";

const DURATION_PRESETS = [15, 30, 60, 120, 180] as const;

interface Props {
  task: Task | null;
  onClose: () => void;
  /** 詳細(タイトル/本文)更新 */
  onSave: (id: string, patch: { title?: string; body?: string | null }) => void;
  /** 工数(endAt)更新 */
  onChangeDuration: (id: string, endAt: Date) => void;
}

/** 右スライドインの詳細ドロワー。入力は debounce + blur で自動保存 */
export function TaskDrawer({ task, onClose, onSave, onChangeDuration }: Props) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 対象タスク切替時にフォームを同期
  useEffect(() => {
    setTitle(task?.title ?? "");
    setBody(task?.body ?? "");
    setSaved(false);
  }, [task?.id, task?.title, task?.body]);

  // Esc で閉じる
  useEffect(() => {
    if (!task) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [task, onClose]);

  if (!task) return null;

  const flush = (next: { title?: string; body?: string }) => {
    onSave(task.id, {
      title: next.title ?? title,
      body: (next.body ?? body) || null,
    });
    setSaved(true);
  };

  const scheduleSave = (next: { title?: string; body?: string }) => {
    setSaved(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(next), 600);
  };

  const duration = task.startAt
    ? durationMinutes(task.startAt, task.endAt ?? null)
    : DEFAULT_DURATION_MINUTES;

  return (
    <>
      {/* オーバーレイ */}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
        aria-hidden
      />
      {/* ドロワー本体 */}
      <aside className="bg-card fixed inset-y-0 right-0 z-50 flex w-[360px] flex-col border-l shadow-xl">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-semibold">タスク詳細</span>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-sm"
            aria-label="閉じる"
          >
            ✕
          </button>
        </header>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 text-sm">
          <div>
            <label className="text-muted-foreground mb-1 block text-xs font-semibold uppercase">
              タイトル
            </label>
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                scheduleSave({ title: e.target.value });
              }}
              onBlur={() => flush({})}
              className="border-input focus:ring-ring w-full rounded-md border bg-transparent px-2 py-1.5 font-medium focus:ring-2 focus:outline-none"
            />
          </div>

          <div>
            <label className="text-muted-foreground mb-1 block text-xs font-semibold uppercase">
              詳細
            </label>
            <textarea
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                scheduleSave({ body: e.target.value });
              }}
              onBlur={() => flush({})}
              rows={8}
              placeholder="プレーンテキストで入力"
              className="border-input focus:ring-ring text-muted-foreground w-full resize-y rounded-md border bg-transparent px-2 py-1.5 leading-relaxed focus:ring-2 focus:outline-none"
            />
          </div>

          {task.startAt && (
            <div>
              <label className="text-muted-foreground mb-1 block text-xs font-semibold uppercase">
                開始 / 工数
              </label>
              <div className="text-muted-foreground mb-2 text-xs tabular-nums">
                {format(task.startAt, "HH:mm")} 開始 · {duration}分
              </div>
              <div className="flex flex-wrap gap-1.5">
                {DURATION_PRESETS.map((min) => (
                  <button
                    key={min}
                    onClick={() =>
                      onChangeDuration(task.id, shiftMinutes(task.startAt!, min))
                    }
                    className={cn(
                      "rounded-md border px-2 py-1 text-xs",
                      duration === min
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-input text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {min < 60 ? `${min}m` : `${min / 60}h`}
                  </button>
                ))}
              </div>
              <p className="text-muted-foreground/70 mt-1 text-[10px]">
                最小 {MIN_DURATION_MINUTES} 分。グリッド上の下端ドラッグでも変更できます。
              </p>
            </div>
          )}

          {saved && <p className="text-xs text-green-600">✓ 保存しました</p>}
        </div>
      </aside>
    </>
  );
}
```

- [ ] **Step 2: `Board` にドロワー状態と配線を追加**

`apps/web/src/features/board/components/Board.tsx` を次のように更新する。

(a) import に `useState` と `useUpdateTask`・`TaskDrawer` を追加:

```tsx
import { useMemo, useState } from "react";
```
```tsx
import { useMoveTask, useReorderTask, useUpdateTask } from "../api/mutations";
```
```tsx
import { TaskDrawer } from "./TaskDrawer";
```

(b) `Board` 関数の冒頭、`reorder` 定義の下に追加:

```tsx
  const update = useUpdateTask();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTask = selectedTaskId
    ? (tasksById.get(selectedTaskId) ?? null)
    : null;
```

(c) 3つのカラムとScheduleColumnに `onOpenTask={setSelectedTaskId}` を渡す。`BoardColumn` 3箇所と `ScheduleColumn` を更新:

```tsx
          <BoardColumn
            lane="inbox"
            title="📥 受信箱"
            hint="時刻未定"
            tasks={groups.inbox}
            onOpenTask={setSelectedTaskId}
            footer={<AddTodoForm />}
          />
          <ScheduleColumn
            tasks={groups.schedule}
            now={now}
            onOpenTask={setSelectedTaskId}
            onResizeTask={(id, endAt) =>
              move.mutate({ id, lane: "schedule", endAt })
            }
          />
          <BoardColumn
            lane="in_progress"
            title="▶ In Progress"
            tasks={groups.in_progress}
            onOpenTask={setSelectedTaskId}
          />
          <BoardColumn
            lane="done"
            title="✓ Done"
            tasks={groups.done}
            onOpenTask={setSelectedTaskId}
          />
```

(d) `</DndContext>` の直後（`</div>` の前）にドロワーを描画:

```tsx
      </DndContext>

      <TaskDrawer
        task={selectedTask}
        onClose={() => setSelectedTaskId(null)}
        onSave={(id, patch) => update.mutate({ id, ...patch })}
        onChangeDuration={(id, endAt) =>
          move.mutate({ id, lane: "schedule", endAt })
        }
      />
    </div>
```

- [ ] **Step 3: 型チェック**

Run: `pnpm -F @acme/web typecheck`
Expected: PASS。

- [ ] **Step 4: 目視確認**

Run: `pnpm dev:next` → http://localhost:3000
Expected:
- カードをクリック（ドラッグしない）すると右からドロワーが開く。
- タイトル/詳細を編集すると入力停止 ~0.6 秒後とフォーカスアウトで自動保存され「✓ 保存しました」が出る。ボード上のカード表示も即時更新。
- Schedule タスクではドロワーに開始時刻と工数チップが出て、押すと高さが変わる。
- ✕ / Esc / オーバーレイクリックで閉じる。
- ドラッグ操作（4px以上）ではドロワーは開かず、従来の移動/並び替えが動く。

- [ ] **Step 5: コミット**

```bash
git add apps/web/src/features/board/components/TaskDrawer.tsx apps/web/src/features/board/components/Board.tsx
git commit -m "feat(board): タスク詳細ドロワー(自動保存・工数設定)を追加"
```

---

## Task 10: 仕上げ（全体チェック）

**Files:** なし（検証のみ）

- [ ] **Step 1: 全品質チェックを通す**

Run:
```bash
pnpm -F @acme/web test
pnpm typecheck
pnpm lint
pnpm format
pnpm -F @acme/web build
```
Expected: すべて PASS。失敗があれば該当タスクへ戻って修正。

- [ ] **Step 2: CLAUDE.md の Schedule 記述を更新**

[CLAUDE.md](../../../CLAUDE.md) のデータモデル節、Schedule が「1時間バケツ」前提の表現があれば「連続タイムグリッド（工数で可変高さ、`endAt`=工数終端、15分スナップ）」へ更新する。`startAt` の三値規約の記述に `endAt` も同様の三値（undefined=据え置き/null=クリア/Date=設定）である旨を追記。

- [ ] **Step 3: コミット**

```bash
git add CLAUDE.md
git commit -m "docs: Schedule の連続グリッド化と endAt(工数) 規約を CLAUDE.md に反映"
```

---

## Self-Review メモ（計画作成者による確認結果）

- **Spec カバレッジ:** 要件1=Task2 / 要件2(ドロワー)=Task9 / 要件3(可変高さ・伸縮)=Task3,8 / 要件4(ソートアニメ)=Task7。API/楽観更新=Task5,6。テスト基盤=Task1。すべて対応。
- **型整合:** `MoveArgs.endAt`（Task8で追加）/ `UpdateTaskInput.startAt,endAt`（Task5）/ `useBoardDnd` の `Params`（onMove,onReorder,tasksById,laneOrder）は Task7 で定義し Task8 で `MoveArgs` のみ拡張。`onOpenTask`/`onResizeTask` の prop 名は ScheduleColumn(Task8)・Board(Task8,9) で一致。`positionBetween`/`durationMinutes`/`shiftMinutes`/`clampDayMinutes`/`dateAtMinutesOfDay`/`snapMinutes`/`pxToMinutes`/`minutesOfDay`/`topPx`/`heightPx` は Task3,4,8 で定義済み、利用箇所と名称一致。
- **プレースホルダ:** なし（全ステップに具体コード/コマンド/期待値を記載）。
- **既知の注意:** Task8 Step3 は `handleDragEnd` を一度仮実装→同ステップ内で重複呼び出しを除いた最終形へ整える流れ。最終形のコードブロックを正とすること。
