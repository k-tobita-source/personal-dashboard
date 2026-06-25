# 個人用カンバンダッシュボード データモデル設計

> [`screen-spec.md`](./screen-spec.md)（画面仕様）から逆算したDB設計。実装は次ステップ。
> ORM/DB は [`tech-stack.md`](./tech-stack.md) のとおり Drizzle ORM + SQLite (better-sqlite3)。
>
> **命名方針**：データの実体は `task`（テーブル・API・型）。UI 上の見た目を指す「カード」は画面仕様の用語として別に使う。

---

## 1. 方針

- 4カラム（受信箱 / Schedule / In Progress / Done）に並ぶ各項目を、ソース横断の **単一 `task` テーブル**に集約する（UI ではこれを「カード」として描画）。
- **状態 ＝ 所属カラム**（`lane`）を唯一の真実とする（spec §4.1）。別の状態フラグは持たない。
- 外部実体（カレンダー / Slack / Gmail）と独自ToDoを同一テーブルで扱い、`source` で区別する。

---

## 2. テーブル：`task`

| カラム | 型 (SQLite) | NULL | 説明 |
|---|---|---|---|
| `id` | text | NOT NULL | 主キー（UUID/CUID） |
| `source` | text | NOT NULL | ソース種別：`calendar` / `slack` / `gmail` / `todo` |
| `lane` | text | NOT NULL | 所属カラム：`inbox` / `schedule` / `in_progress` / `done` |
| `title` | text | NOT NULL | 見出し（件名・要約） |
| `body` | text | NULL | 本文プレビュー（Slack冒頭 / Gmail抜粋） |
| `sender` | text | NULL | 送信者（Slack / Gmail） |
| `url` | text | NULL | 元ソースへのリンク |
| `external_id` | text | NULL | 外部実体の一意キー（ポーリングdedup用）。独自ToDoは NULL |
| `start_at` | integer (epoch ms) | NULL | 開始時刻。Scheduleのタイムライン配置に使用。受信箱の項目は NULL |
| `end_at` | integer (epoch ms) | NULL | 終了時刻（予定の長さ表現用） |
| `position` | real | NOT NULL | カラム内の並び順（後述） |
| `created_at` | integer (epoch ms) | NOT NULL | 作成時刻 |
| `updated_at` | integer (epoch ms) | NULL | 更新時刻 |

### 制約・インデックス

| 種別 | 対象 | 目的 |
|---|---|---|
| PRIMARY KEY | `id` | |
| UNIQUE | `(source, external_id)` | 外部実体の重複取り込み防止（UPSERTのキー） |
| INDEX | `(lane, position)` | カラム表示時の取得・並び替え |
| INDEX | `start_at` | Scheduleタイムラインの時刻順取得 |

> 日時は **epoch ミリ秒の integer** で保持（SQLiteにネイティブの日時型が無いため）。
> Drizzle 側で `mode: "timestamp_ms"` を使い、アプリ層では `Date` として扱う。

### enum の扱い

SQLite に enum 型は無いため、`source` / `lane` は `text` で保持し、**zod（`packages/validators`）でアプリ層バリデーション**する。
Drizzle では `text({ enum: [...] })` を用いて型を絞る。

---

## 3. 値の定義

```
source: 'calendar' | 'slack' | 'gmail' | 'todo'
lane:   'inbox' | 'schedule' | 'in_progress' | 'done'
```

| source | 由来 | `external_id` の例 | 初期 `lane` |
|---|---|---|---|
| `calendar` | Googleカレンダー予定 | イベントID | `schedule`（start_at あり） |
| `slack` | Slackメンション | チャンネルID + ts | `inbox`（時刻未定） |
| `gmail` | Gmail | メッセージID | `inbox`（時刻未定） |
| `todo` | 独自ToDo | NULL | `inbox`（または作成時指定） |

---

## 4. 主要ロジック（実装時の指針）

### 4.1 ポーリング取得時の UPSERT

外部実体は数分ごとに再取得される（[`tech-stack.md`](./tech-stack.md) §4.5）。

- キー `(source, external_id)` で UPSERT。
- **更新するのは内容系のみ**：`title` / `body` / `sender` / `url` / `start_at` / `end_at` / `updated_at`。
- **`lane` と `position` は上書きしない**：ユーザーが In Progress / Done へ動かした状態を保持するため。
- 新規（未取得）の場合のみ、初期 `lane` を判定（§3表 / `start_at` の有無）。

### 4.2 ドラッグ&ドロップによる更新

| 操作 | 更新内容 |
|---|---|
| 受信箱 → Schedule のタイムライン | `lane='schedule'`、`start_at` = ドロップ位置の時刻 |
| 受信箱 → In Progress | `lane='in_progress'`（`start_at` は NULL のまま） |
| 任意 → Done | `lane='done'`。外部実体の元データには一切触れない（spec §4.4） |
| カラム内の並び替え | `position` を更新 |

### 4.3 `position`（並び順）

- カラム内の手動並び替え用。`real` 型で「前後タスクの中間値」を入れる方式（再採番を避ける）。
- Schedule カラムは原則 `start_at` 昇順で表示するため `position` は補助的。

### 4.4 削除・消滅の扱い

- ソース側から消えた外部実体（例：Slack検索にヒットしなくなった）は、当面**ボード上に残す**（自動削除しない）。整理はユーザー操作（Doneや手動削除）に委ねる。
- 独自ToDoはユーザー操作でのみ削除。

---

## 5. SQLite 移行メモ（実装ステップで対応）

現状の `packages/db` は Postgres (drizzle-orm/vercel-postgres) 構成。実装時に以下を変更：

- `drizzle.config.ts`：`dialect: "sqlite"`、`dbCredentials` をローカルファイルパスへ。
- `client.ts`：`@vercel/postgres` → `better-sqlite3` + `drizzle-orm/better-sqlite3`。WAL モードを有効化。
- `schema.ts`：`pgTable` → `sqliteTable`。既存の例示 `Post` テーブルは削除し `task`（export 名 `Task`）を定義。
- `index.ts`：`drizzle-orm/pg-core` の re-export を sqlite 系へ。
- DBファイル配置：`~/.my-kanban/kanban.db`（リポジトリ外）。
- `.env.example` / `env.ts` から `POSTGRES_URL` を撤去し、DBパス設定へ差し替え。

---

## 6. 未確定・後続検討

- 取得元の生データ（生JSON）を別途保持するか（再正規化やデバッグ用）。当面は不要と判断。
- ToDo の繰り返し・サブタスク等の拡張（v1 では持たない）。
- カラム内並び順の初期値ポリシー（新着を上 / 下）。
