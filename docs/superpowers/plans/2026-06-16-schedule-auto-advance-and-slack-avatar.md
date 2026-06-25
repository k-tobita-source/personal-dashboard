# スケジュール自動レーン移動 & Slack カードUI改修 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Schedule タスクを時刻経過に応じて自動でレーン移動し、Slack カードに投稿者アバター画像＋名前＋チャンネル名を表示する。

**Architecture:** Part A はクライアント定期判定。純粋関数 `selectAutoMoves` が移動指示を算出し、`useAutoAdvance` フックが `useNow`（1分tick）に合わせて既存の楽観的 move ミューテーションへ発火する。Part B は `task.avatarUrl` 列を追加し、Slack 取得時に `users.info` でアバターURLを解決して保存、`TaskCardView` が Slack 専用レイアウトで描画する。

**Tech Stack:** React 19 + React Compiler / TanStack Query + tRPC / dnd-kit / Drizzle + better-sqlite3 / @slack/web-api / Vitest。

**前提:** 作業前に `nvm use`（Node 22 系）。品質チェックは `pnpm typecheck` / `pnpm lint` / `pnpm -F @acme/web build`。

---

## ファイル構成

**Part A（web のみ・DB変更なし）**
- Create: `apps/web/src/features/board/utils/autoAdvance.ts` — 移動指示を算出する純粋関数
- Create: `apps/web/src/features/board/utils/autoAdvance.test.ts` — 上記のテスト
- Create: `apps/web/src/features/board/hooks/useNow.ts` — 定期更新する現在時刻
- Create: `apps/web/src/features/board/hooks/useAutoAdvance.ts` — tick ごとに move を発火
- Modify: `apps/web/src/features/board/components/Board.tsx` — now を useNow に置換し useAutoAdvance を配線
- Modify: `apps/web/src/features/board/components/ScheduleColumn.tsx` — 初回のみセンタリング

**Part B（DB + integrations + api + web）**
- Modify: `packages/db/src/schema.ts` — `avatarUrl` 列追加
- Modify: `packages/integrations/src/types.ts` — `NormalizedItem.avatarUrl`
- Modify: `packages/integrations/src/slack/client.ts` — `getUserAvatars` 追加 + 2パス化
- Modify: `packages/integrations/src/slack/client.test.ts` — `getUserAvatars` テスト
- Modify: `packages/api/src/service/syncService.ts` — `avatarUrl` を upsert に反映
- Create: `apps/web/src/features/board/components/SlackAvatar.tsx` — アバター（失敗時イニシャル）
- Modify: `apps/web/src/features/board/components/TaskCard.tsx` — Slack 専用レイアウト

---

## Part A: スケジュール自動レーン移動

### Task A1: 移動指示を算出する純粋関数 `selectAutoMoves`

