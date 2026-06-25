# Schedule クイック追加（空き時間クリックでタスク作成）設計

作成日: 2026-06-17

## 背景・目的

現状、タスクは受信箱の `AddTodoForm` からしか追加できない。Schedule レーンの
連続タイムグリッド上で、空いている時間帯をクリック／ドラッグして、その場でタスクを
作成できるようにする（Google カレンダーの「クリックで予定追加」相当）。UI は Popover。

## スコープ

- 入力項目: **タイトル＋時刻範囲（開始・終了）＋本文(body)**。
- 操作: **クリック**（その位置を開始に既定60分）と**上下ドラッグでの範囲選択**の両方。
- 作成先は常に `schedule` レーン（`startAt` を持つため）。

非対象（YAGNI）: 楽観的更新、ソース選択（常に `todo`）、繰り返し予定、複数日選択。

## データ契約の拡張

`create` の契約は UI/MCP 共通。終了時刻を作成時に指定できるよう `endAt` を追加する。

### `packages/api/src/service/task.ts`

- `CreateTodoInput` に `endAt: z.date().optional()` を追加（工数の終端。`startAt` とセットで
  Schedule 作成時に使用）。
- `taskService.create` の `insert().values({...})` に `endAt: input.endAt` を追加。
  lane 自動判定（`startAt` あり → `schedule`）は現状のまま。`endAt` 未指定なら null（表示は既定60分）。

### `apps/web/src/features/board/api/mutations.ts`

- `useCreateTask` は現状どおり **invalidate のみ（楽観更新なし）** を踏襲。作成後 refetch で
  Schedule にブロックが現れる。既存 `AddTodoForm` と同一挙動。

## フック: `useScheduleSelection`

`apps/web/src/features/board/hooks/useScheduleSelection.ts`（新規）

グリッド背景上の pointer 操作から「選択された時間帯」を導出する。`ScheduleBlock` の resize と
同じ「`useEffect` で window listener を着脱」パターンを踏襲する。

返り値:

```
selection: { startMin: number; endMin: number } | null  // 確定した範囲（当日0:00起点の分）
isDragging: boolean                                       // ドラッグ選択中（ゴースト矩形描画用）
onBackgroundPointerDown(e): void                          // 背景に渡すハンドラ
clear(): void                                             // Popover を閉じる時に選択解除
```

ロジック:

- `pointerdown` で開始 Y を記録（ローカル座標 = `clientY - rect.top + scrollTop`）。
  `pxToMinutes` → `snapMinutes(_, 15)` → `clampDayMinutes` で開始分を算出。
- `pointermove` で現在 Y を分換算。開始との差が**閾値（4px 相当）未満ならクリック扱い**、
  超えたら `isDragging=true`。
- `pointerup` で `selectionToRange()`（下記 util）に通して `selection` を確定。`clear()` で null。

純粋計算は util へ切り出す（テスト対象）:

### `apps/web/src/features/board/utils/schedule.ts`

`selectionToRange(startMin, endMin, isDrag): { startMin, endMin }` を追加。

- `isDrag=false`（クリック）→ `{ startMin, endMin: startMin + 60 }`。
- `isDrag=true` → `min/max` で正規化（逆方向ドラッグ対応）。
- いずれも `endMin - startMin < 15`（最小工数）なら 15分にクランプ。
- `clampDayMinutes` で 0〜1439 に収め、`endMin` は 1440 を超えないようクランプ。

分↔Date 変換は描画／送信側で既存 `dateAtMinutesOfDay` を使う（フックは分のまま扱い純粋に保つ）。

## コンポーネント

### `packages/ui/src/popover.tsx`（新規）

`dropdown-menu.tsx` と同じ流儀で `radix-ui` の `Popover` をラップ。
`Popover`(Root) / `PopoverAnchor` / `PopoverTrigger` / `PopoverContent`(Portal + 既定スタイル)
をエクスポート。`packages/ui/package.json` の exports に `./popover` を追加。

### `apps/web/src/features/board/components/ScheduleQuickAdd.tsx`（新規）

Popover 内の作成フォーム（presentational + 作成）。

