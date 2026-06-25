import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { databasePath } from "./paths";
import * as schema from "./schema";

type DrizzleDb = ReturnType<typeof createDb>;

let instance: DrizzleDb | undefined;

function createDb() {
  // DB ファイルの格納ディレクトリを用意（初回起動時など）
  mkdirSync(dirname(databasePath), { recursive: true });

  const sqlite = new Database(databasePath);
  // Web プロセスと MCP プロセスからの並行アクセスを許容するため WAL を有効化
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  return drizzle({ client: sqlite, schema, casing: "snake_case" });
}

/** DB ハンドルを取得（初回アクセス時にだけ接続を開く） */
export function getDb(): DrizzleDb {
  return (instance ??= createDb());
}

/**
 * 遅延初期化される db。プロパティ/メソッドへ実際にアクセスするまで接続を開かない
 * （Next.js のビルド時にモジュール読込だけで DB を開いてしまうのを防ぐ）。
 */
export const db = new Proxy({} as DrizzleDb, {
  get(_target, prop, receiver) {
    const real = getDb();
    const value = Reflect.get(real as object, prop, receiver) as unknown;
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(real)
      : value;
  },
});
