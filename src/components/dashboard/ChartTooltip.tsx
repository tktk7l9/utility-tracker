"use client";

/**
 * ReferenceLine 用のラベル。背景色の縁取り（halo）を付けて、グリッドやバーの上でも
 * テキストが読みやすいようにする。viewBox は recharts が注入する。
 */
export function RefLineLabel({
  viewBox,
  text,
  color = "var(--foreground)",
  align = "right",
}: {
  viewBox?: { x: number; y: number; width: number; height: number };
  text: string;
  color?: string;
  align?: "left" | "right";
}) {
  if (!viewBox) return null;
  const x = align === "right" ? viewBox.x + viewBox.width - 4 : viewBox.x + 4;
  const y = viewBox.y - 5;
  return (
    <text
      x={x}
      y={y}
      textAnchor={align === "right" ? "end" : "start"}
      fontSize={11}
      fontWeight={600}
      fill={color}
      stroke="var(--card)"
      strokeWidth={3.5}
      paintOrder="stroke"
      strokeLinejoin="round"
    >
      {text}
    </text>
  );
}

interface TooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
}

/** recharts 共通のカスタムツールチップ（角丸カード・色ドット・右寄せ数値）。 */
export function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter,
  hideKeys,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  labelFormatter?: (label: string | number) => string;
  valueFormatter?: (value: number, entry: TooltipEntry) => string;
  hideKeys?: string[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const rows = payload.filter((p) => !hideKeys?.includes(String(p.dataKey)));

  return (
    <div className="min-w-[9rem] rounded-lg border bg-popover/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
      {label != null && (
        <p className="mb-1.5 font-medium text-foreground">
          {labelFormatter ? labelFormatter(label) : String(label)}
        </p>
      )}
      <div className="space-y-1">
        {rows.map((p, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="inline-block size-2 rounded-full" style={{ backgroundColor: p.color }} />
              {p.name}
            </span>
            <span className="font-medium tabular-nums text-foreground">
              {valueFormatter ? valueFormatter(Number(p.value), p) : String(p.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
