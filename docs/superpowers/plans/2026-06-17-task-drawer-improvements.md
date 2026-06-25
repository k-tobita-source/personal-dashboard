# タスク詳細ドロワー改修 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** タスク詳細ドロワーに「終了時刻の表示」「同一レーン内の前/次ナビゲーション」「外部ソースへのリンク行」を追加する。

**Architecture:** board feature 内のフロントエンドのみで完結。`TaskDrawer.tsx`（表示・ナビUI・リンク）と `Board.tsx`（prev/next の配線）を変更。service 層・DB スキーマ・tRPC は変更しない（`startAt`/`endAt`/`url`/`source` は既存、三値規約の update も実装済み）。

**Tech Stack:** Next.js / React（React Compiler 前提で手動 memo なし）, TypeScript 5.9, Tailwind, date-fns, dnd-kit。設計: [docs/superpowers/specs/2026-06-17-task-drawer-improvements-design.md](../specs/2026-06-17-task-drawer-improvements-design.md)。

## Global Constraints

- Node 22 系（`nvm use`）。pnpm 10 / TypeScript 5.9。パッケージ名は `@acme/*`。
- ファイル名規約: `.tsx` は PascalCase、`.ts` は camelCase、ディレクトリ kebab-case。
- 手動 memo は入れない（React Compiler に任せる）。
- 完了基準: `pnpm typecheck` / `pnpm lint` / `pnpm format` / `pnpm -F @acme/web build` をすべて通す。
- 三値規約（undefined=据え置き / null=クリア / Date=設定）を崩さない。本改修では時刻の**表示のみ**で編集は追加しない。

---

### Task 1: 終了時刻の表示

ドロワーの「開始 / 工数」サマリ行に終了時刻を追加する（表示のみ、編集機能は追加しない）。

**Files:**
- Modify: `apps/web/src/features/board/components/TaskDrawer.tsx`（`TaskDrawerForm` 内の `startAt && (...)` ブロック、現状 172–203 行付近）

**Interfaces:**
- Consumes: 既存 util `durationMinutes(startAt, endAt)`, `shiftMinutes(date, minutes)`（`../utils/schedule`）, `format`（date-fns）。`task.startAt: Date | null`, `task.endAt: Date | null`。
- Produces: なし（UI 変更のみ）。

- [ ] **Step 1: 終了時刻を算出して表示行を変更**

`TaskDrawerForm` 内、`const duration = ...` の直後（現状 108–111 行付近）の `startAt` 算出ブロックはそのまま。`startAt && (...)` ブロック内のサマリ行（現状 177–179 行）を以下に置き換える。終了時刻は `endAt` があればそれを、無ければ `duration`（既定60分にフォールバック済み）から算出する。

置き換え前:

```tsx
          <div className="text-muted-foreground mb-2 text-xs tabular-nums">
            {format(startAt, "HH:mm")} 開始 · {duration}分
          </div>
```

置き換え後:

```tsx
          <div className="text-muted-foreground mb-2 text-xs tabular-nums">
            {format(startAt, "HH:mm")} –{" "}
            {format(task.endAt ?? shiftMinutes(startAt, duration), "HH:mm")} ·{" "}
            {duration}分
          </div>
```

`shiftMinutes` は既に import 済み（現状 14 行）なので追加 import 不要。

- [ ] **Step 2: 型チェックとビルド確認**

Run: `pnpm typecheck && pnpm -F @acme/web build`
Expected: PASS（エラーなし）

- [ ] **Step 3: 手動確認**

`pnpm dev:next` で起動し、Schedule レーンのタスクをドロワーで開く。サマリ行が `09:00 – 10:00 · 60分` の形式（開始 – 終了 · 工数）で表示されること。工数プリセットボタンを押すと終了時刻も追従すること。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/board/components/TaskDrawer.tsx
git commit -m "feat(board): show end time in task drawer summary

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 外部ソースへのリンク行

外部アイテム（calendar / gmail / slack）でタイトル直下に「元ソースで開く」リンクを表示する。

**Files:**
- Modify: `apps/web/src/features/board/components/TaskDrawer.tsx`（import 追加、`TaskDrawerForm` のタイトル div 直後にリンク行を追加）

