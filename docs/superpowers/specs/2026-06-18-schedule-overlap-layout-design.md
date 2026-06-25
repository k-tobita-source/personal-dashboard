# Schedule 重なりブロックの左右分割レイアウト設計

作成日: 2026-06-18

## 背景・目的

Schedule レーンの連続タイムグリッドでは、各ブロックが `left: TIME_GUTTER_PX, right: 4`
（＝常に全幅）で絶対配置され、時間が重なると `zIndex`（calendar=15 / その他=10）で前後する
だけになっている（[ScheduleBlock.tsx:150-161](../../../apps/web/src/features/board/components/ScheduleBlock.tsx#L150-L161)）。
結果、背面のブロックは前面に完全に覆われ、クリック・ドラッグ・リサイズが一切できない。

これを **Google カレンダー風の左右分割** に変更し、重なったブロックが横に並んで
すべて見える・操作できるようにする。

## スコープ

- 重なるブロック群を検出し、各ブロックに列を割り当てて横並びにする。
- 想定する同時重なり件数は **基本2件・たまに3件**。3件でも分割で成立させる
  （各列は細くなりタイトル/時刻は truncate、詳細はクリックで Drawer 表示の現状動線でカバー）。
- 対象は Schedule タイムラインに描画される **全ブロック**（`schedule` レーン＋
  `in_progress` のゴースト）。ゴーストもレイアウト計算に含め、実ブロックと重ならせない。

非対象（YAGNI）:

- Google カレンダーの「後続に衝突がなければ幅を広げる」高度な伸張ロジックは入れない。
  クラスタ内は**均等分割**に割り切る。
- リサイズ中のライブ再フローはしない（後述）。
- 重なり件数に応じた折り畳み（+N チップ）は今回は入れない（件数が少ないため不要）。

## 中核ロジック（純粋関数）

### `apps/web/src/features/board/utils/schedule.ts`（関数を追加）

列割り当て関数を追加する。カレンダーの定番（区間グラフの貪欲彩色）。

```
assignScheduleColumns(items, now) -> Map<taskId, { col: number; cols: number }>
```

アルゴリズム:

1. 各ブロックの実効区間を求める。`start = startAt`、
   `end = start + max(durationMinutes(startAt, endAt), MIN_DURATION_MINUTES)`。
   実効工数は**描画される高さと一致**させる（見た目の重なり＝計算上の重なり）。
2. `start` 昇順（同 `start` は `end` 昇順）で安定ソート。
3. **クラスタ分割**: 走査しながら「クラスタ内の最大 end」を保持。次ブロックの
   `start` がそれ以上なら、そこでクラスタを閉じる。`A↔B` 重なり・`B↔C` 重なり・
   `A↔C` 非重なり、のような連鎖も同一クラスタとして扱う。
4. **列割り当て**: クラスタ内で、各列の「最後に置いたブロックの end」を保持。
   ブロックごとに `lastEnd <= start` の一番左の列へ詰める。無ければ新しい列を作る。
   クラスタの総列数 `cols` ＝使った列数。
5. 各ブロックに `{ col, cols }` を付与（`cols` はそのブロックが属するクラスタの総列数）。

重なりが無いブロックは `{ col: 0, cols: 1 }`（＝現状とほぼ同じ全幅）。

### テスト（`schedule.test.ts` に追加）

- 重なりなし → 全ブロック `col0 / cols1`。
- 2件重なり → `col0 / col1`、両者 `cols2`。
- 連鎖クラスタ（A↔B, B↔C 重なり / A↔C 非重なり）→ 同一クラスタ `cols2`、
  C は A の列を再利用して `col0`。
- ゴースト（in_progress）と schedule ブロックの重なりも列分割される。
- `endAt` 未設定（既定60分）でも実効区間で重なり判定される。

## 描画側の差し替え

### `apps/web/src/features/board/components/ScheduleColumn.tsx`

- `blocks` から `assignScheduleColumns` を一度だけ計算し、各 `ScheduleBlock` に
  `col` / `cols` を渡す（[L100-L111](../../../apps/web/src/features/board/components/ScheduleColumn.tsx#L100-L111)）。
- 列の並び順は `start` → `source`（calendar 優先で左）でソートして安定させる。

### `apps/web/src/features/board/components/ScheduleBlock.tsx`

- 固定の `left: TIME_GUTTER_PX, right: 4`（[L150-L161](../../../apps/web/src/features/board/components/ScheduleBlock.tsx#L150-L161)）を、
  `col` / `cols` から CSS `calc` で算出した `left` / `width` に置換する
  （コンテナ実測は不要）。`GUTTER = TIME_GUTTER_PX`、右パディング 4px、列間ギャップ 2px:
  - `width: calc((100% - {GUTTER + 4}px) / cols - 2px)`
  - `left:  calc({GUTTER}px + (100% - {GUTTER + 4}px) * col / cols)`
- `cols === 1` のとき幅はほぼ現状の全幅になり、単独ブロックの見た目は変わらない。
- `ScheduleBlockView`（DragOverlay 用）は `h-full` で親サイズに追従するため変更不要。

## 既存挙動への影響（維持するもの）

- **リサイズ**（下端ハンドル）・**レーン間 D&D**・**DragOverlay** はそのまま。掴むブロックが
  細くなるだけで操作系は不変。
- **`zIndex`**（calendar=15 / その他=10）は残す。重ならなくなるので前後依存は実質解消するが、
  端数や同時刻完全一致のフォールバックとして無害に残置。
- **背景クリック/ドラッグの作成 Popover・選択ハイライト** は全幅のまま（別系統）。変更しない。

## 割り切り（確認済み）

- **リサイズ中は再フローしない**: レイアウトは確定済み `startAt` / `endAt` から計算する。
  下端ドラッグ中に列がガタつくのを防ぐため、確定（`onResize`）後の再 render で列が更新される。
- **ゴーストもレイアウト対象**: `in_progress` の残像ブロックも列割り当てに含め、schedule
  ブロックと全幅で重ならないようにする。

## 完了条件

- 同時刻に重なる schedule ブロックが横並びになり、いずれもクリック/ドラッグ/リサイズできる。
- 単独ブロックの見た目は従来どおり（実質全幅）。
- `pnpm typecheck` / `pnpm lint` / 追加した schedule のテストが通る。
