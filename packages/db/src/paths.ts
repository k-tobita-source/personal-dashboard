import { homedir } from "node:os";
import { join } from "node:path";

/**
 * ローカル完結方針により、DB はユーザー領域のファイルに保存する（リポジトリ外）。
 * 既定は ~/.my-kanban/kanban.db。`KANBAN_DB_PATH` で上書き可能。
 */
export const databasePath =
  process.env.KANBAN_DB_PATH ?? join(homedir(), ".my-kanban", "kanban.db");
