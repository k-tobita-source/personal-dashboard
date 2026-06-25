# 個人用カンバンダッシュボード 技術スタック・アーキテクチャ

> 本書は [`spec.md`](./spec.md) の要件を満たすための技術選定をまとめたもの。
> ベースは [create-t3-turbo](https://github.com/t3-oss/create-t3-turbo)（このワークスペースの現状構成）。

---

## 1. 設計方針

要件のうち、技術選定を最も強く規定するのは **非機能要件（spec.md §3）** の以下3点。

1. **ローカル完結** — 外部APIの取得も状態保存もローカルPC内で行い、第三者サーバーへ送信しない
2. **最小権限** — Google=閲覧+作成 / Slack=検索 / Gmail=閲覧 のみ
3. **認証情報のローカル保管** — トークンはローカルのみ、`.gitignore` で除外

これを満たすため、create-t3-turbo のデフォルトから次の方針で調整する。

| 観点    | t3-turbo デフォルト                           | 本プロジェクトの方針                      | 理由                                                     |
| ------- | --------------------------------------------- | ----------------------------------------- | -------------------------------------------------------- |
| DB      | Vercel/Supabase Postgres（クラウド）          | **ローカル SQLite ファイル**              | ローカル完結。サーバープロセス不要・単一ファイルで完結   |
| 認証    | better-auth + Discord OAuth（マルチユーザー） | **アプリ認証は廃止**（単一ユーザー前提）  | 共有・マルチユーザーはスコープ外（spec §2.2）            |
| apps    | expo / nextjs / tanstack-start の3つ          | **`apps/web`（Next.js）に一本化**         | モバイル化しない（spec §2.2）。デスクトップ常駐の1画面UI |
| 外部API | なし                                          | **Google / Slack / Gmail コネクタを追加** | データ集約が本質要件（spec §4）                          |
| MCP     | なし                                          | **`packages/mcp` を追加**                 | Claudeからのボード操作（spec §2.1）                      |

> 「ローカル完結」を厳格に守るため、認証トークン・取得データ・ボード状態はすべて
> ローカルディスク（SQLite + ローカル設定ディレクトリ）に閉じる。クラウド同期は行わない。

---

## 2. 全体アーキテクチャ

```
                ┌─────────────────────────────────────────────┐
                │  ローカル PC（すべてここで完結）                  │
                │                                             │
  ブラウザ ──────┤  apps/web (Next.js)                          │
  (Kanban UI)   │   ├─ React 19 + Tailwind v4 + shadcn/ui      │
                │   ├─ dnd-kit（D&D）                          │
                │   └─ tRPC client (TanStack Query)            │
                │            │                                │
                │            ▼                                │
                │      packages/api (tRPC router / service層)  │◄──┐
                │            │                                │   │
                │     ┌──────┼───────────────┐                │   │
                │     ▼      ▼               ▼                │   │
                │  packages/db   packages/integrations         │   │
                │  (Drizzle +    (Google / Slack / Gmail)      │   │
                │   SQLite file)        │                      │   │
                │     │                  ▼                     │   │
                │  kanban.db        外部API（最小権限・読取中心）  │   │ stdio
                │  (ローカル)         Google Calendar / Slack /   │   │
                │                    Gmail                     │   │
                └─────────────────────────────────────────────┘   │
                                                                   │
  Claude Desktop / Claude Code ────► packages/mcp (MCPサーバー) ─────┘
                                     （ボード操作ツールを公開）
```

- **UI と MCP は同じ service 層（`packages/api`）を共有**し、ロジックの二重実装を避ける。
- MCP サーバーは Web アプリが起動していなくても動くよう、**HTTP経由ではなく service層→DBを直接呼ぶ**構成にする（ヘッドレス動作）。
- SQLite は **WAL モード**で開き、Web プロセスと MCP プロセスからの並行アクセスを許容する。

---

## 3. ディレクトリ構成（提案）

ユーザー提示の構成をベースに、外部連携層を追加。

```
personal-dashboard/
├─ apps/
│  └─ web/                  # Next.js（Kanban UI + tRPC ルート）
└─ packages/
   ├─ mcp/                  # MCP サーバー（@modelcontextprotocol/sdk, stdio）
   ├─ api/                  # tRPC router + service 層（UI/MCP 共有）
   ├─ integrations/         # Google / Slack / Gmail コネクタ（★新規）
   ├─ db/                   # Drizzle ORM + SQLite
   ├─ validators/           # zod スキーマ（既存）
   └─ ui/                   # shadcn/ui + Tailwind コンポーネント
```

> `apps/expo` と `apps/tanstack-start` は削除、`apps/nextjs` を `apps/web` にリネーム。
> `packages/auth` は単一ユーザー前提のため削除（または最小化）。
> `integrations` は新規。`api` 内のサブモジュールに置く案もあるが、依存と権限の境界を明確にするため独立パッケージを推奨。

---

## 4. レイヤー別 技術選定

### 4.1 モノレポ基盤（既存を踏襲）

| 項目           | 採用                          | 備考                 |
| -------------- | ----------------------------- | -------------------- |
| パッケージ管理 | pnpm 10 (workspace + catalog) | 既存                 |
| タスクランナー | Turborepo 2.5                 | 既存                 |
| 言語           | TypeScript 5.9                | 既存                 |
| Lint / Format  | ESLint 9 + Prettier 3         | 既存 tooling/ を流用 |
| Node           | 22.x                          | `.nvmrc` 準拠        |

### 4.2 フロントエンド（`apps/web` + `packages/ui`）

| 項目                  | 採用                         | 理由                                                                                                  |
| --------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| フレームワーク        | **Next.js 16（App Router）** | 既存。ローカルでは `next dev`/`next start` で常駐                                                     |
| UI                    | React 19                     | 既存                                                                                                  |
| スタイル              | Tailwind CSS v4              | 既存                                                                                                  |
| コンポーネント        | shadcn/ui + Radix UI         | 既存 `packages/ui`                                                                                    |
| **ドラッグ&ドロップ** | **dnd-kit**                  | spec §4.3 の中核。タイムラインへのスナップ配置・キーボード操作・アクセシビリティに強い。React 19 対応 |
| サーバー状態          | TanStack Query v5            | 既存。tRPC と統合済み                                                                                 |
| トースト等            | sonner                       | 既存 `packages/ui`                                                                                    |

> **タイムライン / 現在時刻ライン（spec §4.2）** は専用ライブラリを入れず、
> dnd-kit + 自前のタイムグリッド（CSS Grid + 時刻→座標の換算）で実装するのが軽量。
> 日時計算は **date-fns** を採用（軽量・tree-shakable）。

### 4.3 API / ロジック層（`packages/api`）

| 項目           | 採用                           | 理由                                                    |
| -------------- | ------------------------------ | ------------------------------------------------------- |
| RPC            | **tRPC v11**                   | 既存。型安全な UI↔サーバー連携                         |
| クエリ統合     | @trpc/tanstack-react-query     | 既存                                                    |
| シリアライズ   | superjson                      | 既存（Date を透過的に扱える＝タイムライン要件と相性良） |
| バリデーション | zod 4（`packages/validators`） | 既存                                                    |

- **service 層を tRPC router から分離**して export し、`packages/mcp` から直接呼べるようにする
  （tRPC は「Webからの入口」、service は「純粋なドメインロジック」）。

### 4.4 データ層（`packages/db`）

| 項目             | 採用                           | 理由                                                     |
| ---------------- | ------------------------------ | -------------------------------------------------------- |
| ORM              | **Drizzle ORM**（既存）        | 既存。dialect を postgres → **sqlite** に変更            |
| DB               | **SQLite（ローカルファイル）** | ローカル完結。サーバー不要・バックアップはファイルコピー |
| ドライバ         | **better-sqlite3**（決定）     | 同期API・高速・組み込み用途の定番                        |
| マイグレーション | drizzle-kit                    | 既存。dialect 変更のみ                                   |

- DB ファイルは **`~/.personal-dashboard/kanban.db`** などユーザー領域に配置（リポジトリ外）。
- **WAL モード**を有効化し、Web プロセスと MCP プロセスの並行アクセスに対応。
- 既存の `auth-schema.ts` は削除し、ボード用スキーマに置き換える。

### 4.5 外部連携層（`packages/integrations`・新規）

| ソース            | ライブラリ                 | 必要スコープ（最小権限）                     |
| ----------------- | -------------------------- | -------------------------------------------- |
| Google カレンダー | `googleapis` (calendar v3) | **`calendar.readonly` のみ（読み取り専用）** |
| Gmail             | `googleapis` (gmail v1)    | `gmail.readonly`                             |
| Slack             | `@slack/web-api`           | `search:read`（検索のみ）                    |

- 各コネクタは「外部実体（read中心）→ 共通のカード型へ正規化」する責務に限定。
- spec §4.4 の通り、**外部実体は Done に移してもボード状態のみ変更**し、元データは触らない。
- **【決定】D&D で時刻確定した予定を実 Google カレンダーへ書き込むことはしない**（spec §4.3 の未決 → 「しない」で確定）。
  これにより外部APIへの書き込みは一切発生せず、**全ソースが読み取り専用**になる。`calendar.events` スコープは不要。

#### ポーリング設計（取得方式）

webhook は使わず（ローカル完結のため）、**増分取得 + ソース別間隔のポーリング**で負荷を最小化する。

| ソース          | 推奨間隔 | 増分方式                                    | レート制限の余裕                                                  |
| --------------- | -------- | ------------------------------------------- | ----------------------------------------------------------------- |
| Google Calendar | 1〜2分   | `syncToken`（変更なしならほぼ空レスポンス） | 桁違いに余裕（100万クエリ/日）                                    |
| Gmail           | 2〜3分   | `historyId`（新着のみ取得）                 | 余裕（10億単位/日）                                               |
| Slack           | 3〜5分   | 検索クエリに期間（`after:`）を付与          | `search.messages` は約20回/分が最も厳しいが、数分間隔なら問題なし |

- 初回のみフル取得、以降は差分のみ。これで「常時起動でも外部APIへの負荷は最小」。
- **ウィンドウ非アクティブ / PC スリープ中はポーリング停止**（`document.visibilityState` 等）で無駄打ちを排除。

### 4.6 MCP サーバー（`packages/mcp`・新規）

| 項目           | 採用                                          | 理由                                        |
| -------------- | --------------------------------------------- | ------------------------------------------- |
| SDK            | **`@modelcontextprotocol/sdk`（TypeScript）** | 公式。Claude Desktop / Claude Code 両対応   |
| トランスポート | **stdio**                                     | ローカル完結。Claude が子プロセスとして起動 |
| 公開ツール     | カード追加 / レーン移動 / 整理 等             | service 層（`packages/api`）を再利用        |

- Claude 側の設定（`claude_desktop_config.json` 等）から本サーバーを起動する想定。
- 認証不要（ローカルの DB を直接操作）。ただし外部API書き込みを伴う操作は要確認フローを検討。

---

## 5. 認証情報・データのローカル保管

| 種別                             | 保管先                                             | Git 除外               |
| -------------------------------- | -------------------------------------------------- | ---------------------- |
| 外部APIトークン（Google/Slack）  | `~/.personal-dashboard/credentials.json` 等（ユーザー領域） | 対象外（リポジトリ外） |
| アプリ設定（OAuth client id 等） | `.env`（リポジトリ内・gitignore済）                | ✅ `.gitignore`        |
| ボード状態・取得データ           | `~/.personal-dashboard/kanban.db`（SQLite）                 | リポジトリ外           |

- 既存 `.env.example` の `POSTGRES_URL` / `AUTH_*`（Discord）は不要になるため、
  `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `SLACK_*` 等へ差し替える。

---

## 6. 既存（create-t3-turbo）からの主な変更点まとめ

**追加**

- `packages/mcp`（MCP サーバー）
- `packages/integrations`（Google / Slack / Gmail）
- `dnd-kit`, `date-fns`, `better-sqlite3`, `googleapis`, `@slack/web-api`, `@modelcontextprotocol/sdk`

**変更**

- `packages/db`: dialect を postgresql → **sqlite**、driver を `@vercel/postgres` → `better-sqlite3`
- `apps/nextjs` → `apps/web` にリネーム
- `packages/api`: service 層を router から分離（MCP 共有のため）

**削除**

- `apps/expo`, `apps/tanstack-start`（モバイル/別フレームワーク不要）
- `packages/auth` + `db/auth-schema.ts`（単一ユーザー前提）
- `.env` の Supabase / Discord 関連

---

## 7. 決定事項・残課題（spec 由来）

**決定済み**

- ✅ **カレンダー書き込み（spec §4.3）** — 実 Google カレンダーへは登録**しない**。
  → 全ソース読み取り専用。Google スコープは `calendar.readonly` のみ。
- ✅ **外部ソースの取得方式** — webhook は使わず、**増分取得 + ソース別間隔ポーリング**（§4.5 参照）。
  個人利用・数分間隔ではどのAPIもレート制限に十分余裕あり。

- ✅ **DB ドライバ** — **better-sqlite3** に決定（同期API・定番）。
- ✅ **MCP の操作範囲** — **ボード操作（カード追加・移動・整理）のみ**に限定。外部API書き込みは行わないため、権限境界はボードDB操作に閉じる。

**残課題**

- なし（実装着手可能）。
