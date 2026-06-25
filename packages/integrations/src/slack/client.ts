import { WebClient } from "@slack/web-api";

import type { NormalizedItem } from "../types";

/** search.messages の match（必要フィールドのみ） */
export interface SlackMatch {
  channel?: { id?: string | null; name?: string | null } | null;
  ts?: string | null;
  text?: string | null;
  username?: string | null;
  user?: string | null;
  permalink?: string | null;
}

/** ノイズなので取り込まない Slack アプリ/ボットの表示名 */
const IGNORED_SLACK_SENDERS = ["Google Calendar"];

/**
 * Slack の特殊トークンを人間可読な表記へ整形する。
 * `<@U123|Name>`→`@Name` / `<@U123>`→`@U123` / `<#C1|name>`→`#name` /
 * `<!here>`→`@here` / `<!date^..|Mon>`→`Mon` / `<https://x|text>`→`text`
 */
export function humanizeSlackText(text: string): string {
  return text
    .replace(/<@[A-Z0-9]+\|([^>]+)>/g, "@$1") // ユーザーメンション（ラベル付き）
    .replace(/<@([A-Z0-9]+)>/g, "@$1") // ユーザーメンション（ラベル無し）
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1") // チャンネル参照（ラベル付き）
    .replace(/<#([A-Z0-9]+)>/g, "#$1") // チャンネル参照（ラベル無し）
    .replace(/<!([^>]+)>/g, (_m, inner: string) => {
      // <!date^..|fallback> や <!subteam^..|@team> はフォールバック、
      // <!here> 等はコマンド名を @ 付きで表示する
      const pipe = inner.indexOf("|");
      return pipe >= 0 ? inner.slice(pipe + 1) : `@${inner}`;
    })
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, "$2") // リンク（ラベル付き）
    .replace(/<(https?:\/\/[^>]+)>/g, "$1"); // 素のリンク
}

/** Slack の match を NormalizedItem に変換（channel.id / ts 欠落・ノイズ送信者は null） */
export function normalizeSlackMessage(match: SlackMatch): NormalizedItem | null {
  const channelId = match.channel?.id;
  const ts = match.ts;
  if (!channelId || !ts) return null;
  // Google カレンダー等のアプリ通知は予定ではないので取り込まない
  if (match.username && IGNORED_SLACK_SENDERS.includes(match.username)) {
    return null;
  }
  const sender = match.username ?? match.user ?? undefined;
  const body = match.text ? humanizeSlackText(match.text) : undefined;
  return {
    source: "slack",
    // タイトルはチャンネル名。無い場合（DM 等）は送信者、それも無ければ "Slack"
    title: match.channel?.name ?? sender ?? "Slack",
    body,
    sender,
    externalId: `${channelId}:${ts}`,
    url: match.permalink ?? undefined,
    defaultLane: "inbox",
  };
}

