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
  ResponsiveContainer,
} from "recharts";

import { UTILITIES, UTILITY_ORDER } from "@/lib/domain";
import { monthLabel, type MonthlyBucket } from "@/lib/aggregate";
import { formatYen } from "@/lib/utils";

function shortMonth(month: string): string {
  const [y, m] = month.split("-");
  return `${y.slice(2)}/${m}`;
}

export function CostChart({ data }: { data: MonthlyBucket[] }) {
  if (data.length === 0) {
    return <p className="py-16 text-center text-sm text-muted-foreground">データがありません。「入力」タブから追加してください。</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={360}>
      <ComposedChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="month" tickFormatter={shortMonth} tick={{ fontSize: 12 }} />
        <YAxis tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} tick={{ fontSize: 12 }} width={44} />
        <Tooltip
          labelFormatter={(label) => monthLabel(String(label))}
          formatter={(value, name) => [formatYen(Number(value)), name]}
        />
        <Legend />
        {UTILITY_ORDER.map((u) => (
          <Bar
            key={u}
            dataKey={u}
            name={UTILITIES[u].label}
            stackId="cost"
            fill={UTILITIES[u].color}
            radius={u === "water" ? [3, 3, 0, 0] : undefined}
          />
        ))}
        <Line
          type="monotone"
          dataKey="total"
          name="合計"
          stroke="var(--foreground)"
          strokeWidth={2}
          dot={{ r: 2 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
