import { index, sqliteTable, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/** ソース種別（アイコン・取り扱いの分岐に使用） */
export const SOURCES = ["calendar", "slack", "gmail", "todo"] as const;
export type Source = (typeof SOURCES)[number];

/** 所属カラム＝状態の単一ソース */
export const LANES = ["inbox", "schedule", "in_progress", "done"] as const;
export type Lane = (typeof LANES)[number];

/**
 * task: 4カラム（受信箱 / Schedule / In Progress / Done）に並ぶ各項目。
 * UI ではこれを「カード」として描画する。
 * 詳細は docs/data-model.md を参照。
 */
export const Task = sqliteTable(
  "task",
  (t) => ({
    id: t
      .text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    source: t.text({ enum: SOURCES }).notNull(),
    lane: t.text({ enum: LANES }).notNull(),
    title: t.text().notNull(),
    /** 本文プレビュー（Slack冒頭 / Gmail抜粋） */
    body: t.text(),
    /** 送信者（Slack / Gmail） */
    sender: t.text(),
    /** 投稿者アバター画像URL（Slack のみ。users.info の image_72） */
    avatarUrl: t.text(),
    /** 元ソースへのリンク */
    url: t.text(),
    /** 外部実体の一意キー（ポーリングdedup用）。独自ToDoは NULL */
    externalId: t.text(),
    /** 開始時刻（Scheduleのタイムライン配置に使用）。受信箱の項目は NULL */
    startAt: t.integer({ mode: "timestamp_ms" }),
    /** 終了時刻（予定の長さ表現用） */
    endAt: t.integer({ mode: "timestamp_ms" }),
    /** カラム内の並び順（前後の中間値を入れる方式） */
    position: t.real().notNull().default(0),
    createdAt: t
      .integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: t
      .integer({ mode: "timestamp_ms" })
      .$onUpdateFn(() => new Date()),
  }),
  (table) => [
    // 外部実体の重複取り込み防止（UPSERTキー）。external_id が NULL の独自ToDoは対象外
    uniqueIndex("task_source_external_id_unq").on(
      table.source,
      table.externalId,
    ),
    // カラム表示時の取得・並び替え
    index("task_lane_position_idx").on(table.lane, table.position),
    // Scheduleタイムラインの時刻順取得
    index("task_start_at_idx").on(table.startAt),
  ],
);

/** task の 1 行（select）型。サービス出力・カードビューの基盤として共有する */
export type TaskRow = typeof Task.$inferSelect;

export const CreateTaskSchema = createInsertSchema(Task, {
  title: z.string().min(1).max(512),
  source: z.enum(SOURCES),
  lane: z.enum(LANES),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

/**
 * sync_state: ソース別の最終同期時刻。クライアントは一定間隔で sync を呼ぶが、
 * 実際の取得頻度は lastSyncedAt + ソース別間隔でサーバーが判定する。
 */
export const SyncState = sqliteTable("sync_state", (t) => ({
  source: t.text().primaryKey(),
  lastSyncedAt: t.integer({ mode: "timestamp_ms" }),
}));
