"use client";

import { useEffect, useRef } from "react";

import type { Lane } from "@acme/db/schema";

import type { Task } from "../types/task";
import { selectAutoMoves } from "../utils/autoAdvance";

/**
 * now の更新ごとに自動レーン移動を判定し、該当タスクへ move を発火する。
 * 楽観的更新で lane は即時に書き換わるが、invalidate 確定までの多重発火を
 * firedRef で防ぐ（対象から外れたキーは解除する）。
 */
export function useAutoAdvance({
  tasks,
  now,
  onMove,
}: {
  tasks: Task[];
  now: Date;
  onMove: (args: { id: string; lane: Lane }) => void;
}) {
  const firedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const moves = selectAutoMoves(tasks, now);
    const fired = firedRef.current;
    const activeKeys = new Set(moves.map((m) => `${m.id}:${m.lane}`));
    for (const key of fired) {
      if (!activeKeys.has(key)) fired.delete(key);
    }
    for (const m of moves) {
      const key = `${m.id}:${m.lane}`;
      if (fired.has(key)) continue;
      fired.add(key);
      onMove({ id: m.id, lane: m.lane });
    }
    // onMove は move.mutate を呼ぶだけの安定コールバック。毎レンダーで新規参照に
    // なるため依存から除外し、tasks / now の変化時のみ再評価する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, now]);
}
