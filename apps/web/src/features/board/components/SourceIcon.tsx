import Image from "next/image";

import type { Source } from "@acme/db/schema";

import { SOURCE_ICON } from "../configs/board";

interface Props {
  source: Source;
  size?: number;
}

/** ソース種別アイコン（外部ソースは SVG）。アイコンを持たないソースは何も描画しない */
export function SourceIcon({ source, size = 16 }: Props) {
  const icon = SOURCE_ICON[source];

  if (icon.src) {
    return (
      <Image
        src={icon.src}
        alt={icon.label}
        width={size}
        height={size}
        className="shrink-0"
      />
    );
  }

  if (icon.emoji) {
    return (
      <span className="shrink-0" aria-label={icon.label}>
        {icon.emoji}
      </span>
    );
  }

  return null;
}
