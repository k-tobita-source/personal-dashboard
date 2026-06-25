# Schedule 重なりブロックの左右分割レイアウト Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Schedule タイムラインで時間が重なるブロックを Google カレンダー風に左右分割し、すべて見える・操作できるようにする。

**Architecture:** 純粋関数 `assignScheduleColumns`（区間グラフの貪欲彩色）で各ブロックの列番号と総列数を算出し、`ScheduleColumn` がそれを `ScheduleBlock` に渡す。`ScheduleBlock` は固定全幅の `left`/`right` を `col`/`cols` 由来の CSS `calc` に置き換える。

**Tech Stack:** TypeScript 5.9 / React (Next.js) / dnd-kit / Vitest。パッケージは `@acme/web`、Node は 22 系（`nvm use`）。

## Global Constraints

- Node は 22 系（`.nvmrc` = 22.21.0）。作業前に `nvm use`。
- 手動 memo は入れない（React Compiler 方針）。
- ファイル名規約: `.ts` は camelCase、フックは `use` プレフィックス、定数は UPPER_SNAKE_CASE。
- 純粋計算は utils、UI はコンポーネントに分離（既存の board feature 構成を踏襲）。
- 既存挙動を壊さない: リサイズ（下端ハンドル）、レーン間 D&D、DragOverlay、背景クリック作成 Popover。

---

### Task 1: `assignScheduleColumns` 純粋関数とテスト

**Files:**
- Modify: `apps/web/src/features/board/utils/schedule.ts`（末尾に関数を追加）
- Test: `apps/web/src/features/board/utils/schedule.test.ts`（`describe` を追加）

