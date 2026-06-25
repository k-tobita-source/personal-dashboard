# Slack 連携（メンション / DM）取り込み 設計

> 作成日: 2026-06-15
> 対象: `packages/integrations` への Slack 追加 + `packages/api` / `apps/web` の調整
> 関連: [docs/spec.md](../../spec.md) §4 / [docs/tech-stack.md](../../tech-stack.md) §4.5 / [Google 連携設計](./2026-06-15-google-integration-design.md)

## 1. 目的とスコープ

Slack の「自分への依頼・確認事項」をローカル完結・読み取り専用でカンバンの **Todo（inbox）レーン**へ取り込む。Google 連携（Calendar/Gmail）と同じ構造を踏襲する。

### スコープ内

- 自分へのメンション + 自分宛 DM を Todo に取り込み（過去3日）
- `search:read` のみ・読み取り専用
- `SLACK_TOKEN`（User OAuth Token）を `.env` に設定する方式
- タブ表示中の自動ポーリング（既存 `useAutoSync` に相乗り）

### スコープ外

- OAuth Web フロー（token を `.env` に置くため不要）
- syncToken 相当の増分（`after:` の期間指定で代替）
- 外部実体の自動削除
- チャンネル全体の取り込み（メンション/DM のみ）

## 2. 確定要件（ブレインストーミング結果）

| 項目 | 決定 |
| --- | --- |
| 認証 | `SLACK_TOKEN`（User OAuth Token, `xoxp-`）を `.env` に設定 |
| 取得対象 | 自分へのメンション + 自分宛 DM |
| 期間 | 過去3日（`after:` 付与） |
| 取り込み先 | Todo（inbox）レーン |
| 再同期 | 内容更新・lane/position 保護（Gmail と同じ） |

## 3. アーキテクチャ

Google と同一の流れ。`packages/integrations` は DB 非依存、upsert は `packages/api` の `syncService`。

```
apps/web (env: SLACK_TOKEN) ──tRPC──> packages/api syncService.run()
                                          │  source ごとにプロバイダを判定
                                          ▼
                              packages/integrations
                                slack/client.ts
                                  ├─ isSlackConnected()
                                  ├─ fetchSlackMentionsAndDms(token, now)
                                  └─ normalizeSlackMessage()  (純粋)
                                      │ @slack/web-api（search:read）
                                      ▼
                                  Slack search.messages
```

## 4. データモデル

- `task` 表は変更なし（`source = "slack"` を利用、`(source, externalId)` の unique index で dedup）。
- `sync_state` 表に `slack` 行が増えるのみ（スキーマ変更なし）。

## 5. 認証

- `@slack/web-api` の `WebClient(process.env.SLACK_TOKEN)`。
- `isSlackConnected()` = `Boolean(process.env.SLACK_TOKEN)`。未設定時は Slack 同期をスキップ（他ソースは継続）。Google のような接続バナー UI は設けない（`.env` で完結）。
- `auth.test()` で自分の `user_id` を取得し、メンションクエリに使う。

## 6. 取得（読み取り専用）

`search.messages`（user token 必須・`search:read`）を 2 クエリ発行してマージ:

| 用途 | クエリ | 参加チャンネル限定 |
| --- | --- | --- |
| 自分へのメンション | `<@USERID> after:<3日前> -from:me` | ✓ |
| チャンネル全体メンション | `@channel after:<3日前> -from:me` | ✓ |
| オンラインメンバーメンション | `@here after:<3日前> -from:me` | ✓ |
| チームメンション(@usergroup) | `@<handle> after:<3日前> -from:me`（所属グループごと） | ✓ |
| DM | `is:dm after:<3日前> -from:me`（自分の発言を除外） | （対象外） |

