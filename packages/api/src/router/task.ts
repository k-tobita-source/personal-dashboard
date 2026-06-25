import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import {
  CreateTodoInput,
  MoveTaskInput,
  ReorderTaskInput,
  taskService,
  UpdateTaskInput,
} from "../service/task";
import { publicProcedure } from "../trpc";

export const taskRouter = {
  /** 全タスク取得（UI が 4 カラムに振り分ける） */
  all: publicProcedure.query(() => taskService.list()),

  /** 独自 ToDo を追加 */
  create: publicProcedure
    .input(CreateTodoInput)
    .mutation(({ input }) => taskService.create(input)),

  /** レーン移動（D&D） */
  move: publicProcedure
    .input(MoveTaskInput)
    .mutation(({ input }) => taskService.move(input)),

  /** カラム内の並び替え */
  reorder: publicProcedure
    .input(ReorderTaskInput)
    .mutation(({ input }) => taskService.reorder(input)),

  /** タイトル・本文の編集 */
  update: publicProcedure
    .input(UpdateTaskInput)
    .mutation(({ input }) => taskService.update(input)),

  /** 削除 */
  delete: publicProcedure
    .input(z.string())
    .mutation(({ input }) => taskService.remove(input)),
} satisfies TRPCRouterRecord;
