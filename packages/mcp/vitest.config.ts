import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      // 本物の ~/.personal-dashboard/kanban.db を汚さないよう一時ファイルへ向ける
      KANBAN_DB_PATH: join(tmpdir(), "kanban-mcp-test.db"),
    },
  },
});
