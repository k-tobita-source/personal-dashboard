import type { TaskRow } from "@pdash/db/schema";

/** body プレビューの最大文字数 */
const BODY_PREVIEW_LEN = 200;

/** Task 行を Claude 向けのコンパクトなカードビューへ変換（Date → ISO 文字列） */
export function toCardView(task: TaskRow) {
  return {
    id: task.id,
    lane: task.lane,
    source: task.source,
    title: task.title,
    body: task.body ? task.body.slice(0, BODY_PREVIEW_LEN) : null,
    startAt: task.startAt ? task.startAt.toISOString() : null,
    endAt: task.endAt ? task.endAt.toISOString() : null,
  };
}

/** ISO 文字列を Date へ。zod のバージョン差異を避けるためここで妥当性検証する */
function toDate(iso: string): Date {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid date: ${iso}`);
  return d;
}

/** 任意日時: undefined はそのまま、文字列は Date（add_task 等） */
export function parseDate(iso: string | undefined): Date | undefined {
  return iso === undefined ? undefined : toDate(iso);
}

/** 三値日時: undefined=据え置き / null=クリア / ISO=設定（move / update） */
export function parseNullableDate(
  iso: string | null | undefined,
): Date | null | undefined {
  if (iso === undefined) return undefined;
  if (iso === null) return null;
  return toDate(iso);
}
