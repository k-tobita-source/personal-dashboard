import { describe, expect, it } from "vitest";

import { positionBetween } from "./position";

describe("positionBetween", () => {
  it("両隣がある場合は中間値", () => {
    expect(positionBetween(2, 4)).toBe(3);
  });
  it("先頭(beforeなし)は after より小さい値", () => {
    expect(positionBetween(null, 4)).toBe(3);
  });
  it("末尾(afterなし)は before より大きい値", () => {
    expect(positionBetween(2, null)).toBe(3);
  });
  it("両隣なし(空カラム)は 1", () => {
    expect(positionBetween(null, null)).toBe(1);
  });
});
