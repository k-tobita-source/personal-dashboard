import { describe, expect, it } from "vitest";

import { normalizeGmailMessage } from "./gmail";

describe("normalizeGmailMessage", () => {
  it("件名・差出人・スニペットを Todo カードへ正規化する", () => {
    const item = normalizeGmailMessage({
      id: "msg1",
      snippet: "至急ご確認ください",
      payload: {
        headers: [
          { name: "Subject", value: "請求書の件" },
          { name: "From", value: "Taro <taro@example.com>" },
        ],
      },
    });
    expect(item).toEqual({
      source: "gmail",
      externalId: "msg1",
      title: "請求書の件",
      sender: "Taro <taro@example.com>",
      body: "至急ご確認ください",
      url: "https://mail.google.com/mail/u/0/#inbox/msg1",
      defaultLane: "inbox",
    });
  });

  it("件名ヘッダ欠落時は代替文言", () => {
    const item = normalizeGmailMessage({
      id: "msg2",
      snippet: "",
      payload: { headers: [{ name: "From", value: "a@example.com" }] },
    });
    expect(item.title).toBe("(件名なし)");
  });

  it("ヘッダ名は大文字小文字を区別しない", () => {
    const item = normalizeGmailMessage({
      id: "msg3",
      payload: { headers: [{ name: "subject", value: "小文字ヘッダ" }] },
    });
    expect(item.title).toBe("小文字ヘッダ");
  });
});
