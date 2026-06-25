# スケジュール自動レーン移動 & Slack カードUI改修 設計

日付: 2026-06-16

## 概要

2 つの独立した改修を行う。

- **Part A**: Schedule レーンのタスクを時刻経過に応じて自動でレーン移動する（クライアント定期判定）。
- **Part B**: Slack 由来カードに「投稿者アイコン（本物の Slack アバター画像）＋名前＋チャンネル名」を表示する。

---

## Part A: スケジュール自動レーン移動

### 目的

- 開始時刻が来た Schedule タスクを自動で In Progress に進める。
- 終了時刻を過ぎた Google カレンダー予定（独自 ToDo は除く）を自動で Done に片付ける（前日分の取り残し対策を含む）。

### 仕組み（クライアント定期判定）

1. **`useNow(intervalMs = 60_000)` フックを追加**。1 分間隔で `Date` state を更新して返す。Board の `now` をマウント時固定（[Board.tsx:79](apps/web/src/features/board/components/Board.tsx#L79)）からこのフックに置き換える。Schedule の現在時刻ラインもライブで動くようになる。
2. **`useAutoAdvance({ tasks, now, move })` フックを追加**。`now` または `tasks` が変化するたびに条件判定し、該当タスクへ `move.mutate` を発火する。既存の楽観的更新（[mutations.ts useMoveTask](apps/web/src/features/board/api/mutations.ts)）をそのまま利用。

### 判定ルール

1 タスクにつき **Done を先に評価**し、いずれか 1 つだけ発火する。

| 条件 | 移動先 |
|---|---|
| `source === "calendar"` かつ `endAt != null` かつ `endAt < now` かつ lane が `schedule` または `in_progress` | **done** |
| 上記 Done に該当せず、lane === `schedule` かつ `startAt != null` かつ `startAt <= now`（calendar / todo 問わず） | **in_progress** |

- 移動時は `startAt` / `endAt` を **undefined（据え置き）** で渡し、時刻情報を保持する。
- Done を先に評価するため、開始も終了も過ぎたカレンダー予定は In Progress を経ずに直接 Done へ移動する。

### 多重発火ガード

- `useRef<Set<string>>` に発火済みタスク id を保持する。
- 楽観的更新により move 直後に lane が書き換わるため次 tick では再マッチしないが、`onSettled` の invalidate 確定までの競合（同一タスクへ複数 mutation が飛ぶ）を防ぐためのガード。
- タスクが目的レーンに到達したことをキャッシュ上で確認できたら id をセットから除く必要は特にない（lane が変われば条件に再マッチしないため）。シンプルに「発火したら add、対象から外れたら remove」で十分。

### 付随調整: ScheduleColumn の初回センタリング

- 現在時刻ラインを画面中央へスクロールする effect（[ScheduleColumn.tsx:40-44](apps/web/src/features/board/components/ScheduleColumn.tsx#L40-L44)）は、`now` がライブ更新になると毎分再センタリングしてしまう。
- `didCenter` ref を用いて **初回マウント時のみ**スクロールするよう変更する。

---

## Part B: Slack カードUI（アバター画像 + 名前 + チャンネル名）

### 目的

Slack 由来カードに投稿者のアバター画像・名前・チャンネル名を表示する。レイアウトは「アバターの右に名前、名前の下にチャンネル名」。

### データモデル変更

1. **schema** ([packages/db/src/schema.ts](packages/db/src/schema.ts)): `task` テーブルに `avatarUrl: t.text()`（NULL 許容）を追加。`pnpm -F @acme/db generate` → `migrate` でマイグレーション生成・適用。
2. **NormalizedItem** ([packages/integrations/src/types.ts](packages/integrations/src/types.ts)): `avatarUrl?: string` を追加。

### Slack 取得ロジック

[packages/integrations/src/slack/client.ts](packages/integrations/src/slack/client.ts) の `fetchSlackMentionsAndDms` を 2 パス化する。

1. チャンネル系（参加チャンネル限定）と DM の採用 match を一旦配列に集める。
2. 採用 match からユニークな `match.user`（ユーザー ID）を集め、`getUserAvatars(client, userIds)` ヘルパーで `users.info` をまとめて呼び、`user.profile.image_72` を `userId → avatarUrl` のマップに解決する。
3. 各 match を `normalizeSlackMessage` で正規化し、`match.user` をキーにマップから `avatarUrl` を付与する。

- `match.user` が無い／`users.info` が失敗したケースでは `avatarUrl` は undefined のまま（UI 側でフォールバック）。
- 必要 Slack スコープ: **`users:read`**（ユーザー側で Slack App 設定に追加）。

### 同期（upsert）

[packages/api/src/service/syncService.ts](packages/api/src/service/syncService.ts):

- `UpdateValues` に `avatarUrl: string | null` を追加。
- `buildUpdateValues` の base に `avatarUrl: item.avatarUrl ?? null` を含める（全ソース共通。非 Slack は null）。
- `upsertItem` の insert にも `avatarUrl: item.avatarUrl ?? null` を追加。
- 既存 Slack カードは次回ポーリングの update でアバターがバックフィルされる。

### UI

[apps/web/src/features/board/components/TaskCard.tsx](apps/web/src/features/board/components/TaskCard.tsx) の `TaskCardView`。**Slack かつ `avatarUrl` あり**のとき下記レイアウト、それ以外は現状維持。

```
┌─────────────────────────────────┐
│ (img)  山田太郎                  │   ← アバター右に名前(sender)
│  ⬤    # general                 │   ← 名前の下にチャンネル名(title)＋Slackアイコン
│ メッセージ本文のプレビュー…       │   ← body（"sender:" 接頭辞は廃止）
│ 開く ↗                           │
└─────────────────────────────────┘
```

- アバターは ~28px の丸画像。読み込み失敗時は sender 頭文字のイニシャル丸にフォールバック。
- Slack カードの本文プレビューは名前を別表示するため `body` のみとする（現状の `sender: body` 連結をやめる）。
- 非 Slack ソースのカードは現状（SourceIcon + title）のまま変更しない。

---

## テスト方針

- **Part A**: `useAutoAdvance` の判定ロジックを純粋関数（例: `selectAutoMoves(tasks, now)` → 移動指示の配列）に切り出し、ユニットテスト（calendar 終了超過→done、todo 開始到達→in_progress、両方該当時 done 優先、該当なし）を追加。
- **Part B**: `normalizeSlackMessage` / avatar 付与のロジックにテストを追加（[client.test.ts](packages/integrations/src/slack/client.test.ts) に準拠）。`getUserAvatars` は users.info をモックして map 解決を検証。
- PR 前に `pnpm typecheck` / `pnpm lint` / `pnpm -F @acme/web build` を通す。

## スコープ外（YAGNI）

- アバター URL のキャッシュ／TTL 管理（毎ポーリング解決で十分）。
- イニシャルフォールバック以外の凝った欠損表示。
- 自動移動のサーバー側実装・MCP 連携。
