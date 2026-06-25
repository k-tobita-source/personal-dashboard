import { describe, expect, it } from "vitest";

import { parseDate, parseNullableDate, toCardView } from "./mapping";

const baseRow = {
  id: "t1",
  source: "todo" as const,
  lane: "inbox" as const,
  title: "買い物",
  body: "x".repeat(300),
  sender: null,
  avatarUrl: null,
  url: null,
  externalId: null,
  startAt: new Date("2026-06-16T01:00:00Z"),
  endAt: new Date("2026-06-16T02:00:00Z"),
  position: 1,
  createdAt: new Date("2026-06-16T00:00:00Z"),
  updatedAt: null,
};

describe("toCardView", () => {
  it("Date を ISO 文字列へ変換する", () => {
    const v = toCardView(baseRow);
    expect(v.startAt).toBe("2026-06-16T01:00:00.000Z");
    expect(v.endAt).toBe("2026-06-16T02:00:00.000Z");
  });

  it("body を 200 文字でプレビューに切り詰める", () => {
    expect(toCardView(baseRow).body).toHaveLength(200);
  });

  it("null 時刻・null body はそのまま null", () => {
    const v = toCardView({
      ...baseRow,
      startAt: null,
      endAt: null,
      body: null,
    });
    expect(v.startAt).toBeNull();
    expect(v.endAt).toBeNull();
    expect(v.body).toBeNull();
  });

  it("id / lane / source / title を保持する", () => {
    const v = toCardView(baseRow);
    expect(v).toMatchObject({
      id: "t1",
      lane: "inbox",
      source: "todo",
      title: "買い物",
    });
  });
});

describe("parseDate", () => {
  it("undefined はそのまま undefined", () => {
    expect(parseDate(undefined)).toBeUndefined();
  });
  it("ISO 文字列は Date", () => {
    expect(parseDate("2026-06-16T01:00:00Z")).toEqual(
      new Date("2026-06-16T01:00:00Z"),
    );
  });
  it("不正な日時は throw", () => {
    expect(() => parseDate("not-a-date")).toThrow(/invalid date/);
  });
});

describe("parseNullableDate", () => {
  it("undefined=据え置き", () => {
    expect(parseNullableDate(undefined)).toBeUndefined();
  });
  it("null=クリア", () => {
    expect(parseNullableDate(null)).toBeNull();
  });
  it("ISO=設定", () => {
    expect(parseNullableDate("2026-06-16T01:00:00Z")).toEqual(
      new Date("2026-06-16T01:00:00Z"),
    );
  });
});
