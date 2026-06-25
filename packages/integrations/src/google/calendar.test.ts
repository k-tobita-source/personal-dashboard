import { describe, expect, it } from "vitest";

import { normalizeCalendarEvent } from "./calendar";

describe("normalizeCalendarEvent", () => {
  it("時刻ありの予定を schedule レーンへ正規化する", () => {
    const item = normalizeCalendarEvent({
      id: "evt1",
      summary: "定例MTG",
      status: "confirmed",
      htmlLink: "https://calendar.google.com/evt1",
      start: { dateTime: "2026-06-15T10:00:00+09:00" },
      end: { dateTime: "2026-06-15T11:00:00+09:00" },
    });
    expect(item).toEqual({
      source: "calendar",
      externalId: "evt1",
      title: "定例MTG",
      url: "https://calendar.google.com/evt1",
      startAt: new Date("2026-06-15T10:00:00+09:00"),
      endAt: new Date("2026-06-15T11:00:00+09:00"),
      defaultLane: "schedule",
    });
  });

  it("終日予定は時刻なしで inbox レーンへ", () => {
    const item = normalizeCalendarEvent({
      id: "evt2",
      summary: "終日タスク",
      status: "confirmed",
      start: { date: "2026-06-15" },
      end: { date: "2026-06-16" },
    });
    expect(item?.defaultLane).toBe("inbox");
    expect(item?.startAt).toBeUndefined();
    expect(item?.endAt).toBeUndefined();
  });

  it("cancelled は null", () => {
    expect(
      normalizeCalendarEvent({ id: "evt3", status: "cancelled" }),
    ).toBeNull();
  });

  it("勤務場所(workingLocation)など予定でない eventType は null", () => {
    expect(
      normalizeCalendarEvent({
        id: "wl1",
        status: "confirmed",
        eventType: "workingLocation",
        summary: "オフィス",
        start: { date: "2026-06-15" },
        end: { date: "2026-06-16" },
      }),
    ).toBeNull();
    expect(
      normalizeCalendarEvent({
        id: "ooo1",
        status: "confirmed",
        eventType: "outOfOffice",
        summary: "外出",
        start: { dateTime: "2026-06-15T10:00:00+09:00" },
        end: { dateTime: "2026-06-15T11:00:00+09:00" },
      }),
    ).toBeNull();
  });

  it("タイトル無しは代替文言", () => {
    const item = normalizeCalendarEvent({
      id: "evt4",
      status: "confirmed",
      start: { dateTime: "2026-06-15T10:00:00+09:00" },
      end: { dateTime: "2026-06-15T10:30:00+09:00" },
    });
    expect(item?.title).toBe("(タイトルなし)");
  });
});