**Interfaces:**
- Consumes: `SourceIcon`（`./SourceIcon`）, `SOURCE_ICON`（`../configs/board`）, `task.source: Source`, `task.url: string | null`。
- Produces: なし（UI 変更のみ）。

- [ ] **Step 1: import を追加**

`TaskDrawer.tsx` の import 群（現状 6–14 行付近）に以下を追加する。`SOURCE_ICON` は既存の `configs/board` import 行へ統合し、`SourceIcon` は新規行で追加する。

```tsx
import {
  DEFAULT_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
  SOURCE_ICON,
} from "../configs/board";
import { SourceIcon } from "./SourceIcon";
```

（`durationMinutes, shiftMinutes` の `../utils/schedule` import 行は変更不要。）

- [ ] **Step 2: リンク行を追加**

`TaskDrawerForm` の return 内、タイトル入力の `</div>`（現状 128 行）の直後・「詳細」div の前に以下を挿入する。

```tsx
      {task.source !== "todo" && task.url && (
        <a
          href={task.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary inline-flex items-center gap-1.5 text-xs font-medium hover:underline"
        >
          <SourceIcon source={task.source} size={14} />
          {SOURCE_ICON[task.source].label} で開く ↗
        </a>
      )}
```

- [ ] **Step 3: 型チェックとビルド確認**

Run: `pnpm typecheck && pnpm -F @acme/web build`
Expected: PASS

- [ ] **Step 4: 手動確認**

Slack / Gmail / カレンダー由来のタスクをドロワーで開くと、タイトル下にソースアイコン付きリンクが出て、クリックで新規タブが開くこと。独自 ToDo（source=todo）や url が NULL のタスクではリンクが出ないこと。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/board/components/TaskDrawer.tsx
git commit -m "feat(board): add external source link in task drawer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: ＜前 / 次＞ナビゲーション

同一レーン内の表示順で前後のタスクへドロワーを切り替える。切り替え前に未保存の編集を flush する。

**Files:**
- Modify: `apps/web/src/features/board/components/Board.tsx`（prev/next 解決と配線）
- Modify: `apps/web/src/features/board/components/TaskDrawer.tsx`（Props 追加、ナビボタン UI）

**Interfaces:**
- Produces（Board → TaskDrawer の新 Props）:
  - `onNavigate: (dir: "prev" | "next") => void`
  - `canPrev: boolean`
  - `canNext: boolean`
- Consumes: Board 既存の `laneOrder: Record<Lane, string[]>`, `selectedTask: Task | null`, `setSelectedTaskId`。TaskDrawerForm 内既存の `dirtyRef`, `flush`。

- [ ] **Step 1: Board に prev/next 解決ロジックを追加**

`Board.tsx`、`selectedTask` 算出（現状 55–57 行）と `laneOrder`（現状 59–67 行）の後に以下を追加する。`laneOrder` を参照するため、`laneOrder` 定義より後に置くこと。

```tsx
  const selectedLaneIds = selectedTask ? laneOrder[selectedTask.lane] : [];
  const selectedIndex = selectedTask
    ? selectedLaneIds.indexOf(selectedTask.id)
    : -1;
  const canPrev = selectedIndex > 0;
  const canNext =
    selectedIndex >= 0 && selectedIndex < selectedLaneIds.length - 1;
  const handleNavigate = (dir: "prev" | "next") => {
    if (selectedIndex < 0) return;
    const nextId =
      selectedLaneIds[dir === "prev" ? selectedIndex - 1 : selectedIndex + 1];
    if (nextId) setSelectedTaskId(nextId);
  };
```

- [ ] **Step 2: Board の TaskDrawer 呼び出しに新 Props を渡す**

`Board.tsx` の `<TaskDrawer ... />`（現状 174–181 行）に以下の3 Props を追加する。

```tsx
      <TaskDrawer
        task={selectedTask}
        onClose={() => setSelectedTaskId(null)}
        onSave={(id, patch) => update.mutate({ id, ...patch })}
        onChangeDuration={(id, endAt) => update.mutate({ id, endAt })}
        onMove={handleMoveLane}
        onDelete={(id) => del.mutate(id)}
        onNavigate={handleNavigate}
        canPrev={canPrev}
        canNext={canNext}
      />
```