**Files:**
- Create: `apps/web/src/features/board/utils/autoAdvance.ts`
- Test: `apps/web/src/features/board/utils/autoAdvance.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/features/board/utils/autoAdvance.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { AutoAdvanceTask } from "./autoAdvance";
import { selectAutoMoves } from "./autoAdvance";

const now = new Date(2026, 5, 16, 12, 0); // 2026-06-16 12:00

function task(overrides: Partial<AutoAdvanceTask>): AutoAdvanceTask {
  return {
    id: "t",
    source: "todo",
    lane: "schedule",
    startAt: null,
    endAt: null,
    ...overrides,
  };
}

describe("selectAutoMoves", () => {
  it("schedule で開始到達したタスクは in_progress へ（source 問わず）", () => {
    const todo = task({ id: "a", source: "todo", startAt: new Date(2026, 5, 16, 11, 0) });
    const cal = task({ id: "b", source: "calendar", startAt: new Date(2026, 5, 16, 11, 0), endAt: new Date(2026, 5, 16, 13, 0) });
    expect(selectAutoMoves([todo, cal], now)).toEqual([
      { id: "a", lane: "in_progress" },
      { id: "b", lane: "in_progress" },
    ]);
  });

  it("開始未到来のタスクは移動しない", () => {
    const future = task({ id: "a", startAt: new Date(2026, 5, 16, 13, 0) });
    expect(selectAutoMoves([future], now)).toEqual([]);
  });

  it("終了超過の calendar は done へ（schedule からも in_progress からも）", () => {
    const inSchedule = task({ id: "a", source: "calendar", lane: "schedule", startAt: new Date(2026, 5, 16, 9, 0), endAt: new Date(2026, 5, 16, 10, 0) });
    const inProgress = task({ id: "b", source: "calendar", lane: "in_progress", startAt: new Date(2026, 5, 15, 9, 0), endAt: new Date(2026, 5, 15, 10, 0) });
    expect(selectAutoMoves([inSchedule, inProgress], now)).toEqual([
      { id: "a", lane: "done" },
      { id: "b", lane: "done" },
    ]);
  });

  it("開始も終了も過ぎた calendar は in_progress を経ず done を優先", () => {
    const cal = task({ id: "a", source: "calendar", lane: "schedule", startAt: new Date(2026, 5, 16, 9, 0), endAt: new Date(2026, 5, 16, 10, 0) });
    expect(selectAutoMoves([cal], now)).toEqual([{ id: "a", lane: "done" }]);
  });

  it("終了超過でも todo は done にしない（schedule なら開始到達で in_progress）", () => {
    const todo = task({ id: "a", source: "todo", lane: "schedule", startAt: new Date(2026, 5, 16, 9, 0), endAt: new Date(2026, 5, 16, 10, 0) });
    expect(selectAutoMoves([todo], now)).toEqual([{ id: "a", lane: "in_progress" }]);
  });

  it("done / inbox のタスクは対象外", () => {
    const done = task({ id: "a", lane: "done", startAt: new Date(2026, 5, 16, 9, 0) });
    const inbox = task({ id: "b", lane: "inbox", startAt: new Date(2026, 5, 16, 9, 0) });
    expect(selectAutoMoves([done, inbox], now)).toEqual([]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm -F @acme/web exec vitest run src/features/board/utils/autoAdvance.test.ts`
Expected: FAIL（`autoAdvance.ts` が存在しない / `selectAutoMoves is not a function`）

- [ ] **Step 3: 最小実装を書く**

`apps/web/src/features/board/utils/autoAdvance.ts`:

```ts
import type { Lane } from "@acme/db/schema";

import type { Task } from "../types/task";

/** 自動移動の判定に必要な最小フィールド */
export type AutoAdvanceTask = Pick<
  Task,
  "id" | "source" | "lane" | "startAt" | "endAt"
>;

/** 自動移動の指示 */
export interface AutoMove {
  id: string;
  lane: Extract<Lane, "in_progress" | "done">;
}

/**
 * 時刻経過に応じた自動レーン移動の指示を算出する。
 * 1 タスクにつき Done を先に評価し、いずれか 1 つだけ返す。
 * - calendar かつ endAt < now（schedule / in_progress に居る）→ done
 * - 上記以外で schedule かつ startAt <= now → in_progress
 */
export function selectAutoMoves(
  tasks: AutoAdvanceTask[],
  now: Date,
): AutoMove[] {
  const t = now.getTime();
  const moves: AutoMove[] = [];
  for (const task of tasks) {
    if (
      task.source === "calendar" &&
      task.endAt &&
      task.endAt.getTime() < t &&
      (task.lane === "schedule" || task.lane === "in_progress")
    ) {
      moves.push({ id: task.id, lane: "done" });
      continue;
    }
    if (task.lane === "schedule" && task.startAt && task.startAt.getTime() <= t) {
      moves.push({ id: task.id, lane: "in_progress" });
    }
  }
  return moves;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm -F @acme/web exec vitest run src/features/board/utils/autoAdvance.test.ts`
