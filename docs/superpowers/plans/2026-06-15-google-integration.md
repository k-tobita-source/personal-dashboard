# Google 連携（Calendar / Gmail）取り込み Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Google Calendar の当日予定を Schedule レーンへ、未読 Gmail を Todo レーンへ、ローカル完結・読み取り専用で取り込み、タブ表示中に自動同期する。

**Architecture:** `packages/integrations`（DB 非依存・Google 取得＋正規化）→ `packages/api` の `syncService`（期限判定・レーン保護 upsert）→ `apps/web`（OAuth ルート・表示中ポーリング）。レーン保護マージ／間隔判定／正規化／認可URL生成は純粋関数に切り出して TDD する。

**Tech Stack:** TypeScript 5.9 / pnpm + Turborepo / googleapis / Drizzle + better-sqlite3 / tRPC v11 / TanStack Query / Vitest

設計書: [docs/superpowers/specs/2026-06-15-google-integration-design.md](../specs/2026-06-15-google-integration-design.md)

---

## ファイル構成

**新規パッケージ `packages/integrations`**
- `package.json` / `tsconfig.json` / `eslint.config.js` — 既存パッケージに倣う
- `src/index.ts` — 公開 API の集約 export
- `src/types.ts` — `NormalizedItem`, `IntegrationSource`
- `src/paths.ts` — `credentialsPath`（`~/.my-kanban/credentials.json`）
- `src/google/oauth.ts` — 認可URL生成（純粋）・token 保存／読込・auth クライアント生成・接続判定
- `src/google/calendar.ts` — `normalizeCalendarEvent`（純粋）＋ `fetchCalendarToday`
- `src/google/gmail.ts` — `normalizeGmailMessage`（純粋）＋ `fetchUnreadInbox`
- `src/google/*.test.ts` — 正規化・認可URLの単体テスト
- `vitest.config.ts`

**`packages/db`**
- `src/schema.ts` — `SyncState` 表を追加
- `drizzle/` — 生成されるマイグレーション

**`packages/api`**
- `src/service/syncService.ts` — `buildUpdateValues` / `isDue`（純粋・テスト対象）＋ `run()`
- `src/service/syncService.test.ts` — 純粋ロジックの単体テスト
- `src/service/task.ts` — `nextPosition` を export（DRY のため）
- `src/router/integration.ts` — `status` / `sync`
- `src/root.ts` — `integration` ルーター登録
- `vitest.config.ts`

**`apps/web`**
- `src/env.ts` — `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- `src/app/api/auth/google/route.ts` — 認可リダイレクト
- `src/app/api/auth/google/callback/route.ts` — code 交換 → 保存
- `src/features/board/api/queries.ts` — `useConnectionStatus`
- `src/features/board/api/mutations.ts` — `useSync`
- `src/features/board/hooks/useAutoSync.ts` — 表示中ポーリング
- `src/features/board/components/Board.tsx` — 自動同期と未接続バナー配線
- `src/features/board/components/ConnectBanner.tsx` — 「Google を接続」

**ドキュメント**
- `.env.example` — Google 変数のコメントアウト解除
- `docs/setup-google.md` — Google Cloud セットアップ手順

---

## Task 1: `packages/integrations` パッケージ雛形

**Files:**
- Create: `packages/integrations/package.json`
- Create: `packages/integrations/tsconfig.json`
- Create: `packages/integrations/eslint.config.js`
- Create: `packages/integrations/vitest.config.ts`
- Create: `packages/integrations/src/index.ts`

- [ ] **Step 1: package.json を作成**

`packages/api/package.json` を参考に、依存を Google 用に差し替える。

```json
{
  "name": "@acme/integrations",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./src/index.ts"
    }
  },
  "license": "MIT",
  "scripts": {
    "build": "tsc",
    "clean": "git clean -xdf .cache .turbo dist node_modules",
    "dev": "tsc",
    "format": "prettier --check . --ignore-path ../../.gitignore",
    "lint": "eslint --flag unstable_native_nodejs_ts_config",
    "test": "vitest run",
    "typecheck": "tsc --noEmit --emitDeclarationOnly false"
  },
  "dependencies": {
    "googleapis": "^144.0.0",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@acme/eslint-config": "workspace:*",
    "@acme/prettier-config": "workspace:*",
    "@acme/tsconfig": "workspace:*",
    "eslint": "catalog:",
    "prettier": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  },
  "prettier": "@acme/prettier-config"
}
```

- [ ] **Step 2: tsconfig.json / eslint.config.js を作成**

`packages/api/tsconfig.json` と `packages/api/eslint.config.js` の内容をそのままコピーする（同じ相対構成のため変更不要）。

- [ ] **Step 3: vitest.config.ts を作成**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 4: src/index.ts を仮作成**

```ts
export {};
```

- [ ] **Step 5: 依存をインストール**

Run: `pnpm install`
Expected: `@acme/integrations` が認識され、`googleapis` が解決される。

- [ ] **Step 6: Commit**

```bash
git add packages/integrations pnpm-lock.yaml
git commit -m "chore(integrations): scaffold @acme/integrations package"
```

---

## Task 2: `NormalizedItem` 型と credentials パス

**Files:**
- Create: `packages/integrations/src/types.ts`
- Create: `packages/integrations/src/paths.ts`

- [ ] **Step 1: types.ts を作成**

```ts
/** 連携ソース（Slack は後日） */
export type IntegrationSource = "calendar" | "gmail";

