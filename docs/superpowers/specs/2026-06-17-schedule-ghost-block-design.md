# Schedule のゴーストブロック（開始済みタスクの残像表示）

- 日付: 2026-06-17
- ステータス: 設計承認済み（実装計画へ）

## 背景・課題

Schedule レーンは当日の連続タイムグリッドで、`startAt` を持つタスクをブロックとして描画する。
現状、`startAt <= now` になったタスクは `useAutoAdvance` により自動で `in_progress` レーンへ移動する
（[utils/autoAdvance.ts](../../../apps/web/src/features/board/utils/autoAdvance.ts) のルール）。

その結果、開始したタスクは Schedule から即座に消える。`ScheduleColumn` は
`lane === "schedule"` のタスク（`groups.schedule`）だけを描画しているためである
（[components/ScheduleColumn.tsx](../../../apps/web/src/features/board/components/ScheduleColumn.tsx)）。

時間が進むと Schedule が空になり、「今どの時間帯に何が動いているか」がタイムライン上で見えなくなって見づらい。

## ゴール

- 開始済みタスクは従来どおり `in_progress` に入れる（自動移動の挙動は変えない）。
- 同時に、開始済みタスクを **Schedule にも残像（ゴースト）として残す**（半透明で表示）。
- **終了時刻を過ぎたら Schedule から消える**（タスク自体は `in_progress` に残る）。

## 仕様

### 1. 表示ルール（純粋関数で導出）

Schedule タイムラインに描画する対象を、`lane` / `startAt` / 終了時刻 / `now` から導出する純粋関数
`selectScheduleBlocks(tasks, now)` を新設する。戻り値は `{ task: Task; isGhost: boolean }[]`。

判定:

- `lane === "schedule"` かつ `startAt` あり → 通常表示（`isGhost: false`）
- `lane === "in_progress"` かつ `startAt` あり かつ **終了時刻 > now** → ゴースト表示（`isGhost: true`）
- 上記いずれにも該当しないタスクは Schedule に描画しない

終了時刻の定義:

```
終了時刻 = startAt + durationMinutes(startAt, endAt)
```

`durationMinutes`（[utils/schedule.ts](../../../apps/web/src/features/board/utils/schedule.ts)）は
`endAt` 未設定時に既定 60 分を返す。したがって `endAt` の無い todo / slack / gmail のゴーストは
**開始から 60 分で Schedule から消える**（高さ計算の既定工数と一貫）。calendar は `endAt` を用いる。

`now` は毎分更新される（`useNow`）ため、`now` を依存に含めて再評価すれば、ゴーストは時間経過で自然に消える。
追加の state やタイマーは不要。

補足:

- calendar タスクは別途、既存の「`endAt` 超過 → done」自動移動でも `in_progress` から外れる。
  ゴーストの消滅条件（終了時刻 > now）と整合し、done へ移動した時点で Schedule からも消える。
- ゴーストが Schedule に出ている間、同じタスクは In Progress カラムにも実カードとして並ぶ（意図どおり）。

### 2. スタイル（dim）

`ScheduleBlock` に `isGhost` prop を追加する。ゴーストは「動作中の残像」と分かる半透明表示にする:

- 透過: `opacity-50` 程度
- 背景: `bg-muted/40` 寄り（実ブロックの `bg-card` より落ち着いた見た目）
- 左アクセントバー（ソース色）・タイトル・時刻表示は維持

### 3. インタラクション（操作可能を維持）

ゴーストでも以下は維持する:

- **クリックでドロワーを開く**
- **下端ドラッグで `endAt` 伸縮**（伸ばすと消える時刻も後ろにずれる＝自然な挙動）

一方、**ブロック全体のレーン D&D は無効化**する。

理由: `in_progress` のゴーストは Schedule（`ScheduleBlock` = `useDraggable({ id: task.id })`）と
In Progress カラム（`TaskCard` = `useSortable({ id: task.id })`）の両方に描画される。
dnd-kit は同一 id の draggable を複数登録できないため、ゴーストが `task.id` で draggable を登録すると衝突する。

実装方針（hooks 規則を守る）:

- `useDraggable` は常に呼ぶが、id をゴースト時のみ `ghost:${task.id}` にする
  （`useDraggable({ id: isGhost ? \`ghost:${task.id}\` : task.id })`）。
- ゴースト時は `listeners` / `attributes` を spread せず、`onPointerDown` でも `listeners` を呼ばない
  → 実際には掴めない（レーン移動が起きない）。
- リサイズハンドルとクリック判定は `task.id` を直接参照しているため、上記の変更の影響を受けない。

## 変更ファイル

- 新規: `selectScheduleBlocks(tasks, now): { task, isGhost }[]`
  - 配置は `utils/schedule.ts`（px 計算と同居）または `utils/groupTasks.ts`。実装計画で確定。
  - ユニットテスト追加（schedule / in_progress・終了時刻前後・endAt 有無・startAt 無しの各ケース）。
- [components/Board.tsx](../../../apps/web/src/features/board/components/Board.tsx):
  `groups.schedule` の代わりに `selectScheduleBlocks(tasks, now)` を `ScheduleColumn` に渡す。
- [components/ScheduleColumn.tsx](../../../apps/web/src/features/board/components/ScheduleColumn.tsx):
  `{ task, isGhost }[]` を受け取り、`ScheduleBlock` に `isGhost` を渡す。
- [components/ScheduleBlock.tsx](../../../apps/web/src/features/board/components/ScheduleBlock.tsx):
  `isGhost` prop で dim スタイル＋レーン D&D 無効化。

## 非対象（YAGNI）

- ゴーストの自動 done 化（非 calendar）は行わない。終了時刻でゴーストが消えるだけで、タスクは `in_progress` に残る。
- ゴーストからのレーン移動 D&D は提供しない（レーン移動は In Progress カラムの実カードで行う）。

## テスト観点

- `selectScheduleBlocks`: schedule は常時表示 / in_progress は終了時刻前のみゴースト / 終了時刻後は非表示 /
  `endAt` 無しは開始+60分で消える / `startAt` 無しは非表示。
- 目視: 開始到達でブロックが半透明化しつつ Schedule に残り、終了時刻で消えること。
  ゴーストのクリック（ドロワー）とリサイズ（`endAt` 更新）が動作すること。
