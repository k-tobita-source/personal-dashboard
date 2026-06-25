import type { WebClient } from "@slack/web-api";
import { describe, expect, it } from "vitest";

import {
  getUserProfiles,
  humanizeSlackText,
  normalizeSlackMessage,
} from "./client";

describe("humanizeSlackText", () => {
  it("ラベル付きユーザーメンションを @名前 に整形", () => {
    expect(
      humanizeSlackText("<@U0AQ2QR1RD4|Kokoro Tobita/GMO-FH> よろしく"),
    ).toBe("@Kokoro Tobita/GMO-FH よろしく");
  });

  it("ラベル無しメンション/チャンネル参照/特殊メンション/リンクを整形", () => {
    expect(humanizeSlackText("<@U999> 確認 <#C2|random> にて")).toBe(
      "@U999 確認 #random にて",
    );
    expect(humanizeSlackText("<!here> 至急")).toBe("@here 至急");
    expect(humanizeSlackText("資料 <https://ex.com/a|こちら> 参照")).toBe(
      "資料 こちら 参照",
    );
    expect(humanizeSlackText("URL <https://ex.com/a>")).toBe(
      "URL https://ex.com/a",
    );
  });

  it("date トークンはフォールバック文言に置換", () => {
    expect(
      humanizeSlackText(
        "*Today*-<!date^1781449200^{date_long}|Monday, June 15, 2026>",
      ),
    ).toBe("*Today*-Monday, June 15, 2026");
  });
});

describe("normalizeSlackMessage", () => {
  it("title=チャンネル名 / body=整形済み本文 で inbox へ正規化する", () => {
    const item = normalizeSlackMessage({
      channel: { id: "C123", name: "general" },
      ts: "1718000000.000100",
      text: "<@U0AQ2QR1RD4|Kokoro Tobita/GMO-FH> レビューお願いします",
      username: "taro",
      permalink: "https://example.slack.com/archives/C123/p1718000000000100",
    });
    expect(item).toEqual({
      source: "slack",
      externalId: "C123:1718000000.000100",
      title: "general",
      body: "@Kokoro Tobita/GMO-FH レビューお願いします",
      sender: "taro",
      url: "https://example.slack.com/archives/C123/p1718000000000100",
      defaultLane: "inbox",
    });
  });

  it("チャンネル名が無ければ sender をタイトルにする（DM 等）", () => {
    const item = normalizeSlackMessage({
      channel: { id: "D1" },
      ts: "1.1",
      text: "hi",
      username: "hanako",
    });
    expect(item?.title).toBe("hanako");
  });

  it("username が無ければ user ID を sender にする", () => {
    const item = normalizeSlackMessage({
      channel: { id: "C1", name: "dev" },
      ts: "1.1",
      text: "hi",
      user: "U999",
    });
    expect(item?.sender).toBe("U999");
  });

  it("channel.id か ts が無ければ null", () => {
    expect(normalizeSlackMessage({ ts: "1.1", text: "x" })).toBeNull();
    expect(
      normalizeSlackMessage({ channel: { id: "C1" }, text: "x" }),
    ).toBeNull();
  });

  it("Google Calendar アプリの投稿はノイズなので null", () => {
    expect(
      normalizeSlackMessage({
        channel: { id: "C1", name: "general" },
        ts: "1.1",
        text: "*Today*-<!date^1781449200^{date_long}|Monday, June 15, 2026>",
        username: "Google Calendar",
      }),
    ).toBeNull();
  });
});

describe("getUserProfiles", () => {
  it("display_name を優先し、avatarUrl とともに解決する（失敗ユーザーは除外）", async () => {
    const client = {
      users: {
        info: ({ user }: { user: string }) =>
          user === "U1"
            ? Promise.resolve({
                user: {
                  profile: {
                    display_name: "藤田 哲朗",
                    real_name: "Tetsuro Fujita",
                    image_72: "https://img/u1.png",
                  },
                },
              })
            : Promise.reject(new Error("user_not_found")),
      },
    } as unknown as WebClient;

    const map = await getUserProfiles(client, new Set(["U1", "U2"]));
    expect(map.get("U1")).toEqual({
      displayName: "藤田 哲朗",
      avatarUrl: "https://img/u1.png",
    });
    expect(map.has("U2")).toBe(false);
  });

  it("display_name が空なら real_name にフォールバックする", async () => {
    const client = {
      users: {
        info: () =>
          Promise.resolve({
            user: {
              profile: { display_name: "", real_name: "Tetsuro Fujita" },
            },
          }),
      },
    } as unknown as WebClient;

    const map = await getUserProfiles(client, new Set(["U1"]));
    expect(map.get("U1")?.displayName).toBe("Tetsuro Fujita");
  });
});
