/** 連携ソース */
export type IntegrationSource = "calendar" | "gmail" | "slack";

/** 外部ソースを共通のカード形へ正規化した中間表現 */
export interface NormalizedItem {
  source: IntegrationSource;
  /** 外部実体の一意キー（(source, externalId) で dedup） */
  externalId: string;
  title: string;
  body?: string;
  sender?: string;
  /** 投稿者アバター画像URL（Slack のみ） */
  avatarUrl?: string;
  url?: string;
  startAt?: Date;
  endAt?: Date;
  /** 新規取り込み時の既定レーン */
  defaultLane: "schedule" | "inbox";
}
