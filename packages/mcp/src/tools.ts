import { z } from "zod/v4";

import type { TaskRow } from "@pdash/db/schema";
import { taskService } from "@pdash/api/service";
import { LANES } from "@pdash/db/schema";

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
    .describe(
      "ISO8601 日時。指定すると schedule レーンへ時刻確定タスクとして作成",
    ),
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
  startAt: z
    .string()
    .nullish()
    .describe("ISO8601。null=クリア / 省略=据え置き"),
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
      // list() は drizzle のリレーショナルクエリで型が緩く推論されるため明示する
      const all = (await taskService.list()) as TaskRow[];
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
      if (!row) throw new Error("failed to create task");
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
