import { describe, it, expect } from "vitest";
import { cn, formatYen, formatSignedYen, formatNumber, formatPercent, formatDate, formatPeriod } from "./utils";

describe("cn", () => {
  it("joins classes and drops falsy values", () => {
    expect(cn("a", false && "b", "c")).toBe("a c");
  });
  it("lets the later tailwind class win on conflict", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});

describe("formatYen", () => {
  it("rounds, adds thousands separators and appends the yen suffix", () => {
    expect(formatYen(1234.6)).toBe("1,235円");
    expect(formatYen(0)).toBe("0円");
  });
});

describe("formatSignedYen", () => {
  it("adds a plus sign only to increases", () => {
    expect(formatSignedYen(1200)).toBe("+1,200円");
    expect(formatSignedYen(-800)).toBe("-800円");
    expect(formatSignedYen(0)).toBe("0円");
  });
});

describe("formatNumber", () => {
  it("rounds to the given digits without trailing zeros", () => {
    expect(formatNumber(1234.567, 1)).toBe("1,234.6");
    expect(formatNumber(1000, 0)).toBe("1,000");
    expect(formatNumber(12.0, 1)).toBe("12");
  });
});

describe("formatPercent", () => {
  it("prefixes positives with + and leaves negatives as is", () => {
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
