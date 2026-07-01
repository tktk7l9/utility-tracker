import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 数値を「1,234円」形式に（四捨五入）。 */
export function formatYen(value: number): string {
  return `${Math.round(value).toLocaleString("ja-JP")}円`;
}

/** 小数を桁指定で丸めて日本語ロケール表示（末尾ゼロは残さない）。 */
export function formatNumber(value: number, digits = 1): string {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return rounded.toLocaleString("ja-JP", { maximumFractionDigits: digits });
}

/** 増減率（-0.12 → 「-12.0%」, 正なら「+」を付与）。 */
export function formatPercent(ratio: number, digits = 1): string {
  const pct = ratio * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(digits)}%`;
}
