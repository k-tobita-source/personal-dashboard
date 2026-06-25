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
