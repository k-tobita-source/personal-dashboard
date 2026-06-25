"use client";

import type { ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import type { Lane } from "@pdash/db/schema";
import { cn } from "@pdash/ui";

import type { Task } from "../types/task";
import { LANE_ICON } from "../configs/board";
import { TaskCard } from "./TaskCard";

interface Props {
  lane: Lane;
  title: string;
  hint?: string;
  tasks: Task[];
  /** カードクリックで詳細ドロワーを開く */
  onOpenTask?: (id: string) => void;
  /** カラム下部に置く追加 UI（受信箱の ToDo 追加フォームなど） */
  footer?: ReactNode;
}

/** 単純なカード積み上げ式のカラム（受信箱 / In Progress / Done） */
export function BoardColumn({
  lane,
  title,
  hint,
  tasks,
  onOpenTask,
  footer,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: `lane:${lane}` });
  const { icon: Icon, className: iconColor } = LANE_ICON[lane];

  return (
    <section className="flex min-h-0 min-w-0 flex-col">
      <header className="mb-2 flex items-center gap-2">
        <Icon className={cn("size-4", iconColor)} aria-hidden />
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
        <span className="text-muted-foreground ml-auto text-xs">
          {tasks.length}
        </span>
      </header>

      <div
        ref={setNodeRef}
        className={cn(
          "bg-muted/30 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-md p-2",
          isOver && "ring-primary ring-2",
        )}
      >
        <SortableContext
          items={tasks.map((task) => task.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} onOpen={onOpenTask} />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <p className="text-muted-foreground/60 px-1 py-4 text-center text-xs">
            ここにドロップ
          </p>
        )}
        {footer}
      </div>
    </section>
  );
}
