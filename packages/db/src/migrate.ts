import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { getDb } from "./client";

const migrationsFolder = join(
  dirname(fileURLToPath(import.meta.url)),
  "../drizzle",
);

/**
 * drizzle マイグレーションを適用する（冪等）。
 * MCP サーバー起動時やテストのセットアップで、スキーマ未適用の DB でも動くよう保証する。
 */
export function runMigrations(): void {
  migrate(getDb(), { migrationsFolder });
}
