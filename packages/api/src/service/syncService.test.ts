import { describe, expect, it } from "vitest";

import type { NormalizedItem } from "@acme/integrations";

import { buildUpdateValues, isDue } from "./syncService";

const gmailItem: NormalizedItem = {
  source: "gmail",
  externalId: "m1",
  title: "件名",
  body: "本文",
  sender: "a@example.com",
  url: "https://mail.google.com/mail/u/0/#inbox/m1",
  defaultLane: "inbox",
};

const calendarItem: NormalizedItem = {
  source: "calendar",
  externalId: "e1",
  title: "MTG",
  url: "https://calendar.google.com/e1",
  startAt: new Date("2026-06-15T10:00:00+09:00"),
  endAt: new Date("2026-06-15T11:00:00+09:00"),
  defaultLane: "schedule",
};

describe("buildUpdateValues", () => {
  it("lane / position を更新値に含めない（レーン保護）", () => {
    const v = buildUpdateValues(gmailItem);
    expect(v).not.toHaveProperty("lane");
    expect(v).not.toHaveProperty("position");
  });

  it("gmail は時刻を更新しない", () => {
    const v = buildUpdateValues(gmailItem);
    expect(v).not.toHaveProperty("startAt");
    expect(v).not.toHaveProperty("endAt");
    expect(v.title).toBe("件名");
    expect(v.sender).toBe("a@example.com");
  });

  it("calendar は時刻も更新する", () => {
    const v = buildUpdateValues(calendarItem);
    expect(v.startAt).toEqual(new Date("2026-06-15T10:00:00+09:00"));
    expect(v.endAt).toEqual(new Date("2026-06-15T11:00:00+09:00"));
  });

  it("欠落フィールドは null に正規化する", () => {
    const v = buildUpdateValues({
      ...gmailItem,
      body: undefined,
      sender: undefined,
    });
    expect(v.body).toBeNull();
    expect(v.sender).toBeNull();
  });
});

describe("isDue", () => {
  const now = new Date("2026-06-15T12:00:00Z");

  it("未同期(null)は常に due", () => {
    expect(isDue("calendar", null, now)).toBe(true);
  });

  it("間隔未経過は due でない", () => {
    const last = new Date(now.getTime() - 30_000); // 30s 前
    expect(isDue("calendar", last, now)).toBe(false); // calendar=90s
  });

  it("間隔経過後は due", () => {
    const last = new Date(now.getTime() - 100_000); // 100s 前
    expect(isDue("calendar", last, now)).toBe(true);
  });

  it("ソースごとに間隔が異なる", () => {
    const last = new Date(now.getTime() - 120_000); // 120s 前
    expect(isDue("calendar", last, now)).toBe(true); // 90s
    expect(isDue("gmail", last, now)).toBe(false); // 150s
  });

  it("slack は 240 秒間隔", () => {
    const last = new Date(now.getTime() - 200_000); // 200s 前
    expect(isDue("slack", last, now)).toBe(false); // 240s 未満
    const older = new Date(now.getTime() - 250_000); // 250s 前
    expect(isDue("slack", older, now)).toBe(true);
  });
});
