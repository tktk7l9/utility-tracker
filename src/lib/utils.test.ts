import { describe, it, expect } from "vitest";
import { cn, formatYen, formatNumber, formatPercent, formatDate, formatPeriod } from "./utils";

describe("cn", () => {
  it("クラスを結合し falsy を除去", () => {
    expect(cn("a", false && "b", "c")).toBe("a c");
  });
  it("tailwind の競合は後勝ち", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});

describe("formatYen", () => {
  it("四捨五入して桁区切り＋円", () => {
    expect(formatYen(1234.6)).toBe("1,235円");
    expect(formatYen(0)).toBe("0円");
  });
});

describe("formatNumber", () => {
  it("桁指定で丸め、末尾ゼロを残さない", () => {
    expect(formatNumber(1234.567, 1)).toBe("1,234.6");
    expect(formatNumber(1000, 0)).toBe("1,000");
    expect(formatNumber(12.0, 1)).toBe("12");
  });
});

describe("formatPercent", () => {
  it("正は + 、負はそのまま", () => {
    expect(formatPercent(0.2)).toBe("+20.0%");
    expect(formatPercent(-0.125)).toBe("-12.5%");
    expect(formatPercent(0)).toBe("0.0%");
  });
});

describe("formatDate", () => {
  it("uses slashes", () => {
    expect(formatDate("2026-07-01")).toBe("2026/07/01");
  });
});

describe("formatPeriod", () => {
  it("omits the year of the end date within the same year", () => {
    expect(formatPeriod("2026-07-01", "2026-08-31")).toBe("2026/07/01〜08/31");
  });
  it("keeps both years across a year boundary", () => {
    expect(formatPeriod("2025-12-15", "2026-01-14")).toBe("2025/12/15〜2026/01/14");
  });
  it("leaves the end open when it is missing", () => {
    expect(formatPeriod("2025-04-01", null)).toBe("2025/04/01〜");
  });
});
