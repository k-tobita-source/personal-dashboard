import {
  ArchiveIcon,
  CalendarIcon,
  CheckCircledIcon,
  UpdateIcon,
} from "@radix-ui/react-icons";

import type { Lane, Source } from "@pdash/db/schema";

// 各 Radix アイコンは同一の型なので、代表 1 つから型を導出する
type RadixIcon = typeof ArchiveIcon;

/** レーン見出しに表示するアイコン（Radix Icons）と色クラス */
export const LANE_ICON: Record<Lane, { icon: RadixIcon; className: string }> = {
  inbox: { icon: ArchiveIcon, className: "text-slate-500" },
  schedule: { icon: CalendarIcon, className: "text-blue-600" },
  in_progress: { icon: UpdateIcon, className: "text-amber-600" },
  done: { icon: CheckCircledIcon, className: "text-emerald-600" },
};

interface SourceIconDef {
  /** public 配下のアイコンパス（外部ソース） */
  src?: string;
  /** アイコン画像が無いソース用の絵文字フォールバック */
  emoji?: string;
  label: string;
}

/** ソース種別ごとのアイコン定義（カード見出しに表示） */
export const SOURCE_ICON: Record<Source, SourceIconDef> = {
  calendar: {
    src: "/icons/google_calendar_icon.svg",
    label: "Google カレンダー",
  },
  slack: { src: "/icons/slack_icon.svg", label: "Slack" },
  gmail: { src: "/icons/gmail_icon.svg", label: "Gmail" },
  todo: { label: "ToDo" },
};

/** Schedule タイムラインで表示する時間（当日 0:00〜23:00） */
export const HOURS: readonly number[] = Array.from({ length: 24 }, (_, h) => h);

/** Schedule グリッドの 1 時間あたりの高さ(px) */
export const PX_PER_HOUR = 96;
/** 1 分あたりの高さ(px) */
export const PX_PER_MINUTE = PX_PER_HOUR / 60;
/** 伸縮・移動のスナップ単位(分) */
export const SNAP_MINUTES = 15;
/** タスクの最小工数(分) */
export const MIN_DURATION_MINUTES = 15;
/** endAt 未設定タスクの既定工数(分) */
export const DEFAULT_DURATION_MINUTES = 60;
/** グリッド表示の開始時刻(時)。0:00 起点 */
export const GRID_START_HOUR = 0;
/** 時刻ラベル用に左へ確保するガター幅(px)。カードはこの分だけ右にずらす */
export const TIME_GUTTER_PX = 40;
