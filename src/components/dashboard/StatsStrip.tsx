"use client";

import { Card, CardContent } from "@/components/ui/card";
import { monthLabel, periodStats, type MonthlyBucket } from "@/lib/aggregate";
import { formatYen } from "@/lib/utils";

export function StatsStrip({ data }: { data: MonthlyBucket[] }) {
  const s = periodStats(data);
  if (s.months === 0 || !s.maxMonth || !s.minMonth) return null;

  const items = [
    { label: `期間合計（${s.months}ヶ月）`, value: formatYen(s.total) },
    { label: "月平均", value: formatYen(s.average) },
    { label: "最高月", value: formatYen(s.maxMonth.total), sub: monthLabel(s.maxMonth.month) },
    { label: "最低月", value: formatYen(s.minMonth.total), sub: monthLabel(s.minMonth.month) },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((it) => (
        <Card key={it.label}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{it.label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{it.value}</p>
            {it.sub && <p className="text-xs text-muted-foreground">{it.sub}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
