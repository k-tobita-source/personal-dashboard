# MCP サーバー（`packages/mcp`）実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude（Claude Code / Claude Desktop）から stdio MCP 経由でカンバンボードのカードを操作（一覧・追加・移動・完了・更新・削除）できる `@acme/mcp` パッケージを追加する。

**Architecture:** 既存の `taskService`（`packages/api`）を HTTP を経由せず直接呼ぶヘッドレス構成。MCP SDK の低レベル `Server` API で 6 つのツールを公開し、入力スキーマは zod v4 で定義して `z.toJSONSchema()` で MCP 用 JSON Schema を導出する。DB は既存の遅延初期化 SQLite（WAL）を共有し、起動時にマイグレーションを冪等適用する。

**Tech Stack:** TypeScript 5.9 / Node 22 / `@modelcontextprotocol/sdk` / zod v4 / drizzle-orm（better-sqlite3）/ tsx / Vitest。

> **設計からの差分（YAGNI）:** スペックにあった `move_task` の任意引数 `place: "top"|"bottom"` は実装しない。`taskService.move` は position を内部計算（Done→先頭 / その他→末尾）し override の口を持たないため、追加には service 改修が必要で価値が小さい。自動配置でスペックの主旨（Claude に数値 position を見せない）は満たせる。

---

## ファイル構成

**新規作成**
- `packages/mcp/package.json` — パッケージ定義（`@acme/mcp`）
- `packages/mcp/tsconfig.json` — ワークスペース共通 tsconfig を継承
- `packages/mcp/eslint.config.ts` — ワークスペース共通 ESLint
- `packages/mcp/vitest.config.ts` — テスト用に `KANBAN_DB_PATH` を一時ファイルへ向ける
- `packages/mcp/README.md` — Claude 設定スニペット
- `packages/mcp/src/mapping.ts` — 純粋関数（Task 行→カードビュー、日時パース）
- `packages/mcp/src/mapping.test.ts` — 純粋関数のユニットテスト
- `packages/mcp/src/tools.ts` — 6 ツールの定義（name / description / zod スキーマ / handler）
- `packages/mcp/src/tools.test.ts` — 一時 DB に対するツール統合テスト
- `packages/mcp/src/index.ts` — エントリ。`Server` 構築・ツール登録・stdio 接続
- `packages/db/src/migrate.ts` — drizzle マイグレーションを冪等適用するヘルパー（MCP 起動・テスト共用）

**変更**
- `packages/api/package.json` — `./service` サブパス export を追加（MCP から `taskService` を import するため）
- `packages/db/package.json` — `./migrate` サブパス export を追加

---

## Task 1: パッケージ雛形と service / migrate の export

**Files:**
- Create: `packages/mcp/package.json`, `packages/mcp/tsconfig.json`, `packages/mcp/eslint.config.ts`, `packages/mcp/vitest.config.ts`
- Create: `packages/db/src/migrate.ts`
- Modify: `packages/api/package.json`, `packages/db/package.json`

- [ ] **Step 1: `@acme/api` に `./service` export を追加**

`packages/api/package.json` の `exports` を以下に置き換える（既存の `"."` は残す）:

```json
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./src/index.ts"
    },
    "./service": {
      "types": "./dist/service/task.d.ts",
      "default": "./src/service/task.ts"
    }
  },
```

- [ ] **Step 2: `@acme/db` に `./migrate` export を追加**

`packages/db/package.json` の `exports` に次のキーを追加する（`.` / `./client` / `./schema` の後ろ）:

```json
    "./migrate": {
      "types": "./dist/migrate.d.ts",
      "default": "./src/migrate.ts"
    }
```

- [ ] **Step 3: マイグレーションヘルパーを作成**

`packages/db/src/migrate.ts`:

```ts
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
```

- [ ] **Step 4: MCP パッケージの `package.json` を作成**

`packages/mcp/package.json`:

