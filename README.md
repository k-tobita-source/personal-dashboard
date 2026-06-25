# personal-dashboard

当日の予定・Slack の依頼・Gmail・独自 ToDo を 1 画面のカンバンボードに集約する、ローカル完結の個人用ダッシュボード。
MCPでClaudeでのボード操作にも対応。

## 主な機能

## 構成

create-t3-turbo ベースの pnpm + Turborepo モノレポ。

```
personal-dashboard/
├─ apps/
│  └─ web/        # Next.js（Web UI + Server）
└─ packages/
   ├─ api/        # tRPC ルーター（UI/MCP 共有）
   ├─ db/         # Drizzle ORM + SQLite (better-sqlite3)
   ├─ ui/         # shadcn/ui + Tailwind コンポーネント
   └─ validators/ # zod スキーマ
```

## セットアップ

```sh
# 1. Node を 22 に切り替え
nvm use

# 2. 依存をインストール
pnpm install

# 3. 環境変数
cp .env.example .env

# 4. DB マイグレーション
pnpm -F @acme/db migrate
```

### DBについて

- **ローカルの SQLite ファイル**に保存（クラウド送信なし）。
- 既定の保存先は `~/.my-kanban/kanban.db`。初回アクセス時にディレクトリごと自動生成される。
- 保存先を変えたい場合のみ環境変数で上書き:

  ```sh
  # .env など
  KANBAN_DB_PATH="/absolute/path/to/kanban.db"
  ```

- スキーマを変更したら `pnpm -F @acme/db generate`（マイグレーション生成）→ `pnpm -F @acme/db migrate`（適用）。
- 中身を GUI で確認したい場合は `pnpm db:studio`（Drizzle Studio）。

## 起動

```sh
# Web アプリ（http://localhost:3000）
pnpm dev:next

# もしくは全パッケージの dev をまとめて
pnpm dev
```

ブラウザで http://localhost:3000 を開くとカンバンボードが表示される。

## 品質チェック

PR 提出前に以下を実行（[docs/frontend-guideline.md](docs/frontend-guideline.md) 準拠）。

```sh
pnpm typecheck          # 型チェック
pnpm lint               # ESLint
pnpm format             # Prettier（自動修正は format:fix）
pnpm -F @acme/web build # ビルドエラー確認
```

## 使い方（現状）

- **📥 受信箱**: 時刻未定のタスク。`+ ToDo を追加` から独自 ToDo を作成できる。
- **🗓 Schedule**: 当日 0:00〜24:00 のタイムライン。受信箱からカードをドラッグすると、その時間に時刻が確定する。
- **▶ In Progress / ✓ Done**: 対応中・完了。カードをドラッグして移動する。
