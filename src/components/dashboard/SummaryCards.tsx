"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { UTILITIES, UTILITY_ORDER } from "@/lib/domain";
import { monthLabel, periodStats, summarize, type MonthlyBucket } from "@/lib/aggregate";
import { formatPercent, formatYen } from "@/lib/utils";

function daysInMonth(monthKey: string): number {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function signedYen(v: number): string {
  return `${v > 0 ? "+" : ""}${formatYen(v)}`;
}

export function SummaryCards({ monthly }: { monthly: MonthlyBucket[] }) {
  const { latest, latestMonth, yoyDelta, yoyPct } = summarize(monthly);
  const stats = periodStats(monthly);

  if (!latest || !latestMonth) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          まだデータがありません。「入力・管理」タブから手入力するか、CSV を取り込んでください。
        </CardContent>
      </Card>
    );
  }

  const up = yoyDelta != null && yoyDelta > 0;
  const down = yoyDelta != null && yoyDelta < 0;
  const Trend = up ? TrendingUp : down ? TrendingDown : Minus;
  // 光熱費は下がる方が good（緑）、上がると warning（赤）。
  const trendClass = up ? "text-destructive" : down ? "text-success" : "text-muted-foreground";

  const prevMonth = monthly.length >= 2 ? monthly[monthly.length - 2] : null;
  const momDelta = prevMonth ? latest.total - prevMonth.total : null;
  const momPct = prevMonth && prevMonth.total !== 0 ? (latest.total - prevMonth.total) / prevMonth.total : null;
  const perDay = latest.total / daysInMonth(latestMonth);
  const vsAvg = latest.total - stats.average;

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">{monthLabel(latestMonth)}の合計</p>
              <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{formatYen(latest.total)}</p>
              {yoyDelta != null && (
                <p className={`mt-1 flex items-center gap-1 text-sm ${trendClass}`}>
                  <Trend className="size-4" />
                  前年同月比 {signedYen(yoyDelta)}
                  {yoyPct != null && <span className="text-muted-foreground">（{formatPercent(yoyPct)}）</span>}
                </p>
              )}
            </div>

            <dl className="grid grid-cols-3 gap-x-6 gap-y-1 border-t pt-4 text-right sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
              <div>
                <dt className="text-xs text-muted-foreground">1日あたり</dt>
                <dd className="mt-0.5 font-medium tabular-nums">{formatYen(perDay)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">前月比</dt>
                <dd className="mt-0.5 font-medium tabular-nums">
                  {momDelta != null ? signedYen(momDelta) : "—"}
                  {momPct != null && <span className="ml-1 text-xs text-muted-foreground">{formatPercent(momPct)}</span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">月平均比</dt>
                <dd className="mt-0.5 font-medium tabular-nums">{signedYen(vsAvg)}</dd>
              </div>
            </dl>
          </div>
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