```json
{
  "name": "@acme/mcp",
  "private": true,
  "type": "module",
  "license": "MIT",
  "scripts": {
    "build": "tsc",
    "clean": "git clean -xdf .cache .turbo dist node_modules",
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "format": "prettier --check . --ignore-path ../../.gitignore",
    "lint": "eslint --flag unstable_native_nodejs_ts_config",
    "test": "vitest run",
    "typecheck": "tsc --noEmit --emitDeclarationOnly false"
  },
  "dependencies": {
    "@acme/api": "workspace:*",
    "@acme/db": "workspace:*",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@acme/eslint-config": "workspace:*",
    "@acme/prettier-config": "workspace:*",
    "@acme/tsconfig": "workspace:*",
    "@types/node": "catalog:",
    "eslint": "catalog:",
    "prettier": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  },
  "prettier": "@acme/prettier-config"
}
```

- [ ] **Step 5: `tsconfig.json` / `eslint.config.ts` / `vitest.config.ts` を作成**

`packages/mcp/tsconfig.json`:

```json
{
  "extends": "@acme/tsconfig/compiled-package.json",
  "include": ["src"],
  "exclude": ["node_modules"]
}
```

`packages/mcp/eslint.config.ts`:

```ts
import { defineConfig } from "eslint/config";

import { baseConfig } from "@acme/eslint-config/base";

export default defineConfig(
  {
    ignores: ["dist/**"],
  },
  baseConfig,
);
```

`packages/mcp/vitest.config.ts`（`KANBAN_DB_PATH` は paths.ts のモジュール評価時に読まれるため、`beforeAll` ではなく config の `test.env` で設定する必要がある）:

```ts
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      // 本物の ~/.my-kanban/kanban.db を汚さないよう一時ファイルへ向ける
      KANBAN_DB_PATH: join(tmpdir(), "kanban-mcp-test.db"),
    },
  },
});
```

- [ ] **Step 6: SDK と tsx をインストール**

Run:
```bash
pnpm -F @acme/mcp add @modelcontextprotocol/sdk
pnpm -F @acme/mcp add -D tsx
```
Expected: 両方 `dependencies` / `devDependencies` に追加され、インストール成功。

- [ ] **Step 7: 既存パッケージの型が壊れていないか確認**

Run: `pnpm -F @acme/api typecheck && pnpm -F @acme/db typecheck`
Expected: どちらも PASS（export 追加・migrate.ts 追加で既存型に影響なし）。

- [ ] **Step 8: コミット**

```bash
git add packages/mcp packages/api/package.json packages/db/package.json packages/db/src/migrate.ts
git commit -m "feat(mcp): scaffold @acme/mcp package and service/migrate exports

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 純粋関数（mapping）

**Files:**
- Create: `packages/mcp/src/mapping.ts`
- Test: `packages/mcp/src/mapping.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/mcp/src/mapping.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { parseDate, parseNullableDate, toCardView } from "./mapping";

const baseRow = {
  id: "t1",
  source: "todo" as const,
  lane: "inbox" as const,
  title: "買い物",
  body: "x".repeat(300),
  sender: null,
  avatarUrl: null,
  url: null,
  externalId: null,
  startAt: new Date("2026-06-16T01:00:00Z"),
  endAt: new Date("2026-06-16T02:00:00Z"),
  position: 1,
  createdAt: new Date("2026-06-16T00:00:00Z"),
  updatedAt: null,
};

describe("toCardView", () => {
  it("Date を ISO 文字列へ変換する", () => {
    const v = toCardView(baseRow);
    expect(v.startAt).toBe("2026-06-16T01:00:00.000Z");
    expect(v.endAt).toBe("2026-06-16T02:00:00.000Z");
  });

  it("body を 200 文字でプレビューに切り詰める", () => {
    expect(toCardView(baseRow).body).toHaveLength(200);
  });

  it("null 時刻・null body はそのまま null", () => {
    const v = toCardView({ ...baseRow, startAt: null, endAt: null, body: null });
    expect(v.startAt).toBeNull();
    expect(v.endAt).toBeNull();
    expect(v.body).toBeNull();
  });

  it("id / lane / source / title を保持する", () => {
    const v = toCardView(baseRow);
    expect(v).toMatchObject({
      id: "t1",
      lane: "inbox",
      source: "todo",
      title: "買い物",
    });
  });
});

