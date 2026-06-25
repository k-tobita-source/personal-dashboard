# Google 連携（Calendar / Gmail）取り込み 設計

> 作成日: 2026-06-15
> 対象: `packages/integrations`（新規）+ `packages/db` / `packages/api` / `apps/web` への追加
> 関連: [docs/spec.md](../../spec.md) §4 / [docs/tech-stack.md](../../tech-stack.md) §4.5

## 1. 目的とスコープ

Google Calendar / Gmail の内容をローカル完結・読み取り専用でカンバンへ取り込む。

- **Calendar の当日予定 → Schedule レーン**（startAt/endAt でタイムライン配置）
- **Gmail の未読受信トレイ → Todo（inbox）レーン**
- 全 API は**読み取り専用・最小権限**（`calendar.readonly` / `gmail.readonly`）。書き込みは一切しない。

### スコープ内（今回）

- Google のみ（Calendar + Gmail）
- Web ルート経由の OAuth（単一ユーザー、ローカル）
- タブ表示中の自動ポーリング同期

### スコープ外（後日・別タスク）

- Slack 連携（別途 Slack App / トークンが必要）
- syncToken / historyId による増分取得（v1 は毎回フェッチ。後日の最適化）
- 外部実体の自動削除（既読化・予定削除に伴うカード削除）
- 終日予定のタイムライン専用表現（v1 は Todo に置く）
- カレンダーへの書き込み（恒久的に行わない）

## 2. 確定した要件（ブレインストーミング結果）

| 項目 | 決定 |
| --- | --- |
| 実装スコープ | Google のみ（Calendar + Gmail）。Slack は後日。 |
| OAuth 方式 | Web ルート経由（`/api/auth/google`）。refresh token をローカル保存。 |
| 同期トリガー | タブ表示中に自動ポーリング（非表示・スリープ中は停止）。 |
| Gmail 対象 | 未読の受信トレイ（`is:unread in:inbox`）。 |
| Calendar 対象 | 主カレンダー（primary）の当日予定。 |
| 再同期の振る舞い | 内容（title/body/sender/url、Calendar は時刻も）は更新、**lane/position は保護**。 |

## 3. アーキテクチャ

```
apps/web
  ├─ /api/auth/google          ── 認可リダイレクト
  ├─ /api/auth/google/callback ── code 交換 → refresh token 保存
  ├─ env.ts                    ── GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
  └─ features/board
       ├─ useSync()            ── 表示中だけ 60s 間隔で sync、完了後 task.all 無効化
       └─ 未接続バナー          ── /api/auth/google への導線
              │ tRPC
              ▼
packages/api
  ├─ router/integration.ts     ── sync(mutation) / status(query)
  └─ service/syncService.ts    ── 期限判定 → コネクタ呼び出し → upsert → sync_state 更新
       │                                    │ 既存 taskService を再利用
       ▼                                    ▼
packages/integrations          packages/db
  └─ google/                     ├─ schema: sync_state 追加（task は変更なし）
       ├─ oauth.ts               └─ paths: credentialsPath 追加
       ├─ calendar.ts
       ├─ gmail.ts
       └─ types.ts (NormalizedItem)
              │ googleapis（読み取り専用）
              ▼
        Google Calendar / Gmail API
```

**境界の原則**

- `packages/integrations` は **DB を知らない**。Google から取得し `NormalizedItem[]` を返すだけ。テスト時は googleapis をモックできる。
- DB への upsert・レーン保護・position 採番は `packages/api` の `syncService` が担う（既存 `taskService` のヘルパーを再利用）。
- これにより「ローカル完結」「service 層を MCP からも再利用」の既存方針を維持する。

## 4. データモデル

### task 表（変更なし）

既存スキーマが必要な列（`source` / `externalId` / `(source, externalId)` unique / `startAt` / `endAt` / `sender` / `url` / `body`）を備えているため**変更不要**。

### sync_state 表（新規）

ソース別の同期間隔を判定するために最終同期時刻を保持する。

| 列 | 型 | 説明 |
| --- | --- | --- |
| `source` | text PK | `calendar` / `gmail`（将来 `slack`） |
| `lastSyncedAt` | integer(timestamp_ms) | 最終同期成功時刻 |

> v1 は増分取得をしないため syncToken/historyId は持たない。後日の増分対応時に列追加で拡張する。

## 5. OAuth フロー

1. board が未接続のとき「Google を接続」ボタンを表示 → `/api/auth/google` へ遷移。
2. `/api/auth/google`: `google.auth.OAuth2(clientId, clientSecret, redirectUri)` で認可 URL を生成しリダイレクト。
   - スコープ: `https://www.googleapis.com/auth/calendar.readonly`, `https://www.googleapis.com/auth/gmail.readonly`
   - `access_type=offline`, `prompt=consent`（refresh token を確実に取得）
3. `/api/auth/google/callback`: `code` を token へ交換し、**refresh token を `~/.my-kanban/credentials.json` に保存**（ファイルパーミッション 600）。完了後 `/` にリダイレクト。
4. コネクタは保存済み refresh token から OAuth2 クライアントを生成。access token は googleapis が自動更新。

