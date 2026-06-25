# personal-dashboard

Googleカレンダーの予定・Slack通知・Gmail・独自 ToDo を 1 画面に集約する、ローカル完結の個人用ダッシュボード。Web UIとClaude（Claude Code / Claude Desktop）から操作するためのMCPを提供。

## 前提環境

- **Node は 22 系（`.nvmrc` = 22.21.0）を使うこと。** DB ドライバ `better-sqlite3` はネイティブモジュールで、プリビルドの無い新しい Node ではソースコンパイルに失敗する。`nvm use` してから作業する。
- pnpm 10 / TypeScript 5.9。パッケージ名は `@pdash/*`（例: `@pdash/db`, `@pdash/api`, `@pdash/web`）。

## 開発コマンド

ルートから実行（Turborepo がワークスペース間の依存順を解決する）。

```sh
pnpm dev:next            # Web のみ起動 → http://localhost:3000
pnpm dev                 # 全パッケージの dev をまとめて起動

# 品質チェック（PR 前に必ず全部通す。docs/frontend-guideline.md 準拠）
pnpm typecheck           # 型チェック
pnpm lint                # ESLint（lint:fix で自動修正）
pnpm format              # Prettier（format:fix で自動修正）
pnpm -F @pdash/web build  # ビルドエラー確認

# DB（@pdash/db）
pnpm -F @pdash/db generate   # スキーマ変更後、マイグレーション生成
pnpm -F @pdash/db migrate    # マイグレーション適用
pnpm db:studio              # Drizzle Studio で中身を確認
```

単一パッケージへの絞り込みは `pnpm -F @pdash/<pkg> <script>`。

## 詳細ドキュメント（/docs）

- [docs/development/spec.md](docs/development/spec.md) — 要件
- [docs/development/tech-stack.md](docs/development/tech-stack.md) — 技術選定・全体アーキテクチャ・決定事項
- [docs/development/screen-spec.md](docs/development/screen-spec.md) — 画面仕様
- [docs/development/data-model.md](docs/development/data-model.md) — データモデル
- [docs/development/frontend-guideline.md](docs/development/frontend-guideline.md) — フロントエンド開発ガイドライン
