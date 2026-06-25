import { describe, expect, it } from "vitest";

import type { AutoAdvanceTask } from "./autoAdvance";
import { selectAutoMoves } from "./autoAdvance";

const now = new Date(2026, 5, 16, 12, 0); // 2026-06-16 12:00

function task(overrides: Partial<AutoAdvanceTask>): AutoAdvanceTask {
  return {
    id: "t",
    source: "todo",
    lane: "schedule",
    startAt: null,
    endAt: null,
    ...overrides,
  };
}

describe("selectAutoMoves", () => {
  it("schedule で開始到達したタスクは in_progress へ（source 問わず）", () => {
    const todo = task({ id: "a", source: "todo", startAt: new Date(2026, 5, 16, 11, 0) });
    const cal = task({ id: "b", source: "calendar", startAt: new Date(2026, 5, 16, 11, 0), endAt: new Date(2026, 5, 16, 13, 0) });
    expect(selectAutoMoves([todo, cal], now)).toEqual([
      { id: "a", lane: "in_progress" },
      { id: "b", lane: "in_progress" },
    ]);
  });

  it("開始未到来のタスクは移動しない", () => {
    const future = task({ id: "a", startAt: new Date(2026, 5, 16, 13, 0) });
    expect(selectAutoMoves([future], now)).toEqual([]);
  });

  it("終了超過の calendar は done へ（schedule からも in_progress からも）", () => {
    const inSchedule = task({ id: "a", source: "calendar", lane: "schedule", startAt: new Date(2026, 5, 16, 9, 0), endAt: new Date(2026, 5, 16, 10, 0) });
    const inProgress = task({ id: "b", source: "calendar", lane: "in_progress", startAt: new Date(2026, 5, 15, 9, 0), endAt: new Date(2026, 5, 15, 10, 0) });
    expect(selectAutoMoves([inSchedule, inProgress], now)).toEqual([
      { id: "a", lane: "done" },
      { id: "b", lane: "done" },
    ]);
  });

  it("開始も終了も過ぎた calendar は in_progress を経ず done を優先", () => {
    const cal = task({ id: "a", source: "calendar", lane: "schedule", startAt: new Date(2026, 5, 16, 9, 0), endAt: new Date(2026, 5, 16, 10, 0) });
    expect(selectAutoMoves([cal], now)).toEqual([{ id: "a", lane: "done" }]);
  });

  it("終了超過でも todo は done にしない（schedule なら開始到達で in_progress）", () => {
    const todo = task({ id: "a", source: "todo", lane: "schedule", startAt: new Date(2026, 5, 16, 9, 0), endAt: new Date(2026, 5, 16, 10, 0) });
    expect(selectAutoMoves([todo], now)).toEqual([{ id: "a", lane: "in_progress" }]);
  });

  it("done / inbox のタスクは対象外", () => {
    const done = task({ id: "a", lane: "done", startAt: new Date(2026, 5, 16, 9, 0) });
    const inbox = task({ id: "b", lane: "inbox", startAt: new Date(2026, 5, 16, 9, 0) });
    expect(selectAutoMoves([done, inbox], now)).toEqual([]);
  });
});
