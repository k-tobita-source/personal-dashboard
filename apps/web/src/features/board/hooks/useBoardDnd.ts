"use client";

import type {
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import { useState } from "react";
import { PointerSensor, useSensor, useSensors } from "@dnd-kit/core";

import type { Lane } from "@pdash/db/schema";

import type { Task } from "../types/task";
import type { LaneOrder } from "../utils/reorder";
import {
  laneOf,
  moveItemToLane,
  ordersEqual,
  resolveColumnDrop,
} from "../utils/reorder";
import {
  clampDayMinutes,
  dateAtMinutesOfDay,
  durationMinutes,
  minutesOfDay,
  pxToMinutes,
  shiftMinutes,
  snapMinutes,
} from "../utils/schedule";

export interface MoveArgs {
  id: string;
  lane: Lane;
  startAt?: Date | null;
  endAt?: Date | null;
  position?: number;
}
export interface ReorderArgs {
  id: string;
  position: number;
}

interface Params {
  /** レーン移動（lane / 時刻 / 工数 / position の変更） */
  onMove: (args: MoveArgs) => void;
  /** 同一カラム内の並び替え */
  onReorder: (args: ReorderArgs) => void;
  /** id からタスクを引くためのマップ */
  tasksById: Map<string, Task>;
  /** レーンごとの表示順 id 配列（position 昇順） */
  laneOrder: LaneOrder;
}

/** ライブプレビュー（中間挿入）の対象となるカラムレーン。schedule は時刻が状態のため除外 */
const COLUMN_LANES: Lane[] = ["inbox", "in_progress", "done"];

/** active カードの中心 Y が over カードの中心より下なら true（= over の後ろへ挿入） */
function isBelowOverItem(event: DragOverEvent): boolean {
  const activeRect = event.active.rect.current.translated;
  const overRect = event.over?.rect;
  if (!activeRect || !overRect) return false;
  return (
    activeRect.top + activeRect.height / 2 > overRect.top + overRect.height / 2
  );
}

/**
 * ボードの D&D の振る舞い。
 *
 * - 同一カラム内の並び替えは dnd-kit 組み込みの sortable に任せ、`onDragEnd` で確定する。
 * - 別カラムへの移動は `onDragOver` で `previewOrder`（ドラッグ中だけの表示順 override）へ
 *   差し込み、ライブプレビュー（移動先カードが隙間を空ける）を出す。
 * - Schedule レーンは対象外。`lane:schedule` への/からのドロップは時刻ロジック（既存）で扱う。
 *
 * ドロップ先 id の規約:
 *  - `lane:schedule` … Schedule グリッド（時刻配置 / 縦移動）
 *  - `lane:<lane>` … カラムの空きエリア（末尾へ）
 *  - 上記以外（タスク id）… そのカードの前後へ挿入
 */
export function useBoardDnd({
  onMove,
  onReorder,
  tasksById,
  laneOrder,
}: Params) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [previewOrder, setPreviewOrder] = useState<LaneOrder | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  /** プレビュー適用後の表示順（ドラッグ中以外は素の laneOrder） */
  const displayOrder = previewOrder ?? laneOrder;

  const handleDragStart = (event: DragStartEvent) =>
    setActiveId(String(event.active.id));

  const handleDragCancel = () => {
    setActiveId(null);
    setPreviewOrder(null);
  };

  /** クロスレーン移動だけを previewOrder へ反映（同一レーン内は組み込み sortable に任せる） */
  const handleDragOver = (event: DragOverEvent) => {
    if (!event.over) return;
    const id = String(event.active.id);
    const over = String(event.over.id);

    const activeTask = tasksById.get(id);
    if (!activeTask || activeTask.lane === "schedule") return; // schedule ドラッグは対象外

    const base = previewOrder ?? laneOrder;
    const fromLane = laneOf(base, id) ?? activeTask.lane;

    let toLane: Lane;
    let toIndex: number;
    if (over.startsWith("lane:")) {
      const lane = over.slice(5) as Lane;
      if (!COLUMN_LANES.includes(lane)) return; // schedule droppable など
      toLane = lane;
      toIndex = base[lane].length; // 空きエリア → 末尾
    } else {
      const overLane = laneOf(base, over);
      if (!overLane || !COLUMN_LANES.includes(overLane)) return;
      toLane = overLane;
      toIndex = base[overLane].indexOf(over) + (isBelowOverItem(event) ? 1 : 0);
    }

    if (toLane === fromLane) return; // 同一レーン内は触らない

    const next = moveItemToLane(base, id, toLane, toIndex);
    if (ordersEqual(next, base)) return; // 変化なしなら再レンダーしない
    setPreviewOrder(next);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const preview = previewOrder;
    setActiveId(null);
    setPreviewOrder(null);

    const id = String(event.active.id);
    const over = event.over ? String(event.over.id) : null;

    const activeTask = tasksById.get(id);
    if (!activeTask) return;

    if (over === "lane:schedule") {
      // カレンダー予定は時間変更不可。Schedule 内では何もせず、他レーンからは時刻を保持して戻す
      if (activeTask.source === "calendar") {
        if (activeTask.lane !== "schedule") onMove({ id, lane: "schedule" });
        return;
      }
      // 既に Schedule 上のブロック → 縦ドラッグ量で再配置（工数=高さは維持）
      if (activeTask.lane === "schedule" && activeTask.startAt) {
        const deltaMin = pxToMinutes(event.delta.y);
        const nextMin = clampDayMinutes(
          snapMinutes(minutesOfDay(activeTask.startAt) + deltaMin),
        );
        const duration = durationMinutes(
          activeTask.startAt,
          activeTask.endAt ?? null,
        );
        const newStart = dateAtMinutesOfDay(nextMin, activeTask.startAt);
        onMove({
          id,
          lane: "schedule",
          startAt: newStart,
          endAt: shiftMinutes(newStart, duration),
        });
        return;
      }
      // 他カラムから Schedule へ → ドロップされた Y 位置の時刻にスナップして配置
      const overRect = event.over?.rect;
      const activeRect = event.active.rect.current.translated;
      const dropMin =
        overRect && activeRect
          ? clampDayMinutes(
              snapMinutes(pxToMinutes(activeRect.top - overRect.top)),
            )
          : clampDayMinutes(snapMinutes(minutesOfDay(new Date())));
      onMove({ id, lane: "schedule", startAt: dateAtMinutesOfDay(dropMin) });
      return;
    }

    // Schedule ブロックを列へドロップ → 末尾へ（中間挿入は対象外）
    if (activeTask.lane === "schedule") {
      if (!over) return;
      if (over.startsWith("lane:")) {
        const lane = over.slice(5) as Lane;
        if (COLUMN_LANES.includes(lane)) {
          onMove({ id, lane, startAt: lane === "inbox" ? null : undefined });
        }
        return;
      }
      const overTask = tasksById.get(over);
      if (overTask && overTask.lane !== "schedule") {
        onMove({
          id,
          lane: overTask.lane,
          startAt: overTask.lane === "inbox" ? null : undefined,
        });
      }
      return;
    }

    // --- カラムレーン間: previewOrder（ユーザーが見ている並び）を真実として確定する。
    //     ドロップ時の collision が active 自身や null を返しても snap back しない。 ---
    const result = resolveColumnDrop({
      id,
      over,
      originalLane: activeTask.lane,
      laneOrder,
      preview,
      positionOf: (tid) => tasksById.get(tid)?.position ?? null,
    });
    if (!result) return;
    if (result.kind === "reorder") {
      onReorder({ id: result.id, position: result.position });
    } else {
      onMove({
        id: result.id,
        lane: result.lane,
        position: result.position,
        startAt: result.startAt,
      });
    }
  };

  return {
    activeId,
    sensors,
    displayOrder,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  };
}