Expected: PASS（6 件）

- [ ] **Step 5: コミット**

```bash
git add apps/web/src/features/board/utils/autoAdvance.ts apps/web/src/features/board/utils/autoAdvance.test.ts
git commit -m "feat(board): add selectAutoMoves for time-based lane auto-advance"
```

---

### Task A2: `useNow` フック（1分間隔の現在時刻）

**Files:**
- Create: `apps/web/src/features/board/hooks/useNow.ts`

- [ ] **Step 1: 実装を書く**

時刻ベースのフックで、純粋ロジックは Task A1 でテスト済みのため、ここではフックを実装する。

`apps/web/src/features/board/hooks/useNow.ts`:

```ts
"use client";

import { useEffect, useState } from "react";

/** 一定間隔で更新される現在時刻。Schedule の現在時刻ライン・自動移動の基準に使う。 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
```

- [ ] **Step 2: 型チェック**

Run: `pnpm -F @acme/web typecheck`
Expected: エラー無し（未使用 export の警告のみ許容、次タスクで使用）

- [ ] **Step 3: コミット**

```bash
git add apps/web/src/features/board/hooks/useNow.ts
git commit -m "feat(board): add useNow hook ticking every minute"
```

---

### Task A3: `useAutoAdvance` フック（tick ごとに move を発火）

**Files:**
- Create: `apps/web/src/features/board/hooks/useAutoAdvance.ts`

- [ ] **Step 1: 実装を書く**

`apps/web/src/features/board/hooks/useAutoAdvance.ts`:

```ts
"use client";

import { useEffect, useRef } from "react";

import type { Lane } from "@acme/db/schema";

import type { Task } from "../types/task";
import { selectAutoMoves } from "../utils/autoAdvance";

/**
 * now の更新ごとに自動レーン移動を判定し、該当タスクへ move を発火する。
 * 楽観的更新で lane は即時に書き換わるが、invalidate 確定までの多重発火を
 * firedRef で防ぐ（対象から外れたキーは解除する）。
 */
export function useAutoAdvance({
  tasks,
  now,
  onMove,
}: {
  tasks: Task[];
  now: Date;
  onMove: (args: { id: string; lane: Lane }) => void;
}) {
  const firedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const moves = selectAutoMoves(tasks, now);
    const fired = firedRef.current;
    const activeKeys = new Set(moves.map((m) => `${m.id}:${m.lane}`));
    for (const key of fired) {
      if (!activeKeys.has(key)) fired.delete(key);
    }
    for (const m of moves) {
      const key = `${m.id}:${m.lane}`;
      if (fired.has(key)) continue;
      fired.add(key);
      onMove({ id: m.id, lane: m.lane });
    }
  }, [tasks, now, onMove]);
}
```

- [ ] **Step 2: 型チェック**

Run: `pnpm -F @acme/web typecheck`
Expected: エラー無し

- [ ] **Step 3: コミット**

```bash
git add apps/web/src/features/board/hooks/useAutoAdvance.ts
git commit -m "feat(board): add useAutoAdvance hook dispatching auto-moves"
```

---

### Task A4: Board に配線（now を useNow へ置換 + useAutoAdvance）

**Files:**
- Modify: `apps/web/src/features/board/components/Board.tsx`

- [ ] **Step 1: import を追加**

`apps/web/src/features/board/components/Board.tsx` の hooks import 群（`useAutoSync` 付近, 15-16 行目あたり）に追加:

```ts
import { useAutoAdvance } from "../hooks/useAutoAdvance";
import { useNow } from "../hooks/useNow";
```

- [ ] **Step 2: now をライブ更新へ置換**

