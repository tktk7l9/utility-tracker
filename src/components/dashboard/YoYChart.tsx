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
import {
  amountMetric,
  seasonalAverages,
  totalMetric,
  yoyByMonth,
  type MonthlyBucket,
  type Metric,
} from "@/lib/aggregate";
import { cn, formatYen } from "@/lib/utils";
import { ChartTooltip } from "./ChartTooltip";

const YEAR_COLORS = ["#94a3b8", "#60a5fa", "#3a7bd5", "#1e40af"];

type MetricKey = "total" | Utility;

export function YoYChart({ data }: { data: MonthlyBucket[] }) {
  const [metricKey, setMetricKey] = useState<MetricKey>("total");

  const metric: Metric = metricKey === "total" ? totalMetric : amountMetric(metricKey);
  const { years, rows } = yoyByMonth(data, metric);
  const seasonal = seasonalAverages(data, metric);
  const merged = rows.map((r, i) => ({ ...r, avg: seasonal[i].average }));

  const options: { key: MetricKey; label: string }[] = [
    { key: "total", label: "合計" },
    ...UTILITY_ORDER.map((u) => ({ key: u as MetricKey, label: UTILITIES[u].label })),
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => setMetricKey(o.key)}
            className={cn(
              "rounded-md border px-3 py-1 text-sm font-medium transition-colors",
              o.key === metricKey
                ? "border-transparent bg-primary text-primary-foreground shadow-sm"
                : "bg-background hover:bg-accent"
            )}
          >
            {o.label}
          </button>
        ))}
      </div>

      {years.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">データがありません。</p>
      ) : (
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={merged} margin={{ top: 16, right: 12, bottom: 4, left: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
            <YAxis
              tickFormatter={(v: number) => v.toLocaleString("ja-JP")}
              tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
              axisLine={false}
              tickLine={false}
              width={56}
            />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.4 }}
              content={<ChartTooltip valueFormatter={(v) => formatYen(v)} />}
            />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
            {years.map((y, i) => (
              <Bar key={y} dataKey={y} name={`${y}年`} fill={YEAR_COLORS[i % YEAR_COLORS.length]} radius={[3, 3, 0, 0]} maxBarSize={26} isAnimationActive={false} />
            ))}
            <Line type="monotone" dataKey="avg" name="季節平均" stroke="var(--warning)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
      <p className="text-xs text-muted-foreground">
        同じ月番号で年ごとの棒を並べた前年同月比。オレンジ線は各月の年跨ぎ平均（季節性）。
      </p>
    </div>
  );
}
