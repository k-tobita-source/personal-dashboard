"use client";

import { useRef } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { cn } from "@pdash/ui";

import type { Task } from "../types/task";
import { SlackAvatar } from "./SlackAvatar";
import { SourceIcon } from "./SourceIcon";

interface ViewProps {
  task: Task;
  /** DragOverlay 用にドラッグ中の見た目を出すか */
  dragging?: boolean;
}

/** カードの見た目だけを担う Presentational コンポーネント */
export function TaskCardView({ task, dragging }: ViewProps) {
  const isSlack = task.source === "slack";
  // Slack は投稿者名を別表示するので本文は body のみ。他は従来の "送信者: 本文"。
  const preview = isSlack
    ? task.body
    : task.sender
      ? `${task.sender}: ${task.body ?? ""}`
      : task.body;
  // Slack: アバター右に名前(sender)、その下にチャンネル名(title)。
  const name = task.sender ?? task.title;
  const showChannel = task.title !== name;

  return (
    <div
      className={cn(
        "bg-card rounded-[4px] border p-2 text-sm",
        dragging && "ring-primary rotate-1 ring-2",
      )}
    >
      {isSlack ? (
        <div className="flex items-center gap-2">
          <SlackAvatar src={task.avatarUrl ?? null} name={name} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-normal">{name}</div>
            {showChannel && (
              <div className="text-muted-foreground flex items-center gap-1 text-xs">
                <SourceIcon source="slack" size={12} />
                <span className="truncate">{task.title}</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 font-normal">
          <SourceIcon source={task.source} />
          <span className="truncate">{task.title}</span>
        </div>
      )}
      {preview && (
        <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
          {preview}
        </p>
      )}
      {task.url && (
        <a
          href={task.url}
          target="_blank"
          rel="noreferrer"
          onPointerDown={(e) => e.stopPropagation()}
          className="text-primary mt-1 inline-block text-xs underline"
        >
          開く ↗
        </a>
      )}
    </div>
  );
}

/** ドラッグ起動距離(px)。PointerSensor の activationConstraint と一致させる */
const CLICK_MOVE_THRESHOLD = 4;

/** 並び替え可能なカード（dnd の振る舞い＋クリックで詳細を開く） */
export function TaskCard({
  task,
  onOpen,
}: {
  task: Task;
  onOpen?: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });
  const downPos = useRef<{ x: number; y: number } | null>(null);

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={cn("cursor-grab touch-none", isDragging && "opacity-40")}
      {...attributes}
      {...listeners}
      onPointerDown={(e) => {
        downPos.current = { x: e.clientX, y: e.clientY };
        listeners?.onPointerDown?.(e);
      }}
      onClick={(e) => {
        const down = downPos.current;
        if (!down) return;
        const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
        if (moved < CLICK_MOVE_THRESHOLD) onOpen?.(task.id);
      }}
    >
      <TaskCardView task={task} />
    </div>
  );
}
