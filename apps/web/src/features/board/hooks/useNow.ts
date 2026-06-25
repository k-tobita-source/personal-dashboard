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
