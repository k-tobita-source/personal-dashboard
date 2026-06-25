import { describe, expect, it } from "vitest";

import { CreateTodoInput } from "./task";

describe("CreateTodoInput", () => {
  it("endAt（Date）を受け付ける", () => {
    const parsed = CreateTodoInput.parse({
      title: "会議",
      startAt: new Date("2026-06-17T10:00:00+09:00"),
      endAt: new Date("2026-06-17T11:00:00+09:00"),
    });
    expect(parsed.endAt).toBeInstanceOf(Date);
  });

  it("endAt は任意（省略可）", () => {
    const parsed = CreateTodoInput.parse({ title: "メモ" });
    expect(parsed.endAt).toBeUndefined();
  });
});
