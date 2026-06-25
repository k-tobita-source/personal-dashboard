/**
 * 並び替え後の position を、前後の要素の position から算出する。
 * position は real（中間値方式）。前後が無い端は ±1 する。
 */
export function positionBetween(
  before: number | null,
  after: number | null,
): number {
  if (before !== null && after !== null) return (before + after) / 2;
  if (after !== null) return after - 1; // before が null（先頭へ）
  if (before !== null) return before + 1; // after が null（末尾へ）
  return 1; // 両隣なし（空カラム）
}
