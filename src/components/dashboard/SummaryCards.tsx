"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { UTILITIES, UTILITY_ORDER } from "@/lib/domain";
import { monthLabel, type Summary } from "@/lib/aggregate";
import { formatPercent, formatYen } from "@/lib/utils";

export function SummaryCards({ summary }: { summary: Summary }) {
  const { latest, latestMonth, yoyDelta, yoyPct } = summary;

  if (!latest || !latestMonth) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          まだデータがありません。「入力」タブから手入力するか、CSV を取り込んでください。
        </CardContent>
      </Card>
    );
  }

  const up = yoyDelta != null && yoyDelta > 0;
  const down = yoyDelta != null && yoyDelta < 0;
  const Trend = up ? TrendingUp : down ? TrendingDown : Minus;
  // 光熱費は下がる方が good（緑）、上がると warning（赤）。
  const trendClass = up ? "text-destructive" : down ? "text-success" : "text-muted-foreground";

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-5">
          <p className="text-sm text-muted-foreground">{monthLabel(latestMonth)}の合計</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight">{formatYen(latest.total)}</p>
          {yoyDelta != null && (
            <p className={`mt-1 flex items-center gap-1 text-sm ${trendClass}`}>
              <Trend className="size-4" />
              前年同月比 {yoyDelta > 0 ? "+" : ""}
              {formatYen(yoyDelta)}
              {yoyPct != null && <span className="text-muted-foreground">（{formatPercent(yoyPct)}）</span>}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {UTILITY_ORDER.map((u) => (
          <Card key={u}>
            <CardContent className="p-5">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: UTILITIES[u].color }} />
                {UTILITIES[u].label}
              </p>
              <p className="mt-1 flex items-baseline gap-2">
                <span className="text-xl font-semibold tabular-nums">{formatYen(latest[u])}</span>
                {latest.total > 0 && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {((latest[u] / latest.total) * 100).toFixed(0)}%
                  </span>
                )}
              </p>
              {latest.usage[u] > 0 && (
                <p className="text-xs text-muted-foreground">
                  {latest.usage[u].toLocaleString("ja-JP", { maximumFractionDigits: 1 })} {UTILITIES[u].unit}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
