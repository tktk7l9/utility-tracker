"use client";

import { useState } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

import { UTILITIES, UTILITY_ORDER, type Utility } from "@/lib/domain";
import { monthLabel, usageSeriesFor } from "@/lib/aggregate";
import type { Reading } from "@/lib/domain";
import { formatNumber, formatYen } from "@/lib/utils";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { ChartTooltip, RefLineLabel } from "./ChartTooltip";

function shortMonth(month: string): string {
  const [y, m] = month.split("-");
  return `${y.slice(2)}/${m}`;
}

export function UsageChart({ readings }: { readings: Reading[] }) {
  const [utility, setUtility] = useState<Utility>("electricity");
  const meta = UTILITIES[utility];
  const data = usageSeriesFor(readings, utility);
  const prices = data.map((d) => d.unitPrice).filter((p): p is number => p != null);
  const avgPrice = prices.length ? prices.reduce((s, p) => s + p, 0) / prices.length : null;

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5" role="group" aria-label="種別">
        {UTILITY_ORDER.map((u) => (
          <ToggleChip key={u} pressed={u === utility} color={UTILITIES[u].color} onClick={() => setUtility(u)}>
            {UTILITIES[u].label}
          </ToggleChip>
        ))}
      </div>

      {data.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">{meta.label}のデータがありません。</p>
      ) : (
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart
            data={data}
            margin={{ top: 28, right: 8, bottom: 4, left: 4 }}
            title={`${meta.label}の月別使用量と実効単価`}
            desc="棒が使用量、線が実効単価です。矢印キーで月ごとの値を読み上げます。"
          >
            <defs>
              <linearGradient id={`usage-${utility}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={meta.color} stopOpacity={0.95} />
                <stop offset="100%" stopColor={meta.color} stopOpacity={0.55} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="month" tickFormatter={shortMonth} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
            <YAxis
              yAxisId="usage"
              tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
              axisLine={false}
              tickLine={false}
              width={40}
              // Above the axis, clear of the top tick label (SHIG 75, 85).
              label={{ value: meta.unit, position: "top", offset: 12, fontSize: 11, fill: "var(--muted-foreground)" }}
            />
            <YAxis
              yAxisId="price"
              orientation="right"
              tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
              axisLine={false}
              tickLine={false}
              width={46}
              tickFormatter={(v: number) => `¥${Math.round(v)}`}
            />
            {avgPrice != null && (
              <ReferenceLine
                yAxisId="price"
                y={avgPrice}
                stroke="var(--foreground)"
                strokeOpacity={0.4}
                strokeDasharray="5 4"
                label={<RefLineLabel text={`平均単価 ¥${Math.round(avgPrice)}`} align="right" />}
              />
            )}
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.4 }}
              content={
                <ChartTooltip
                  labelFormatter={(l) => monthLabel(String(l))}
                  valueFormatter={(v, e) =>
                    e.dataKey === "unitPrice" ? `${formatYen(v)} / ${meta.unit}` : `${formatNumber(v, 1)} ${meta.unit}`
                  }
                />
              }
            />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
            <Bar yAxisId="usage" dataKey="usage" name={`使用量(${meta.unit})`} fill={`url(#usage-${utility})`} radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false} />
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="unitPrice"
              name="実効単価"
              stroke="var(--foreground)"
              strokeWidth={2}
              dot={{ r: 2.5, strokeWidth: 0, fill: "var(--foreground)" }}
              activeDot={{ r: 4 }}
              connectNulls
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
      {data.length > 0 && (
        <p className="text-xs text-muted-foreground">
          ※「すべて（合算）」表示では、引っ越し月に同じ月のレコードが複数（旧居・新居）並ぶことがあります。
        </p>
      )}
    </div>
  );
}
