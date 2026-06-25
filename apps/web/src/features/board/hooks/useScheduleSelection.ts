"use client";

import { useEffect, useRef, useState } from "react";

import { PX_PER_MINUTE } from "../configs/board";
import {
  clampDayMinutes,
  selectionToRange,
  snapMinutes,
} from "../utils/schedule";

/** クリックとドラッグを区別する移動量しきい値(px) */
const DRAG_THRESHOLD_PX = 4;

export interface ScheduleSelection {
  startMin: number;
  endMin: number;
}

interface DragState {
  /** pointerdown 時点の背景要素 top（viewport 基準）。ドラッグ中のスクロールには追随しない（取得時点で固定） */
  top: number;
  startY: number;
  startMin: number;
  moved: boolean;
}

/**
 * Schedule グリッド背景上の pointer 操作から、作成する時間帯を導出する。
 * ScheduleBlock の resize と同じく useEffect で window listener を着脱する。
 * フックは「分」だけを扱い、Date 変換は描画/送信側に委ねて純粋性を保つ。
 */
export function useScheduleSelection() {
  const [selection, setSelection] = useState<ScheduleSelection | null>(null);
  const [draft, setDraft] = useState<ScheduleSelection | null>(null);
  const [active, setActive] = useState(false);
  const drag = useRef<DragState | null>(null);

  const minutesAt = (clientY: number, top: number) =>
    clampDayMinutes(snapMinutes((clientY - top) / PX_PER_MINUTE));

  const onBackgroundPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // 左ボタンかつ「背景そのもの」を掴んだときだけ開始（ブロック等の上は無視）
    if (e.button !== 0) return;
    if (e.currentTarget !== e.target) return;
    const rect = e.currentTarget.getBoundingClientRect();
    drag.current = {
      top: rect.top,
      startY: e.clientY,
      startMin: minutesAt(e.clientY, rect.top),
      moved: false,
    };
    setActive(true);
  };

  useEffect(() => {
    if (!active) return;
    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      if (Math.abs(ev.clientY - d.startY) >= DRAG_THRESHOLD_PX) d.moved = true;
      if (d.moved) {
        setDraft(
          selectionToRange(d.startMin, minutesAt(ev.clientY, d.top), true),
        );
      }
    };
    const up = (ev: PointerEvent) => {
      const d = drag.current;
      setActive(false);
      setDraft(null);
      drag.current = null;
      if (!d) return;
      setSelection(
        selectionToRange(d.startMin, minutesAt(ev.clientY, d.top), d.moved),
      );
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [active]);

  const clear = () => setSelection(null);

  return { selection, draft, onBackgroundPointerDown, clear };
}
