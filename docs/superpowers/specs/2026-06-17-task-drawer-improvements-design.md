# タスク詳細ドロワー改修 設計

作成日: 2026-06-17

## 背景・課題

タスク詳細ドロワー（[TaskDrawer.tsx](../../../apps/web/src/features/board/components/TaskDrawer.tsx)）に以下の3点を改善する。

1. **終了時間が見えない** — ドロワー内に開始時刻と工数は出るが、終了時刻が表示されていない。
2. **隣のアイテムへ移動できない** — 同じレーン内の上下のタスクへドロワーを切り替える手段がない。
3. **外部アイテムを開けない** — カレンダー / Gmail / Slack 由来のタスクから元ソースを開くリンクがドロワー内に無い。

いずれも **board feature 内のフロントエンドのみ**で完結する。service 層・DB スキーマ・tRPC ルーターの変更は不要（`startAt`/`endAt`/`url`/`source` は既に存在し、三値規約の update も実装済み）。

## スコープ外

- 開始・終了時刻の**編集**機能（feature 1 は表示のみ。工数プリセットによる変更は現状維持）。
- 別日への日付設定。本ボードは「当日の予定」前提のため対象外。

## 設計

### 1. 終了時間の表示（表示のみ）

[TaskDrawer.tsx](../../../apps/web/src/features/board/components/TaskDrawer.tsx) の「開始 / 工数」サマリ行を変更する。

- 現状: `{HH:mm} 開始 · {duration}分`
- 変更後: `{開始HH:mm} – {終了HH:mm} · {duration}分`（例: `09:00 – 10:00 · 60分`）
- 終了時刻の算出:
  - `endAt` があればそれを表示。
  - 無ければ `shiftMinutes(startAt, duration)` を使う（`duration` は `durationMinutes` が `endAt` 未設定時に既定60分へフォールバック済み）。
- 既存の工数プリセットボタン（15m/30m/1h…）は**そのまま残す**。

### 2. ＜前 / 次＞ナビゲーション

選択中タスクと同じレーン内の、表示順（lane 内 position 昇順）で前後のタスクへドロワーを切り替える。

- **Board.tsx**
  - 既存の `laneOrder: Record<Lane, string[]>` を再利用する。
  - 選択中タスクの lane 配列内 index を求め、prev/next の id を解決する `handleNavigate(dir: "prev" | "next")` を追加。範囲外なら何もしない。
  - 端判定 `canPrev` / `canNext` を算出し、`onNavigate` とともに `TaskDrawer` へ渡す。
- **TaskDrawer**
  - ヘッダーに「‹ 前」「次 ›」ボタンを追加。`canPrev`/`canNext` が false の側は `disabled`。
- **未保存編集の flush（「移動前に flush」要件）**
  - ナビボタンは `TaskDrawerForm` 内に配置し、クリック時に `if (dirtyRef.current) flush({})` → `onNavigate(dir)` の順で実行する。
  - `flush` が `dirtyRef.current = false` にするため、`key={task.id}` による再マウント時の unmount cleanup での二重保存は発生しない。
- **再マウントによる初期化**
  - 親の `selectedTaskId` が変わると `key={task.id}` で `TaskDrawerForm` が再マウントされ、新タスクの値で state が初期化される（既存の仕組みをそのまま活用）。

### 3. 外部リンク行

- タイトル入力の直下に1行追加する。
- 表示条件: `task.source !== "todo"` かつ `task.url` が存在する場合のみ。
- 内容: 既存の `SourceIcon` + `task.url` への `<a href={task.url} target="_blank" rel="noopener noreferrer">`。ラベルは「元ソースで開く ↗」（または `SOURCE_ICON[source].label` を併記）。

### Props 変更

`TaskDrawer` と内部の `TaskDrawerForm` に以下を追加する。

```ts
onNavigate: (dir: "prev" | "next") => void;
canPrev: boolean;
canNext: boolean;
```

## テスト・完了基準

- ドロワー UI / dnd には既存のコンポーネントテストが無いため、純粋ロジックの新規 util を切り出す場合のみ vitest を追加する。
- 完了基準は CLAUDE.md の品質チェック通過とする:
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm format`
  - `pnpm -F @acme/web build`
- 手動確認: (a) Schedule タスクで終了時刻が表示される、(b) 各レーンで前/次ボタンが端で無効化されつつ切り替わる、(c) 外部タスクでリンクが新規タブで開く / todo では出ない。

## 影響ファイル（想定）

- `apps/web/src/features/board/components/TaskDrawer.tsx`（主たる変更）
- `apps/web/src/features/board/components/Board.tsx`（navigate / canPrev / canNext の配線）
