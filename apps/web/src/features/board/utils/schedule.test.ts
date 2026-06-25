import { describe, expect, it } from "vitest";

import type { Lane } from "@pdash/db/schema";

import {
  assignScheduleColumns,
  clampDayMinutes,
  dateAtMinutesOfDay,
  durationMinutes,
  heightPx,
  minutesOfDay,
  pxToMinutes,
  selectionToRange,
  selectScheduleBlocks,
  shiftMinutes,
  snapMinutes,
  topPx,
} from "./schedule";

describe("minutesOfDay", () => {
  it("時:分を当日0:00からの分に変換する", () => {
    expect(minutesOfDay(new Date(2026, 5, 11, 10, 30))).toBe(630);
    expect(minutesOfDay(new Date(2026, 5, 11, 0, 0))).toBe(0);
  });
});

describe("snapMinutes", () => {
  it("15分刻みに丸める", () => {
    expect(snapMinutes(607)).toBe(600); // 10:07 -> 10:00
    expect(snapMinutes(623)).toBe(630); // 10:23 -> 10:30
    expect(snapMinutes(638)).toBe(645); // 10:38 -> 10:45
  });
});

describe("topPx", () => {
  it("開始時刻に応じた top(px) を返す(96px/時)", () => {
    expect(topPx(new Date(2026, 5, 11, 10, 0))).toBeCloseTo(960); // 10*96
    expect(topPx(new Date(2026, 5, 11, 10, 30))).toBeCloseTo(1008); // 10.5*96
  });
});

describe("durationMinutes", () => {
  it("endAt があれば差分(分)、無ければ既定60分", () => {
    const s = new Date(2026, 5, 11, 10, 0);
    expect(durationMinutes(s, new Date(2026, 5, 11, 11, 30))).toBe(90);
    expect(durationMinutes(s, null)).toBe(60);
  });
  it("endAt が startAt 以下なら 0（負値を返さない）", () => {
    const s = new Date(2026, 5, 11, 10, 0);
    expect(durationMinutes(s, s)).toBe(0);
    expect(durationMinutes(s, new Date(2026, 5, 11, 9, 0))).toBe(0);
  });
});

describe("heightPx", () => {
  it("工数(分)を高さ(px)に変換し、最小15分を保証する", () => {
    expect(heightPx(60)).toBeCloseTo(96);
    expect(heightPx(90)).toBeCloseTo(144);
    expect(heightPx(5)).toBeCloseTo(24); // 15分にクランプ -> 15*1.6
  });
});

describe("pxToMinutes", () => {
  it("px を分に変換する", () => {
    expect(pxToMinutes(96)).toBeCloseTo(60);
    expect(pxToMinutes(48)).toBeCloseTo(30);
  });
});

describe("dateAtMinutesOfDay", () => {
  it("基準日の当日0:00から指定分の Date を返す", () => {
    const base = new Date(2026, 5, 11, 15, 0);
    const d = dateAtMinutesOfDay(630, base); // 10:30
    expect(d.getHours()).toBe(10);
    expect(d.getMinutes()).toBe(30);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getDate()).toBe(11);
  });
});

describe("shiftMinutes", () => {
  it("Date を分だけずらす", () => {
    const d = shiftMinutes(new Date(2026, 5, 11, 10, 0), 90);
    expect(d.getHours()).toBe(11);
    expect(d.getMinutes()).toBe(30);
  });
});

describe("clampDayMinutes", () => {
  it("0〜1439 に収める", () => {
    expect(clampDayMinutes(-30)).toBe(0);
    expect(clampDayMinutes(2000)).toBe(1439);
    expect(clampDayMinutes(600)).toBe(600);
  });
});

describe("selectScheduleBlocks", () => {
  const now = new Date(2026, 5, 17, 12, 0); // 2026-06-17 12:00

  function cand(overrides: {
    id: string;
    lane: Lane;
    startAt?: Date | null;
    endAt?: Date | null;
  }) {
    return {
      id: overrides.id,
      lane: overrides.lane,
      startAt: overrides.startAt ?? null,
      endAt: overrides.endAt ?? null,
    };
  }

  it("schedule レーンで startAt があれば通常表示（isGhost=false）", () => {
    const t = cand({
      id: "a",
      lane: "schedule",
      startAt: new Date(2026, 5, 17, 14, 0),
    });
    expect(selectScheduleBlocks([t], now)).toEqual([
      { task: t, isGhost: false },
    ]);
  });

  it("schedule レーンでも startAt が無ければ除外", () => {
    const t = cand({ id: "a", lane: "schedule", startAt: null });
    expect(selectScheduleBlocks([t], now)).toEqual([]);
  });

  it("in_progress で終了時刻 > now ならゴースト表示（isGhost=true）", () => {
    // 11:00開始 + endAt 13:00 -> 終了13:00 > 12:00
    const t = cand({
      id: "a",
      lane: "in_progress",
      startAt: new Date(2026, 5, 17, 11, 0),
      endAt: new Date(2026, 5, 17, 13, 0),
    });
    expect(selectScheduleBlocks([t], now)).toEqual([
      { task: t, isGhost: true },
    ]);
  });

  it("in_progress で終了時刻 <= now なら除外", () => {
    // 9:00開始 + endAt 10:00 -> 終了10:00 < 12:00
    const t = cand({
      id: "a",
      lane: "in_progress",
      startAt: new Date(2026, 5, 17, 9, 0),
      endAt: new Date(2026, 5, 17, 10, 0),
    });
    expect(selectScheduleBlocks([t], now)).toEqual([]);
  });

  it("in_progress で終了時刻がちょうど now なら除外（境界は排他）", () => {
    // 11:00開始 + endAt 12:00 -> 終了12:00 === now 12:00 -> 排他なので除外
    const t = cand({
      id: "a",
      lane: "in_progress",
      startAt: new Date(2026, 5, 17, 11, 0),
      endAt: new Date(2026, 5, 17, 12, 0),
    });
    expect(selectScheduleBlocks([t], now)).toEqual([]);
  });

  it("endAt 無し in_progress は開始+60分まで表示（既定工数）", () => {
    // 11:30開始 -> 終了12:30 > 12:00 -> ゴースト
    const fresh = cand({
      id: "a",
      lane: "in_progress",
      startAt: new Date(2026, 5, 17, 11, 30),
    });
    // 10:30開始 -> 終了11:30 < 12:00 -> 除外
    const old = cand({
      id: "b",
      lane: "in_progress",
      startAt: new Date(2026, 5, 17, 10, 30),
    });
    expect(selectScheduleBlocks([fresh, old], now)).toEqual([
      { task: fresh, isGhost: true },
    ]);
  });

  it("in_progress でも startAt が無ければ除外", () => {
    const t = cand({ id: "a", lane: "in_progress", startAt: null });
    expect(selectScheduleBlocks([t], now)).toEqual([]);
  });

  it("inbox / done は対象外", () => {
    const inbox = cand({
      id: "a",
      lane: "inbox",
      startAt: new Date(2026, 5, 17, 14, 0),
    });
    const done = cand({
      id: "b",
      lane: "done",
      startAt: new Date(2026, 5, 17, 11, 0),
    });
    expect(selectScheduleBlocks([inbox, done], now)).toEqual([]);
  });
});

