"use client";

import { useState } from "react";

import { Button } from "@acme/ui/button";
import { Input } from "@acme/ui/input";

import { useCreateTask } from "../api/mutations";
import { MIN_DURATION_MINUTES } from "../configs/board";
import { dateAtMinutesOfDay } from "../utils/schedule";

/** 当日0:00起点の分を <input type="time"> 用の "HH:mm" に変換 */
function toTimeValue(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "HH:mm" を当日0:00起点の分に変換 */
function fromTimeValue(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

interface Props {
  selection: { startMin: number; endMin: number };
  now: Date;
  onCreated: () => void;
  onCancel: () => void;
}

/** Schedule の空き時間クリックで開く、その場のタスク作成フォーム */
export function ScheduleQuickAdd({
  selection,
  now,
  onCreated,
  onCancel,
}: Props) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [startMin, setStartMin] = useState(selection.startMin);
  const [endMin, setEndMin] = useState(selection.endMin);
  const createTask = useCreateTask();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    // 開始≥終了は終了=開始+最小工数へ補正
    const end = endMin > startMin ? endMin : startMin + MIN_DURATION_MINUTES;
    createTask.mutate(
      {
        title: trimmed,
        body: body.trim() || undefined,
        startAt: dateAtMinutesOfDay(startMin, now),
        endAt: dateAtMinutesOfDay(end, now),
        lane: "schedule",
      },
      { onSuccess: () => onCreated() },
    );
  };

  return (
    <form onSubmit={handleSubmit} className="flex w-64 flex-col gap-2">
      <Input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="タイトル"
        className="h-8 text-sm"
      />
      <div className="flex items-center gap-1 text-sm tabular-nums">
        <input
          type="time"
          step={900}
          value={toTimeValue(startMin)}
          onChange={(e) => setStartMin(fromTimeValue(e.target.value))}
          className="rounded-md border border-gray-300 bg-transparent px-1 py-0.5"
        />
        <span className="text-muted-foreground">–</span>
        <input
          type="time"
          step={900}
          value={toTimeValue(endMin)}
          onChange={(e) => setEndMin(fromTimeValue(e.target.value))}
          className="rounded-md border border-gray-300 bg-transparent px-1 py-0.5"
        />
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="メモ（任意）"
        className="focus:ring-ring w-full resize-y rounded-md border border-gray-300 bg-transparent px-2 py-1.5 text-sm focus:ring-2 focus:outline-none"
      />
      <div className="flex justify-end gap-1">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          キャンセル
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={!title.trim() || createTask.isPending}
        >
          作成
        </Button>
      </div>
    </form>
  );
}
