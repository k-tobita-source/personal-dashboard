"use client";

import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { RouterInputs } from "@acme/api";
import { LANES } from "@acme/db/schema";

import type { Task } from "../types/task";
import { useTRPC } from "~/trpc/react";

type MoveVars = RouterInputs["task"]["move"];
type UpdateVars = RouterInputs["task"]["update"];
type ReorderVars = RouterInputs["task"]["reorder"];

// --- 楽観的更新の共通部品 ---------------------------------------------------

/** レーン昇順 → 同一レーン内は position 昇順で並べる比較関数 */
function byLaneThenPosition(a: Task, b: Task): number {
  return a.lane === b.lane
    ? a.position - b.position
    : LANES.indexOf(a.lane) - LANES.indexOf(b.lane);
}

/**
 * 三値規約（undefined=据え置き / null=クリア / 値=設定）に従って現在値へマージする。
 * service 層（move/update）の規約とクライアント側の楽観更新を一致させるためのヘルパー。
 */
function mergeNullable<T>(
  current: T | null,
  incoming: T | null | undefined,
): T | null {
  return incoming === undefined ? current : (incoming ?? null);
}

/**
 * tRPC ミューテーションの楽観的更新（キャッシュ即時反映 + 失敗時ロールバック + 完了後再取得）を
 * 組み立てる。各ミューテーション固有の差分は `apply`（現在のリストと入力から次のリストを返す純粋関数）に集約する。
 */
function optimistic<TVars>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  apply: (list: Task[], vars: TVars) => Task[],
) {
  return {
    onMutate: async (vars: TVars) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Task[]>(queryKey);
      queryClient.setQueryData<Task[]>(queryKey, (old) =>
        apply(old ?? [], vars),
      );
      return { previous };
    },
    onError: (
      _err: unknown,
      _vars: TVars,
      context: { previous: Task[] | undefined } | undefined,
    ) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  };
}

// --- キャッシュ書き換え（純粋関数） ----------------------------------------

/** レーン移動。position 指定があればそれを反映、無ければ Done は先頭・他は据え置き。時刻は三値規約でマージ */
function applyMove(list: Task[], vars: MoveVars): Task[] {
  const doneFallback =
    vars.lane === "done"
      ? Math.min(
          0,
          ...list.filter((t) => t.lane === "done").map((t) => t.position),
        ) - 1
      : undefined;
  const targetPosition = vars.position ?? doneFallback;
  return list
    .map((task) =>
      task.id === vars.id
        ? {
            ...task,
            lane: vars.lane,
            position: targetPosition ?? task.position,
            startAt: mergeNullable(task.startAt, vars.startAt),
            endAt: mergeNullable(task.endAt, vars.endAt),
          }
        : task,
    )
    .sort(byLaneThenPosition);
}

/** タイトル/本文/時刻/工数の更新（三値規約でマージ） */
function applyUpdate(list: Task[], vars: UpdateVars): Task[] {
  return list.map((task) =>
    task.id === vars.id
      ? {
          ...task,
          title: vars.title ?? task.title,
          body: mergeNullable(task.body, vars.body),
          startAt: mergeNullable(task.startAt, vars.startAt),
          endAt: mergeNullable(task.endAt, vars.endAt),
        }
      : task,
  );
}

/** カラム内の並び替え。position を反映し (lane, position) 順へ並べ替える */
function applyReorder(list: Task[], vars: ReorderVars): Task[] {
  return list
    .map((task) =>
      task.id === vars.id ? { ...task, position: vars.position } : task,
    )
    .sort(byLaneThenPosition);
}

// --- フック -----------------------------------------------------------------

/**
 * レーン移動（D&D）。サーバー応答を待たず即座に反映する楽観的更新を行い、
 * D&D のUXを損なわないようにする（カードが一瞬戻る挙動を防ぐ）。
 */
export function useMoveTask() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const queryKey = trpc.task.all.queryKey();

  return useMutation(
    trpc.task.move.mutationOptions(
      optimistic<MoveVars>(queryClient, queryKey, applyMove),
    ),
  );
}

/** 独自 ToDo を追加 */
export function useCreateTask() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.task.create.mutationOptions({
      onSettled: () =>
        queryClient.invalidateQueries({ queryKey: trpc.task.all.queryKey() }),
    }),
  );
}

/**
 * タスク詳細（タイトル/本文/時刻/工数）の更新。ドロワー編集・Schedule伸縮で使用。
 * 入力の undefined フィールドは据え置き、null はクリアとして即時にキャッシュへ反映する。
 */
export function useUpdateTask() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const queryKey = trpc.task.all.queryKey();

  return useMutation(
    trpc.task.update.mutationOptions(
      optimistic<UpdateVars>(queryClient, queryKey, applyUpdate),
    ),
  );
}

/**
 * タスク削除。キャッシュから即時に取り除く楽観的更新を行い、ドロワーを閉じても
 * 一覧から消えた状態を維持する。
 */
export function useDeleteTask() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const queryKey = trpc.task.all.queryKey();

  return useMutation(
    trpc.task.delete.mutationOptions(
      optimistic<string>(queryClient, queryKey, (list, id) =>
        list.filter((task) => task.id !== id),
      ),
    ),
  );
}

/**
 * カラム内の並び替え。position を即時反映し、レーン内を (lane, position) 順に
 * 並べ替えて SortableContext のレイアウトアニメーションを滑らかにする。
 */
export function useReorderTask() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const queryKey = trpc.task.all.queryKey();

  return useMutation(
    trpc.task.reorder.mutationOptions(
      optimistic<ReorderVars>(queryClient, queryKey, applyReorder),
    ),
  );
}

/** 期限の来た外部ソースを同期し、完了後に task 一覧を無効化する */
export function useSync() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.integration.sync.mutationOptions({
      onSettled: () =>
        queryClient.invalidateQueries({ queryKey: trpc.task.all.queryKey() }),
    }),
  );
}
