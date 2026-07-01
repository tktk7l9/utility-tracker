"use client";

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
