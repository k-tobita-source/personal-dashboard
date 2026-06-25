import { describe, expect, it } from "vitest";

import { resolveDrawerNav } from "./drawerNav";

describe("resolveDrawerNav", () => {
  const list = ["a", "b", "c", "d"];

  describe("選択タスクがレーンに残っている（通常）", () => {
    it("先頭は prev 不可・next 可", () => {
      const nav = resolveDrawerNav(list, "a", 0);
      expect(nav.canPrev).toBe(false);
      expect(nav.canNext).toBe(true);
      expect(nav.nextId).toBe("b");
      expect(nav.nextIndex).toBe(1);
    });

    it("中間は前後どちらも可", () => {
      const nav = resolveDrawerNav(list, "b", 1);
      expect(nav.canPrev).toBe(true);
      expect(nav.canNext).toBe(true);
      expect(nav.prevId).toBe("a");
      expect(nav.nextId).toBe("c");
      expect(nav.prevIndex).toBe(0);
      expect(nav.nextIndex).toBe(2);
    });

    it("末尾は next 不可・prev 可", () => {
      const nav = resolveDrawerNav(list, "d", 3);
      expect(nav.canPrev).toBe(true);
      expect(nav.canNext).toBe(false);
      expect(nav.prevId).toBe("c");
    });
  });

  describe("選択タスクがレーンを離れた（ステータス変更直後）", () => {
    // 例: inbox=[a,b,c,d] で b を開き(anchor=1)、Done にした。
    // navList は b を失い [a,c,d] になる。anchor=1 は基準のまま。
    it("next は繰り上がってきた次タスクへ進む", () => {
      const after = ["a", "c", "d"];
      const nav = resolveDrawerNav(after, "b", 1);
      expect(nav.canNext).toBe(true);
      expect(nav.nextId).toBe("c");
      expect(nav.nextIndex).toBe(1);
    });

    it("prev は直前のタスクへ戻る", () => {
      const after = ["a", "c", "d"];
      const nav = resolveDrawerNav(after, "b", 1);
      expect(nav.canPrev).toBe(true);
      expect(nav.prevId).toBe("a");
      expect(nav.prevIndex).toBe(0);
    });

    it("先頭タスクを離れた場合は prev 不可・next は新しい先頭へ", () => {
      // inbox=[a,b,c] で a を開き(anchor=0) Done に → [b,c]
      const after = ["b", "c"];
      const nav = resolveDrawerNav(after, "a", 0);
      expect(nav.canPrev).toBe(false);
      expect(nav.canNext).toBe(true);
      expect(nav.nextId).toBe("b");
      expect(nav.nextIndex).toBe(0);
    });

    it("末尾タスクを離れた場合は next 不可・prev は新しい末尾へ", () => {
      // inbox=[a,b,c] で c を開き(anchor=2) Done に → [a,b]
      const after = ["a", "b"];
      const nav = resolveDrawerNav(after, "c", 2);
      expect(nav.canNext).toBe(false);
      expect(nav.canPrev).toBe(true);
      expect(nav.prevId).toBe("b");
      expect(nav.prevIndex).toBe(1);
    });

    it("レーンが空になったら前後とも不可", () => {
      const nav = resolveDrawerNav([], "a", 0);
      expect(nav.canPrev).toBe(false);
      expect(nav.canNext).toBe(false);
      expect(nav.prevId).toBeNull();
      expect(nav.nextId).toBeNull();
    });
  });

  it("選択なしなら前後とも不可", () => {
    const nav = resolveDrawerNav(list, null, -1);
    expect(nav.canPrev).toBe(false);
    expect(nav.canNext).toBe(false);
  });
});