/** 外部ソースを共通のカード形へ正規化した中間表現 */
export interface NormalizedItem {
  source: IntegrationSource;
  /** 外部実体の一意キー（(source, externalId) で dedup） */
  externalId: string;
  title: string;
  body?: string;
  sender?: string;
  url?: string;
  startAt?: Date;
  endAt?: Date;
  /** 新規取り込み時の既定レーン */
  defaultLane: "schedule" | "inbox";
}
```

- [ ] **Step 2: paths.ts を作成**

DB と同じ `~/.my-kanban/` 配下に置く。integrations は DB に依存しないため自前で算出する。

```ts
import { homedir } from "node:os";
import { join } from "node:path";

/** 認証情報の保存先（リポジトリ外・ローカル完結）。 */
export const credentialsPath = join(
  homedir(),
  ".my-kanban",
  "credentials.json",
);
```

- [ ] **Step 3: typecheck**

Run: `pnpm -F @acme/integrations typecheck`
Expected: エラーなし。

- [ ] **Step 4: Commit**

```bash
git add packages/integrations/src/types.ts packages/integrations/src/paths.ts
git commit -m "feat(integrations): add NormalizedItem type and credentials path"
```

---

## Task 3: OAuth モジュール（認可URL生成を TDD）

**Files:**
- Create: `packages/integrations/src/google/oauth.ts`
- Test: `packages/integrations/src/google/oauth.test.ts`

- [ ] **Step 1: 失敗するテストを書く（認可URL生成は純粋）**

`buildAuthUrl` は client id とリダイレクトURIから認可URLを組み立てる純粋関数。スコープ・`access_type=offline`・`prompt=consent` を含むことを検証する。

```ts
import { describe, expect, it } from "vitest";

import { buildAuthUrl, GOOGLE_SCOPES } from "./oauth";

