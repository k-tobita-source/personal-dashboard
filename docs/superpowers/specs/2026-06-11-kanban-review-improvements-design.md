# カンバン改修：白基調デザイン・詳細ドロワー・Schedule可変高さ・ソートアニメーション

作成日: 2026-06-11

レビュー指摘を受けた4点の改修設計。

## 背景と現状

- monorepo（Turborepo + pnpm）。フロントは `apps/web`（Next.js 16 / React 19 / Tailwind v4）、API は `packages/api`（tRPC）、DB は `packages/db`（Drizzle + better-sqlite3）。
- テーマ変数は [tooling/tailwind/theme.css](../../../tooling/tailwind/theme.css) に oklch で定義。`--primary` がコーラル／ピンク。
- ボードは [Board.tsx](../../../apps/web/src/features/board/components/Board.tsx) の4カラム。Schedule は [ScheduleColumn.tsx](../../../apps/web/src/features/board/components/ScheduleColumn.tsx) で「1時間バケツ」式（`min-h-9` の固定高さ）。
- カードは [TaskCard.tsx](../../../apps/web/src/features/board/components/TaskCard.tsx) で `useDraggable`（sortable 未使用 → 並び替えアニメーションなし）。
- Task スキーマ（[schema.ts](../../../packages/db/src/schema.ts)）には既に `body`・`startAt`・`endAt`・`position` が存在。**詳細文・工数の保存にスキーマ変更は不要**。

## 要件と決定事項

| # | 要件 | 決定 |
|---|------|------|
| 1 | 薄ピンク基調 → 白基調（GitHubライトモード風） | アクセントは **GitHub純正風ブルー** (`#0969da`) |
| 2 | タイトルに加え詳細文を入力。カード押下で右ドロワー。まずプレーンテキスト | **自動保存**（デバウンス＋blur）。ドロワーに**工数設定も同居** |
| 3 | Schedule タスクの縦幅を工数に応じ可変・Googleカレンダー風に伸縮 | **連続タイムグリッドへ作り替え**。伸縮は**15分スナップ** |
| 4 | ソート時にアニメーションがない | dnd-kit **`useSortable` + `SortableContext`** へ移行 |

## セクション1：白基調デザイン

- 変更は [tooling/tailwind/theme.css](../../../tooling/tailwind/theme.css) の**ライトモード変数のみ**。GitHub Primer 相当へ：
  - `--background`: `#ffffff`
  - 列の背景（`--secondary` / `--muted` / `--accent`）: 薄グレー `#f6f8fa`
  - `--card`: `#ffffff`
  - `--border`: `#d0d7de`
  - `--primary`（アクセント=リンク・選択リング・ドラッグ中ring）: `#0969da`
  - `--foreground`: `#1f2328`、`--muted-foreground`: `#656d76`
  - `--destructive` / 現在時刻線: `#cf222e`
- 既存表記に合わせ、これらを **oklch に変換**して記述（トーン統一のため）。
- **ダークモードは今回スコープ外**（変更しない）。ライトモードのみ刷新。
- 既存のピンク固有スタイルは全て `--primary` 等のトークン経由のため、変数差し替えで自動的にブルーへ追従する想定。コンポーネント側のハードコード色がないか実装時に grep で確認する。

## セクション2：タスク詳細ドロワー

### コンポーネント
- 新規 `TaskDrawer`（`apps/web/src/features/board/components/`）。右スライドイン＋半透明オーバーレイの軽量実装（外部ドロワーライブラリは追加しない）。閉じる手段：✕ボタン / Esc / オーバーレイクリック。
- `Board` に `selectedTaskId: string | null` のローカル状態を追加。カードクリックで set。
- ドラッグとクリックの分離：既存の `PointerSensor` `activationConstraint: { distance: 4 }` により、4px未満の操作はドラッグにならず `onClick` が発火する。これを利用（追加対応不要）。

### フィールドと挙動
- 共通：**タイトル**（input）、**詳細**（textarea・プレーンテキスト）。
- Schedule レーンのタスクのみ：**開始時刻** と **工数**（クイックチップ 15m / 30m / 1h / 2h / 3h、および数値編集）。工数は `endAt - startAt` を編集する形。
- **自動保存**：入力変更を ~600ms デバウンス、加えて blur 時に `task.update` を呼ぶ。保存完了で「✓保存しました」を一時表示。
- リッチエディタは将来対応。今回は plain textarea。

### API 変更
- `UpdateTaskInput`（[packages/api/src/service/task.ts](../../../packages/api/src/service/task.ts)）に `startAt?: Date | null`、`endAt?: Date | null` を追加し、`taskService.update` で反映。
- 詳細文は既存 `body` をそのまま使用。
- 楽観的更新：ドロワー編集中もボード表示へ即時反映するため、`task.update` mutation に `onMutate` でのキャッシュ更新を実装（既存 `useMoveTask` と同パターン）。

## セクション3：Schedule 連続タイムグリッド＋伸縮

