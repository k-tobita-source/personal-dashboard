import { z } from "zod/v4";

import type { Lane } from "@pdash/db/schema";
import { asc, eq, sql } from "@pdash/db";
import { db } from "@pdash/db/client";
import { LANES, Task } from "@pdash/db/schema";

/**
 * task の純粋なドメイン操作。tRPC ルーター（Web）からも MCP サーバーからも
 * この層を直接呼ぶ（HTTP を経由しない）。詳細は docs/data-model.md を参照。
 */

// --- 入力スキーマ（API/MCP 共通の契約） -------------------------------------

export const CreateTodoInput = z.object({
  title: z.string().min(1).max(512),
  body: z.string().max(2000).optional(),
  /** 指定時は Schedule への時刻確定タスクとして作成 */
  startAt: z.date().optional(),
  /** 工数の終端。startAt とセットで Schedule 作成時に使用 */
  endAt: z.date().optional(),
  /** 明示しない場合は startAt の有無で inbox/schedule を自動判定 */
  lane: z.enum(LANES).optional(),
});
export type CreateTodoInput = z.infer<typeof CreateTodoInput>;

export const MoveTaskInput = z.object({
  id: z.string(),
  lane: z.enum(LANES),
  /** undefined=変更しない / null=クリア / Date=設定 */
  startAt: z.date().nullish(),
  /** undefined=変更しない / null=クリア / Date=設定（工数の終端） */
  endAt: z.date().nullish(),
  /** カラム内の挿入位置（クライアントが前後の中間値を計算して渡す）。未指定なら末尾/Done は先頭 */
  position: z.number().optional(),
});
export type MoveTaskInput = z.infer<typeof MoveTaskInput>;

export const ReorderTaskInput = z.object({
  id: z.string(),
  /** カラム内の新しい並び順（クライアントが前後の中間値を計算して渡す） */
  position: z.number(),
});
export type ReorderTaskInput = z.infer<typeof ReorderTaskInput>;

export const UpdateTaskInput = z.object({
  id: z.string(),
  title: z.string().min(1).max(512).optional(),
  body: z.string().max(2000).nullish(),
  /** undefined=据え置き / null=クリア / Date=設定 */
  startAt: z.date().nullish(),
  /** 工数の終端。undefined=据え置き / null=クリア / Date=設定 */
  endAt: z.date().nullish(),
});
export type UpdateTaskInput = z.infer<typeof UpdateTaskInput>;

// --- ヘルパー --------------------------------------------------------------

/** Schedule レーンへの D&D 時に補完する既定工数（ミリ秒） */
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

/**
 * 三値規約（undefined=据え置き / null=クリア / 値=設定）に従い patch を values へ反映する。
 * undefined のキーは set に含めず（据え置き）、null/値はそのまま渡す。
 * クライアントの楽観更新側ヘルパー（mergeNullable）と対になる規約。
 */
function applyPatch<T extends Record<string, unknown>>(
  values: T,
  patch: Partial<T>,
): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) (values as Record<string, unknown>)[key] = value;
  }
}

/** 指定レーンの末尾に積むための次の position を返す */
export async function nextPosition(lane: Lane): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${Task.position}), 0)` })
    .from(Task)
    .where(eq(Task.lane, lane));
  return (row?.max ?? 0) + 1;
}

/** 指定レーンの先頭に積むための position を返す（Done は直近完了を上に出す） */
async function firstPosition(lane: Lane): Promise<number> {
  const [row] = await db
    .select({ min: sql<number>`coalesce(min(${Task.position}), 0)` })
    .from(Task)
    .where(eq(Task.lane, lane));
  return (row?.min ?? 0) - 1;
}

// --- サービス --------------------------------------------------------------

export const taskService = {
  /** 全タスクをレーン・position 順で取得（UI 側で 4 カラムに振り分ける） */
  list() {
    return db.query.Task.findMany({
      orderBy: [asc(Task.lane), asc(Task.position)],
    });
  },

  /** 独自 ToDo を作成 */
  async create(input: CreateTodoInput) {
    const lane = input.lane ?? (input.startAt ? "schedule" : "inbox");
    const [row] = await db
      .insert(Task)
      .values({
        source: "todo",
        lane,
        title: input.title,
        body: input.body,
        startAt: input.startAt,
        endAt: input.endAt,
        position: await nextPosition(lane),
      })
      .returning();
    return row;
  },

  /** レーン移動（D&D）。position 指定があればその位置へ、無ければ末尾（Done は先頭）へ */
  async move(input: MoveTaskInput) {
    const position =
      input.position ??
      (input.lane === "done"
        ? await firstPosition(input.lane)
        : await nextPosition(input.lane));
    const values: {
      lane: Lane;
      position: number;
      startAt?: Date | null;
      endAt?: Date | null;
    } = {
      lane: input.lane,
      position,
    };
    // startAt / endAt は三値規約でマージ（undefined は据え置き）
    applyPatch(values, { startAt: input.startAt, endAt: input.endAt });

    // Schedule へ時刻付きで入れる際、工数(endAt)未指定なら既定1時間を補完
    if (
      input.lane === "schedule" &&
      input.startAt instanceof Date &&
      input.endAt === undefined
    ) {
      values.endAt = new Date(input.startAt.getTime() + DEFAULT_DURATION_MS);
    }

    const [row] = await db
      .update(Task)
      .set(values)
      .where(eq(Task.id, input.id))
      .returning();
    return row;
  },

  /** カラム内の並び替え */
  async reorder(input: ReorderTaskInput) {
    const [row] = await db
      .update(Task)
      .set({ position: input.position })
      .where(eq(Task.id, input.id))
      .returning();
    return row;
  },

  /** タイトル・本文・時刻・工数の編集 */
  async update(input: UpdateTaskInput) {
    const values: {
      title?: string;
      body?: string | null;
      startAt?: Date | null;
      endAt?: Date | null;
    } = {};
    applyPatch(values, {
      title: input.title,
      body: input.body,
      startAt: input.startAt,
      endAt: input.endAt,
    });

    const [row] = await db
      .update(Task)
      .set(values)
      .where(eq(Task.id, input.id))
      .returning();
    return row;
  },

  /** 削除 */
  async remove(id: string) {
    await db.delete(Task).where(eq(Task.id, id));
    return { id };
  },
};