/** now の days 日前を Slack 検索用の YYYY-MM-DD（ローカル日付）にする */
function afterDate(now: Date, days: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** search.messages を 1 クエリ実行して match 配列を返す */
async function searchMatches(
  client: WebClient,
  query: string,
): Promise<SlackMatch[]> {
  const res = await client.search.messages({
    query,
    count: 100,
    sort: "timestamp",
  });
  return (res.messages?.matches ?? []) as SlackMatch[];
}

/** 自分が参加している公開/非公開チャンネルの ID 集合（要 channels:read / groups:read） */
async function getMemberChannelIds(client: WebClient): Promise<Set<string>> {
  const ids = new Set<string>();
  let cursor: string | undefined;
  do {
    const res = await client.users.conversations({
      types: "public_channel,private_channel",
      exclude_archived: true,
      limit: 1000,
      cursor,
    });
    for (const c of res.channels ?? []) {
      if (c.id) ids.add(c.id);
    }
    cursor = res.response_metadata?.next_cursor ?? undefined;
  } while (cursor);
  return ids;
}

/** 自分が所属する user group の handle 一覧（要 usergroups:read） */
async function getMyUsergroupHandles(
  client: WebClient,
  userId: string,
): Promise<string[]> {
  const res = await client.usergroups.list({ include_users: true });
  return (res.usergroups ?? [])
    .filter((g) => (g.users ?? []).includes(userId))
    .map((g) => g.handle)
    .filter((h): h is string => Boolean(h));
}

/** users.info から解決したユーザー情報（表示名・アバターURL） */
export interface SlackUserProfile {
  displayName?: string;
  avatarUrl?: string;
}

/**
 * ユーザーID集合に対し users.info で表示名(display_name→real_name)と
 * アバターURL(image_72)を解決する（失敗は無視）。
 */
export async function getUserProfiles(
  client: WebClient,
  userIds: Set<string>,
): Promise<Map<string, SlackUserProfile>> {
  const map = new Map<string, SlackUserProfile>();
  // users.info は Tier 4（約100 RPM）。1ポーリングのユニークユーザー数は
  // 通常数人〜数十人なので並列実行で問題ない。
  await Promise.all(
    [...userIds].map(async (user) => {
      try {
        const res = await client.users.info({ user });
        const profile = res.user?.profile;
        // Slack の表示ロジックに合わせる: display_name（空なら real_name）。
        // trim() 後に空文字になる場合は次の候補へ落とすため、条件分岐で処理する。
        const rawDisplayName = profile?.display_name?.trim();
        const rawRealName = profile?.real_name?.trim() ?? res.user?.real_name?.trim();
        const displayName =
          rawDisplayName !== "" && rawDisplayName !== undefined
            ? rawDisplayName
            : rawRealName !== "" && rawRealName !== undefined
              ? rawRealName
              : undefined;
        const rawAvatarUrl = profile?.image_72;
        const avatarUrl = rawAvatarUrl !== "" ? rawAvatarUrl : undefined;
        if (displayName || avatarUrl) map.set(user, { displayName, avatarUrl });
      } catch {
        // 取得失敗はスキップ（表示名・アバター無しで続行）
      }
    }),
  );
  return map;
}

/**
 * 参加チャンネルの「自分へのメンション / @channel / @here / チーム(@usergroup)」と、
 * 自分宛 DM（過去3日）を取得して正規化する。チャンネル系は参加チャンネルのみに限定。
 */
export async function fetchSlackMentionsAndDms(
  token: string,
  now: Date,
): Promise<NormalizedItem[]> {
  const client = new WebClient(token);
  const auth = await client.auth.test();
  const userId = auth.user_id;
  const after = afterDate(now, 3);

  const [memberChannels, usergroupHandles] = await Promise.all([
    getMemberChannelIds(client),
    userId ? getMyUsergroupHandles(client, userId) : Promise.resolve([]),
  ]);

  // 参加チャンネルに限定して拾うクエリ（メンション / ブロードキャスト / チーム）
  const channelQueries = [
    `<@${userId}> after:${after} -from:me`, // 自分へのメンション
    `@channel after:${after} -from:me`, // チャンネル全体メンション
    `@here after:${after} -from:me`, // オンラインメンバーへのメンション
    ...usergroupHandles.map((h) => `@${h} after:${after} -from:me`), // チームメンション
  ];
  // DM は参加チャンネル判定の対象外（常に自分宛）
  const dmQuery = `is:dm after:${after} -from:me`;

  const seen = new Set<string>();
  const collected: { item: NormalizedItem; user?: string }[] = [];
  const collect = (match: SlackMatch) => {
    const item = normalizeSlackMessage(match);
    if (!item || seen.has(item.externalId)) return;
    seen.add(item.externalId);
    collected.push({ item, user: match.user ?? undefined });
  };

  // チャンネル系: 参加しているチャンネルのメッセージだけ採用
  for (const query of channelQueries) {
    for (const match of await searchMatches(client, query)) {
      const channelId = match.channel?.id;
      if (!channelId || !memberChannels.has(channelId)) continue;
      collect(match);
    }
  }
  // DM: 全件
  for (const match of await searchMatches(client, dmQuery)) {
    collect(match);
  }

  // 採用 match のユニークユーザーの表示名・アバターを解決して付与する
  const userIds = new Set<string>();
  for (const c of collected) if (c.user) userIds.add(c.user);
  const profiles = await getUserProfiles(client, userIds);

  return collected.map(({ item, user }) => {
    const profile = user ? profiles.get(user) : undefined;
    if (!profile) return item;
    // 送信者名は Slack の表示名で上書き（無ければ既存の username 等を維持）
    const sender = profile.displayName ?? item.sender;
    // DM 等でタイトルが送信者にフォールバックしていた場合は表示名へ揃える
    const title =
      item.title === item.sender && sender ? sender : item.title;
    const next: NormalizedItem = { ...item, sender, title };
    if (profile.avatarUrl) next.avatarUrl = profile.avatarUrl;
    return next;
  });
}
