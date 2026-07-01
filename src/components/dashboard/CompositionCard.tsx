"use client";

import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UTILITIES } from "@/lib/domain";
import { utilityShares, type MonthlyBucket } from "@/lib/aggregate";
import { formatYen } from "@/lib/utils";

export function CompositionCard({ data }: { data: MonthlyBucket[] }) {
  const shares = utilityShares(data);
  const grand = shares.reduce((sum, s) => sum + s.total, 0);
  if (grand === 0) return null;

  const pie = shares
    .filter((s) => s.total > 0)
    .map((s) => ({ key: s.utility, name: UTILITIES[s.utility].label, value: s.total, color: UTILITIES[s.utility].color }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">期間の内訳（構成比）</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center gap-4">
          <div className="relative h-40 w-40 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pie}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={48}
                  outerRadius={72}
                  paddingAngle={2}
                  stroke="var(--card)"
                  strokeWidth={2}
                  isAnimationActive={false}
                >
                  {pie.map((p) => (
                    <Cell key={p.key} fill={p.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[10px] text-muted-foreground">合計</span>
              <span className="text-sm font-semibold tabular-nums">{formatYen(grand)}</span>
            </div>
          </div>

          <ul className="w-full space-y-2 text-sm">
            {shares.map((s) => (
              <li key={s.utility} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                  <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ backgroundColor: UTILITIES[s.utility].color }} />
                  {UTILITIES[s.utility].label}
                </span>
                <span className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap">
                  <span className="font-medium tabular-nums">{formatYen(s.total)}</span>
                  <span className="w-11 text-right text-xs text-muted-foreground tabular-nums">{(s.share * 100).toFixed(1)}%</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
