"use client";

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

import { UTILITIES, UTILITY_ORDER } from "@/lib/domain";
import { monthLabel, type MonthlyBucket } from "@/lib/aggregate";
import { formatYen } from "@/lib/utils";
import { ChartTooltip } from "./ChartTooltip";

function shortMonth(month: string): string {
  const [y, m] = month.split("-");
  return `${y.slice(2)}/${m}`;
}

export function CostChart({ data }: { data: MonthlyBucket[] }) {
  if (data.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        データがありません。「入力・管理」タブから追加してください。
      </p>
    );
  }

  const avg = data.reduce((s, b) => s + b.total, 0) / data.length;

  return (
    <ResponsiveContainer width="100%" height={360}>
      <ComposedChart data={data} margin={{ top: 16, right: 12, bottom: 4, left: 4 }}>
        <defs>
          {UTILITY_ORDER.map((u) => (
            <linearGradient key={u} id={`cost-${u}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={UTILITIES[u].color} stopOpacity={0.95} />
              <stop offset="100%" stopColor={UTILITIES[u].color} stopOpacity={0.6} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey="month" tickFormatter={shortMonth} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
        <YAxis
          tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
          tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
          width={40}
        />
        <ReferenceLine
          y={avg}
          stroke="var(--muted-foreground)"
          strokeDasharray="5 4"
          label={{ value: `平均 ${formatYen(avg)}`, position: "insideTopRight", fontSize: 11, fill: "var(--muted-foreground)" }}
        />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.4 }}
          content={<ChartTooltip labelFormatter={(l) => monthLabel(String(l))} valueFormatter={(v) => formatYen(v)} />}
        />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
        {UTILITY_ORDER.map((u, i) => (
          <Bar
            key={u}
            dataKey={u}
            name={UTILITIES[u].label}
            stackId="cost"
            fill={`url(#cost-${u})`}
            radius={i === UTILITY_ORDER.length - 1 ? [4, 4, 0, 0] : undefined}
            maxBarSize={48}
            isAnimationActive={false}
          />
        ))}
        <Line
          type="monotone"
          dataKey="total"
          name="合計"
          stroke="var(--foreground)"
          strokeWidth={2}
          dot={{ r: 2.5, strokeWidth: 0, fill: "var(--foreground)" }}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