- チャンネル系クエリの結果は、`users.conversations`（要 `channels:read`/`groups:read`）で取得した**参加チャンネルの ID 集合に含まれるものだけ**採用する（ノイズ＝非参加の公開チャンネル等を除外）。
- チームメンションは `usergroups.list({include_users:true})`（要 `usergroups:read`）で自分が所属する user group の handle を引き、`@<handle>` で検索する。
- 必要スコープ（User Token Scopes）: `search:read` / `channels:read` / `groups:read` / `usergroups:read`。
- Slack の per-channel 通知設定（全件/メンションのみ/ミュート）は API で取得できないため完全再現はしない。参加チャンネル＋メンション種別で近似する。

- `count: 100`, `sort: "timestamp"`。
- `after` は **ローカル日付**で `YYYY-MM-DD`（`now` の3日前）。
- 2 クエリ結果を `(channel.id, ts)` で重複排除してから正規化。

## 7. 正規化（→ inbox）

`normalizeSlackMessage(match)` は `NormalizedItem | null`（`channel.id` か `ts` 欠落で null）。

- `source = "slack"`
- `externalId = \`${channel.id}:${ts}\``
- `title` = 本文の1行目（trim、空なら「(本文なし)」）
- `body` = 本文全文（未設定なら undefined）
- `sender` = `username`（無ければ `user` ID）
- `url` = `permalink`
- `defaultLane = "inbox"`

カードは Gmail と同様に Slack アイコン + 「sender: 本文」プレビュー + 「開く ↗」。

## 8. 同期オーケストレーション（`syncService`）

- `IntegrationSource` に `"slack"` を追加。`SYNC_INTERVALS_MS.slack = 240_000`（4分）。
- `run()` を「ソースごとに対応プロバイダのクライアントを取得して fetch」する形に小さくリファクタ:
  - `calendar` / `gmail` → `loadGoogleAuth()`（null ならスキップ）
  - `slack` → `process.env.SLACK_TOKEN`（無ければスキップ）
  - fetch が `null`（未接続）なら `lastSyncedAt` を更新せず次へ。
- `buildUpdateValues` は Slack も時刻なし（Gmail と同じ＝内容のみ更新・lane/position 保護）。
- `run()` の戻り値は `{ inserted, updated }`（`connected` は UI 未使用のため整理）。Google 接続バナーは `integration.status`（Google）を引き続き使用。

## 9. クライアント

- 既存の `useAutoSync`（タブ表示中 60 秒間隔）にそのまま相乗り。Slack の実取得頻度はサーバーの 4 分間隔で間引かれる。
- Slack 用 UI（バナー等）は追加しない。

## 10. 設定（env / turbo / docs）

- `apps/web/src/env.ts` の `server` に `SLACK_TOKEN: z.string().optional()`。
- `turbo.json` `globalEnv` に `SLACK_TOKEN` を追加。
- `.env.example` の `SLACK_TOKEN` を有効化。
- `docs/setup-slack.md` を追加:
  1. Slack App を作成（api.slack.com/apps）。
  2. 「OAuth & Permissions」→ **User Token Scopes** に `search:read` を追加。
  3. ワークスペースにインストールし、**User OAuth Token（`xoxp-`）** を取得。
  4. `.env` の `SLACK_TOKEN` に設定。
  5. `pnpm dev:next` を再起動。

## 11. テスト方針

- `normalizeSlackMessage`: 正規化（メンション/DM の match → NormalizedItem）、必須フィールド欠落で null、本文複数行で title が1行目になること。
- `isDue` に `slack` 間隔のケースを追加。
- `@slack/web-api` はモック（ネットワーク非依存）。

## 12. 受け入れ条件

- `SLACK_TOKEN` 設定後、過去3日の自分へのメンションと DM が Todo に積まれる。
- 取り込んだ Slack カードをレーン移動しても再同期で戻らない（lane 保護）。
- `SLACK_TOKEN` 未設定でも他ソース（Google）の同期は正常に動く。
- Slack への書き込みが一切発生しない（`search:read` のみ）。
