"use client";

import { useEffect, useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { format } from "date-fns";

import { cn } from "@pdash/ui";

import type { Task } from "../types/task";
import {
  MIN_DURATION_MINUTES,
  PX_PER_MINUTE,
  SNAP_MINUTES,
  TIME_GUTTER_PX,
} from "../configs/board";
import {
  durationMinutes,
  heightPx,
  shiftMinutes,
  snapMinutes,
  topPx,
} from "../utils/schedule";
import { SourceIcon } from "./SourceIcon";

// Fix 3: mirror the guard in TaskCard.tsx to avoid opening the drawer on micro-drag
const CLICK_MOVE_THRESHOLD = 4;

/** ソース別の左アクセントバー色（カレンダー=青 / それ以外=グレー） */
function accentBorder(task: Task): string {
  return task.source === "calendar"
    ? "border-l-primary"
    : "border-l-muted-foreground/40";
}

/**
 * DragOverlay 用のブロック表示。ScheduleColumn の overflow に
 * クリップされないよう、ドラッグ中はこの presentational を最前面で動かす。
 */
export function ScheduleBlockView({ task }: { task: Task }) {
  const start = task.startAt;
  if (!start) return null;
  const duration = durationMinutes(start, task.endAt ?? null);
  return (
    <div
      className={cn(
        "bg-card text-foreground ring-primary h-full overflow-hidden rounded-[4px] border-l-4 px-2 py-1 text-xs ring-2",
        accentBorder(task),
      )}
    >
      <div className="flex items-center gap-1 font-medium">
        <SourceIcon source={task.source} size={12} />
        <span className="truncate">{task.title}</span>
      </div>
      <div className="text-muted-foreground text-[10px] tabular-nums">
        {format(start, "HH:mm")}-
        {format(shiftMinutes(start, duration), "HH:mm")}
      </div>
    </div>
  );
}

interface Props {
  task: Task;
  onOpen?: (id: string) => void;
  /** 伸縮確定時に新しい endAt を保存 */
  onResize: (id: string, endAt: Date) => void;
  /** 開始済み（in_progress）の残像表示。半透明＋レーン D&D 無効 */
  isGhost?: boolean;
  /** 重なりレイアウトの列番号（0 始まり） */
  col: number;
  /** 重なりレイアウトの総列数（重なり無しは 1） */
  cols: number;
}

/** Schedule 上の 1 タスク。startAt=top, 工数=height。下端ハンドルで伸縮できる */
export function ScheduleBlock({
  task,
  onOpen,
  onResize,
  isGhost = false,
  col,
  cols,
}: Props) {
  // ScheduleColumn は startAt が存在するタスクのみ描画する（型上は nullable なので早期リターンで保証）
  const start = task.startAt;
  // カレンダー予定は時間変更不可（時刻はカレンダー側が真実。リロード時の同期で反映）
  const fixedTime = task.source === "calendar";

  // Fix 1: useEffect-driven resize so React cleans up listeners on unmount
  const [resizing, setResizing] = useState<{
    startY: number;
    startDuration: number;
  } | null>(null);
  // 伸縮中はローカルの分でプレビュー、確定時に onResize
  const [draftDuration, setDraftDuration] = useState<number | null>(null);

  // Fix 3: track pointer-down position to filter out micro-drags
  const downPos = useRef<{ x: number; y: number } | null>(null);

  // transform は使わない: ドラッグ中の見た目は DragOverlay(ScheduleBlockView) が担う。
  // 元ブロックを transform で動かすと ScheduleColumn の overflow にクリップされ、
  // 他カラムへドラッグした際に掴んでいるアイテムが消えてしまうため。
  // ゴースト（in_progress）は In Progress カラムの実カードと同一 task.id で
  // draggable が衝突するため、別 id で登録し listeners も無効化してレーン移動を封じる。
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: isGhost ? `ghost:${task.id}` : task.id,
  });

  // Fix 1: attach/detach window listeners via useEffect so they are cleaned up on unmount
  useEffect(() => {
    if (!resizing) return;
    const move = (ev: PointerEvent) => {
      const deltaMin = (ev.clientY - resizing.startY) / PX_PER_MINUTE;
      const next = Math.max(
        MIN_DURATION_MINUTES,
        snapMinutes(resizing.startDuration + deltaMin, SNAP_MINUTES),
      );
      setDraftDuration(next);
    };
    const up = () => {
      setResizing(null);
      setDraftDuration((current) => {
        // start is always defined when resizing: the resize handle is only rendered
        // after the `if (!start) return null` guard, so this branch is safe.
        if (current !== null && current !== resizing.startDuration && start) {
          onResize(task.id, shiftMinutes(start, current));
        }
        return null;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [resizing, start, task.id, onResize]);

  // Fix 4: early return AFTER all hooks but BEFORE computing baseDuration,
  // so we no longer need the misleading `?? new Date()` fallback
  if (!start) return null;

  // baseDuration is computed after the early return so `start` is always defined here
  const baseDuration = durationMinutes(start, task.endAt ?? null);
  const duration = draftDuration ?? baseDuration;

  const handleResizePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setResizing({ startY: e.clientY, startDuration: baseDuration });
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        position: "absolute",
        left: `calc(${TIME_GUTTER_PX}px + (100% - ${TIME_GUTTER_PX + 4}px) * ${col} / ${cols})`,
        width: `calc((100% - ${TIME_GUTTER_PX + 4}px) / ${cols} - 2px)`,
        top: topPx(start),
        height: heightPx(duration),
        transition: isDragging
          ? undefined
          : "top 150ms ease, height 150ms ease",
        // カレンダー予定は ToDo より手前に重ねる（時間が重なったとき優先表示）
        zIndex: task.source === "calendar" ? 15 : 10,
      }}
      className={cn(
        "bg-card text-foreground ring-border touch-none overflow-hidden rounded-[4px] border-l-4 px-2 py-1 text-xs ring-1",
        accentBorder(task),
        // 通常ブロックは掴めてホバーで明るくなる
        !isGhost && "hover:bg-muted/50 cursor-grab",
        // ゴーストは半透明＋落ち着いた背景で「動作中の残像」を表現
        isGhost && "bg-muted/40 cursor-pointer opacity-50",
        // ドラッグ中は DragOverlay が前面に出るので、元ブロックは薄く残す
        isDragging && "opacity-40",
      )}
      {...(isGhost ? {} : attributes)}
      {...(isGhost ? {} : listeners)}
      onPointerDown={(e) => {
        // Fix 3: record pointer-down position; resize handle calls stopPropagation
        // so this won't fire during resize, preventing a finished resize from being
        // misread as a click.
        downPos.current = { x: e.clientX, y: e.clientY };
        // 通常ブロックのみレーン D&D を起動。ゴーストは掴ませない（同一 id 衝突回避）。
        if (!isGhost) listeners?.onPointerDown?.(e);
      }}
      onClick={(e) => {
        // Fix 3: only open drawer when the pointer barely moved (not a drag)
        const down = downPos.current;
        if (!down) return;
        if (
          Math.hypot(e.clientX - down.x, e.clientY - down.y) <
          CLICK_MOVE_THRESHOLD
        ) {
          onOpen?.(task.id);
        }
      }}
    >
      <div>
        <div className="flex items-center gap-1 font-medium">
          <SourceIcon source={task.source} size={12} />
          <span className="truncate">{task.title}</span>
        </div>
        <div className="text-muted-foreground text-[10px] tabular-nums">
          {format(start, "HH:mm")}-
          {format(shiftMinutes(start, duration), "HH:mm")}
        </div>
      </div>
      {/* 下端リサイズハンドル（カレンダー予定は工数変更不可のため出さない） */}
      {!fixedTime && (
        <div
          onPointerDown={handleResizePointerDown}
          className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
        >
          <div className="bg-muted-foreground/40 mx-auto h-1 w-6 rounded-full" />
        </div>
      )}
    </div>
  );
}
