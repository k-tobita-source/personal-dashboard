# 別レーンへのライブプレビュー挿入（cross-lane drag insert）

- 日付: 2026-06-17
- 状態: 設計確定（実装計画へ）

## 背景・課題

カードを別レーンへ D&D で移動するとき、現状はカードの上にドロップしても常に「末尾へ」（Done のみ先頭へ）配置され、**任意の中間位置に差し込めない**。

- 同一レーン内の並び替えは `positionBetween` で中間挿入できている（[useBoardDnd.ts:124-138](../../../apps/web/src/features/board/hooks/useBoardDnd.ts#L124-L138)）。
- 別レーン移動は `move()` が `nextPosition`／Done は `firstPosition` 固定で position を受け取らない（[task.ts:117-150](../../../packages/api/src/service/task.ts#L117-L150)）。

ユーザー要望: 別レーンの好きな位置にも差し込めるようにする。さらに **ドラッグ中のライブプレビュー**（移動先のカードがリアルタイムに隙間を空ける Trello 風）も含める。

## 方針

dnd-kit の「マルチコンテナ Sortable」標準パターンを採用する。ドラッグ中だけ有効なローカルの並び順 override を持ち、`onDragOver` でドラッグ中のカードを「移動先レーンの・指定インデックス」に差し込んだ状態を作る。各カラムはその override 順でレンダリングするので、移動先のカードがリアルタイムに隙間を空けて動く。`onDragEnd` で最終位置を確定し、既存の楽観的更新へ流す。

DnD ロジックは [useBoardDnd.ts](../../../apps/web/src/features/board/hooks/useBoardDnd.ts) に集約する方針を維持し、preview state とハンドラはこのフックに持たせる。Board はフックが返す表示順でカラムを描画するだけにする。

## スコープ

- **対象は3つのカラムレーン（Todo / In Progress / Done）間**の移動。ここにライブプレビュー＋中間挿入を実装する。
- **Schedule レーンは対象外**（連続タイムグリッドで「位置」ではなく「時刻」が状態のため）。Schedule への/からの D&D は現状ロジックのまま（時刻ドロップ／縦リサイズ）。`onDragOver` で over/active が schedule のときは preview を変更せず早期 return する。

## 変更点

### サービス層 / 契約（packages/api）

- `MoveTaskInput` に `position: z.number().optional()` を追加（[task.ts:25-33](../../../packages/api/src/service/task.ts#L25-L33)）。
- `move()`：`input.position` があればそれを使い、無ければ従来通り `nextPosition`／Done は `firstPosition`（[task.ts:117-150](../../../packages/api/src/service/task.ts#L117-L150)）。後方互換を保つ。

### 楽観的更新（apps/web mutations）

- `applyMove`：`vars.position` があればそれを反映し `byLaneThenPosition` で並べ替え。無ければ従来の Done 先頭ロジック（[mutations.ts:65-83](../../../apps/web/src/features/board/api/mutations.ts#L65-L83)）。確定 position をプレビューと一致させるので、ドロップ→確定でカードが飛ばない。

### DnD フック（中心: useBoardDnd）

- `previewOrder: Record<Lane, string[]> | null` state を追加。`onDragStart` で初期化（現在の laneOrder のコピー）、`onDragCancel`/`onDragEnd` でクリア。
- `onDragOver` を新設：
  - over がカード or `lane:<lane>` から移動先レーン＋挿入インデックスを算出。
  - over がカードのときは over カードの矩形中点と active の位置から「前/後ろ」を判定（dnd-kit 標準の `isBelowOverItem` 方式）。
  - active を previewOrder 上で元レーンから取り除き、移動先レーンの該当インデックスへ差し込む。
  - over/active が schedule に絡む場合は preview を変更せず return。
- `onDragEnd`：
  - schedule 関連の既存分岐（`over === "lane:schedule"`、schedule 内縦移動、calendar 保護）はそのまま維持。
  - カラムレーン確定時は previewOrder から active の前後カードの position で `positionBetween` を計算。
    - レーン不変なら `onReorder({ id, position })`。
    - レーン変化なら `onMove({ id, lane, position, startAt: lane === "inbox" ? null : undefined })`。
- 返り値に `displayOrder`（preview があればそれ、無ければ laneOrder）を追加。
- 既存の `arrayMove` ベースの同一レーン並び替え分岐は preview ベースに置き換える。

### Board / Column（apps/web components）

- `DndContext` に `onDragOver` を接続。
- 3カラムは `displayOrder` の id 列を `tasksById` で Task に解決して描画（`groups.inbox` 直渡しをやめる）。Schedule は従来通り `groups.schedule`。
- BoardColumn / TaskCard 自体は変更なし（既に `useSortable` + `SortableContext`）。

## テスト

- 既存 `position.test.ts` は維持。
- フックの純粋部分を `utils/reorder.ts`（仮）へ切り出してユニットテスト可能にする:
  - 「id を `(lane, index)` へ移動して新しい `Record<Lane, string[]>` を返す」関数。
  - 「前後 id（と tasksById）から確定 position を算出する」関数。
- 既存の typecheck / lint / build / vitest を通す。

## 非対象（YAGNI）

- Schedule ↔ カラム間の中間挿入（時刻マッピングが別途必要なため今回は対象外）。
- 複数選択ドラッグ、キーボード操作での並び替え。
