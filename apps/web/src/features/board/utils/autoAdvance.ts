import type { Lane } from "@pdash/db/schema";

import type { Task } from "../types/task";

/** 自動移動の判定に必要な最小フィールド */
export type AutoAdvanceTask = Pick<
  Task,
  "id" | "source" | "lane" | "startAt" | "endAt"
>;

/** 自動移動の指示 */
export interface AutoMove {
  id: string;
  lane: Extract<Lane, "in_progress" | "done">;
}

/**
 * 時刻経過に応じた自動レーン移動の指示を算出する。
 * 1 タスクにつき Done を先に評価し、いずれか 1 つだけ返す。
 * - calendar かつ endAt < now（schedule / in_progress に居る）→ done
 * - 上記以外で schedule かつ startAt <= now → in_progress
 * Non-calendar sources (todo/slack/gmail) follow the second rule only —
 * they auto-advance to in_progress on start reached, never to done.
 */
export function selectAutoMoves(
  tasks: AutoAdvanceTask[],
  now: Date,
): AutoMove[] {
  const nowMs = now.getTime();
  const moves: AutoMove[] = [];
  for (const task of tasks) {
    if (
      task.source === "calendar" &&
      task.endAt &&
      task.endAt.getTime() < nowMs &&
      (task.lane === "schedule" || task.lane === "in_progress")
    ) {
      moves.push({ id: task.id, lane: "done" });
      continue;
    }
    if (
      task.lane === "schedule" &&
      task.startAt &&
      task.startAt.getTime() <= nowMs
    ) {
      moves.push({ id: task.id, lane: "in_progress" });
    }
  }
  return moves;
}
