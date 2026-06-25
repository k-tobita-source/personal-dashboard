import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@pdash/db/client";
import { runMigrations } from "@pdash/db/migrate";
import { Task } from "@pdash/db/schema";

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