describe("buildAuthUrl", () => {
  const url = buildAuthUrl({
    clientId: "cid.apps.googleusercontent.com",
    redirectUri: "http://localhost:3000/api/auth/google/callback",
  });
  const parsed = new URL(url);

  it("Google の認可エンドポイントを指す", () => {
    expect(parsed.origin + parsed.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
  });

  it("client_id と redirect_uri を含む", () => {
    expect(parsed.searchParams.get("client_id")).toBe(
      "cid.apps.googleusercontent.com",
    );
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/auth/google/callback",
    );
  });

  it("offline + consent で refresh token を要求する", () => {
    expect(parsed.searchParams.get("access_type")).toBe("offline");
    expect(parsed.searchParams.get("prompt")).toBe("consent");
  });

  it("readonly スコープのみを要求する", () => {
    const scope = parsed.searchParams.get("scope") ?? "";
    expect(scope).toContain("calendar.readonly");
    expect(scope).toContain("gmail.readonly");
    expect(scope).not.toContain("calendar.events");
    expect(GOOGLE_SCOPES.every((s) => s.endsWith(".readonly"))).toBe(true);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm -F @acme/integrations test`
Expected: FAIL（`buildAuthUrl` 未定義）。

- [ ] **Step 3: oauth.ts を実装**

```ts
import { existsSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

import { credentialsPath } from "../paths";

/** 読み取り専用スコープ（書き込みなし） */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
] as const;

const REDIRECT_URI = "http://localhost:3000/api/auth/google/callback";

/** 認可URLを組み立てる（純粋関数・テスト対象） */
export function buildAuthUrl(opts: {
  clientId: string;
  redirectUri?: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri ?? REDIRECT_URI,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES.join(" "),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function oauthClient(): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET が未設定です");
  }
  return new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
}

interface StoredCredentials {
  google?: { refresh_token: string; obtained_at: number };
}

function readStored(): StoredCredentials {
  if (!existsSync(credentialsPath)) return {};
  return JSON.parse(readFileSync(credentialsPath, "utf8")) as StoredCredentials;
}

/** Web ルートから呼ぶ: 認可URLを返す */
export function getAuthUrl(): string {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID が未設定です");
  return buildAuthUrl({ clientId });
}

/** Web ルートから呼ぶ: code を token に交換し refresh token を保存 */
export async function exchangeCodeAndSave(code: string): Promise<void> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error("refresh_token を取得できませんでした（再認可が必要）");
  }
  mkdirSync(dirname(credentialsPath), { recursive: true });
  const next: StoredCredentials = {
    ...readStored(),
    google: { refresh_token: tokens.refresh_token, obtained_at: Date.now() },
  };
  writeFileSync(credentialsPath, JSON.stringify(next, null, 2), "utf8");
  chmodSync(credentialsPath, 0o600);
}

/** 接続済みか（refresh token を保持しているか） */
export function isConnected(): boolean {
  return Boolean(readStored().google?.refresh_token);
}

/** 同期処理用の認可済みクライアントを返す。未接続なら null。 */
export function loadGoogleAuth(): OAuth2Client | null {
  const refreshToken = readStored().google?.refresh_token;
  if (!refreshToken) return null;
  const client = oauthClient();
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm -F @acme/integrations test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/src/google/oauth.ts packages/integrations/src/google/oauth.test.ts
git commit -m "feat(integrations): add Google OAuth (auth url, token store, auth client)"
```

---

## Task 4: Calendar コネクタ（正規化を TDD）

**Files:**
- Create: `packages/integrations/src/google/calendar.ts`
- Test: `packages/integrations/src/google/calendar.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`normalizeCalendarEvent` は Calendar API の event を `NormalizedItem | null` に変換（cancelled は null）。

```ts
import { describe, expect, it } from "vitest";

import { normalizeCalendarEvent } from "./calendar";

describe("normalizeCalendarEvent", () => {
  it("時刻ありの予定を schedule レーンへ正規化する", () => {
    const item = normalizeCalendarEvent({
      id: "evt1",
      summary: "定例MTG",
      status: "confirmed",
      htmlLink: "https://calendar.google.com/evt1",
      start: { dateTime: "2026-06-15T10:00:00+09:00" },
      end: { dateTime: "2026-06-15T11:00:00+09:00" },
    });
    expect(item).toEqual({
      source: "calendar",
      externalId: "evt1",
      title: "定例MTG",
      url: "https://calendar.google.com/evt1",
      startAt: new Date("2026-06-15T10:00:00+09:00"),
      endAt: new Date("2026-06-15T11:00:00+09:00"),
      defaultLane: "schedule",
    });
  });

  it("終日予定は時刻なしで inbox レーンへ", () => {
    const item = normalizeCalendarEvent({
      id: "evt2",
      summary: "終日タスク",
      status: "confirmed",
      start: { date: "2026-06-15" },
      end: { date: "2026-06-16" },
    });
    expect(item?.defaultLane).toBe("inbox");
    expect(item?.startAt).toBeUndefined();
    expect(item?.endAt).toBeUndefined();
  });

  it("cancelled は null", () => {
    expect(
      normalizeCalendarEvent({ id: "evt3", status: "cancelled" }),
    ).toBeNull();
  });

  it("タイトル無しは代替文言", () => {
    const item = normalizeCalendarEvent({
      id: "evt4",
      status: "confirmed",
      start: { dateTime: "2026-06-15T10:00:00+09:00" },
      end: { dateTime: "2026-06-15T10:30:00+09:00" },
    });
    expect(item?.title).toBe("(タイトルなし)");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm -F @acme/integrations test`
Expected: FAIL（`normalizeCalendarEvent` 未定義）。

- [ ] **Step 3: calendar.ts を実装**

```ts
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

import type { NormalizedItem } from "../types";

/** Calendar API の event（必要フィールドのみ） */
export interface CalendarEvent {
  id?: string | null;
  summary?: string | null;
  status?: string | null;
  htmlLink?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null } | null;
}

/** event を NormalizedItem に変換（cancelled / id 無しは null） */
export function normalizeCalendarEvent(
  event: CalendarEvent,
): NormalizedItem | null {
  if (!event.id || event.status === "cancelled") return null;
  const title = event.summary?.trim() ? event.summary : "(タイトルなし)";
  const base = {
    source: "calendar" as const,
    externalId: event.id,
    title,
    url: event.htmlLink ?? undefined,
  };
  // 時刻あり → schedule
  if (event.start?.dateTime && event.end?.dateTime) {
    return {
      ...base,
      startAt: new Date(event.start.dateTime),
      endAt: new Date(event.end.dateTime),
      defaultLane: "schedule",
    };
  }
  // 終日（date のみ）→ inbox（時刻なし）
  return { ...base, defaultLane: "inbox" };
}

/** 当日の primary カレンダー予定を取得して正規化する */
export async function fetchCalendarToday(
  auth: OAuth2Client,
  now: Date,
): Promise<NormalizedItem[]> {
  const timeMin = new Date(now);
  timeMin.setHours(0, 0, 0, 0);
  const timeMax = new Date(now);
  timeMax.setHours(23, 59, 59, 999);

  const calendar = google.calendar({ version: "v3", auth });
  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
  });
  return (res.data.items ?? [])
    .map((e) => normalizeCalendarEvent(e as CalendarEvent))
    .filter((x): x is NormalizedItem => x !== null);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm -F @acme/integrations test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/src/google/calendar.ts packages/integrations/src/google/calendar.test.ts
git commit -m "feat(integrations): add Calendar connector (today events, read-only)"
```

---

## Task 5: Gmail コネクタ（正規化を TDD）

**Files:**
- Create: `packages/integrations/src/google/gmail.ts`
- Test: `packages/integrations/src/google/gmail.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`normalizeGmailMessage` は `messages.get(format=metadata)` の応答を `NormalizedItem` に変換。

```ts
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
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm -F @acme/integrations test`
Expected: FAIL（`normalizeGmailMessage` 未定義）。

- [ ] **Step 3: gmail.ts を実装**

```ts
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

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
  auth: OAuth2Client,
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
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm -F @acme/integrations test`
Expected: PASS。

- [ ] **Step 5: index.ts で公開 API を集約**

`packages/integrations/src/index.ts` を更新:

```ts
export type { IntegrationSource, NormalizedItem } from "./types";
export {
  buildAuthUrl,
  getAuthUrl,
  exchangeCodeAndSave,
  isConnected,
  loadGoogleAuth,
  GOOGLE_SCOPES,
} from "./google/oauth";
export { fetchCalendarToday, normalizeCalendarEvent } from "./google/calendar";
export { fetchUnreadInbox, normalizeGmailMessage } from "./google/gmail";
```

- [ ] **Step 6: typecheck**

Run: `pnpm -F @acme/integrations typecheck`
Expected: エラーなし。

- [ ] **Step 7: Commit**

```bash
git add packages/integrations/src/google/gmail.ts packages/integrations/src/google/gmail.test.ts packages/integrations/src/index.ts
git commit -m "feat(integrations): add Gmail connector and public API exports"
```

---

## Task 6: DB に `SyncState` 表を追加

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/drizzle/*`（生成物）

- [ ] **Step 1: schema.ts に SyncState を追加**

ファイル末尾（`CreateTaskSchema` の後）に追記:

```ts
/**
 * sync_state: ソース別の最終同期時刻。クライアントは一定間隔で sync を呼ぶが、
 * 実際の取得頻度は lastSyncedAt + ソース別間隔でサーバーが判定する。
 */
export const SyncState = sqliteTable("sync_state", (t) => ({
  source: t.text().primaryKey(),
  lastSyncedAt: t.integer({ mode: "timestamp_ms" }),
}));
```

- [ ] **Step 2: マイグレーションを生成**

Run: `pnpm -F @acme/db generate`
Expected: `packages/db/drizzle/` に `sync_state` を作成する新しい SQL マイグレーションが生成される。

- [ ] **Step 3: マイグレーションを適用**

Run: `pnpm -F @acme/db migrate`
Expected: ローカル DB（`~/.my-kanban/kanban.db`）に `sync_state` テーブルが作成される。エラーなし。

- [ ] **Step 4: typecheck**

Run: `pnpm -F @acme/db typecheck`
Expected: エラーなし。

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle
git commit -m "feat(db): add sync_state table for per-source sync cadence"
```

---

## Task 7: `syncService` の純粋ロジックを TDD

**Files:**
- Modify: `packages/api/package.json`（`@acme/integrations` 依存追加 + test 設定）
- Create: `packages/api/vitest.config.ts`
- Create: `packages/api/src/service/syncService.ts`
- Test: `packages/api/src/service/syncService.test.ts`

- [ ] **Step 1: api に integrations 依存と test を追加**

`packages/api/package.json` の `dependencies` に追加:

```json
    "@acme/integrations": "workspace:*",
```

`scripts` に追加:

```json
    "test": "vitest run",
```

`devDependencies` に追加:

```json
    "vitest": "catalog:",
```

その後 Run: `pnpm install`

- [ ] **Step 2: vitest.config.ts を作成**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 3: 失敗するテストを書く**

`buildUpdateValues`（再同期時の更新値・レーン保護）と `isDue`（間隔判定）を検証。

```ts
import { describe, expect, it } from "vitest";

import { buildUpdateValues, isDue } from "./syncService";
import type { NormalizedItem } from "@acme/integrations";

const gmailItem: NormalizedItem = {
  source: "gmail",
  externalId: "m1",
  title: "件名",
  body: "本文",
  sender: "a@example.com",
  url: "https://mail.google.com/mail/u/0/#inbox/m1",
  defaultLane: "inbox",
};

const calendarItem: NormalizedItem = {
  source: "calendar",
  externalId: "e1",
  title: "MTG",
  url: "https://calendar.google.com/e1",
  startAt: new Date("2026-06-15T10:00:00+09:00"),
  endAt: new Date("2026-06-15T11:00:00+09:00"),
  defaultLane: "schedule",
};

describe("buildUpdateValues", () => {
  it("lane / position を更新値に含めない（レーン保護）", () => {
    const v = buildUpdateValues(gmailItem);
    expect(v).not.toHaveProperty("lane");
    expect(v).not.toHaveProperty("position");
  });

  it("gmail は時刻を更新しない", () => {
    const v = buildUpdateValues(gmailItem);
    expect(v).not.toHaveProperty("startAt");
    expect(v).not.toHaveProperty("endAt");
    expect(v.title).toBe("件名");
    expect(v.sender).toBe("a@example.com");
  });

  it("calendar は時刻も更新する", () => {
    const v = buildUpdateValues(calendarItem);
    expect(v.startAt).toEqual(new Date("2026-06-15T10:00:00+09:00"));
    expect(v.endAt).toEqual(new Date("2026-06-15T11:00:00+09:00"));
  });

  it("欠落フィールドは null に正規化する", () => {
    const v = buildUpdateValues({ ...gmailItem, body: undefined, sender: undefined });
    expect(v.body).toBeNull();
    expect(v.sender).toBeNull();
  });
});

describe("isDue", () => {
  const now = new Date("2026-06-15T12:00:00Z");

  it("未同期(null)は常に due", () => {
    expect(isDue("calendar", null, now)).toBe(true);
  });

  it("間隔未経過は due でない", () => {
    const last = new Date(now.getTime() - 30_000); // 30s 前
    expect(isDue("calendar", last, now)).toBe(false); // calendar=90s
  });

  it("間隔経過後は due", () => {
    const last = new Date(now.getTime() - 100_000); // 100s 前
    expect(isDue("calendar", last, now)).toBe(true);
  });

  it("ソースごとに間隔が異なる", () => {
    const last = new Date(now.getTime() - 120_000); // 120s 前
    expect(isDue("calendar", last, now)).toBe(true); // 90s
    expect(isDue("gmail", last, now)).toBe(false); // 150s
  });
});
```

- [ ] **Step 4: テストが失敗することを確認**

Run: `pnpm -F @acme/api test`
Expected: FAIL（`syncService` 未定義）。

- [ ] **Step 5: syncService.ts の純粋ロジックを実装**

まずは純粋関数だけを実装する（`run()` は次タスク）。

```ts
import type { IntegrationSource, NormalizedItem } from "@acme/integrations";

/** ソース別ポーリング間隔（ミリ秒） */
export const SYNC_INTERVALS_MS: Record<IntegrationSource, number> = {
  calendar: 90_000,
  gmail: 150_000,
};

/** 既存カードへ書き戻す更新値。lane / position は意図的に含めない（ユーザーの状態を保護）。 */
export interface UpdateValues {
  title: string;
  body: string | null;
  sender: string | null;
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
    url: item.url ?? null,
  };
  if (item.source === "calendar") {
    return { ...base, startAt: item.startAt ?? null, endAt: item.endAt ?? null };
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
```

- [ ] **Step 6: テストが通ることを確認**

Run: `pnpm -F @acme/api test`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add packages/api/package.json packages/api/vitest.config.ts packages/api/src/service/syncService.ts packages/api/src/service/syncService.test.ts pnpm-lock.yaml
git commit -m "feat(api): add syncService pure logic (update values, due interval)"
```

---

## Task 8: `syncService.run()` と upsert 配線

**Files:**
- Modify: `packages/api/src/service/task.ts`（`nextPosition` を export）
- Modify: `packages/api/src/service/syncService.ts`（`run()` 追加）

- [ ] **Step 1: task.ts の `nextPosition` を export**

`packages/api/src/service/task.ts` の `async function nextPosition(` を `export async function nextPosition(` に変更する（既存の呼び出し箇所はそのまま動く）。

- [ ] **Step 2: syncService.ts に `run()` を追加**

ファイル先頭の import を更新:

```ts
import { and, eq } from "@acme/db";
import { db } from "@acme/db/client";
import { SyncState, Task } from "@acme/db/schema";
import {
  fetchCalendarToday,
  fetchUnreadInbox,
  loadGoogleAuth,
  type IntegrationSource,
  type NormalizedItem,
} from "@acme/integrations";

import { nextPosition } from "./task";
```

ファイル末尾に追加:

```ts
const SOURCES: IntegrationSource[] = ["calendar", "gmail"];

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
    where: and(eq(Task.source, item.source), eq(Task.externalId, item.externalId)),
  });
  if (existing) {
    await db.update(Task).set(buildUpdateValues(item)).where(eq(Task.id, existing.id));
    return "updated";
  }
  await db.insert(Task).values({
    source: item.source,
    lane: item.defaultLane,
    title: item.title,
    body: item.body ?? null,
    sender: item.sender ?? null,
    url: item.url ?? null,
    externalId: item.externalId,
    startAt: item.startAt ?? null,
    endAt: item.endAt ?? null,
    position: await nextPosition(item.defaultLane),
  });
  return "inserted";
}

/** 期限の来たソースを取得し upsert する。未接続なら connected:false を返す。 */
export async function run(): Promise<{
  connected: boolean;
  inserted: number;
  updated: number;
}> {
  const auth = loadGoogleAuth();
  if (!auth) return { connected: false, inserted: 0, updated: 0 };

  const now = new Date();
  let inserted = 0;
  let updated = 0;

  for (const source of SOURCES) {
    const last = await getLastSyncedAt(source);
    if (!isDue(source, last, now)) continue;
    try {
      const items =
        source === "calendar"
          ? await fetchCalendarToday(auth, now)
          : await fetchUnreadInbox(auth);
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

  return { connected: true, inserted, updated };
}
```

- [ ] **Step 3: 既存テストが引き続き通ることを確認（純粋ロジックは不変）**

Run: `pnpm -F @acme/api test`
Expected: PASS（Task 7 のテストがそのまま通る）。

- [ ] **Step 4: typecheck**

Run: `pnpm -F @acme/api typecheck`
Expected: エラーなし。

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/service/task.ts packages/api/src/service/syncService.ts
git commit -m "feat(api): add syncService.run upsert with lane protection"
```

---

## Task 9: `integration` tRPC ルーター

**Files:**
- Create: `packages/api/src/router/integration.ts`
- Modify: `packages/api/src/root.ts`

- [ ] **Step 1: integration.ts を作成**

```ts
import type { TRPCRouterRecord } from "@trpc/server";

import { isConnected } from "@acme/integrations";

import { run } from "../service/syncService";
import { publicProcedure } from "../trpc";

export const integrationRouter = {
  /** Google 接続状態 */
  status: publicProcedure.query(() => ({ connected: isConnected() })),

  /** 期限の来たソースを同期し処理件数を返す */
  sync: publicProcedure.mutation(() => run()),
} satisfies TRPCRouterRecord;
```

- [ ] **Step 2: root.ts に登録**

```ts
import { integrationRouter } from "./router/integration";
import { taskRouter } from "./router/task";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  task: taskRouter,
  integration: integrationRouter,
});

export type AppRouter = typeof appRouter;
```

- [ ] **Step 3: typecheck**

Run: `pnpm -F @acme/api typecheck`
Expected: エラーなし。

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/router/integration.ts packages/api/src/root.ts
git commit -m "feat(api): add integration router (status, sync)"
```

---

## Task 10: env と OAuth Web ルート

**Files:**
- Modify: `apps/web/src/env.ts`
- Modify: `apps/web/package.json`（`@acme/integrations` 依存追加）
- Create: `apps/web/src/app/api/auth/google/route.ts`
- Create: `apps/web/src/app/api/auth/google/callback/route.ts`

- [ ] **Step 1: apps/web に integrations 依存を追加**

`apps/web/package.json` の `dependencies` に追加:

```json
    "@acme/integrations": "workspace:*",
```

Run: `pnpm install`

- [ ] **Step 2: env.ts に Google 変数を追加**

`server` ブロックに追加:

```ts
  server: {
    KANBAN_DB_PATH: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
  },
```

`experimental__runtimeEnv` に追加:

```ts
  experimental__runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  },
```

- [ ] **Step 3: 認可リダイレクトのルートを作成**

`apps/web/src/app/api/auth/google/route.ts`:

```ts
import { NextResponse } from "next/server";

import { getAuthUrl } from "@acme/integrations";

export function GET() {
  return NextResponse.redirect(getAuthUrl());
}
```

- [ ] **Step 4: callback ルートを作成**

`apps/web/src/app/api/auth/google/callback/route.ts`:

```ts
import { NextResponse } from "next/server";

import { exchangeCodeAndSave } from "@acme/integrations";

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code");
  const base = new URL(request.url).origin;
  if (!code) {
    return NextResponse.redirect(`${base}/?google=error`);
  }
  try {
    await exchangeCodeAndSave(code);
    return NextResponse.redirect(`${base}/?google=connected`);
  } catch {
    return NextResponse.redirect(`${base}/?google=error`);
  }
}
```

- [ ] **Step 5: ビルドで検証**

Run: `pnpm -F @acme/web build`
Expected: コンパイル成功（型エラーなし）。

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json apps/web/src/env.ts apps/web/src/app/api/auth/google pnpm-lock.yaml
git commit -m "feat(web): add Google OAuth routes and env vars"
```

---

## Task 11: 接続状態クエリと sync ミューテーション（クライアント）

**Files:**
- Modify: `apps/web/src/features/board/api/queries.ts`
- Modify: `apps/web/src/features/board/api/mutations.ts`

- [ ] **Step 1: queries.ts に接続状態フックを追加**

`useTasks` と同じ `useQuery(trpc.x.queryOptions())` 記法（既存の import をそのまま利用）。ファイル末尾に追記:

```ts
/** Google 接続状態を取得する */
export function useConnectionStatus() {
  const trpc = useTRPC();
  return useQuery(trpc.integration.status.queryOptions());
}
```

- [ ] **Step 2: mutations.ts に sync フックを追加**

ファイル末尾に追記:

```ts
/** 期限の来た外部ソースを同期し、完了後に task 一覧を無効化する */
export function useSync() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.integration.sync.mutationOptions({
      onSettled: () =>
        queryClient.invalidateQueries({ queryKey: trpc.task.all.queryKey() }),
    }),
  );
}
```

- [ ] **Step 3: typecheck**

Run: `pnpm -F @acme/web typecheck`
Expected: エラーなし。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/board/api/queries.ts apps/web/src/features/board/api/mutations.ts
git commit -m "feat(web): add connection status query and sync mutation hooks"
```

