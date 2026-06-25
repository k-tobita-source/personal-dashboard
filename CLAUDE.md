# MYダッシュボード

当日の予定・Slack の依頼・Gmail・独自 ToDo を 1 画面のカンバンに集約する、ローカル完結の個人用ダッシュボード（単一ユーザー前提）。create-t3-turbo ベースの pnpm + Turborepo モノレポ。

## 前提環境

- **Node は 22 系（`.nvmrc` = 22.21.0）を使うこと。** DB ドライバ `better-sqlite3` はネイティブモジュールで、プリビルドの無い新しい Node ではソースコンパイルに失敗する。`nvm use` してから作業する。
- pnpm 10 / TypeScript 5.9。パッケージ名は `@acme/*`（例: `@acme/db`, `@acme/api`, `@acme/web`）。

## 開発コマンド

ルートから実行（Turborepo がワークスペース間の依存順を解決する）。

```sh
pnpm dev:next            # Web のみ起動 → http://localhost:3000
pnpm dev                 # 全パッケージの dev をまとめて起動

# 品質チェック（PR 前に必ず全部通す。docs/frontend-guideline.md 準拠）
pnpm typecheck           # 型チェック
pnpm lint                # ESLint（lint:fix で自動修正）
pnpm format              # Prettier（format:fix で自動修正）
pnpm -F @acme/web build  # ビルドエラー確認

# DB（@acme/db）
pnpm -F @acme/db generate   # スキーマ変更後、マイグレーション生成
pnpm -F @acme/db migrate    # マイグレーション適用
pnpm db:studio              # Drizzle Studio で中身を確認
```

単一パッケージへの絞り込みは `pnpm -F @acme/<pkg> <script>`。

## 詳細ドキュメント（/docs）

- [docs/development/spec.md](docs/development/spec.md) — 要件
- [docs/development/tech-stack.md](docs/development/tech-stack.md) — 技術選定・全体アーキテクチャ・決定事項
- [docs/development/screen-spec.md](docs/development/screen-spec.md) — 画面仕様
- [docs/development/data-model.md](docs/development/data-model.md) — データモデル
- [docs/development/frontend-guideline.md](docs/development/frontend-guideline.md) — フロントエンド開発ガイドライン