describe("selectionToRange", () => {
  it("クリック（isDrag=false）は開始から既定60分", () => {
    expect(selectionToRange(600, 600, false)).toEqual({
      startMin: 600,
      endMin: 660,
    });
  });

  it("ドラッグは下方向にそのまま範囲化", () => {
    expect(selectionToRange(600, 690, true)).toEqual({
      startMin: 600,
      endMin: 690,
    });
  });

  it("逆方向ドラッグは min/max で正規化", () => {
    expect(selectionToRange(690, 600, true)).toEqual({
      startMin: 600,
      endMin: 690,
    });
  });

  it("幅が15分未満なら最小15分にクランプ", () => {
    expect(selectionToRange(600, 605, true)).toEqual({
      startMin: 600,
      endMin: 615,
    });
  });

  it("日付末尾のクリックは当日内に収め endMin は最大1440", () => {
    expect(selectionToRange(1439, 1439, false)).toEqual({
      startMin: 1425,
      endMin: 1440,
    });
  });
});

describe("assignScheduleColumns", () => {
  function blk(
    id: string,
    startAt: Date,
    endAt: Date | null = null,
    isGhost = false,
  ) {
    return {
      task: { id, lane: "schedule" as Lane, startAt, endAt },
      isGhost,
    };
  }
  const at = (h: number, m = 0) => new Date(2026, 5, 18, h, m);

  it("重ならないブロックは全て col0 / cols1", () => {
    const map = assignScheduleColumns([
      blk("a", at(9), at(10)),
      blk("b", at(11), at(12)),
    ]);
    expect(map.get("a")).toEqual({ col: 0, cols: 1 });
    expect(map.get("b")).toEqual({ col: 0, cols: 1 });
  });

  it("2件重なりは col0 / col1、ともに cols2", () => {
    const map = assignScheduleColumns([
      blk("a", at(9, 0), at(10, 0)),
      blk("b", at(9, 30), at(10, 30)),
    ]);
    expect(map.get("a")).toEqual({ col: 0, cols: 2 });
    expect(map.get("b")).toEqual({ col: 1, cols: 2 });
  });

  it("連鎖クラスタ(A↔B,B↔C 重なり/A↔C 非重なり)は cols2、C は列を再利用して col0", () => {
    const map = assignScheduleColumns([
      blk("a", at(9, 0), at(10, 0)),
      blk("b", at(9, 30), at(10, 30)),
      blk("c", at(10, 0), at(11, 0)),
    ]);
    expect(map.get("a")).toEqual({ col: 0, cols: 2 });
    expect(map.get("b")).toEqual({ col: 1, cols: 2 });
    expect(map.get("c")).toEqual({ col: 0, cols: 2 });
  });

  it("ちょうど隣接(終了==開始)は重ならない扱いで cols1", () => {
    const map = assignScheduleColumns([
      blk("a", at(9, 0), at(10, 0)),
      blk("c", at(10, 0), at(11, 0)),
    ]);
    expect(map.get("a")).toEqual({ col: 0, cols: 1 });
    expect(map.get("c")).toEqual({ col: 0, cols: 1 });
  });

  it("ゴースト(in_progress)も schedule ブロックと列分割される", () => {
    const map = assignScheduleColumns([
      blk("a", at(9, 0), at(10, 0)),
      blk("g", at(9, 30), at(10, 30), true),
    ]);
    expect(map.get("a")).toEqual({ col: 0, cols: 2 });
    expect(map.get("g")).toEqual({ col: 1, cols: 2 });
  });

  it("endAt 未設定(既定60分)でも実効区間で重なり判定する", () => {
    // a: 9:00 開始 endAt 無し -> 実効 10:00 まで
    // b: 9:30 開始 endAt 無し -> 実効 10:30 まで -> 重なる
    const map = assignScheduleColumns([
      blk("a", at(9, 0), null),
      blk("b", at(9, 30), null),
    ]);
    expect(map.get("a")).toEqual({ col: 0, cols: 2 });
    expect(map.get("b")).toEqual({ col: 1, cols: 2 });
  });
});
