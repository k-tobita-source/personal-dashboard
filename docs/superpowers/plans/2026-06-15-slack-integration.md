# Slack 連携（メンション / DM）取り込み Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slack の自分へのメンションと DM（過去3日）を読み取り専用で取り込み、Todo レーンに積む。

**Architecture:** `packages/integrations` に Slack コネクタ（`@slack/web-api`・DB 非依存）を追加し、`packages/api` の `syncService` を「ソースごとにプロバイダを判定して fetch」する形へ小さくリファクタして `slack` を追加する。正規化と間隔判定は純粋関数として TDD する。

**Tech Stack:** TypeScript / pnpm + Turborepo / @slack/web-api / Drizzle + better-sqlite3 / tRPC / Vitest

設計書: [docs/superpowers/specs/2026-06-15-slack-integration-design.md](../specs/2026-06-15-slack-integration-design.md)

---

## ファイル構成

**`packages/integrations`**
- `package.json` — `@slack/web-api` 依存追加
- `src/types.ts` — `IntegrationSource` に `"slack"` を追加
- `src/slack/client.ts` — `isSlackConnected` / `fetchSlackMentionsAndDms` / `normalizeSlackMessage`（純粋）
- `src/slack/client.test.ts` — 正規化の単体テスト
- `src/index.ts` — Slack の公開 API を export

**`packages/api`**
- `src/service/syncService.ts` — `SYNC_INTERVALS_MS.slack` 追加、`SOURCES` に `slack`、`run()` をプロバイダ判定式にリファクタ
- `src/service/syncService.test.ts` — `isDue` に slack ケース追加

**`apps/web`**
- `src/env.ts` — `SLACK_TOKEN` 追加

**ルート / docs**
- `turbo.json` — `globalEnv` に `SLACK_TOKEN`
- `.env.example` — `SLACK_TOKEN` 有効化
- `docs/setup-slack.md` — セットアップ手順

---

## Task 1: `@slack/web-api` 依存追加と IntegrationSource 拡張

**Files:**
- Modify: `packages/integrations/package.json`
- Modify: `packages/integrations/src/types.ts`

- [ ] **Step 1: package.json に依存を追加**

`packages/integrations/package.json` の `dependencies` に追加（`googleapis` の隣）:

```json
    "@slack/web-api": "^7.8.0",
```

- [ ] **Step 2: インストール**

Run: `pnpm install`
Expected: `@slack/web-api` が解決される。

- [ ] **Step 3: IntegrationSource に slack を追加**

`packages/integrations/src/types.ts` の型を更新:

```ts
/** 連携ソース */
export type IntegrationSource = "calendar" | "gmail" | "slack";
```

- [ ] **Step 4: typecheck**

Run: `pnpm -F @acme/integrations typecheck`
Expected: エラーなし。

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/package.json packages/integrations/src/types.ts pnpm-lock.yaml
git commit -m "chore(integrations): add @slack/web-api and slack source type"
```

---

## Task 2: Slack メッセージ正規化（TDD）

**Files:**
- Create: `packages/integrations/src/slack/client.ts`
- Test: `packages/integrations/src/slack/client.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`normalizeSlackMessage` は search.messages の match を `NormalizedItem | null` に変換（channel.id か ts 欠落で null）。

```ts
import { describe, expect, it } from "vitest";

import { normalizeSlackMessage } from "./client";

describe("normalizeSlackMessage", () => {
  it("メンション/DM の match を inbox レーンへ正規化する", () => {
    const item = normalizeSlackMessage({
      channel: { id: "C123" },
      ts: "1718000000.000100",
      text: "レビューお願いします",
      username: "taro",
      permalink: "https://example.slack.com/archives/C123/p1718000000000100",
    });
    expect(item).toEqual({
      source: "slack",
      externalId: "C123:1718000000.000100",
      title: "レビューお願いします",
      body: "レビューお願いします",
      sender: "taro",
      url: "https://example.slack.com/archives/C123/p1718000000000100",
      defaultLane: "inbox",
    });
  });

  it("本文が複数行なら title は1行目", () => {
    const item = normalizeSlackMessage({
      channel: { id: "C1" },
      ts: "1.1",
      text: "1行目\n2行目\n3行目",
      username: "hanako",
    });
    expect(item?.title).toBe("1行目");
    expect(item?.body).toBe("1行目\n2行目\n3行目");
  });

  it("本文が空なら代替文言", () => {
    const item = normalizeSlackMessage({
      channel: { id: "C1" },
      ts: "1.1",
      text: "",
      username: "hanako",
    });
    expect(item?.title).toBe("(本文なし)");
  });

  it("username が無ければ user ID を sender にする", () => {
    const item = normalizeSlackMessage({
      channel: { id: "C1" },
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
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm -F @acme/integrations test`
Expected: FAIL（`./client` 未定義）。

- [ ] **Step 3: client.ts を実装**

