"use client";

import { ExternalLink } from "lucide-react";

import { UTILITIES } from "@/lib/domain";

// 各社の料金ページ（明細確認・CSVダウンロードの入口）。
const LINKS = [
  { utility: "electricity" as const, label: "電気（TEPCO）", url: "https://epauth.tepco.co.jp/u/login" },
  { utility: "gas" as const, label: "ガス（LPIO）", url: "https://my-lpg.net/customers/login" },
  { utility: "water" as const, label: "水道（東京都水道局）", url: "https://www.suidoapp.waterworks.metro.tokyo.lg.jp/#/login" },
];

export function ProviderLinks() {
  return (
    <div className="flex flex-wrap gap-2">
      {LINKS.map((l) => (
        <a
          key={l.utility}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
        >
          <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: UTILITIES[l.utility].color }} />
          {l.label}
          <ExternalLink className="size-3.5 text-muted-foreground" />
        </a>
      ))}
    </div>
  );
}