### レイアウト
- `ScheduleColumn` を「1時間バケツ」から**連続グリッド**へ作り替える。
- 定数：`PX_PER_HOUR = 48`（= 0.8px/分）、`SNAP_MINUTES = 15`、グリッド表示範囲は既存 `HOURS`（0–23、必要なら表示時間帯を絞る検討は実装時）。
- 背景に時間目盛り（各時の罫線＋ラベル）を敷き、その上にタスクを**絶対配置ブロック**で重ねる。
- ブロックの位置：
  - `top = (startAtの分 - グリッド開始時刻の分) × (PX_PER_HOUR / 60)`
  - `height = max(durationMinutes, SNAP_MINUTES) × (PX_PER_HOUR / 60)`
- 工数 = `endAt - startAt`。`endAt` が `null` のタスクは**デフォルト60分**として描画。
- 現在時刻線：分単位で `top` を算出して赤線を配置。

### 工数（duration）の確定
- 他レーン → Schedule への移動時、`taskService.move` で `endAt` 未設定なら `endAt = startAt + 60min` を自動設定（`MoveTaskInput`/サービスを拡張）。
- ドロワーの工数設定（セクション2）と同じ `endAt` を編集対象とし、グリッドの高さと常に連動。

### 伸縮（リサイズ）
- 各ブロック下端に**ドラッグハンドル**を表示。
- dnd-kit ではなく**専用の pointer ハンドラ**（pointerdown → pointermove → pointerup）で実装。
- ドラッグ量を px→分換算し、**15分スナップ**で `endAt` を更新。**最小15分**を保証。
- 確定時に `task.update`（`endAt`）を楽観的更新付きで呼ぶ。

### 縦移動（時刻変更）
- ブロック本体のドラッグ（dnd-kit）で時刻変更。drop 時に `delta.y` から新 `top` を算出 → 分換算 → 15分スナップ → 新 `startAt`。工数（高さ）は維持し `endAt` も同量シフト。
- ドロップターゲットはグリッド全体を1つの droppable（`lane:schedule`）とし、`useBoardDnd` の drop 解決ロジックを「時刻 = ドロップ位置から算出」へ更新。`schedule.ts` の `dateAtHour` は分対応の関数（例 `dateAtMinutes`）へ拡張/追加。

### スコープ外（YAGNI）
- 同時刻に重なる複数タスクの**左右分割表示**は v1 では行わない（重なって表示で可）。必要になれば後続タスクで対応。

## セクション4：ソートアニメーション（dnd-kit）

- リスト型カラム（受信箱 `inbox`・In Progress `in_progress`・Done `done`）のカードを、`useDraggable` から **`useSortable`** へ移行。各カラムを **`SortableContext`（`verticalListSortingStrategy`）** でラップ。
  - これにより並び替え時の**レイアウト移動アニメーション（transform + transition）が標準で有効化**される。
- `DragOverlay` は維持。ドラッグ中の元カードは sortable の `isDragging` で半透明プレースホルダ表示。
- 並び替え確定：`onDragEnd` で `arrayMove` により新順を算出し、既存 `task.reorder`（`position`）を楽観的更新付きで呼ぶ。`useMoveTask` と同様の `onMutate`/`onError`/`onSettled` パターン。
- Schedule グリッドは「時刻による配置」のため sortable ではなく、ブロックの `top` / `height` に **CSS transition** を付けて値変化をアニメーションさせる。
- カラム間移動（lane 変更）も `useSortable` のコンテキストで引き続き機能させる（`DndContext` 配下で複数 `SortableContext` ＋ droppable を併用）。

## 影響ファイル（想定）

- `tooling/tailwind/theme.css` — 配色（ライトモード変数）
- `apps/web/src/features/board/components/TaskCard.tsx` — sortable 化、クリックで詳細を開く
- `apps/web/src/features/board/components/TaskDrawer.tsx` — 新規
- `apps/web/src/features/board/components/Board.tsx` — `selectedTaskId` 状態、`SortableContext`、ドロワー描画
- `apps/web/src/features/board/components/BoardColumn.tsx` — `SortableContext` ラップ
- `apps/web/src/features/board/components/ScheduleColumn.tsx` — 連続グリッドへ作り替え、リサイズハンドル
- `apps/web/src/features/board/hooks/useBoardDnd.ts` — Schedule の時刻算出・並び替え（reorder）対応
- `apps/web/src/features/board/utils/schedule.ts` / `groupTasks.ts` — 分単位ユーティリティ、グリッドレイアウト算出
- `apps/web/src/features/board/api/mutations.ts` — `useUpdateTask`（楽観的更新）、`useReorderTask`
- `packages/api/src/service/task.ts` — `UpdateTaskInput`/`MoveTaskInput` に `endAt` 等追加、`move` の `endAt` デフォルト
- `packages/validators`（あれば該当 Zod スキーマ）

## テスト方針

- API：`taskService.update`（`startAt`/`endAt` 反映）、`move`（`endAt` デフォルト付与）のユニットテスト。
- フロント：duration↔高さの換算（px/分・スナップ）ユーティリティのユニットテスト（純関数として切り出す）。
- 手動確認：白基調の見た目、ドロワー自動保存、Schedule の伸縮・縦移動・現在時刻線、リスト列のソートアニメーション。

## 未決事項

- なし（重なり表示の左右分割は意図的にスコープ外）。
