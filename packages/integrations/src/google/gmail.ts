import type { Auth } from "googleapis";
import { google } from "googleapis";

import type { NormalizedItem } from "../types";

export interface GmailHeader {
  name?: string | null;
  value?: string | null;
}
export interface GmailMessage {
  id?: string | null;
  snippet?: string | null;
  payload?: { headers?: GmailHeader[] | null } | null;
}

function header(message: GmailMessage, name: string): string | undefined {
  const lower = name.toLowerCase();
  const found = message.payload?.headers?.find(
    (h) => h.name?.toLowerCase() === lower,
  );
  return found?.value ?? undefined;
}

/** Gmail メッセージを NormalizedItem に変換 */
export function normalizeGmailMessage(message: GmailMessage): NormalizedItem {
  const id = message.id ?? "";
  const subject = header(message, "Subject");
  return {
    source: "gmail",
    externalId: id,
    title: subject?.trim() ? subject : "(件名なし)",
    sender: header(message, "From"),
    body: message.snippet ?? undefined,
    url: `https://mail.google.com/mail/u/0/#inbox/${id}`,
    defaultLane: "inbox",
  };
}

/** 未読の受信トレイを取得して正規化する（最大50件） */
export async function fetchUnreadInbox(
  auth: Auth.OAuth2Client,
): Promise<NormalizedItem[]> {
  const gmail = google.gmail({ version: "v1", auth });
  const list = await gmail.users.messages.list({
    userId: "me",
    q: "is:unread in:inbox",
    maxResults: 50,
  });
  const ids = (list.data.messages ?? [])
    .map((m) => m.id)
    .filter((id): id is string => Boolean(id));

  const items: NormalizedItem[] = [];
  for (const id of ids) {
    const res = await gmail.users.messages.get({
      userId: "me",
      id,
      format: "metadata",
      metadataHeaders: ["Subject", "From"],
    });
    items.push(normalizeGmailMessage(res.data as GmailMessage));
  }
  return items;
}