現状（[Board.tsx:78-79](apps/web/src/features/board/components/Board.tsx#L78-L79)）:

```ts
  // 現在時刻ラインの基準。マウント時に固定（必要になれば定期更新を検討）
  const now = useMemo(() => new Date(), []);
```

を次に置換:

```ts
  // 現在時刻ラインの基準。1分ごとに更新し、自動レーン移動の判定にも使う。
  const now = useNow();
```

- [ ] **Step 3: useAutoAdvance を配線**

`const now = useNow();` の直後に追加:

```ts
  // 時刻経過に応じた自動レーン移動（開始到達→In Progress / カレンダー終了超過→Done）
  useAutoAdvance({ tasks, now, onMove: (args) => move.mutate(args) });
```

- [ ] **Step 4: 未使用になった useMemo import を確認**

`useMemo` は他でも使用中（groups, tasksById, laneOrder）のため import は残す。`react` の import 行は変更不要。

- [ ] **Step 5: 型チェック・lint**

Run: `pnpm -F @acme/web typecheck && pnpm -F @acme/web lint`
Expected: エラー無し

- [ ] **Step 6: コミット**

```bash
git add apps/web/src/features/board/components/Board.tsx
git commit -m "feat(board): wire live now and auto-advance into Board"
```

---

### Task A5: ScheduleColumn を初回のみセンタリングに変更

**Files:**
- Modify: `apps/web/src/features/board/components/ScheduleColumn.tsx`

- [ ] **Step 1: 初回センタリングガードを追加**

現状（[ScheduleColumn.tsx:38-44](apps/web/src/features/board/components/ScheduleColumn.tsx#L38-L44)）:

```ts
  // 初期表示時、現在時刻ラインが縦中央に来るようスクロールする
  const scrollerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = nowTop - el.clientHeight / 2;
  }, [nowTop]);
```

を次に置換（now が毎分更新されても再センタリングしないよう初回のみ実行）:

```ts
  // 初期表示時のみ、現在時刻ラインが縦中央に来るようスクロールする。
  // now は毎分更新されるため、didCenter で初回だけに限定する。
  const scrollerRef = useRef<HTMLDivElement>(null);
  const didCenter = useRef(false);
  useEffect(() => {
    if (didCenter.current) return;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = nowTop - el.clientHeight / 2;
    didCenter.current = true;
  }, [nowTop]);
```

- [ ] **Step 2: 型チェック・lint**

Run: `pnpm -F @acme/web typecheck && pnpm -F @acme/web lint`
Expected: エラー無し

- [ ] **Step 3: コミット**

```bash
git add apps/web/src/features/board/components/ScheduleColumn.tsx
git commit -m "fix(board): center schedule timeline only on first mount"
```

---

## Part B: Slack カードUI（アバター画像 + 名前 + チャンネル名）

### Task B1: schema に `avatarUrl` 列を追加 + マイグレーション

**Files:**
- Modify: `packages/db/src/schema.ts`

- [ ] **Step 1: `avatarUrl` 列を追加**

`packages/db/src/schema.ts` の `sender` 列定義（[schema.ts:30-31](packages/db/src/schema.ts#L30-L31)）の直後に追加:

```ts
    /** 送信者（Slack / Gmail） */
    sender: t.text(),
    /** 投稿者アバター画像URL（Slack のみ。users.info の image_72） */
    avatarUrl: t.text(),
```

- [ ] **Step 2: マイグレーションを生成**

Run: `pnpm -F @acme/db generate`
Expected: `packages/db/src/migrations/` 配下に新しい `.sql`（`ALTER TABLE task ADD avatar_url ...` 相当）が生成される

- [ ] **Step 3: マイグレーションを適用**

Run: `pnpm -F @acme/db migrate`
Expected: エラー無く適用完了（`~/.my-kanban/kanban.db` に列追加）

- [ ] **Step 4: コミット**

```bash
git add packages/db/src/schema.ts packages/db/src/migrations
git commit -m "feat(db): add avatarUrl column to task"
```

---

### Task B2: NormalizedItem に `avatarUrl` を追加

**Files:**
- Modify: `packages/integrations/src/types.ts`

- [ ] **Step 1: フィールドを追加**

`packages/integrations/src/types.ts` の `sender?: string;`（[types.ts:11](packages/integrations/src/types.ts#L11)）の直後に追加:

```ts
  sender?: string;
  /** 投稿者アバター画像URL（Slack のみ） */
  avatarUrl?: string;
```

- [ ] **Step 2: 型チェック**

Run: `pnpm -F @acme/integrations typecheck`
Expected: エラー無し

- [ ] **Step 3: コミット**

```bash
git add packages/integrations/src/types.ts
git commit -m "feat(integrations): add avatarUrl to NormalizedItem"
```

---

### Task B3: Slack 取得で `users.info` からアバターを解決

**Files:**
- Modify: `packages/integrations/src/slack/client.ts`
- Test: `packages/integrations/src/slack/client.test.ts`

- [ ] **Step 1: `getUserAvatars` の失敗するテストを書く**

`packages/integrations/src/slack/client.test.ts` の import 行に `getUserAvatars` を追加:

```ts
import { getUserAvatars, humanizeSlackText, normalizeSlackMessage } from "./client";
```

ファイル末尾に describe を追加:

```ts
describe("getUserAvatars", () => {
  it("users.info から image_72 を解決し、失敗したユーザーは除外する", async () => {
    const client = {
      users: {
        info: ({ user }: { user: string }) =>
          user === "U1"
            ? Promise.resolve({ user: { profile: { image_72: "https://img/u1.png" } } })
            : Promise.reject(new Error("user_not_found")),
      },
    } as unknown as import("@slack/web-api").WebClient;

    const map = await getUserAvatars(client, new Set(["U1", "U2"]));
    expect(map.get("U1")).toBe("https://img/u1.png");
    expect(map.has("U2")).toBe(false);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm -F @acme/integrations exec vitest run src/slack/client.test.ts`
Expected: FAIL（`getUserAvatars` が export されていない）

- [ ] **Step 3: `getUserAvatars` を実装し、fetch を 2 パス化**

`packages/integrations/src/slack/client.ts` に `getMyUsergroupHandles` の後あたり（fetch 関数の前）へ追加:

```ts
/** ユーザーID集合に対し users.info でアバターURL(image_72)を解決する（失敗は無視） */
export async function getUserAvatars(
  client: WebClient,
  userIds: Set<string>,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  await Promise.all(
    [...userIds].map(async (user) => {
      try {
        const res = await client.users.info({ user });
        const url = res.user?.profile?.image_72;
        if (url) map.set(user, url);
      } catch {
        // 取得失敗はアバター無しで続行
      }
    }),
  );
  return map;
}
```

次に `fetchSlackMentionsAndDms` の末尾、現状（[client.ts:149-171](packages/integrations/src/slack/client.ts#L149-L171)）:

```ts
  const seen = new Set<string>();
  const items: NormalizedItem[] = [];
  const push = (match: SlackMatch) => {
    const item = normalizeSlackMessage(match);
    if (!item || seen.has(item.externalId)) return;
    seen.add(item.externalId);
    items.push(item);
  };

  // チャンネル系: 参加しているチャンネルのメッセージだけ採用
  for (const query of channelQueries) {
    for (const match of await searchMatches(client, query)) {
      const channelId = match.channel?.id;
      if (!channelId || !memberChannels.has(channelId)) continue;
      push(match);
    }
  }
  // DM: 全件
  for (const match of await searchMatches(client, dmQuery)) {
    push(match);
  }

  return items;
}
```

を次に置換（採用 match を集め→ユニークユーザーのアバターを解決→付与）:

```ts
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

  // 採用 match のユニークユーザーのアバターを解決して付与する
  const userIds = new Set<string>();
  for (const c of collected) if (c.user) userIds.add(c.user);
  const avatars = await getUserAvatars(client, userIds);

  return collected.map(({ item, user }) => {
    const avatarUrl = user ? avatars.get(user) : undefined;
    return avatarUrl ? { ...item, avatarUrl } : item;
  });
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm -F @acme/integrations exec vitest run src/slack/client.test.ts`
Expected: PASS（既存の normalize / humanize テスト + getUserAvatars）

- [ ] **Step 5: コミット**

```bash
git add packages/integrations/src/slack/client.ts packages/integrations/src/slack/client.test.ts
git commit -m "feat(integrations): resolve Slack avatar URLs via users.info"
```

---

### Task B4: syncService で `avatarUrl` を upsert に反映

**Files:**
- Modify: `packages/api/src/service/syncService.ts`

- [ ] **Step 1: `UpdateValues` に `avatarUrl` を追加**

現状（[syncService.ts:21-29](packages/api/src/service/syncService.ts#L21-L29)）の `UpdateValues` に追加:

```ts
export interface UpdateValues {
  title: string;
  body: string | null;
  sender: string | null;
  avatarUrl: string | null;
  url: string | null;
  startAt?: Date | null;
  endAt?: Date | null;
}
```

- [ ] **Step 2: `buildUpdateValues` の base に `avatarUrl` を追加**

現状（[syncService.ts:32-38](packages/api/src/service/syncService.ts#L32-L38)）の `base` に追加:

```ts
  const base: UpdateValues = {
    title: item.title,
    body: item.body ?? null,
    sender: item.sender ?? null,
    avatarUrl: item.avatarUrl ?? null,
    url: item.url ?? null,
  };
```

- [ ] **Step 3: `upsertItem` の insert に `avatarUrl` を追加**

現状（[syncService.ts:117-128](packages/api/src/service/syncService.ts#L117-L128)）の insert values に追加:

```ts
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
```

- [ ] **Step 4: 型チェック・既存テスト**

Run: `pnpm -F @acme/api typecheck && pnpm -F @acme/api exec vitest run src/service/syncService.test.ts`
Expected: エラー無し / 既存テスト PASS（`buildUpdateValues` を検証するテストがあれば `avatarUrl: null` を含む期待値に更新する。差分が出たらテスト側の期待値へ `avatarUrl: null` を追記）

- [ ] **Step 5: コミット**

```bash
git add packages/api/src/service/syncService.ts packages/api/src/service/syncService.test.ts
git commit -m "feat(api): persist avatarUrl on task upsert"
```

---

### Task B5: SlackAvatar コンポーネント + TaskCardView の Slack レイアウト

**Files:**
- Create: `apps/web/src/features/board/components/SlackAvatar.tsx`
- Modify: `apps/web/src/features/board/components/TaskCard.tsx`

- [ ] **Step 1: SlackAvatar を作成**

`apps/web/src/features/board/components/SlackAvatar.tsx`:

```tsx
"use client";

import { useState } from "react";

interface Props {
  src: string | null;
  name: string;
  size?: number;
}

/** Slack 投稿者アバター。URL 無し / 読み込み失敗時は頭文字の丸にフォールバックする。 */
export function SlackAvatar({ src, name, size = 28 }: Props) {
  const [failed, setFailed] = useState(false);
  const initial = name.trim().charAt(0).toUpperCase() || "?";

  if (!src || failed) {
    return (
      <span
        className="bg-muted text-muted-foreground flex shrink-0 items-center justify-center rounded-full text-xs font-medium"
        style={{ width: size, height: size }}
        aria-hidden
      >
        {initial}
      </span>
    );
  }

  return (
    // Slack アバターは外部ドメイン（avatars.slack-edge.com 等）かつ onError フォールバックが
    // 必要なため next/image ではなく img を使う。
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className="shrink-0 rounded-full object-cover"
      style={{ width: size, height: size }}
    />
  );
}
```

- [ ] **Step 2: TaskCardView を Slack 分岐に対応**

`apps/web/src/features/board/components/TaskCard.tsx`。import に追加:

```ts
import { SlackAvatar } from "./SlackAvatar";
import { SourceIcon } from "./SourceIcon";
```

`TaskCardView` 本体（現状 [TaskCard.tsx:19-53](apps/web/src/features/board/components/TaskCard.tsx#L19-L53)）を次に置換:

```tsx
/** カードの見た目だけを担う Presentational コンポーネント */
export function TaskCardView({ task, dragging }: ViewProps) {
  const isSlack = task.source === "slack";
  // Slack は投稿者名を別表示するので本文は body のみ。他は従来の "送信者: 本文"。
  const preview = isSlack
    ? task.body
    : task.sender
      ? `${task.sender}: ${task.body ?? ""}`
      : task.body;
  // Slack: アバター右に名前(sender)、その下にチャンネル名(title)。
  const name = task.sender ?? task.title;
  const showChannel = task.title !== name;

  return (
    <div
      className={cn(
        "bg-card rounded-[4px] border p-2 text-sm",
        dragging && "ring-primary rotate-1 ring-2",
      )}
    >
      {isSlack ? (
        <div className="flex items-start gap-2">
          <SlackAvatar src={task.avatarUrl ?? null} name={name} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-normal">{name}</div>
            {showChannel && (
              <div className="text-muted-foreground flex items-center gap-1 text-xs">
                <SourceIcon source="slack" size={12} />
                <span className="truncate">{task.title}</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 font-normal">
          <SourceIcon source={task.source} />
          <span className="truncate">{task.title}</span>
        </div>
      )}
      {preview && (
        <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
          {preview}
        </p>
      )}
      {task.url && (
        <a
          href={task.url}
          target="_blank"
          rel="noreferrer"
          onPointerDown={(e) => e.stopPropagation()}
          className="text-primary mt-1 inline-block text-xs underline"
        >
          開く ↗
        </a>
      )}
    </div>
  );
}
```

注: 既存の `import { SourceIcon } from "./SourceIcon";`（[TaskCard.tsx:10](apps/web/src/features/board/components/TaskCard.tsx#L10)）が既にある場合は二重 import しないこと（追加するのは `SlackAvatar` のみ）。

- [ ] **Step 3: 型チェック・lint**

Run: `pnpm -F @acme/web typecheck && pnpm -F @acme/web lint`
Expected: エラー無し（`task.avatarUrl` は Task B1 のスキーマ変更で型に存在する）

- [ ] **Step 4: コミット**

```bash
git add apps/web/src/features/board/components/SlackAvatar.tsx apps/web/src/features/board/components/TaskCard.tsx
git commit -m "feat(board): show Slack avatar, name and channel on cards"
```

---

## 最終検証

- [ ] **Step 1: 全テスト**

Run: `pnpm -F @acme/web test && pnpm -F @acme/integrations test && pnpm -F @acme/api test`
Expected: 全 PASS

- [ ] **Step 2: 品質チェック一式**

Run: `pnpm typecheck && pnpm lint && pnpm -F @acme/web build`
Expected: エラー無し

- [ ] **Step 3: 手動確認（dev 起動）**

Run: `pnpm dev:next` → http://localhost:3000
確認項目:
- Schedule の現在時刻ラインが毎分動く（初回は中央表示、以後は再センタリングされない）
- 開始時刻を過ぎた Schedule タスクが In Progress へ移動する
- 終了時刻を過ぎた Google カレンダー予定が Done へ移動する（独自 ToDo は移動しない）
- Slack カードに投稿者アバター＋名前＋チャンネル名が表示される（アバター取得失敗時はイニシャル丸）
- ※ Slack アバター表示には Slack App に `users:read` スコープが必要（ユーザー側で設定）

---

## スコープ外（YAGNI）

- アバター URL のキャッシュ／TTL 管理（毎ポーリング解決で十分）。
- 自動移動のサーバー側実装・MCP 連携。
- イニシャル以外の凝った欠損表示。
