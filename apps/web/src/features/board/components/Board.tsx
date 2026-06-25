"use client";

import { useMemo, useState } from "react";
import { DndContext, DragOverlay } from "@dnd-kit/core";

import type { Lane } from "@acme/db/schema";

import type { Task } from "../types/task";
import {
  useDeleteTask,
  useMoveTask,
  useReorderTask,
  useUpdateTask,
} from "../api/mutations";
import { useConnectionStatus, useTasks } from "../api/queries";
import { useAutoAdvance } from "../hooks/useAutoAdvance";
import { useAutoSync } from "../hooks/useAutoSync";
import { useBoardDnd } from "../hooks/useBoardDnd";
import { useNow } from "../hooks/useNow";
import { resolveDrawerNav } from "../utils/drawerNav";
import { groupByLane } from "../utils/groupTasks";
import {
  clampDayMinutes,
  dateAtMinutesOfDay,
  minutesOfDay,
  selectScheduleBlocks,
  snapMinutes,
} from "../utils/schedule";
import { AddTodoForm } from "./AddTodoForm";
import { BoardColumn } from "./BoardColumn";
import { ConnectBanner } from "./ConnectBanner";
import { ScheduleBlockView } from "./ScheduleBlock";
import { ScheduleColumn } from "./ScheduleColumn";
import { TaskCardView } from "./TaskCard";
import { TaskDrawer } from "./TaskDrawer";

/**
 * カンバンボード本体（Container）。
 * データ取得・更新・D&D ロジックを束ね、各カラム（Presentational）へ渡す。
 */
export function Board() {
  const { data: tasks = [] } = useTasks();
  useAutoSync();
  const { data: connection } = useConnectionStatus();
  const move = useMoveTask();
  const reorder = useReorderTask();
  const update = useUpdateTask();
  const del = useDeleteTask();

  const groups = useMemo(() => groupByLane(tasks), [tasks]);
  const tasksById = useMemo(
    () => new Map(tasks.map((task) => [task.id, task])),
    [tasks],
  );
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTask = selectedTaskId
    ? (tasksById.get(selectedTaskId) ?? null)
    : null;

  const laneOrder = useMemo<Record<Lane, string[]>>(
    () => ({
      inbox: groups.inbox.map((t) => t.id),
      schedule: groups.schedule.map((t) => t.id),
      in_progress: groups.in_progress.map((t) => t.id),
      done: groups.done.map((t) => t.id),
    }),
    [groups],
  );

  // ドロワーの前/次ナビ: 「開いた時点のレーン」を対象に上下移動する。
  // ステータス変更で選択タスクが別レーンへ移っても navLane は据え置き、
  // Todo を上から順にステータス変更していく操作を途切れさせない。
  const [navLane, setNavLane] = useState<Lane | null>(null);
  const [navIndex, setNavIndex] = useState(-1);

  // カードを開く: 選択し、ナビの基準レーン・位置を記録する。
  const handleOpenTask = (id: string) => {
    setSelectedTaskId(id);
    const task = tasksById.get(id);
    if (task) {
      setNavLane(task.lane);
      setNavIndex(laneOrder[task.lane].indexOf(id));
    }
  };

  const navList = navLane ? laneOrder[navLane] : [];
  const nav = resolveDrawerNav(navList, selectedTaskId, navIndex);
  const handleNavigate = (dir: "prev" | "next") => {
    const nextId = dir === "prev" ? nav.prevId : nav.nextId;
    if (!nextId) return;
    setSelectedTaskId(nextId);
    setNavIndex(dir === "prev" ? nav.prevIndex : nav.nextIndex);
  };

  const {
    activeId,
    sensors,
    displayOrder,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  } = useBoardDnd({
    onMove: (args) => move.mutate(args),
    onReorder: (args) => reorder.mutate(args),
    tasksById,
    laneOrder,
  });

  /** displayOrder（プレビュー反映後）の id 列を Task に解決する */
  const columnTasks = (lane: Lane): Task[] =>
    displayOrder[lane]
      .map((id) => tasksById.get(id))
      .filter((t): t is Task => t !== undefined);

  // 現在時刻ラインの基準。1分ごとに更新し、自動レーン移動の判定にも使う。
  const now = useNow();

  // Schedule に描画するブロック（schedule の通常表示＋in_progress のゴースト）。
  // now 依存で終了時刻を過ぎたゴーストは自動的に外れる。
  const scheduleBlocks = useMemo(
    () => selectScheduleBlocks(tasks, now),
    [tasks, now],
  );

  // 時刻経過に応じた自動レーン移動（開始到達→In Progress / カレンダー終了超過→Done）
  useAutoAdvance({ tasks, now, onMove: (args) => move.mutate(args) });
  const activeTask = tasks.find((task) => task.id === activeId) ?? null;

  // ドロワーのボタンによるレーン移動。D&D（useBoardDnd）と同じ startAt 規約に揃える:
  // Todo へ→クリア / Schedule へ→既存が無ければ現在時刻にスナップ / 他→据え置き。
  const handleMoveLane = (id: string, lane: Lane) => {
    const task = tasksById.get(id);
    if (!task || task.lane === lane) return;
    if (lane === "schedule") {
      const startAt =
        task.startAt ??
        dateAtMinutesOfDay(clampDayMinutes(snapMinutes(minutesOfDay(now))));
      move.mutate({ id, lane, startAt });
    } else {
      move.mutate({ id, lane, startAt: lane === "inbox" ? null : undefined });
    }
  };

  return (
    <div className="flex h-screen flex-col">
      {connection && !connection.connected && <ConnectBanner />}

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 p-3">
          <BoardColumn
            lane="inbox"
            title="Todo"
            tasks={columnTasks("inbox")}
            onOpenTask={handleOpenTask}
            footer={<AddTodoForm />}
          />
          <ScheduleColumn
            blocks={scheduleBlocks}
            now={now}
            onOpenTask={handleOpenTask}
            onResizeTask={(id, endAt) => update.mutate({ id, endAt })}
          />
          <BoardColumn
            lane="in_progress"
            title="In Progress"
            tasks={columnTasks("in_progress")}
            onOpenTask={handleOpenTask}
          />
          <BoardColumn
            lane="done"
            title="Done"
            tasks={columnTasks("done")}
            onOpenTask={handleOpenTask}
          />
        </div>

        {/* dropAnimation を無効化: 既定では overlay が元レーンへ戻るアニメーションを
            再生してから楽観的更新で移動先へ移るため、一瞬元レーンに戻って見える。
            楽観的更新で即座に移動先へ反映されるので戻りアニメーションは不要。
            Schedule のブロックは青い ScheduleBlockView を overlay として動かす
            （元ブロックは列の overflow にクリップされ他カラムへ出すと消えるため）。 */}
        <DragOverlay dropAnimation={null}>
          {activeTask ? (
            activeTask.lane === "schedule" ? (
              <ScheduleBlockView task={activeTask} />
            ) : (
              <TaskCardView task={activeTask} dragging />
            )
          ) : null}
        </DragOverlay>
      </DndContext>

      <TaskDrawer
        task={selectedTask}
        onClose={() => setSelectedTaskId(null)}
        onSave={(id, patch) => update.mutate({ id, ...patch })}
        onChangeDuration={(id, endAt) => update.mutate({ id, endAt })}
        onMove={handleMoveLane}
        onDelete={(id) => del.mutate(id)}
        onNavigate={handleNavigate}
        canPrev={nav.canPrev}
        canNext={nav.canNext}
      />
    </div>
  );
}
