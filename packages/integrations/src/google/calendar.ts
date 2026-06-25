import type { Auth } from "googleapis";
import { google } from "googleapis";

import type { NormalizedItem } from "../types";

/** Calendar API の event（必要フィールドのみ） */
export interface CalendarEvent {
  id?: string | null;
  summary?: string | null;
  status?: string | null;
  htmlLink?: string | null;
  /** "default" 以外は予定でない特殊エントリ（勤務場所/不在/フォーカスタイム/誕生日 等） */
  eventType?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null } | null;
}

/** event を NormalizedItem に変換（cancelled / 特殊 eventType / id 無しは null） */
export function normalizeCalendarEvent(
  event: CalendarEvent,
): NormalizedItem | null {
  if (!event.id || event.status === "cancelled") return null;
  // 勤務場所・不在・フォーカスタイム等は「予定」ではないので取り込まない
  if (event.eventType && event.eventType !== "default") return null;
  const title = event.summary?.trim() ? event.summary : "(タイトルなし)";
  const base = {
    source: "calendar" as const,
    externalId: event.id,
    title,
    url: event.htmlLink ?? undefined,
  };
  // 時刻あり → schedule
  if (event.start?.dateTime && event.end?.dateTime) {
    return {
      ...base,
      startAt: new Date(event.start.dateTime),
      endAt: new Date(event.end.dateTime),
      defaultLane: "schedule",
    };
  }
  // 終日（date のみ）→ inbox（時刻なし）
  return { ...base, defaultLane: "inbox" };
}

/** 当日の primary カレンダー予定を取得して正規化する */
export async function fetchCalendarToday(
  auth: Auth.OAuth2Client,
  now: Date,
): Promise<NormalizedItem[]> {
  const timeMin = new Date(now);
  timeMin.setHours(0, 0, 0, 0);
  const timeMax = new Date(now);
  timeMax.setHours(23, 59, 59, 999);

  const calendar = google.calendar({ version: "v3", auth });
  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
  });
  return (res.data.items ?? [])
    .map((e) => normalizeCalendarEvent(e as CalendarEvent))
    .filter((x): x is NormalizedItem => x !== null);
}
