import { and, eq } from "@acme/db";
import { db } from "@acme/db/client";
import { SyncState, Task } from "@acme/db/schema";
import type { IntegrationSource, NormalizedItem } from "@acme/integrations";
import {
  fetchCalendarToday,
  fetchSlackMentionsAndDms,
  fetchUnreadInbox,
  loadGoogleAuth,
} from "@acme/integrations";

import { nextPosition } from "./task";

/** ソース別ポーリング間隔（ミリ秒） */
export const SYNC_INTERVALS_MS: Record<IntegrationSource, number> = {
  calendar: 90_000,
  gmail: 150_000,
  slack: 240_000,
};

/** 既存カードへ書き戻す更新値。lane / position は意図的に含めない（ユーザーの状態を保護）。 */
export interface UpdateValues {
  title: string;
  body: string | null;
  sender: string | null;
  avatarUrl: string | null;
  url: string | null;
  startAt?: Date | null;
  endAt?: Date | null;
}

/** NormalizedItem から再同期時の更新値を作る（calendar のみ時刻も更新） */
export function buildUpdateValues(item: NormalizedItem): UpdateValues {
  const base: UpdateValues = {
    title: item.title,
    body: item.body ?? null,
    sender: item.sender ?? null,
    avatarUrl: item.avatarUrl ?? null,
    url: item.url ?? null,
  };
  if (item.source === "calendar") {
    return {
      ...base,
      startAt: item.startAt ?? null,
      endAt: item.endAt ?? null,
    };
  }
  return base;
}

/** lastSyncedAt とソース別間隔から、いま取得すべきか判定する */
export function isDue(
  source: IntegrationSource,
  lastSyncedAt: Date | null,
  now: Date,
): boolean {
  if (!lastSyncedAt) return true;
  return now.getTime() - lastSyncedAt.getTime() >= SYNC_INTERVALS_MS[source];
}

const SOURCES: IntegrationSource[] = ["calendar", "gmail", "slack"];

/** ソースに対応するプロバイダから取得する。未接続なら null（同期スキップ）。 */
async function fetchForSource(
  source: IntegrationSource,
  now: Date,
): Promise<NormalizedItem[] | null> {
  if (source === "slack") {
    const token = process.env.SLACK_TOKEN;
    if (!token) return null;
    return fetchSlackMentionsAndDms(token, now);
  }
  const auth = loadGoogleAuth();
  if (!auth) return null;
  return source === "calendar"
    ? fetchCalendarToday(auth, now)
    : fetchUnreadInbox(auth);
}

async function getLastSyncedAt(
  source: IntegrationSource,
): Promise<Date | null> {
  const row = await db.query.SyncState.findFirst({
    where: eq(SyncState.source, source),
  });
  return row?.lastSyncedAt ?? null;
}

async function setLastSyncedAt(
  source: IntegrationSource,
  at: Date,
): Promise<void> {
  await db
    .insert(SyncState)
    .values({ source, lastSyncedAt: at })
    .onConflictDoUpdate({
      target: SyncState.source,
      set: { lastSyncedAt: at },
    });
}

/** 1件を upsert。新規は defaultLane へ insert、既存は内容のみ更新（lane 保護）。 */
async function upsertItem(
  item: NormalizedItem,
): Promise<"inserted" | "updated"> {
  const existing = await db.query.Task.findFirst({
    where: and(
      eq(Task.source, item.source),
      eq(Task.externalId, item.externalId),
    ),
  });
  if (existing) {
    await db
      .update(Task)
      .set(buildUpdateValues(item))
      .where(eq(Task.id, existing.id));
    return "updated";
  }
  await db.insert(Task).values({
    source: item.source,
    lane: item.defaultLane,
    title: item.title,
    body: item.body ?? null,
    sender: item.sender ?? null,
    avatarUrl: item.avatarUrl ?? null,
    url: item.url ?? null,
    externalId: item.externalId,
    startAt: item.startAt ?? null,
    endAt: item.endAt ?? null,
    position: await nextPosition(item.defaultLane),
  });
  return "inserted";
}

/** 期限の来たソースを取得し upsert する。未接続のソースはスキップ。 */
export async function run(): Promise<{ inserted: number; updated: number }> {
  const now = new Date();
  let inserted = 0;
  let updated = 0;

  for (const source of SOURCES) {
    const last = await getLastSyncedAt(source);
    if (!isDue(source, last, now)) continue;
    try {
      const items = await fetchForSource(source, now);
      if (items === null) continue; // 未接続
      for (const item of items) {
        const res = await upsertItem(item);
        if (res === "inserted") inserted++;
        else updated++;
      }
      await setLastSyncedAt(source, now);
    } catch (err) {
      // 個別ソースの失敗は握りつぶし、他ソースの同期を続ける
      console.error(`[sync] ${source} failed`, err);
    }
  }

  return { inserted, updated };
}