- リダイレクト URI: `http://localhost:3000/api/auth/google/callback`
- `credentials.json` 形式（例）: `{ "google": { "refresh_token": "...", "obtained_at": <ms> } }`
- 認証情報はリポジトリ外（`~/.my-kanban/`）。`.env` の client id/secret は gitignore 済み。

## 6. コネクタと正規化

### 共通型

```ts
interface NormalizedItem {
  source: "calendar" | "gmail";
  externalId: string;
  title: string;
  body?: string;
  sender?: string;
  url?: string;
  startAt?: Date;
  endAt?: Date;
  defaultLane: "schedule" | "inbox";
}
```

### Calendar（`google/calendar.ts`）

- `calendar.events.list({ calendarId: "primary", timeMin: 当日0:00, timeMax: 当日24:00, singleEvents: true, orderBy: "startTime" })`
- 正規化:
  - `title = summary`（無題は「(タイトルなし)」）
  - 時刻あり（`start.dateTime`）→ `startAt`/`endAt` を設定、`defaultLane = "schedule"`、`url = htmlLink`
  - **終日予定（`start.date` のみ）→ `defaultLane = "inbox"`、時刻なし**
  - `status === "cancelled"` は除外
  - `externalId = event.id`

### Gmail（`google/gmail.ts`）

- `gmail.users.messages.list({ userId: "me", q: "is:unread in:inbox", maxResults: 50 })`
- 各 ID について `gmail.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: ["Subject", "From"] })`
- 正規化:
  - `title = Subject`（無ければ「(件名なし)」）
  - `sender = From`
  - `body = snippet`
  - `url = https://mail.google.com/mail/u/0/#inbox/{id}`
  - `defaultLane = "inbox"`
  - `externalId = message.id`

## 7. 同期オーケストレーション（`syncService`）

### 間隔（サーバー側判定）

| ソース | 間隔 |
| --- | --- |
| calendar | 90 秒 |
| gmail | 150 秒 |

`run()` は各ソースについて `now - lastSyncedAt >= 間隔` のものだけ処理する。クライアントのタイマーは 60 秒の 1 本で、実際の取得頻度はサーバーが制御する。

### upsert セマンティクス

各 `NormalizedItem` を `(source, externalId)` で照合:

- **新規**: `defaultLane` に insert。`position = nextPosition(lane)`。Calendar は `startAt`/`endAt` を付与。
- **既存**: `title` / `body` / `sender` / `url` を更新（Calendar は `startAt` / `endAt` も）。**`lane` / `position` は更新しない**（ユーザーのレーン移動を保護）。

処理後に `sync_state.lastSyncedAt` を更新。`run()` は処理件数（新規 / 更新 / ソース別）を返す。

### 未接続・エラー時

- `credentials.json` が無い／refresh token 無効 → `status` は未接続を返し、`sync` はスキップ（例外で全体を落とさない）。
- 個別ソースの取得失敗はログに留め、他ソースの同期は継続。

## 8. tRPC ルーター（`integrationRouter`）

- `status: query` → `{ connected: boolean }`（`credentials.json` の有無で判定）
- `sync: mutation` → `syncService.run()` を実行し処理件数を返す

## 9. クライアント（board）

- `useSync()`:
  - `document.visibilityState === "visible"` のときだけ有効化（`visibilitychange` を監視）。
  - 60 秒間隔で `integration.sync` を実行、`onSettled` で `task.all` を invalidate。
- 未接続バナー: `integration.status.connected === false` のとき board 上部に「Google を接続」ボタン（`/api/auth/google`）。

## 10. ユーザー側セットアップ（README / docs に記載）

1. Google Cloud Console で **Calendar API** と **Gmail API** を有効化。
2. OAuth 同意画面を設定し、スコープに `calendar.readonly` / `gmail.readonly` を追加（テスト中は自分をテストユーザーに追加）。
3. OAuth クライアント（種別: ウェブ アプリケーション）を作成し、リダイレクト URI に `http://localhost:3000/api/auth/google/callback` を登録。
4. client id / secret を `.env` の `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` に設定（設定済み）。
5. アプリ起動後、board の「Google を接続」から認可。

## 11. テスト方針

- **正規化（純粋関数）**: Google のサンプルペイロード（フィクスチャ）→ `NormalizedItem` を単体テスト。Calendar の時刻あり/終日/cancelled、Gmail のヘッダ欠落などの分岐を網羅。
- **upsert セマンティクス**: 一時 SQLite に対し、(1) 新規 insert、(2) 既存の内容更新でレーン/position が保持されること、(3) Calendar 時刻更新、を検証。
- **間隔判定**: `lastSyncedAt` と間隔から due 判定を単体テスト。
- **OAuth URL 生成**: スコープ・`access_type`・`prompt` を含むことを検証。
- googleapis 呼び出しはモックし、ネットワークに依存しない。

## 12. 受け入れ条件

- Google 接続後、当日の Calendar 予定が Schedule に時刻どおり表示される。
- 未読の Gmail が Todo に積まれる。
- タブ表示中はおよそソース別間隔で自動更新され、非表示中は停止する。
- 取り込み済みカードをレーン移動しても、再同期で元レーンに戻らない。
- 外部 API への書き込みが発生しない（読み取り専用）。
