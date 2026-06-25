"use client";

import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

/** 全タスクを取得する */
export function useTasks() {
  const trpc = useTRPC();
  return useQuery(trpc.task.all.queryOptions());
}

/** Google 接続状態を取得する */
export function useConnectionStatus() {
  const trpc = useTRPC();
  return useQuery(trpc.integration.status.queryOptions());
}