---

## Task 12: 表示中ポーリングフック

**Files:**
- Create: `apps/web/src/features/board/hooks/useAutoSync.ts`

- [ ] **Step 1: useAutoSync.ts を作成**

タブが表示されている間だけ 60 秒間隔（＋初回即時）で sync を呼ぶ。非表示・アンマウントで停止。

```ts
"use client";

import { useEffect } from "react";

import { useSync } from "../api/mutations";

/** ポーリング間隔(ms)。実際の取得頻度はサーバー側でソース別に間引かれる。 */
const POLL_INTERVAL_MS = 60_000;

/** タブ表示中のみ外部ソースを定期同期する */
export function useAutoSync() {
  const sync = useSync();

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      sync.mutate(); // 表示開始時に即時1回
      timer = setInterval(() => sync.mutate(), POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };

    onVisibility(); // マウント時の状態に合わせて開始
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
    // sync.mutate は安定参照（TanStack Query）。初回マウントで一度だけ仕掛ける。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
```

- [ ] **Step 2: typecheck / lint**

Run: `pnpm -F @acme/web typecheck && pnpm -F @acme/web lint`
Expected: エラーなし。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/board/hooks/useAutoSync.ts
git commit -m "feat(web): add visibility-aware auto-sync hook"
```

---

## Task 13: 未接続バナーと Board 配線

**Files:**
- Create: `apps/web/src/features/board/components/ConnectBanner.tsx`
- Modify: `apps/web/src/features/board/components/Board.tsx`

- [ ] **Step 1: ConnectBanner.tsx を作成**

```tsx
"use client";

