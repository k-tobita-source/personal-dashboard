"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "@radix-ui/react-icons";
import { format } from "date-fns";

import type { Lane } from "@acme/db/schema";
import { cn } from "@acme/ui";

import type { Task } from "../types/task";
import {
  DEFAULT_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
  SOURCE_ICON,
} from "../configs/board";
import { durationMinutes, shiftMinutes } from "../utils/schedule";
import { SourceIcon } from "./SourceIcon";

const DURATION_PRESETS = [15, 30, 60, 120, 180] as const;

/** レーン選択ボタンの表示順とラベル */
const LANE_OPTIONS: { lane: Lane; label: string }[] = [
  { lane: "inbox", label: "Todo" },
  { lane: "schedule", label: "Schedule" },
  { lane: "in_progress", label: "In Progress" },
  { lane: "done", label: "Done" },
];

interface Props {
  task: Task | null;
  onClose: () => void;
  /** 詳細(タイトル/本文)更新 */
  onSave: (id: string, patch: { title?: string; body?: string | null }) => void;
  /** 工数(endAt)更新 */
  onChangeDuration: (id: string, endAt: Date) => void;
  /** レーン移動 */
  onMove: (id: string, lane: Lane) => void;
  /** タスク削除 */
  onDelete: (id: string) => void;
  /** 同一レーン内の前/次へ切り替え */
  onNavigate: (dir: "prev" | "next") => void;
  /** 前のアイテムが存在するか */
  canPrev: boolean;
  /** 次のアイテムが存在するか */
  canNext: boolean;
}

interface FormProps {
  task: Task;
  onClose: () => void;
  onSave: Props["onSave"];
  onChangeDuration: Props["onChangeDuration"];
  onMove: Props["onMove"];
}

/**
 * ドロワーの編集フォーム部分。task.id が変わるたびに key で再マウントされ、
 * 初期 state が新しいタスクの値にリセットされる（useEffect での setState 不要）。
 */
