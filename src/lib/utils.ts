import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formats a number as 「1,234円」 (rounded). */
export function formatYen(value: number): string {
  return `${Math.round(value).toLocaleString("ja-JP")}円`;
}

/** Signed yen for differences: 1200 -> "+1,200円", -800 -> "-800円". */
export function formatSignedYen(value: number): string {
  return `${value > 0 ? "+" : ""}${formatYen(value)}`;
}

/** Rounds a decimal to the given digits and formats it in the Japanese locale (no trailing zeros). */
export function formatNumber(value: number, digits = 1): string {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return rounded.toLocaleString("ja-JP", { maximumFractionDigits: digits });
}

/** Rate of change (-0.12 -> 「-12.0%」; positive values get a 「+」). */
export function formatPercent(ratio: number, digits = 1): string {
  const pct = ratio * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(digits)}%`;
}

/** "2026-07-01" -> "2026/07/01". */
export function formatDate(iso: string): string {
  return iso.replaceAll("-", "/");
}

/**
 * Short period text: "2026/07/01〜08/31" (the end drops the year when it is the same),
 * "2025/12/15〜2026/01/14" across years, "2025/04/01〜" when the end is open.
 */
export function formatPeriod(start: string, end: string | null): string {
  if (end == null) return `${formatDate(start)}〜`;
  const endText = end.slice(0, 4) === start.slice(0, 4) ? formatDate(end.slice(5)) : formatDate(end);
  return `${formatDate(start)}〜${endText}`;
}
