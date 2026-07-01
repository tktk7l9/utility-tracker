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
  ResponsiveContainer,
} from "recharts";

import { UTILITIES, UTILITY_ORDER, type Utility } from "@/lib/domain";
import { monthLabel, usageSeriesFor } from "@/lib/aggregate";
import type { Reading } from "@/lib/domain";
import { cn, formatNumber, formatYen } from "@/lib/utils";

function shortMonth(month: string): string {
  const [y, m] = month.split("-");
  return `${y.slice(2)}/${m}`;
}

export function UsageChart({ readings }: { readings: Reading[] }) {
  const [utility, setUtility] = useState<Utility>("electricity");
  const meta = UTILITIES[utility];
  const data = usageSeriesFor(readings, utility);

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {UTILITY_ORDER.map((u) => (
          <button
            key={u}
            type="button"
            onClick={() => setUtility(u)}
            className={cn(
              "rounded-md border px-3 py-1 text-sm transition-colors",
              u === utility ? "border-transparent text-neutral-900" : "bg-background hover:bg-accent"
            )}
            style={u === utility ? { backgroundColor: UTILITIES[u].color } : undefined}
          >
            {UTILITIES[u].label}
          </button>
        ))}
      </div>

      {data.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">{meta.label}のデータがありません。</p>
      ) : (
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={data} margin={{ top: 12, right: 8, bottom: 4, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="month" tickFormatter={shortMonth} tick={{ fontSize: 12 }} />
            <YAxis
              yAxisId="usage"
              tick={{ fontSize: 12 }}
              width={44}
              label={{ value: meta.unit, position: "insideTopLeft", fontSize: 11 }}
            />
            <YAxis
              yAxisId="price"
              orientation="right"
              tick={{ fontSize: 12 }}
              width={48}
              tickFormatter={(v: number) => `¥${Math.round(v)}`}
            />
            <Tooltip
              labelFormatter={(label) => monthLabel(String(label))}
              formatter={(value, name) =>
                name === "実効単価"
                  ? [`${formatYen(Number(value))} / ${meta.unit}`, name]
                  : [`${formatNumber(Number(value), 1)} ${meta.unit}`, name]
              }
            />
            <Legend />
            <Bar yAxisId="usage" dataKey="usage" name={`使用量(${meta.unit})`} fill={meta.color} radius={[3, 3, 0, 0]} />
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="unitPrice"
              name="実効単価"
              stroke="var(--foreground)"
              strokeWidth={2}
              dot={{ r: 2 }}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
