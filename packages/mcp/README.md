# @pdash/mcp

Claude（Claude Code / Claude Desktop）からカンバンボードを操作する stdio MCP サーバー。
`packages/api` の `taskService` を直接呼び、DB（`~/.personal-dashboard/kanban.db`）を Web アプリと共有する。

## 公開ツール

| ツール          | 内容                                          |
| --------------- | --------------------------------------------- |
| `list_tasks`    | タスク一覧（任意の `lane` フィルタ）          |
| `add_task`      | 独自 ToDo を作成（`startAt` 指定で schedule） |
| `move_task`     | レーン移動＋時刻更新                          |
| `complete_task` | done へ移動                                   |
| `update_task`   | タイトル・本文・時刻の編集                    |
| `delete_task`   | 削除（外部実体でもボード状態のみ変更）        |

## Claude Code / Claude Desktop への登録

`.mcp.json`（Claude Code）または `claude_desktop_config.json` に追記する。`cwd` はこのリポジトリの絶対パスに置き換える。

```json
{
  "mcpServers": {
    "personal-dashboard": {
      "command": "pnpm",
      "args": ["-F", "@pdash/mcp", "start"],
      "cwd": "/absolute/path/to/personal-dashboard"
    }
  }
}
```

- ビルド不要（`tsx` で直接実行）。
- DB パスを変えたい場合は `env` に `KANBAN_DB_PATH` を追加する（Web アプリと同じ値にすること）。WAL モードのため Web と MCP の並行アクセスを許容する。
- 起動時にマイグレーションを冪等適用するため、DB が未作成でも動作する。