```ts
import { WebClient } from "@slack/web-api";

import type { NormalizedItem } from "../types";

/** search.messages の match（必要フィールドのみ） */
export interface SlackMatch {
  channel?: { id?: string | null } | null;
  ts?: string | null;
  text?: string | null;
  username?: string | null;
  user?: string | null;
  permalink?: string | null;
}

/** Slack の match を NormalizedItem に変換（channel.id / ts 欠落は null） */
export function normalizeSlackMessage(match: SlackMatch): NormalizedItem | null {
  const channelId = match.channel?.id;
  const ts = match.ts;
  if (!channelId || !ts) return null;
  const text = match.text ?? "";
  const firstLine = text.split("\n")[0]?.trim() ?? "";
  return {
    source: "slack",
    externalId: `${channelId}:${ts}`,
    title: firstLine || "(本文なし)",
    body: text || undefined,
    sender: match.username ?? match.user ?? undefined,
    url: match.permalink ?? undefined,
    defaultLane: "inbox",
  };
}

/** Slack トークンが設定されているか */
export function isSlackConnected(): boolean {
  return Boolean(process.env.SLACK_TOKEN);
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

/** 自分へのメンション + 自分宛 DM（過去3日）を取得して正規化する */
export async function fetchSlackMentionsAndDms(
  token: string,
  now: Date,
): Promise<NormalizedItem[]> {
  const client = new WebClient(token);
  const auth = await client.auth.test();
  const userId = auth.user_id;
  const after = afterDate(now, 3);

  const queries = [
    `<@${userId}> after:${after}`, // メンション
    `is:dm after:${after} -from:me`, // DM（自分の発言を除外）
  ];

  const seen = new Set<string>();
  const items: NormalizedItem[] = [];
  for (const query of queries) {
    const res = await client.search.messages({
      query,
      count: 100,
      sort: "timestamp",
    });
    for (const match of res.messages?.matches ?? []) {
      const item = normalizeSlackMessage(match as SlackMatch);
      if (!item || seen.has(item.externalId)) continue;
      seen.add(item.externalId);
      items.push(item);
    }
  }
  return items;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm -F @acme/integrations test`
Expected: PASS。

- [ ] **Step 5: index.ts に公開 API を追加**

`packages/integrations/src/index.ts` の末尾に追加:

```ts
export {
  fetchSlackMentionsAndDms,
  isSlackConnected,
  normalizeSlackMessage,
} from "./slack/client";
```

- [ ] **Step 6: typecheck**

Run: `pnpm -F @acme/integrations typecheck`
Expected: エラーなし。

- [ ] **Step 7: Commit**

```bash
git add packages/integrations/src/slack packages/integrations/src/index.ts
git commit -m "feat(integrations): add Slack connector (mentions + DMs, read-only)"
```

---

## Task 3: syncService に slack を追加（プロバイダ判定式へリファクタ）

**Files:**
- Modify: `packages/api/src/service/syncService.ts`
- Modify: `packages/api/src/service/syncService.test.ts`

- [ ] **Step 1: 失敗するテストを追加**

`packages/api/src/service/syncService.test.ts` の `describe("isDue", ...)` 内に slack ケースを追加（既存ケースの後ろ）:

```ts
  it("slack は 240 秒間隔", () => {
    const last = new Date(now.getTime() - 200_000); // 200s 前
    expect(isDue("slack", last, now)).toBe(false); // 240s 未満
    const older = new Date(now.getTime() - 250_000); // 250s 前
    expect(isDue("slack", older, now)).toBe(true);
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm -F @acme/api test`
Expected: FAIL（`SYNC_INTERVALS_MS` に slack が無く `isDue("slack", ...)` が NaN 比較で想定外）。

- [ ] **Step 3: SYNC_INTERVALS_MS に slack を追加**

`packages/api/src/service/syncService.ts`:

```ts
/** ソース別ポーリング間隔（ミリ秒） */
export const SYNC_INTERVALS_MS: Record<IntegrationSource, number> = {
  calendar: 90_000,
  gmail: 150_000,
  slack: 240_000,
};
```

- [ ] **Step 4: import に Slack 取得関数を追加**

`syncService.ts` の import を更新:

```ts
import {
  fetchCalendarToday,
  fetchSlackMentionsAndDms,
  fetchUnreadInbox,
  loadGoogleAuth,
} from "@acme/integrations";
```

- [ ] **Step 5: SOURCES に slack を追加し、fetch をプロバイダ判定式にリファクタ**

`syncService.ts` の `const SOURCES ...` を置き換え:

```ts
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
```

- [ ] **Step 6: run() をリファクタ**

`syncService.ts` の `export async function run() {...}` を置き換え:

```ts
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
```

> `loadGoogleAuth` は `fetchForSource` 内でのみ使うため、ファイル先頭 import の並びはそのままで良い（未使用にはならない）。

- [ ] **Step 7: テストが通ることを確認**

Run: `pnpm -F @acme/api test`
Expected: PASS（既存 + slack ケース）。

- [ ] **Step 8: 依存パッケージをビルドして typecheck**