function TaskDrawerForm({
  task,
  onClose,
  onSave,
  onChangeDuration,
  onMove,
}: FormProps) {
  const [title, setTitle] = useState(task.title);
  const [body, setBody] = useState(task.body ?? "");
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef({ id: task.id, title, body });
  const dirtyRef = useRef(false);
  // レンダー後に最新値を同期（レンダー中に current を書き換えると lint エラーになるため）
  useLayoutEffect(() => {
    latestRef.current = { id: task.id, title, body };
  });

  // Esc で閉じる
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // アンマウント時: 保留中タイマーをキャンセルし、未保存の変更をflush。
  // onSave は意図的に deps から外す — latestRef/dirtyRef 経由で常に最新値を参照するため問題なし。
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (dirtyRef.current) {
        const { id, title: t, body: b } = latestRef.current;
        onSave(id, { title: t, body: b || null });
      }
    };
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */

  const flush = (next: { title?: string; body?: string }) => {
    onSave(task.id, {
      title: next.title ?? title,
      body: (next.body ?? body) || null,
    });
    dirtyRef.current = false;
    setSaved(true);
  };

  const scheduleSave = (next: { title?: string; body?: string }) => {
    dirtyRef.current = true;
    setSaved(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(next), 600);
  };

  const startAt = task.startAt;
  const duration = startAt
    ? durationMinutes(startAt, task.endAt ?? null)
    : DEFAULT_DURATION_MINUTES;

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 text-sm">
      <div>
        <label className="text-muted-foreground mb-1 block text-xs font-semibold uppercase">
          タイトル
        </label>
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            scheduleSave({ title: e.target.value });
          }}
          onBlur={() => flush({})}
          className="focus:ring-ring w-full rounded-md border border-gray-300 bg-transparent px-2 py-1.5 font-normal focus:ring-2 focus:outline-none"
        />
      </div>

      {task.source !== "todo" && task.url && (
        <a
          href={task.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary inline-flex items-center gap-1.5 text-xs font-medium hover:underline"
        >
          <SourceIcon source={task.source} size={14} />
          {SOURCE_ICON[task.source].label} で開く ↗
        </a>
      )}

      <div>
        <label className="text-muted-foreground mb-1 block text-xs font-semibold uppercase">
          詳細
        </label>
        <textarea
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            scheduleSave({ body: e.target.value });
          }}
          onBlur={() => flush({})}
          rows={8}
          placeholder="プレーンテキストで入力"
          className="focus:ring-ring text-muted-foreground w-full resize-y rounded-md border border-gray-300 bg-transparent px-2 py-1.5 leading-relaxed focus:ring-2 focus:outline-none"
        />
      </div>

      <div>
        <label className="text-muted-foreground mb-1 block text-xs font-semibold uppercase">
          レーン
        </label>
        <div className="flex flex-wrap gap-1.5">
          {LANE_OPTIONS.map((opt) => (
            <button
              key={opt.lane}
              onClick={() => {
                if (opt.lane !== task.lane) onMove(task.id, opt.lane);
              }}
              aria-pressed={task.lane === opt.lane}
              className={cn(
                "rounded-md border px-2 py-1 text-xs",
                task.lane === opt.lane
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-input text-muted-foreground hover:bg-muted",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {startAt && (
        <div>
          <label className="text-muted-foreground mb-1 block text-xs font-semibold uppercase">
            開始 / 工数
          </label>
          <div className="text-muted-foreground mb-2 text-xs tabular-nums">
            {format(startAt, "HH:mm")} –{" "}
            {format(task.endAt ?? shiftMinutes(startAt, duration), "HH:mm")} ·{" "}
            {duration}分
          </div>
          <div className="flex flex-wrap gap-1.5">
            {DURATION_PRESETS.map((min) => (
              <button
                key={min}
                onClick={() =>
                  onChangeDuration(task.id, shiftMinutes(startAt, min))
                }
                className={cn(
                  "rounded-md border px-2 py-1 text-xs",
                  duration === min
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input text-muted-foreground hover:bg-muted",
                )}
              >
                {min < 60 ? `${min}m` : `${min / 60}h`}
              </button>
            ))}
          </div>
          <p className="text-muted-foreground/70 mt-1 text-[10px]">
            最小 {MIN_DURATION_MINUTES}{" "}
            分。グリッド上の下端ドラッグでも変更できます。
          </p>
        </div>
      )}

      {saved && <p className="text-xs text-green-600">✓ 保存しました</p>}
    </div>
  );
}

/** 右スライドインの詳細ドロワー。入力は debounce + blur で自動保存 */
export function TaskDrawer({
  task,
  onClose,
  onSave,
  onChangeDuration,
  onMove,
  onDelete,
  onNavigate,
  canPrev,
  canNext,
}: Props) {
  if (!task) return null;

  const handleDelete = () => {
    if (window.confirm("このタスクを削除しますか？")) {
      onDelete(task.id);
      onClose();
    }
  };

  return (
    <>
      {/* オーバーレイ */}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
        aria-hidden
      />
      {/* ドロワー本体 */}
      <aside className="bg-card fixed inset-y-0 right-0 z-50 flex w-[60vw] flex-col border-l">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-semibold">タスク詳細</span>
          <div className="flex items-center gap-1">
            {task.lane !== "schedule" && (
              <>
                <button
                  onClick={() => onNavigate("prev")}
                  disabled={!canPrev}
                  aria-label="前のタスク"
                  className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-md p-1 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronUpIcon />
                </button>
                <button
                  onClick={() => onNavigate("next")}
                  disabled={!canNext}
                  aria-label="次のタスク"
                  className="text-muted-foreground hover:text-foreground hover:bg-muted mr-2 rounded-md p-1 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronDownIcon />
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground text-sm"
              aria-label="閉じる"
            >
              ✕
            </button>
          </div>
        </header>

        <TaskDrawerForm
          key={task.id}
          task={task}
          onClose={onClose}
          onSave={onSave}
          onChangeDuration={onChangeDuration}
          onMove={onMove}
        />

        <footer className="border-t px-4 py-3">
          <button
            onClick={handleDelete}
            className="text-destructive hover:bg-destructive/10 w-full rounded-md border border-current/30 px-2 py-1.5 text-sm font-medium"
          >
            削除
          </button>
        </footer>
      </aside>
    </>
  );
}