describe("parseDate", () => {
  it("undefined はそのまま undefined", () => {
    expect(parseDate(undefined)).toBeUndefined();
  });
  it("ISO 文字列は Date", () => {
    expect(parseDate("2026-06-16T01:00:00Z")).toEqual(
      new Date("2026-06-16T01:00:00Z"),
    );
  });
  it("不正な日時は throw", () => {
    expect(() => parseDate("not-a-date")).toThrow(/invalid date/);
  });
});

describe("parseNullableDate", () => {
  it("undefined=据え置き", () => {
    expect(parseNullableDate(undefined)).toBeUndefined();
  });
  it("null=クリア", () => {
    expect(parseNullableDate(null)).toBeNull();
  });
  it("ISO=設定", () => {
    expect(parseNullableDate("2026-06-16T01:00:00Z")).toEqual(
      new Date("2026-06-16T01:00:00Z"),
    );
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm -F @acme/mcp test src/mapping.test.ts`
Expected: FAIL（`./mapping` が存在しない / import エラー）。

- [ ] **Step 3: 最小実装を書く**

`packages/mcp/src/mapping.ts`:

```ts
import { Task } from "@acme/db/schema";

type TaskRow = typeof Task.$inferSelect;

/** body プレビューの最大文字数 */
const BODY_PREVIEW_LEN = 200;

/** Task 行を Claude 向けのコンパクトなカードビューへ変換（Date → ISO 文字列） */
export function toCardView(task: TaskRow) {
  return {
    id: task.id,
    lane: task.lane,
    source: task.source,
    title: task.title,
    body: task.body ? task.body.slice(0, BODY_PREVIEW_LEN) : null,
    startAt: task.startAt ? task.startAt.toISOString() : null,
    endAt: task.endAt ? task.endAt.toISOString() : null,
  };
}

/** ISO 文字列を Date へ。zod のバージョン差異を避けるためここで妥当性検証する */
function toDate(iso: string): Date {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid date: ${iso}`);
  return d;
}

/** 任意日時: undefined はそのまま、文字列は Date（add_task 等） */
export function parseDate(iso: string | undefined): Date | undefined {
  return iso === undefined ? undefined : toDate(iso);
}

/** 三値日時: undefined=据え置き / null=クリア / ISO=設定（move / update） */
export function parseNullableDate(
  iso: string | null | undefined,
): Date | null | undefined {
  if (iso === undefined) return undefined;
  if (iso === null) return null;
  return toDate(iso);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm -F @acme/mcp test src/mapping.test.ts`
Expected: PASS（全 10 ケース）。

- [ ] **Step 5: コミット**

```bash
git add packages/mcp/src/mapping.ts packages/mcp/src/mapping.test.ts
git commit -m "feat(mcp): add card view and date parsing helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: ツール定義（tools.ts）

**Files:**
- Create: `packages/mcp/src/tools.ts`
- Test: `packages/mcp/src/tools.test.ts`

- [ ] **Step 1: 失敗するテストを書く（一時 DB に対する統合テスト）**

`packages/mcp/src/tools.test.ts`:

```ts
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@acme/db/client";
import { runMigrations } from "@acme/db/migrate";
import { Task } from "@acme/db/schema";

import { tools } from "./tools";

function tool(name: string) {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}

async function call(name: string, args: unknown) {
  return tool(name).handler(args);
}

beforeAll(() => {
  // KANBAN_DB_PATH は vitest.config.ts の test.env で一時ファイルに設定済み
  runMigrations();
});

beforeEach(async () => {
  await db.delete(Task);
});

describe("tools registry", () => {
  it("6 つのツールを公開する", () => {
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "add_task",
        "complete_task",
        "delete_task",
        "list_tasks",
        "move_task",
        "update_task",
      ].sort(),
    );
  });

  it("全ツールが description を持つ", () => {
    for (const t of tools) expect(t.description.length).toBeGreaterThan(0);
  });
});

describe("add_task / list_tasks", () => {
  it("startAt 省略時は inbox に作成される", async () => {
    const created = (await call("add_task", { title: "牛乳を買う" })) as {
      id: string;
      lane: string;
    };
    expect(created.lane).toBe("inbox");

    const list = (await call("list_tasks", {})) as unknown[];
    expect(list).toHaveLength(1);
  });

  it("startAt 指定時は schedule に作成され ISO 文字列が返る", async () => {
    const created = (await call("add_task", {
      title: "MTG",
      startAt: "2026-06-16T01:00:00Z",
    })) as { lane: string; startAt: string | null };
    expect(created.lane).toBe("schedule");
    expect(created.startAt).toBe("2026-06-16T01:00:00.000Z");
  });

  it("list_tasks は lane で絞り込める", async () => {
    await call("add_task", { title: "A" });
    await call("add_task", { title: "B", startAt: "2026-06-16T01:00:00Z" });

    const inbox = (await call("list_tasks", { lane: "inbox" })) as unknown[];
    expect(inbox).toHaveLength(1);
  });
});

describe("move_task / complete_task", () => {
  it("move_task でレーンと時刻を更新する", async () => {
    const created = (await call("add_task", { title: "T" })) as { id: string };
    const moved = (await call("move_task", {
      id: created.id,
      lane: "schedule",
      startAt: "2026-06-16T03:00:00Z",
    })) as { lane: string; startAt: string | null };
    expect(moved.lane).toBe("schedule");
    expect(moved.startAt).toBe("2026-06-16T03:00:00.000Z");
  });

  it("complete_task は done に移動する", async () => {
    const created = (await call("add_task", { title: "T" })) as { id: string };
    const done = (await call("complete_task", { id: created.id })) as {
      lane: string;
    };
    expect(done.lane).toBe("done");
  });

  it("存在しない id は throw する", async () => {
    await expect(call("complete_task", { id: "nope" })).rejects.toThrow(
      /not found/,
    );
  });
});

describe("update_task", () => {
  it("startAt に null を渡すとクリアされる", async () => {
    const created = (await call("add_task", {
      title: "T",
      startAt: "2026-06-16T01:00:00Z",
    })) as { id: string };
    const updated = (await call("update_task", {
      id: created.id,
      startAt: null,
    })) as { startAt: string | null };
    expect(updated.startAt).toBeNull();
  });

  it("title だけ更新し他は据え置く", async () => {
    const created = (await call("add_task", {
      title: "old",
      startAt: "2026-06-16T01:00:00Z",
    })) as { id: string };
    const updated = (await call("update_task", {
      id: created.id,
      title: "new",
    })) as { title: string; startAt: string | null };
    expect(updated.title).toBe("new");
    expect(updated.startAt).toBe("2026-06-16T01:00:00.000Z");
  });
});

describe("delete_task", () => {
  it("削除すると list から消える", async () => {
    const created = (await call("add_task", { title: "T" })) as { id: string };
    await call("delete_task", { id: created.id });
    const list = (await call("list_tasks", {})) as unknown[];
    expect(list).toHaveLength(0);
  });
});

describe("input validation", () => {
  it("title 空文字は throw する", async () => {
    await expect(call("add_task", { title: "" })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm -F @acme/mcp test src/tools.test.ts`
Expected: FAIL（`./tools` が存在しない）。

- [ ] **Step 3: 最小実装を書く**

`packages/mcp/src/tools.ts`:

```ts
import { z } from "zod/v4";

import { taskService } from "@acme/api/service";
import { LANES } from "@acme/db/schema";

import { parseDate, parseNullableDate, toCardView } from "./mapping";

/** MCP に公開する 1 ツールの定義。handler は自前で入力をパースする（テスト容易性のため） */
export interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodType;
  handler: (args: unknown) => Promise<unknown>;
}

const LaneEnum = z.enum(LANES);

const listSchema = z.object({
  lane: LaneEnum.optional().describe("絞り込むレーン。省略時は全レーン"),
});

const addSchema = z.object({
  title: z.string().min(1).max(512),
  body: z.string().max(2000).optional(),
  startAt: z
    .string()
    .optional()
    .describe("ISO8601 日時。指定すると schedule レーンへ時刻確定タスクとして作成"),
});

const moveSchema = z.object({
  id: z.string(),
  lane: LaneEnum,
  startAt: z
    .string()
    .nullish()
    .describe("ISO8601 日時。null=クリア / 省略=据え置き"),
  endAt: z
    .string()
    .nullish()
    .describe("ISO8601 日時（工数の終端）。null=クリア / 省略=据え置き"),
});

const completeSchema = z.object({ id: z.string() });

const updateSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(512).optional(),
  body: z.string().max(2000).nullish().describe("null=クリア / 省略=据え置き"),
  startAt: z.string().nullish().describe("ISO8601。null=クリア / 省略=据え置き"),
  endAt: z.string().nullish().describe("ISO8601。null=クリア / 省略=据え置き"),
});

const deleteSchema = z.object({ id: z.string() });

const LANE_DOC =
  "レーン: inbox(受信箱) / schedule(時系列) / in_progress(対応中) / done(完了)。レーンが状態の単一ソース。";

export const tools: ToolDef[] = [
  {
    name: "list_tasks",
    description: `ボード上のタスク一覧を取得する。${LANE_DOC} source は calendar/slack/gmail(外部実体) と todo(自前ToDo)。`,
    schema: listSchema,
    handler: async (args) => {
      const { lane } = listSchema.parse(args);
      const all = await taskService.list();
      const filtered = lane ? all.filter((t) => t.lane === lane) : all;
      return filtered.map(toCardView);
    },
  },
  {
    name: "add_task",
    description:
      "独自 ToDo を新規作成する。startAt を指定すると schedule、なければ inbox に入る。",
    schema: addSchema,
    handler: async (args) => {
      const input = addSchema.parse(args);
      const row = await taskService.create({
        title: input.title,
        body: input.body,
        startAt: parseDate(input.startAt),
      });
      return toCardView(row);
    },
  },
  {
    name: "move_task",
    description: `タスクを別レーンへ移動する。${LANE_DOC} startAt/endAt を渡すと時刻も更新する。`,
    schema: moveSchema,
    handler: async (args) => {
      const input = moveSchema.parse(args);
      const row = await taskService.move({
        id: input.id,
        lane: input.lane,
        startAt: parseNullableDate(input.startAt),
        endAt: parseNullableDate(input.endAt),
      });
      if (!row) throw new Error(`task not found: ${input.id}`);
      return toCardView(row);
    },
  },
  {
    name: "complete_task",
    description: "タスクを done(完了) レーンへ移動する。",
    schema: completeSchema,
    handler: async (args) => {
      const { id } = completeSchema.parse(args);
      const row = await taskService.move({ id, lane: "done" });
      if (!row) throw new Error(`task not found: ${id}`);
      return toCardView(row);
    },
  },
  {
    name: "update_task",
    description:
      "タスクのタイトル・本文・時刻を編集する。値を省略したフィールドは据え置き、null を渡すとクリアする。",
    schema: updateSchema,
    handler: async (args) => {
      const input = updateSchema.parse(args);
      const row = await taskService.update({
        id: input.id,
        title: input.title,
        body: input.body,
        startAt: parseNullableDate(input.startAt),
        endAt: parseNullableDate(input.endAt),
      });
      if (!row) throw new Error(`task not found: ${input.id}`);
      return toCardView(row);
    },
  },
  {
    name: "delete_task",
    description:
      "タスクを削除する(不可逆)。calendar/slack/gmail などの外部実体を削除してもボードから消えるだけで、元のカレンダー予定やメールには影響しない。",
    schema: deleteSchema,
    handler: async (args) => {
      const { id } = deleteSchema.parse(args);
      await taskService.remove(id);
      return { id, deleted: true };
    },
  },
];
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm -F @acme/mcp test src/tools.test.ts`
Expected: PASS（全ケース）。

- [ ] **Step 5: コミット**

```bash
git add packages/mcp/src/tools.ts packages/mcp/src/tools.test.ts
git commit -m "feat(mcp): add board operation tools backed by taskService

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: サーバーエントリ（index.ts）

**Files:**
- Create: `packages/mcp/src/index.ts`

低レベル `Server` API を使う（高レベル `McpServer.tool` は zod v3 の ZodRawShape を要求し、本プロジェクトの zod v4 と噛み合わないため）。入力スキーマは `z.toJSONSchema()` で JSON Schema 化する。

- [ ] **Step 1: エントリを実装**

`packages/mcp/src/index.ts`:

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";

import { runMigrations } from "@acme/db/migrate";

import { tools } from "./tools";

const server = new Server(
  { name: "my-kanban", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    // zod v4 スキーマから MCP 用 JSON Schema を導出
    inputSchema: z.toJSONSchema(t.schema) as { type: "object" },
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = tools.find((t) => t.name === request.params.name);
  if (!tool) {
    return {
      content: [
        { type: "text", text: `unknown tool: ${request.params.name}` },
      ],
      isError: true,
    };
  }
  try {
    const result = await tool.handler(request.params.arguments ?? {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
  }
});

async function main() {
  // Claude が単体起動してもスキーマが無い DB で落ちないよう冪等にマイグレーション
  runMigrations();
  await server.connect(new StdioServerTransport());
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: 型チェック**

Run: `pnpm -F @acme/mcp typecheck`
Expected: PASS。失敗する場合は `inputSchema` の型のみ `as { type: "object" }` のキャストで吸収する（既にコードに含む）。

- [ ] **Step 3: stdio スモークテスト（ListTools / CallTool を手動で叩く）**

Run:
```bash
KANBAN_DB_PATH="$(mktemp -d)/smoke.db" pnpm -F @acme/mcp start <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"add_task","arguments":{"title":"smoke test"}}}
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"list_tasks","arguments":{}}}
EOF
```
Expected: 標準出力に JSON-RPC レスポンスが流れ、`tools/list` が 6 ツールを返し、`add_task`→`list_tasks` で作成した "smoke test" が 1 件返る。（プロセスは stdin EOF 後も待機するので、レスポンス確認後 Ctrl-C で終了してよい。）

- [ ] **Step 4: コミット**

```bash
git add packages/mcp/src/index.ts
git commit -m "feat(mcp): add stdio server entry wiring tools and migrations

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: README と最終検証

**Files:**
- Create: `packages/mcp/README.md`

- [ ] **Step 1: README を作成**

`packages/mcp/README.md`:

````markdown
# @acme/mcp

Claude（Claude Code / Claude Desktop）からカンバンボードを操作する stdio MCP サーバー。
`packages/api` の `taskService` を直接呼び、DB（`~/.my-kanban/kanban.db`）を Web アプリと共有する。

## 公開ツール

| ツール | 内容 |
| --- | --- |
| `list_tasks` | タスク一覧（任意の `lane` フィルタ） |
| `add_task` | 独自 ToDo を作成（`startAt` 指定で schedule） |
| `move_task` | レーン移動＋時刻更新 |
| `complete_task` | done へ移動 |
| `update_task` | タイトル・本文・時刻の編集 |
| `delete_task` | 削除（外部実体でもボード状態のみ変更） |

## Claude Code / Claude Desktop への登録

`.mcp.json`（Claude Code）または `claude_desktop_config.json` に追記する。`cwd` はこのリポジトリの絶対パスに置き換える。

```json
{
  "mcpServers": {
    "my-kanban": {
      "command": "pnpm",
      "args": ["-F", "@acme/mcp", "start"],
      "cwd": "/absolute/path/to/my-kanban"
    }
  }
}
```

- ビルド不要（`tsx` で TypeScript を直接実行）。
- DB パスを変えたい場合は `env` に `KANBAN_DB_PATH` を追加する（Web アプリと同じ値にすること）。WAL モードのため Web と MCP の並行アクセスを許容する。
- 起動時にマイグレーションを冪等適用するため、DB が未作成でも動作する。
````

- [ ] **Step 2: 全パッケージ品質チェック**

Run: `pnpm -F @acme/mcp typecheck && pnpm -F @acme/mcp lint && pnpm -F @acme/mcp format && pnpm -F @acme/mcp test`
Expected: 全て PASS。format で差分があれば `pnpm -F @acme/mcp format:fix` 相当（`prettier --write`）で整形してから再実行。

- [ ] **Step 3: モノレポ全体の型チェック（export 追加の波及確認）**

Run: `pnpm typecheck`
Expected: PASS。

- [ ] **Step 4: コミット**

```bash
git add packages/mcp/README.md
git commit -m "docs(mcp): add README with Claude config snippet

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
