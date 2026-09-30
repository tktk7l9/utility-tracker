"use client";

import { ExternalLink } from "lucide-react";

import { UTILITIES } from "@/lib/domain";

// Each provider's billing page (entry point for checking statements and downloading CSVs).
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
          <ExternalLink aria-hidden="true" className="size-3.5 text-muted-foreground" />
          <span className="sr-only">（新しいタブで開きます）</span>
        </a>
      ))}
    </div>
  );
}
