# MCP サーバー（`packages/mcp`）設計

> Claude（Claude Code / Claude Desktop）からカンバンボードを操作できるようにする MCP サーバー。
> 背景: [docs/spec.md](../../spec.md) §2.1 / §4、[docs/tech-stack.md](../../tech-stack.md) §4.6。

## 目的

Claude から MCP 経由でボードのカードを追加・移動・整理・編集・削除できるようにする。Web アプリが起動していなくても動くよう、**HTTP を経由せず service 層（`packages/api` の `taskService`）→ DB を直接呼ぶ**ヘッドレス構成にする（tech-stack §4.6）。

## スコープ

- **やること**: ボード操作（読み取り・作成・移動・完了・更新・削除）を提供する stdio MCP サーバー。
- **やらないこと**: 外部 API（Google / Slack / Gmail）への書き込み、認証、ポーリング。MCP の操作範囲は **ボード DB 操作に閉じる**（tech-stack §7 決定事項）。

## アーキテクチャ

### パッケージ構成

新規パッケージ `packages/mcp`（`@acme/mcp`）。既存パッケージ規約に準拠する。

- `type: module`、ESLint は `unstable_native_nodejs_ts_config` フラグ、tsconfig / prettier はワークスペース共通設定を継承。
- 依存: `@acme/api`（service 層）、`@acme/db`（型）、`@modelcontextprotocol/sdk`、`zod`、`tsx`（dev/実行）。
- トランスポート: **stdio**。Claude が子プロセスとして起動する。

### service 層へのアクセス

現状 `@acme/api` は service を package export していない（router が相対パス `../service/task` で import）。MCP から綺麗に import できるよう、`@acme/api` の `package.json` に **`./service` サブパス export を追加**し、`taskService` と入力型（`CreateTodoInput` 等）を公開する。router は変更不要。

```
@acme/mcp  ──import──►  @acme/api/service (taskService)  ──►  @acme/db/client (SQLite, WAL)
```

WAL モードのため Web プロセスと MCP プロセスの並行アクセスを許容する。DB パスは `KANBAN_DB_PATH`（既定 `~/.my-kanban/kanban.db`）を Web アプリと共有。

## 公開ツール（LLM 向けに意味的に再設計）

service 層の 6 関数を、Claude が自然に使える粒度・名前のツールとして公開する。各ツールは zod 入力スキーマと、ドメイン規約（4 レーンの意味、外部実体の扱い、三値規約）を説明する description を持つ。

| ツール | wraps | 内容 |
|---|---|---|
| `list_tasks` | `list` | 任意の `lane` フィルタ。コンパクトなカードビュー（id / lane / title / source / startAt / endAt / body プレビュー）を返す。 |
| `add_task` | `create` | 独自 ToDo を作成。`startAt` 任意 → 有無で inbox/schedule を自動判定。 |
| `move_task` | `move` | `lane` ＋任意の `startAt`/`endAt`（null=クリア）。position は自動処理（下記参照）。 |
| `complete_task` | `move`（lane=done） | よく使う「完了」操作の便利ラッパー。 |
| `update_task` | `update` | title / body / startAt / endAt。三値規約（undefined=据え置き / null=クリア / 値=設定）を維持。 |
| `delete_task` | `remove` | description で不可逆である旨を警告。外部実体（calendar/slack/gmail）はボード状態のみ変わり元データは触らない旨を明記。 |

### レーン・ソースの説明（description に載せる）

- レーン: `inbox`（受信箱）/ `schedule`（時系列）/ `in_progress`（対応中）/ `done`（完了）。レーンが状態の単一ソース。
- ソース: `calendar` / `slack` / `gmail` は外部実体（Done に移しても元データは不変）、`todo` は自前データ。

## position（並び順）の扱い

Claude は前後の中間値を計算できないため、**`reorder` は生ツールとして公開しない**。並び順は MCP 層がサーバー側で処理する。

- `move_task` / `complete_task` は service 既存の配置ロジックを再利用（Done→先頭、それ以外→末尾）。
- 任意の `place: "top" | "bottom"` 引数を追加（既定: 末尾、done は先頭）。MCP 層が `nextPosition` / `firstPosition` ヘルパーで具体的な `position` に変換する。
- **数値の position は一切 Claude に露出しない。**

## 日時の扱い

MCP は JSON でやり取りする（superjson ではない）。ツールの入力スキーマでは日時を **ISO 8601 文字列**で受け取り、service 呼び出し前に `Date` へ変換する。出力では `Date` を ISO 文字列にシリアライズして返す。

## エラーハンドリング

- service 呼び出しをラップし、不正な id・入力不正は MCP の `isError` ツール結果として読みやすいメッセージで返す（スタックを投げない）。
- zod でツール境界の入力を検証する。

## 起動・設定

- 実行: `tsx` で `src/index.ts` を直接実行（ビルド不要）。package script `start: "tsx src/index.ts"`。
- Claude 設定（`claude_desktop_config.json` / Claude Code `.mcp.json`）のスニペットを README に記載。`KANBAN_DB_PATH` が Web アプリと共有である旨も明記。

## テスト

- Vitest（パッケージ規約）。一時 SQLite DB に対して各ツールハンドラをテスト。
- 各ツールの正常系＋異常系（不正 id、バリデーション失敗）。`syncService.test.ts` のスタイルに倣う。

## 成果物

- `packages/mcp/`（`package.json` / `tsconfig.json` / `eslint.config.js` / `src/index.ts` / ツール定義 / テスト / README）。
- `@acme/api` の `package.json` に `./service` export を追加。
- ルート `pnpm-workspace.yaml` / catalog への必要な追記（`@modelcontextprotocol/sdk`、`tsx`）。
