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
  ResponsiveContainer,
} from "recharts";

import { UTILITIES, UTILITY_ORDER, type Utility } from "@/lib/domain";
import {
  amountMetric,
  seasonalAverages,
  totalMetric,
  yearOverYear,
  yoyTotals,
  type MonthlyBucket,
  type Metric,
  type YoYRow,
} from "@/lib/aggregate";
import { formatPercent, formatSignedYen, formatYen } from "@/lib/utils";
import { ToggleChip } from "@/components/ui/toggle-chip";

type MetricKey = "total" | Utility;

// This year is a solid bar, last year a dashed outline, the seasonal average a dashed line
// without markers: three different shapes, so no reader needs to tell hues apart (SHIG 96).
const CURRENT_FILL = "var(--primary)";
const PREVIOUS_STROKE = "var(--muted-foreground)";
const PREVIOUS_DASH = "4 3";
const SEASONAL_STROKE = "var(--warning)";
const SEASONAL_DASH = "6 4";

function YoYLegend({ current, previous }: { current: string; previous: string | null }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-foreground">
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="inline-block h-3 w-3.5 rounded-[2px]" style={{ backgroundColor: CURRENT_FILL }} />
        {current}年（塗り）
      </li>
      {previous && (
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3.5 rounded-[2px] border-[1.5px] border-dashed"
            style={{ borderColor: PREVIOUS_STROKE }}
          />
          {previous}年（点線の枠）
        </li>
      )}
      <li className="flex items-center gap-1.5">
        <svg aria-hidden="true" width="18" height="6" className="shrink-0">
          <line x1="0" y1="3" x2="18" y2="3" stroke={SEASONAL_STROKE} strokeWidth="2" strokeDasharray="4 3" />
        </svg>
        季節平均（全年・破線）
      </li>
    </ul>
  );
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: YoYRow & { avg: number | null } }>;
  current: string;
  previous: string | null;
}

/** Names each value by its year and spells out the difference, instead of a colored dot per series. */
function YoYTooltip({ active, payload, current, previous }: TooltipProps) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const line = (label: string, v: number | null) => (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-foreground">{v === null ? "記録なし" : formatYen(v)}</span>
    </div>
  );
  return (
    <div className="min-w-[10rem] space-y-1 rounded-lg border bg-popover/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
      <p className="mb-1 font-medium text-foreground">{row.label}</p>
      {line(`${current}年`, row.current)}
      {previous && line(`${previous}年`, row.previous)}
      {row.delta !== null && (
        <div className="flex items-center justify-between gap-4 border-t pt-1">
          <span className="text-muted-foreground">前年比</span>
          <span className="font-semibold tabular-nums text-foreground">
            {formatSignedYen(row.delta)}
            {row.deltaPct !== null && `（${formatPercent(row.deltaPct)}）`}
          </span>
        </div>
      )}
      {row.avg !== null && line("季節平均", row.avg)}
    </div>
  );
}

export function YoYChart({ data }: { data: MonthlyBucket[] }) {
  const [metricKey, setMetricKey] = useState<MetricKey>("total");
  const [baseYear, setBaseYear] = useState<string | undefined>(undefined);

  const metric: Metric = metricKey === "total" ? totalMetric : amountMetric(metricKey);
  const { years, current, previous, rows } = yearOverYear(data, metric, baseYear);
  const seasonal = seasonalAverages(data, metric);
  const merged = rows.map((r, i) => ({ ...r, avg: seasonal[i].count ? seasonal[i].average : null }));
  const totals = yoyTotals(rows);

  const options: { key: MetricKey; label: string }[] = [
    { key: "total", label: "合計" },
    ...UTILITY_ORDER.map((u) => ({ key: u as MetricKey, label: UTILITIES[u].label })),
  ];
  // Only years with a year before them can be compared; newest first, since the latest is the usual question.
  const baseChoices = years.filter((y) => years.includes(String(Number(y) - 1))).reverse();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="種別">
        {options.map((o) => (
          <ToggleChip key={o.key} pressed={o.key === metricKey} onClick={() => setMetricKey(o.key)}>
            {o.label}
          </ToggleChip>
        ))}
      </div>

      {current === null ? (
        <p className="py-16 text-center text-sm text-muted-foreground">データがありません。</p>
      ) : (
        <>
          {baseChoices.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="比べる年">
              <span className="mr-1 text-xs text-muted-foreground">比べる年</span>
              {baseChoices.map((y) => (
                <ToggleChip key={y} pressed={y === current} onClick={() => setBaseYear(y)}>
                  {y}年 と {Number(y) - 1}年
                </ToggleChip>
              ))}
            </div>
          )}

          <p className="text-sm text-foreground" aria-live="polite">
            {totals ? (
              <>
                {current}年は、{previous}年と比べられる {totals.months} か月の合計で{" "}
                <span className="font-semibold tabular-nums">{formatSignedYen(totals.delta)}</span>
                {totals.deltaPct !== null && (
                  <span className="tabular-nums">（{formatPercent(totals.deltaPct)}）</span>
                )}
                {totals.delta > 0 ? "増えました。" : totals.delta < 0 ? "減りました。" : "同じでした。"}
              </>
            ) : (
              <>{current}年の前年の記録がないため、比べられる月がありません。</>
            )}
          </p>

          <YoYLegend current={current} previous={previous} />

          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={merged} margin={{ top: 8, right: 8, bottom: 4, left: 4 }} barGap={2}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                interval={0}
                tickFormatter={(l: string) => l.replace("月", "")}
              />
              <YAxis
                tickFormatter={(v: number) => v.toLocaleString("ja-JP")}
                tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                width={52}
              />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                content={<YoYTooltip current={current} previous={previous} />}
              />
              {previous && (
                <Bar
                  dataKey="previous"
                  name={`${previous}年`}
                  fill="var(--card)"
                  stroke={PREVIOUS_STROKE}
                  strokeWidth={1.5}
                  strokeDasharray={PREVIOUS_DASH}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={22}
                  isAnimationActive={false}
                />
              )}
              <Bar
                dataKey="current"
                name={`${current}年`}
                fill={CURRENT_FILL}
                radius={[3, 3, 0, 0]}
                maxBarSize={22}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="avg"
                name="季節平均"
                stroke={SEASONAL_STROKE}
                strokeWidth={2}
                strokeDasharray={SEASONAL_DASH}
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="text-xs text-muted-foreground">
            横軸は月（1〜12月）。{previous ? `各月の左の枠が${previous}年、右の塗りが${current}年です。` : ""}
            季節平均は、記録のあるすべての年の同じ月の平均です。
          </p>
        </>
      )}
    </div>
  );
}