**Interfaces:**
- Consumes: 既存 `durationMinutes`、`MIN_DURATION_MINUTES`（configs/board）、`ScheduleBlockItem`、`ScheduleCandidate`（同ファイル内で定義済み）。
- Produces:
  ```ts
  export function assignScheduleColumns<
    T extends ScheduleCandidate & { id: string },
  >(items: ScheduleBlockItem<T>[]): Map<string, { col: number; cols: number }>
  ```
  `col` はクラスタ内の 0 始まり列番号、`cols` はそのブロックが属するクラスタの総列数。重なりが無いブロックは `{ col: 0, cols: 1 }`。

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/features/board/utils/schedule.test.ts` の import に `assignScheduleColumns` を追加する。先頭の import 文を以下に置き換える:

```ts
import {
  assignScheduleColumns,
  clampDayMinutes,
  dateAtMinutesOfDay,
  durationMinutes,
  heightPx,
  minutesOfDay,
  pxToMinutes,
  selectionToRange,
  selectScheduleBlocks,
  shiftMinutes,
  snapMinutes,
  topPx,
} from "./schedule";
```

ファイル末尾に以下の `describe` を追加する:

```ts
describe("assignScheduleColumns", () => {
  function blk(
    id: string,
    startAt: Date,
    endAt: Date | null = null,
    isGhost = false,
  ) {
    return {
      task: { id, lane: "schedule" as Lane, startAt, endAt },
      isGhost,
    };
  }
  const at = (h: number, m = 0) => new Date(2026, 5, 18, h, m);

  it("重ならないブロックは全て col0 / cols1", () => {
    const map = assignScheduleColumns([
      blk("a", at(9), at(10)),
      blk("b", at(11), at(12)),
    ]);
    expect(map.get("a")).toEqual({ col: 0, cols: 1 });
    expect(map.get("b")).toEqual({ col: 0, cols: 1 });
  });

  it("2件重なりは col0 / col1、ともに cols2", () => {
    const map = assignScheduleColumns([
      blk("a", at(9, 0), at(10, 0)),
      blk("b", at(9, 30), at(10, 30)),
    ]);
    expect(map.get("a")).toEqual({ col: 0, cols: 2 });
    expect(map.get("b")).toEqual({ col: 1, cols: 2 });
  });

  it("連鎖クラスタ(A↔B,B↔C 重なり/A↔C 非重なり)は cols2、C は列を再利用して col0", () => {
    const map = assignScheduleColumns([
      blk("a", at(9, 0), at(10, 0)),
      blk("b", at(9, 30), at(10, 30)),
      blk("c", at(10, 0), at(11, 0)),
    ]);
    expect(map.get("a")).toEqual({ col: 0, cols: 2 });
    expect(map.get("b")).toEqual({ col: 1, cols: 2 });
    expect(map.get("c")).toEqual({ col: 0, cols: 2 });
  });

  it("ちょうど隣接(終了==開始)は重ならない扱いで cols1", () => {
    const map = assignScheduleColumns([
      blk("a", at(9, 0), at(10, 0)),
      blk("c", at(10, 0), at(11, 0)),
    ]);
    expect(map.get("a")).toEqual({ col: 0, cols: 1 });
    expect(map.get("c")).toEqual({ col: 0, cols: 1 });
  });

  it("ゴースト(in_progress)も schedule ブロックと列分割される", () => {
    const map = assignScheduleColumns([
      blk("a", at(9, 0), at(10, 0)),
      blk("g", at(9, 30), at(10, 30), true),
    ]);
    expect(map.get("a")).toEqual({ col: 0, cols: 2 });
    expect(map.get("g")).toEqual({ col: 1, cols: 2 });
  });

  it("endAt 未設定(既定60分)でも実効区間で重なり判定する", () => {
    // a: 9:00 開始 endAt 無し -> 実効 10:00 まで
    // b: 9:30 開始 endAt 無し -> 実効 10:30 まで -> 重なる
    const map = assignScheduleColumns([
      blk("a", at(9, 0), null),
      blk("b", at(9, 30), null),
    ]);
    expect(map.get("a")).toEqual({ col: 0, cols: 2 });
    expect(map.get("b")).toEqual({ col: 1, cols: 2 });
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `cd apps/web && pnpm exec vitest run src/features/board/utils/schedule.test.ts`
Expected: FAIL（`assignScheduleColumns` が存在せず import エラー、または `is not a function`）

- [ ] **Step 3: 関数を実装**

`apps/web/src/features/board/utils/schedule.ts` の末尾に追加する:

```ts
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
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `cd apps/web && pnpm exec vitest run src/features/board/utils/schedule.test.ts`
Expected: PASS（既存 + 追加分すべて green）

- [ ] **Step 5: 型チェック**

Run: `pnpm -F @acme/web typecheck`
Expected: エラーなし

- [ ] **Step 6: コミット**

```bash
git add apps/web/src/features/board/utils/schedule.ts apps/web/src/features/board/utils/schedule.test.ts
git commit -m "feat(board): Schedule 重なりブロックの列割り当て関数を追加"
```

---

### Task 2: `ScheduleColumn` / `ScheduleBlock` を左右分割で描画

**Files:**
- Modify: `apps/web/src/features/board/components/ScheduleColumn.tsx`
- Modify: `apps/web/src/features/board/components/ScheduleBlock.tsx`

**Interfaces:**
- Consumes: Task 1 の `assignScheduleColumns(items): Map<string, { col: number; cols: number }>`、既存 `TIME_GUTTER_PX`（configs/board）。
- Produces: `ScheduleBlock` に新 props `col: number`、`cols: number` を追加（`ScheduleColumn` のみが渡す）。

- [ ] **Step 1: `ScheduleBlock` に col/cols props を追加し、left/width を動的化**

`apps/web/src/features/board/components/ScheduleBlock.tsx` の `Props` interface に追加する:

```ts
interface Props {
  task: Task;
  onOpen?: (id: string) => void;
  /** 伸縮確定時に新しい endAt を保存 */
  onResize: (id: string, endAt: Date) => void;
  /** 開始済み（in_progress）の残像表示。半透明＋レーン D&D 無効 */
  isGhost?: boolean;
  /** 重なりレイアウトの列番号（0 始まり） */
  col: number;
  /** 重なりレイアウトの総列数（重なり無しは 1） */
  cols: number;
}
```

関数引数の分割代入に `col`、`cols` を足す:

```ts
export function ScheduleBlock({
  task,
  onOpen,
  onResize,
  isGhost = false,
  col,
  cols,
}: Props) {
```

`style` 内の `left: TIME_GUTTER_PX,` と `right: 4,` の 2 行を、次の 2 行に置き換える（`right` は削除し `width` を使う）:

```ts
        left: `calc(${TIME_GUTTER_PX}px + (100% - ${TIME_GUTTER_PX + 4}px) * ${col} / ${cols})`,
        width: `calc((100% - ${TIME_GUTTER_PX + 4}px) / ${cols} - 2px)`,
```

（`top`、`height`、`transition`、`zIndex` は変更しない。`cols === 1` のとき従来とほぼ同じ全幅になる。）

- [ ] **Step 2: `ScheduleColumn` でレイアウトを計算して渡す**

`apps/web/src/features/board/components/ScheduleColumn.tsx` の import に `assignScheduleColumns` を追加する（既存の `from "../utils/schedule"` ブロックに足す）:

```ts
import {
  assignScheduleColumns,
  dateAtMinutesOfDay,
  heightPx,
  minutesOfDay,
  topPx,
} from "../utils/schedule";
```

`nowTop` の定義行の直後にレイアウト計算を追加する:

```ts
  const nowTop = (minutesOfDay(now) - GRID_START_HOUR * 60) * PX_PER_MINUTE;
  // 重なるブロックを左右分割するための列割り当て（schedule＋ゴースト両方が対象）
  const columnLayout = assignScheduleColumns(blocks);
```

`blocks.map(...)` の `ScheduleBlock` 呼び出しに `col`/`cols` を渡す:

```tsx
          {blocks.map(({ task, isGhost }) =>
            task.startAt ? (
              <ScheduleBlock
                key={task.id}
                task={task}
                isGhost={isGhost}
                onOpen={onOpenTask}
                onResize={onResizeTask}
                col={columnLayout.get(task.id)?.col ?? 0}
                cols={columnLayout.get(task.id)?.cols ?? 1}
              />
            ) : null,
          )}
```

- [ ] **Step 3: 型チェック・lint・ビルド**

Run: `pnpm -F @acme/web typecheck && pnpm -F @acme/web lint && pnpm -F @acme/web build`
Expected: いずれもエラーなし（`build` が成功）

- [ ] **Step 4: 手動確認（dev サーバ）**

Run: `nvm use && pnpm dev:next`（→ http://localhost:3000）
確認:
- 時間が重なる schedule タスクを 2 件作る → 左右に並んで両方表示される。
- 背面だったタスクをクリックして Drawer が開く / 下端ドラッグでリサイズできる / 掴んで別レーンへ D&D できる。
- 重ならない単独タスクは従来どおりほぼ全幅で表示される。
- in_progress のゴーストが schedule タスクと重なる場合も左右に分かれる。

- [ ] **Step 5: コミット**

```bash
git add apps/web/src/features/board/components/ScheduleColumn.tsx apps/web/src/features/board/components/ScheduleBlock.tsx
git commit -m "feat(board): Schedule 重なりブロックを左右分割で表示"
```

---

## Self-Review

**1. Spec coverage（spec の各節 → 対応タスク）**
- 中核ロジック（`assignScheduleColumns`・クラスタ分割・貪欲列割り当て・実効区間） → Task 1。
- テスト（重なりなし/2件/連鎖クラスタ/ゴースト/既定60分） → Task 1 Step 1。spec の「境界排他」も Task 1 に「ちょうど隣接」ケースとして追加済み。
- 描画差し替え（`ScheduleColumn` でレイアウト計算 → `ScheduleBlock` の `left`/`width` を `calc` 化） → Task 2。
- 既存挙動維持（リサイズ/レーン D&D/DragOverlay/作成 Popover） → Task 2 Step 4 の手動確認で検証。`ScheduleBlockView`（DragOverlay）は `h-full` で親追従のため改修不要（spec 記載どおり）。
- 列の並び順（start→source 優先）: 描画順は `blocks` の既存順序に依存。`assignScheduleColumns` は内部で start 昇順ソートして列を決めるため、表示上の左右位置は時刻順で安定する。`zIndex` は据え置き（spec の「無害に残置」と一致）。

**2. Placeholder scan:** TODO/TBD/「適宜」等なし。各コードステップに完全なコードを記載済み。

**3. Type consistency:** `assignScheduleColumns` の戻り値 `Map<string, { col: number; cols: number }>` を Task 2 が `.get(id)?.col`/`.cols` で参照（一致）。`ScheduleBlock` の新 props `col`/`cols` は Task 2 内で定義・引き渡しとも整合。