- props: `selection: { startMin; endMin }`, `now: Date`, `onCreated()`, `onCancel()`。
- 内部 state: `title` / `body` / `startMin` / `endMin`（selection を初期値に）。
- フォーム: タイトル `Input`、開始〜終了の `<input type="time">`、本文 `textarea`
  （`TaskDrawer.tsx` の素の textarea を踏襲）、作成 `Button`。
- 送信: `useCreateTask().mutate({ title, body: body || undefined,
  startAt: dateAtMinutesOfDay(startMin, now), endAt: dateAtMinutesOfDay(endMin, now),
  lane: "schedule" })` → `onCreated()`。タイトル空は送信不可、`isPending` 中は無効化。
- 開始≥終了は送信前に終了=開始+15分へ補正。

### `apps/web/src/features/board/components/ScheduleColumn.tsx`（改修）

- `useScheduleSelection()` を呼び、背景の相対 div に `onPointerDown={onBackgroundPointerDown}`。
- 装飾レイヤ（時間目盛り）に `pointer-events-none` を付与し、クリックを背景へ届かせる
  （現在時刻ラインは既に pointer-events-none）。
- `isDragging` 中は選択範囲に**ゴースト矩形**を描画（`top=topPx`、高さは選択幅、`bg-primary/15`、
  `TIME_GUTTER_PX` ぶん右寄せでブロックと整列）。
- `selection` 確定で、その矩形位置に絶対配置のサイズ0 `PopoverAnchor` を置き、`Popover` を open に。
  `PopoverContent` に `ScheduleQuickAdd` を描画。作成完了/キャンセル/Esc/外側クリックで `clear()`。

## フロー

1. 背景 pointerdown →（ドラッグなら矩形プレビュー）→ pointerup で `selection` 確定。
2. `selection` 位置に `PopoverAnchor`、Popover open、タイトルにフォーカス。
3. 作成 → `useCreateTask` → invalidate → refetch で Schedule にブロック出現 → `clear()`。
4. 外側クリック / Esc / キャンセル → `clear()`（作成せず閉じる）。

## エッジケース

- **既存ブロック上の pointerdown**: ブロックが draggable/独自ハンドラを持つため背景ハンドラは
  発火しない（追加は空き領域のみ）。重なる位置までのドラッグは許容（重複可）。
- **逆方向ドラッグ**: `min/max` で正規化。
- **極小ドラッグ**: 閾値未満はクリック扱い（60分）。閾値超でも幅 <15分なら15分にクランプ。
- **日付境界**: `clampDayMinutes` で当日内に限定。`endMin` は 1440 を超えないようクランプ。
- **time 入力で開始≥終了**: 終了=開始+15分へ補正。
- **二重送信**: `createTask.isPending` で作成ボタン無効化。
- **D&D/リサイズとの競合**: 背景 droppable は drag を開始しないため非競合。

## テスト

既存 `utils/*.test.ts`（Vitest）の流儀に合わせ、純粋計算のみを対象とする。

- `schedule.test.ts` に `selectionToRange` のテストを追加:
  クリック=60分 / 逆ドラッグ正規化 / 最小15分クランプ / 日付境界クランプ。
- pointer イベント（DOM 結合部）はテストしない。

## 変更ファイル一覧

新規:
- `packages/ui/src/popover.tsx`
- `apps/web/src/features/board/hooks/useScheduleSelection.ts`
- `apps/web/src/features/board/components/ScheduleQuickAdd.tsx`

改修:
- `packages/ui/package.json`（exports に `./popover`）
- `packages/api/src/service/task.ts`（`CreateTodoInput`/`create` に `endAt`）
- `apps/web/src/features/board/components/ScheduleColumn.tsx`
- `apps/web/src/features/board/utils/schedule.ts`（`selectionToRange`）
- `apps/web/src/features/board/utils/schedule.test.ts`

## 品質チェック

`pnpm typecheck` / `pnpm lint` / `pnpm format` / `pnpm -F @acme/web build`。
`@acme/db` スキーマ変更なし → マイグレーション不要。
