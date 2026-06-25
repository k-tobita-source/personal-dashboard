/** ドロワー上下ボタンのナビゲーション状態 */
export interface DrawerNavState {
  canPrev: boolean;
  canNext: boolean;
  /** 「前」へ移動する先の id（不可なら null） */
  prevId: string | null;
  /** 「次」へ移動する先の id（不可なら null） */
  nextId: string | null;
  /** 「前」へ移動した後に記憶すべき基準位置 */
  prevIndex: number;
  /** 「次」へ移動した後に記憶すべき基準位置 */
  nextIndex: number;
}

/**
 * ドロワーの上下ボタンのナビゲーション状態を求める純粋関数。
 *
 * 上下ボタンは「ドロワーを開いた時点のレーン(navList)」を対象に前後移動する。
 * 主用途は Todo を上から確認してステータスを変える操作で、ステータス変更により
 * 選択タスクが navList から外れても、記憶した基準位置(anchorIndex)を頼りに
 * 残りの Todo を上から処理し続けられるようにする。
 *
 * - 選択タスクが navList に残っている → その実位置を基準に前後へ。
 * - 選択タスクが navList から外れた → anchorIndex に繰り上がってきた次タスクを
 *   「次」、anchorIndex-1 を「前」とする（離脱直後でも自然に隣へ進める）。
 */
export function resolveDrawerNav(
  navList: string[],
  selectedId: string | null,
  anchorIndex: number,
): DrawerNavState {
  const at = (index: number): string | null => navList[index] ?? null;

  const inLaneIndex = selectedId ? navList.indexOf(selectedId) : -1;

  // 選択タスクがレーンに残っている通常ケース
  if (inLaneIndex >= 0) {
    const prevIndex = inLaneIndex - 1;
    const nextIndex = inLaneIndex + 1;
    const canPrev = prevIndex >= 0;
    const canNext = nextIndex < navList.length;
    return {
      canPrev,
      canNext,
      prevId: canPrev ? at(prevIndex) : null,
      nextId: canNext ? at(nextIndex) : null,
      prevIndex: canPrev ? prevIndex : inLaneIndex,
      nextIndex: canNext ? nextIndex : inLaneIndex,
    };
  }

  // 選択タスクが navList を離れた（ステータス変更直後など）。
  // anchorIndex の位置には離脱で繰り上がった次タスクが入っている。
  const prevIndex = anchorIndex - 1;
  const nextIndex = anchorIndex;
  const canPrev = prevIndex >= 0 && prevIndex < navList.length;
  const canNext = nextIndex >= 0 && nextIndex < navList.length;
  return {
    canPrev,
    canNext,
    prevId: canPrev ? at(prevIndex) : null,
    nextId: canNext ? at(nextIndex) : null,
    prevIndex: canPrev ? prevIndex : anchorIndex,
    nextIndex: canNext ? nextIndex : anchorIndex,
  };
}