- [ ] **Step 3: TaskDrawer / TaskDrawerForm の Props 型を拡張**

`TaskDrawer.tsx` の `Props` interface（現状 26–37 行）に追加:

```tsx
  /** 同一レーン内の前/次へ切り替え */
  onNavigate: (dir: "prev" | "next") => void;
  /** 前のアイテムが存在するか */
  canPrev: boolean;
  /** 次のアイテムが存在するか */
  canNext: boolean;
```

`FormProps` interface（現状 39–45 行）にも追加:

```tsx
  onNavigate: Props["onNavigate"];
  canPrev: Props["canPrev"];
  canNext: Props["canNext"];
```

- [ ] **Step 4: TaskDrawerForm でナビハンドラとボタンを実装**

flush を確実に行うため、ナビボタンは `TaskDrawerForm`（flush/dirtyRef を持つ）内に置く。

まず関数シグネチャ（現状 51–57 行）に新 Props を受け取らせる:

```tsx
function TaskDrawerForm({
  task,
  onClose,
  onSave,
  onChangeDuration,
  onMove,
  onNavigate,
  canPrev,
  canNext,
}: FormProps) {
```

次に `scheduleSave` 定義（現状 101–106 行）の直後に、移動前 flush を行うハンドラを追加:

```tsx
  // 前/次へ切り替える前に、保留中の編集を確定保存する（「移動前に flush」）。
  // flush が dirtyRef を false にするため、key 再マウントの cleanup で二重保存しない。
  const navigate = (dir: "prev" | "next") => {
    if (timer.current) clearTimeout(timer.current);
    if (dirtyRef.current) flush({});
    onNavigate(dir);
  };
```

最後に return 直後の最外 div（現状 113–114 行）の中、先頭に前/次ボタン行を追加:

```tsx
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 text-sm">
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate("prev")}
          disabled={!canPrev}
          className="text-muted-foreground hover:text-foreground text-xs disabled:cursor-not-allowed disabled:opacity-40"
        >
          ‹ 前
        </button>
        <button
          onClick={() => navigate("next")}
          disabled={!canNext}
          className="text-muted-foreground hover:text-foreground text-xs disabled:cursor-not-allowed disabled:opacity-40"
        >
          次 ›
        </button>
      </div>
```

（既存のタイトル div 以降はそのまま。）

- [ ] **Step 5: TaskDrawer 本体から新 Props を Form へ渡す**

`TaskDrawer` 関数の分割代入（現状 211–218 行）に `onNavigate, canPrev, canNext` を追加し、`<TaskDrawerForm ... />`（現状 249–256 行）にも渡す:

```tsx
export function TaskDrawer({
  task,
  onClose,
  onSave,
  onChangeDuration,
  onMove,
  onDelete,
  onNavigate,
  canPrev,
  canNext,
}: Props) {
```

```tsx
        <TaskDrawerForm
          key={task.id}
          task={task}
          onClose={onClose}
          onSave={onSave}
          onChangeDuration={onChangeDuration}
          onMove={onMove}
          onNavigate={onNavigate}
          canPrev={canPrev}
          canNext={canNext}
        />
```

- [ ] **Step 6: 型チェックとビルド確認**

Run: `pnpm typecheck && pnpm -F @acme/web build`
Expected: PASS

- [ ] **Step 7: 手動確認**

各レーンで複数タスクがある状態でドロワーを開く。「‹ 前」「次 ›」で同一レーン内の上下タスクへ切り替わること。レーン先頭で「前」、末尾で「次」が disabled になること。タイトル/詳細を編集してから即ナビすると、切り替え前に編集が保存される（戻ると保存済み）こと。

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/board/components/TaskDrawer.tsx apps/web/src/features/board/components/Board.tsx
git commit -m "feat(board): prev/next navigation between tasks in task drawer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: 最終品質チェック

**Files:** なし（検証のみ）

- [ ] **Step 1: 全品質チェックを通す**

Run: `pnpm typecheck && pnpm lint && pnpm format && pnpm -F @acme/web build`
Expected: すべて PASS。`format` で差分が出たら次ステップで取り込む。

- [ ] **Step 2: format 差分があればコミット**

```bash
git add -A
git commit -m "style(board): apply prettier to task drawer changes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

（差分が無ければこのコミットはスキップ。）
