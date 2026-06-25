"use client";

import { useState } from "react";

interface Props {
  src: string | null;
  name: string;
  size?: number;
}

/** Slack 投稿者アバター。URL 無し / 読み込み失敗時は頭文字の四角にフォールバックする。 */
export function SlackAvatar({ src, name, size = 32 }: Props) {
  const [failed, setFailed] = useState(false);
  // 先頭1文字（絵文字などサロゲートペアも1文字として扱う）
  const initial = ([...name.trim()][0] ?? "?").toUpperCase();

  if (!src || failed) {
    return (
      <span
        className="bg-muted text-muted-foreground flex shrink-0 items-center justify-center rounded-[6px] text-xs font-medium"
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
      className="shrink-0 rounded-[6px] object-cover"
      style={{ width: size, height: size }}
    />
  );
}
