"use client";

import { TrendingUp, TrendingDown, Minus, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { UTILITIES, UTILITY_ORDER } from "@/lib/domain";
import { missingUtilities, monthLabel, periodStats, summarize, type MonthlyBucket } from "@/lib/aggregate";
import { formatPercent, formatSignedYen, formatYen } from "@/lib/utils";

function daysInMonth(monthKey: string): number {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function SummaryCards({
  monthly,
  onStartImport,
}: {
  monthly: MonthlyBucket[];
  /** Opens the import tab from the empty state (SHIG 30/41). */
  onStartImport: () => void;
}) {
  const { latest, latestMonth, yoyDelta, yoyPct } = summarize(monthly);
  const stats = periodStats(monthly);

  if (!latest || !latestMonth) {
    return (
      <Card>
        <CardContent className="space-y-3 py-8 text-center text-sm text-muted-foreground">
          <p>電気・ガス・水道の請求書を取り込むと、月ごとの合計と前年同月比が見られます。</p>
          <Button onClick={onStartImport}>
            <Upload className="size-4" /> 請求書を取り込む
          </Button>
        </CardContent>
      </Card>
    );
  }

  const up = yoyDelta != null && yoyDelta > 0;
  const down = yoyDelta != null && yoyDelta < 0;
  const Trend = up ? TrendingUp : down ? TrendingDown : Minus;
  // For utility costs, going down is good (green) and going up is a warning (red).
  const trendClass = up ? "text-destructive" : down ? "text-success" : "text-muted-foreground";

  const prevMonth = monthly.length >= 2 ? monthly[monthly.length - 2] : null;
  const momDelta = prevMonth ? latest.total - prevMonth.total : null;
  const momPct = prevMonth && prevMonth.total !== 0 ? (latest.total - prevMonth.total) / prevMonth.total : null;
  const perDay = latest.total / daysInMonth(latestMonth);
  const vsAvg = latest.total - stats.average;
  // A bill that has not arrived yet is a gap, not a drop to 0円 (SHIG 28, 56, 32).
  const missing = missingUtilities(monthly, latest);
  const missingSet = new Set(missing);

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">
                {monthLabel(latestMonth)}の合計
                {missing.length > 0 && (
                  <span className="ml-2 rounded-full border border-warning/60 bg-warning/10 px-2 py-0.5 text-xs text-foreground">
                    {missing.map((u) => UTILITIES[u].label).join("・")}は未登録
                  </span>
                )}
              </p>
              <p className="mt-1 text-4xl font-semibold tracking-tight tabular-nums sm:text-3xl">
                {formatYen(latest.total)}
              </p>
              {yoyDelta != null && (
                <p className={`mt-1.5 flex items-center gap-1 text-sm ${trendClass}`}>
                  <Trend className="size-4 shrink-0" />
                  前年同月比 {formatSignedYen(yoyDelta)}
                  {yoyPct != null && <span className="text-muted-foreground">（{formatPercent(yoyPct)}）</span>}
                </p>
              )}
            </div>

            <dl className="grid grid-cols-3 gap-x-2 border-t pt-4 text-left sm:shrink-0 sm:gap-x-6 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0 sm:text-right">
              <div>
                <dt className="text-xs text-muted-foreground">1日あたり</dt>
                <dd className="mt-1 whitespace-nowrap text-sm font-medium tabular-nums sm:text-base">{formatYen(perDay)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">前月比</dt>
                <dd className="mt-1 whitespace-nowrap text-sm font-medium tabular-nums sm:text-base">
                  {momDelta != null ? formatSignedYen(momDelta) : "—"}
                  {momPct != null && (
                    <span className="block text-xs font-normal text-muted-foreground">{formatPercent(momPct)}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">月平均比</dt>
                <dd className="mt-1 whitespace-nowrap text-sm font-medium tabular-nums sm:text-base">{formatSignedYen(vsAvg)}</dd>
              </div>
            </dl>
          </div>
        </CardContent>
      </Card>

      {/* One card per utility side by side, so none sits alone on a second row (SHIG 85). */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {UTILITY_ORDER.map((u) => (
          <Card key={u}>
            <CardContent className="p-3 sm:p-5">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ backgroundColor: UTILITIES[u].color }} />
                {UTILITIES[u].label}
              </p>
              {missingSet.has(u) ? (
                <p className="mt-1 text-sm text-muted-foreground">まだ記録がありません</p>
              ) : (
                <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
                  <span className="whitespace-nowrap text-lg font-semibold tabular-nums sm:text-xl">{formatYen(latest[u])}</span>
                  {latest.total > 0 && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {((latest[u] / latest.total) * 100).toFixed(0)}%
                    </span>
                  )}
                </p>
              )}
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