Run: `pnpm -F @acme/integrations build && pnpm -F @acme/api typecheck`
Expected: エラーなし（api は @acme/integrations の dist 型を参照するため先にビルド）。

- [ ] **Step 9: lint**

Run: `pnpm -F @acme/api lint`
Expected: エラーなし。

- [ ] **Step 10: Commit**

```bash
git add packages/api/src/service/syncService.ts packages/api/src/service/syncService.test.ts
git commit -m "feat(api): add slack source to syncService (per-provider fetch)"
```

---

## Task 4: env / turbo / .env.example に SLACK_TOKEN を追加

**Files:**
- Modify: `apps/web/src/env.ts`
- Modify: `turbo.json`
- Modify: `.env.example`

- [ ] **Step 1: env.ts の server に SLACK_TOKEN を追加**

`apps/web/src/env.ts` の `server` ブロック:

```ts
  server: {
    KANBAN_DB_PATH: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    SLACK_TOKEN: z.string().optional(),
  },
```

- [ ] **Step 2: turbo.json の globalEnv に追加**

`turbo.json` の `globalEnv`:

```json
  "globalEnv": [
    "KANBAN_DB_PATH",
    "PORT",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "SLACK_TOKEN"
  ],
```

- [ ] **Step 3: .env.example の SLACK_TOKEN を有効化**

`.env.example` の Slack 行を更新:

```sh
# Slack — search:read のみ（User OAuth Token: xoxp-...）
# セットアップ手順は docs/setup-slack.md を参照。
SLACK_TOKEN=''
```

- [ ] **Step 4: web をビルドして検証**

Run: `pnpm -F @acme/api build && pnpm -F @acme/web build`
Expected: コンパイル成功（api を先にビルドして dist 型を更新）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/env.ts turbo.json .env.example
git commit -m "feat(web): add SLACK_TOKEN env var and turbo globalEnv"
```

---

## Task 5: セットアップ手順ドキュメント

**Files:**
- Create: `docs/setup-slack.md`

- [ ] **Step 1: docs/setup-slack.md を作成**

```markdown
# Slack 連携セットアップ（メンション / DM）

読み取り専用・ローカル完結。過去3日の自分へのメンションと DM を Todo レーンに取り込む。

## 手順

1. [Slack API: Your Apps](https://api.slack.com/apps) で「Create New App」→「From scratch」。任意の名前＋対象ワークスペースを選択。
2. 左メニュー「OAuth & Permissions」→「Scopes」→ **User Token Scopes** に `search:read` を追加。
   （Bot Token Scopes ではなく **User Token Scopes** に追加すること。`search.messages` はユーザートークン必須。）
3. 同ページ上部「Install to Workspace」でインストールし、許可。
4. 「OAuth Tokens」の **User OAuth Token**（`xoxp-` で始まる）をコピー。
5. リポジトリ直下の `.env` に設定:

   ```sh
   SLACK_TOKEN='xoxp-...'
   ```

6. `pnpm dev:next` を再起動。タブ表示中、数分間隔で取り込まれる。

## 注意

- トークンはローカルの `.env`（gitignore 済み）にのみ保存。
- 本アプリは Slack を **検索（読み取り）のみ**で、メッセージの送信・変更は一切行わない。
- 取り込み対象は「自分へのメンション」と「自分宛 DM（自分の発言を除く）」の過去3日分。
```

- [ ] **Step 2: Commit**

```bash
git add docs/setup-slack.md
git commit -m "docs: add Slack integration setup guide"
```

---

## Task 6: 手動結合テスト（受け入れ確認）

**Files:** なし（実機確認）

- [ ] **Step 1: 環境準備**

`.env` に有効な `SLACK_TOKEN`（`xoxp-`、`search:read` 付与）を設定。`nvm use` 済み。

- [ ] **Step 2: 起動と取り込み**

Run: `pnpm dev:next`
操作: http://localhost:3000 を開き、数十秒〜数分待つ（Slack 間隔は4分。`sync_state` の slack 行が無ければ初回は即取得）。
Expected: 過去3日の自分へのメンション / DM が Todo（受信箱）に Slack アイコン付きで積まれる。

- [ ] **Step 3: レーン保護確認**

操作: 取り込まれた Slack カードを In Progress 等へ移動 → しばらく待って再同期。
Expected: 元レーンに戻らない。

- [ ] **Step 4: 未接続フォールバック確認**

操作: `.env` の `SLACK_TOKEN` を空にして再起動。
Expected: Slack は取り込まれないが、Google（Calendar/Gmail）の同期は正常に継続。エラーでボードが壊れない。

- [ ] **Step 5: 読み取り専用確認**

操作: Slack 側を確認。
Expected: アプリ操作による送信・既読化・変更が一切発生していない。

---

## 完了条件

- integrations / api の単体テストが通る。
- `pnpm -F @acme/web build` が成功する。
- Task 6 の手動確認をすべて満たす。
- Slack への書き込みが一切発生しない（`search:read` のみ）。
