import type { Lane } from "@pdash/db/schema";

import type { Task } from "../types/task";

/** タスクをレーンごとに振り分ける（4 カラム描画用） */
export function groupByLane(tasks: Task[]): Record<Lane, Task[]> {
  const groups: Record<Lane, Task[]> = {
    inbox: [],
    schedule: [],
    in_progress: [],
    done: [],
  };
  for (const task of tasks) {
    groups[task.lane].push(task);
  }
  return groups;
}
