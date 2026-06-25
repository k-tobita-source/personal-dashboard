"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useDroppable } from "@dnd-kit/core";

import { cn } from "@acme/ui";
import { Popover, PopoverAnchor, PopoverContent } from "@acme/ui/popover";

import type { ScheduleBlockItem } from "../utils/schedule";
import {
  GRID_START_HOUR,
  HOURS,
  LANE_ICON,
  PX_PER_HOUR,
  PX_PER_MINUTE,
  TIME_GUTTER_PX,
} from "../configs/board";
import { useScheduleSelection } from "../hooks/useScheduleSelection";
import {
  assignScheduleColumns,
  dateAtMinutesOfDay,
  heightPx,
  minutesOfDay,
  topPx,
} from "../utils/schedule";
import { ScheduleBlock } from "./ScheduleBlock";
import { ScheduleQuickAdd } from "./ScheduleQuickAdd";

interface Props {
  blocks: ScheduleBlockItem[];
  now: Date;
  onOpenTask?: (id: string) => void;
  onResizeTask: (id: string, endAt: Date) => void;
}

// useSyncExternalStore 用の購読なし subscribe。値は変わらない（マウント判定のみ）。
const subscribeNoop = () => () => undefined;

/** Schedule カラム：当日 0:00〜24:00 の連続タイムライン（工数で高さ可変） */
export function ScheduleColumn({
  blocks,
  now,
  onOpenTask,
  onResizeTask,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: "lane:schedule" });
  const { selection, draft, onBackgroundPointerDown, clear } =
    useScheduleSelection();
  // ドラッグ中は draft、確定後（Popover 表示中）は selection を可視化する。
  // 確定時に draft は null へ戻るため、両者をフォールバックで一本化する。
  const highlight = draft ?? selection;
  const { icon: ScheduleIcon, className: scheduleIconColor } =
    LANE_ICON.schedule;
  const nowTop = (minutesOfDay(now) - GRID_START_HOUR * 60) * PX_PER_MINUTE;
  // 重なるブロックを左右分割するための列割り当て（schedule＋ゴースト両方が対象）
  const columnLayout = assignScheduleColumns(blocks);

  // 現在時刻ラインは now 依存で SSR と初回ハイドレーションが分境界をまたぐと
  // top がズレてハイドレーション不一致を起こす。useSyncExternalStore で
  // SSR＋初回描画は false、マウント後に true となり、ライン描画をマウント後に限定する。
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );

  // 初期表示時のみ、現在時刻ラインが縦中央に来るようスクロールする。
  // now は毎分更新されるため、didCenter で初回だけに限定する。
  const scrollerRef = useRef<HTMLDivElement>(null);
  const didCenter = useRef(false);
  useEffect(() => {
    if (didCenter.current) return;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = nowTop - el.clientHeight / 2;
    didCenter.current = true;
  }, [nowTop]);

  return (
    <section className="flex min-h-0 min-w-0 flex-col">
      <header className="mb-2 flex items-center gap-2">
        <ScheduleIcon className={cn("size-4", scheduleIconColor)} aria-hidden />
        <h2 className="text-sm font-semibold">Schedule</h2>
        <span className="text-muted-foreground text-xs">タイムライン</span>
      </header>
      <div
        ref={scrollerRef}
        className="bg-muted/30 min-h-0 flex-1 overflow-y-auto rounded-md"
      >
        <div
          ref={setNodeRef}
          onPointerDown={onBackgroundPointerDown}
          className={cn("relative", isOver && "bg-primary/5")}
          style={{ height: HOURS.length * PX_PER_HOUR }}
        >
          {/* 時間目盛り */}
          {HOURS.map((hour) => (
            <div
              key={hour}
              className="text-muted-foreground pointer-events-none absolute left-0 w-full border-t text-[10px] tabular-nums"
              style={{ top: (hour - GRID_START_HOUR) * PX_PER_HOUR }}
            >
              <span className="pl-1">{String(hour).padStart(2, "0")}:00</span>
            </div>
          ))}

          {/* 現在時刻ライン（マウント後のみ。SSR との不一致回避） */}
          {mounted && (
            <div
              className="bg-destructive pointer-events-none absolute left-0 z-30 h-px w-full"
              style={{ top: nowTop }}
            >
              <span className="bg-destructive absolute -top-1 left-0 h-2 w-2 rounded-full" />
            </div>
          )}

          {/* タスクブロック（通常＋開始済みゴースト） */}
          {blocks.map(({ task, isGhost }) => {
            if (!task.startAt) return null;
            const layout = columnLayout.get(task.id);
            return (
              <ScheduleBlock
                key={task.id}
                task={task}
                isGhost={isGhost}
                onOpen={onOpenTask}
                onResize={onResizeTask}
                col={layout?.col ?? 0}
                cols={layout?.cols ?? 1}
              />
            );
          })}

          {/* 選択範囲のハイライト矩形（ドラッグ中＋Popover 表示中とも表示） */}
          {highlight && (
            <div
              className="bg-primary/15 border-primary/40 pointer-events-none absolute rounded-[4px] border"
              style={{
                left: TIME_GUTTER_PX,
                right: 4,
                top: topPx(dateAtMinutesOfDay(highlight.startMin, now)),
                height: heightPx(highlight.endMin - highlight.startMin),
              }}
            />
          )}

          {/* クリック/ドラッグ確定で開く作成 Popover */}
          <Popover
            open={selection !== null}
            onOpenChange={(open) => {
              if (!open) clear();
            }}
          >
            {selection && (
              <PopoverAnchor
                className="pointer-events-none absolute"
                style={{
                  left: TIME_GUTTER_PX,
                  top: topPx(dateAtMinutesOfDay(selection.startMin, now)),
                  height: heightPx(selection.endMin - selection.startMin),
                  width: 1,
                }}
              />
            )}
            <PopoverContent align="start" side="right">
              {selection && (
                <ScheduleQuickAdd
                  selection={selection}
                  now={now}
                  onCreated={clear}
                  onCancel={clear}
                />
              )}
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </section>
  );
}