/** Google 未接続時に表示する接続導線バナー */
export function ConnectBanner() {
  return (
    <div className="flex items-center justify-between gap-2 border-b bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <span>
        Google（Calendar / Gmail）が未接続です。接続すると当日の予定と未読メールが表示されます。
      </span>
      <a
        href="/api/auth/google"
        className="border-primary text-primary hover:bg-primary/10 shrink-0 rounded-md border px-3 py-1 font-medium"
      >
        Google を接続
      </a>
    </div>
  );
}
```

- [ ] **Step 2: Board.tsx に配線**

import を追加:

```tsx
import { useConnectionStatus } from "../api/queries";
import { useAutoSync } from "../hooks/useAutoSync";
import { ConnectBanner } from "./ConnectBanner";
```

`Board` 関数の本体冒頭（`const { data: tasks = [] } = useTasks();` の直後）に追加:

```tsx
  useAutoSync();
  const { data: connection } = useConnectionStatus();
```

`return (` 直後の最上位 `<div className="flex h-screen flex-col">` の中、`<header>` の前に未接続バナーを差し込む:

```tsx
      {connection && !connection.connected && <ConnectBanner />}
```

- [ ] **Step 3: typecheck / lint / build**

Run: `pnpm -F @acme/web typecheck && pnpm -F @acme/web lint && pnpm -F @acme/web build`
Expected: すべて成功。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/board/components/ConnectBanner.tsx apps/web/src/features/board/components/Board.tsx
git commit -m "feat(web): wire auto-sync and connect banner into board"
```

---

## Task 14: セットアップ手順と .env.example

**Files:**
- Modify: `.env.example`
- Create: `docs/setup-google.md`

- [ ] **Step 1: .env.example の Google 行を有効化**

`# GOOGLE_CLIENT_ID=''` と `# GOOGLE_CLIENT_SECRET=''` のコメントを外し、リダイレクトURIの注記を添える:

```sh
# --- External integrations -----------------------------------------------
# Google (Calendar / Gmail) — 読み取り専用・最小権限
# OAuth リダイレクトURI: http://localhost:3000/api/auth/google/callback
GOOGLE_CLIENT_ID=''
GOOGLE_CLIENT_SECRET=''
# Slack（後日対応）— search:read のみ
# SLACK_TOKEN=''
```

- [ ] **Step 2: docs/setup-google.md を作成**

```markdown
# Google 連携セットアップ（Calendar / Gmail）

読み取り専用・ローカル完結。

## 手順

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成（既存でも可）。
2. 「APIとサービス」→「ライブラリ」で **Google Calendar API** と **Gmail API** を有効化。
3. 「OAuth 同意画面」を設定（User type は個人なら External）。
   - スコープに `.../auth/calendar.readonly` と `.../auth/gmail.readonly` を追加。
   - 公開ステータスが「テスト」の場合、自分の Google アカウントを「テストユーザー」に追加。
4. 「認証情報」→「認証情報を作成」→「OAuth クライアント ID」。
   - アプリケーションの種類: **ウェブ アプリケーション**
   - 承認済みのリダイレクト URI に次を追加:
     `http://localhost:3000/api/auth/google/callback`
5. 発行された client ID / secret を、リポジトリ直下の `.env` に設定:
   ```
   GOOGLE_CLIENT_ID='...'
   GOOGLE_CLIENT_SECRET='...'
   ```
6. `pnpm dev:next` で起動し、ボード上部の「Google を接続」から認可。

## 注意

- トークンは `~/.my-kanban/credentials.json` にのみ保存され、リポジトリには含まれません。
- 本アプリは Calendar / Gmail を**読み取りのみ**で、書き込み・削除は一切行いません。
```

- [ ] **Step 3: Commit**

```bash
git add .env.example docs/setup-google.md
git commit -m "docs: add Google integration setup guide"
```

---

## Task 15: 手動結合テスト（受け入れ確認）

**Files:** なし（実機確認）

- [ ] **Step 1: 環境準備**

`.env` に有効な `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` が設定され、Google Cloud にリダイレクトURIが登録済みであることを確認。`nvm use` 済みであること。

- [ ] **Step 2: 起動と接続**

Run: `pnpm dev:next`
操作: ブラウザで http://localhost:3000 を開く → 未接続バナーが出る → 「Google を接続」→ 同意 → `/` に戻る。
Expected: バナーが消える（`integration.status.connected === true`）。

- [ ] **Step 3: 取り込み確認**

操作: 数十秒待つ（または再読込）。
Expected:
- 当日の Calendar 予定が Schedule に時刻どおり表示される。
- 未読 Gmail が Todo に積まれる。

- [ ] **Step 4: レーン保護確認**

操作: 取り込まれたカードを別レーン（例: In Progress）へ移動 → 1〜2分待って再同期させる。
Expected: カードが元レーンに戻らない（lane が保護される）。

- [ ] **Step 5: 読み取り専用確認**

操作: Google Calendar / Gmail 側を確認。
Expected: アプリ操作によって予定やメールが変更・削除されていない。

- [ ] **Step 6: 非表示停止の確認（任意）**

操作: タブを非アクティブにし、しばらく放置。
Expected: 非表示中は sync が走らない（ネットワークタブやログで確認）。

---

## 完了条件

- すべての単体テスト（integrations / api）が通る。
- `pnpm -F @acme/web build` が成功する。
- Task 15 の手動確認をすべて満たす。
- 外部 API への書き込みが一切発生しない。
