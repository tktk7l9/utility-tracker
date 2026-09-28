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

import { HOUSEHOLD_AVERAGE, UTILITIES, UTILITY_ORDER } from "@/lib/domain";
import { monthLabel, refLabelSides, type MonthlyBucket } from "@/lib/aggregate";
import { formatYen } from "@/lib/utils";
import { ChartTooltip, RefLineLabel } from "./ChartTooltip";

function shortMonth(month: string): string {
  const [y, m] = month.split("-");
  return `${y.slice(2)}/${m}`;
}

/** Draws the legend in the order total -> electricity -> gas -> water (total uses a line icon). */
function CostLegend() {
  return (
    <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 pt-3 text-xs text-muted-foreground">
      <li className="flex items-center gap-1.5">
        <span className="inline-block h-[2px] w-3.5 rounded" style={{ backgroundColor: "var(--foreground)" }} />
        合計
      </li>
      {UTILITY_ORDER.map((u) => (
        <li key={u} className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: UTILITIES[u].color }} />
          {UTILITIES[u].label}
        </li>
      ))}
    </ul>
  );
}

export function CostChart({ data }: { data: MonthlyBucket[] }) {
  if (data.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        まだデータがありません。
      </p>
    );
  }

  const avg = data.reduce((s, b) => s + b.total, 0) / data.length;
  // The two lines are often close (e.g. 22,000 vs 23,235): the higher one's label goes above
  // it and the lower one's below, so they never overlap (SHIG 75). Each line also has its own
  // dash pattern and says what it is in its label, so neither relies on color (SHIG 96).
  const [householdSide, avgSide] = refLabelSides(HOUSEHOLD_AVERAGE.total, avg);

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
          tickFormatter={(v: number) => v.toLocaleString("ja-JP")}
          tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
          width={56}
        />
        <ReferenceLine
          y={HOUSEHOLD_AVERAGE.total}
          stroke="#7c3aed"
          strokeWidth={1.5}
          strokeDasharray="8 4"
          label={
            <RefLineLabel
              text={`一般家庭の目安 ${formatYen(HOUSEHOLD_AVERAGE.total)}`}
              color="#7c3aed"
              align="left"
              side={householdSide}
            />
          }
        />
        <ReferenceLine
          y={avg}
          stroke="var(--foreground)"
          strokeOpacity={0.6}
          strokeWidth={1.5}
          strokeDasharray="2 3"
          label={<RefLineLabel text={`この期間の平均 ${formatYen(avg)}`} align="right" side={avgSide} />}
        />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.4 }}
          content={<ChartTooltip labelFormatter={(l) => monthLabel(String(l))} valueFormatter={(v) => formatYen(v)} />}
        />
        <Legend content={<CostLegend />} />
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
