# personal-dashboard

Googleカレンダーの予定・Slack通知・Gmail・独自 ToDo を 1 画面に集約する、ローカル完結の個人用ダッシュボード。Web UIとClaude（Claude Code / Claude Desktop）から操作するためのMCPを提供。

[create-t3-turbo](https://github.com/t3-oss/create-t3-turbo) をベースにした pnpm + Turborepo モノレポ。

## 技術スタック

| レイヤー       | 内容                                               |
| -------------- | -------------------------------------------------- |
| 言語・ツール   | TypeScript / pnpm（workspace）/ Turborepo          |
| フロントエンド | Next.js/ React 19 / Tailwind CSS v4 / shadcn/ui    |
| API / ロジック | tRPC v11 / TanStack Query v5 / superjson / zod 4   |
| データ         | Drizzle ORM / SQLite（better-sqlite3, WAL モード） |
| MCP            | `@modelcontextprotocol/sdk`（stdio）               |

## ディレクトリ構成

```
personal-dashboard/
├─ apps/
│  └─ web/                # @pdash/web   Next.js（カンバン UI + tRPC ルート + Google OAuth コールバック）
└─ packages/
   ├─ api/                # @pdash/api          tRPC router + service 層（UI / MCP 共有）
   ├─ db/                 # @pdash/db           Drizzle ORM + SQLite スキーマ / マイグレーション
   ├─ integrations/       # @pdash/integrations Google / Slack / Gmail コネクタ（読み取り専用）
   ├─ mcp/                # @pdash/mcp          MCP サーバー（stdio）
   └─ ui/                 # @pdash/ui           shadcn/ui + Tailwind コンポーネント
```

## 必要環境

- Node 22 系
- pnpm 10

## セットアップ

```sh
# 1. Node を 22 に切り替え
nvm use

# 2. 依存をインストール
pnpm install

# 3. 環境変数（OAuth クライアント ID / トークン等）
cp .env.example .env
# .env を編集。各連携のセットアップ手順は下記ドキュメントを参照:
#   - docs/development/setup-google.md（Calendar / Gmail）
#   - docs/development/setup-slack.md（Slack）

# 4. DB マイグレーション適用
pnpm -F @pdash/db migrate
```

`.env` は OAuth の **クライアント情報のみ**を保持する。Google のアクセストークンや取得データはコミットされず、ユーザー領域（`~/.personal-dashboard/`）に保存される。

## 起動

```sh
pnpm dev:next            # Web のみ起動 → http://localhost:3000
pnpm dev                 # 全パッケージの dev をまとめて起動
```

## 外部連携

| ソース                   | 取り込み先 | スコープ            | 接続方法                                                             |
| ------------------------ | ---------- | ------------------- | -------------------------------------------------------------------- |
| Google カレンダー        | Schedule   | `calendar.readonly` | アプリ起動後 `http://localhost:3000/api/auth/google` から OAuth 認可 |
| Gmail（未読）            | 受信箱     | `gmail.readonly`    | 上記 Google OAuth と共通                                             |
| Slack（メンション / DM） | 受信箱     | `search:read`       | User OAuth Token（`xoxp-...`）を `.env` の `SLACK_TOKEN` に設定      |

未接続のソースは同期時に自動でスキップされる。

## DB

- ローカルの SQLite ファイルに保存（クラウド送信なし）。既定の保存先は `~/.personal-dashboard/kanban.db`。

- 保存先を変えたい場合のみ環境変数で上書き:

  ```sh
  # .env など
  KANBAN_DB_PATH="/absolute/path/to/kanban.db"
  ```

- スキーマを変更したら `pnpm -F @pdash/db generate`（マイグレーション生成）→ `pnpm -F @pdash/db migrate`（適用）。

- 中身を GUI で確認したい場合は `pnpm db:studio`（Drizzle Studio）。

- WAL モードで開くため、Web プロセスと MCP プロセスからの並行アクセスを許容する。

## MCP

Claude から本ボードを操作するための `personal-dashboard` サーバーが `.mcp.json`（Claude Code が読み込む）に定義済み。Claude Desktop で使う場合は `claude_desktop_config.json` に同等の設定を追加する。

```jsonc
{
  "mcpServers": {
    "personal-dashboard": {
      "command": "pnpm",
      "args": ["-F", "@pdash/mcp", "start"],
    },
  },
}
```

認証は不要（ローカルの DB を直接操作）。外部 API への書き込みは行わないため、操作はボード DB に閉じる。
