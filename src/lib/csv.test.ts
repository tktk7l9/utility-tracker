import { describe, it, expect } from "vitest";
import {
  parseCsv,
  toHalfWidth,
  normalizeNumber,
  normalizeDate,
  normalizeDateRange,
  monthRange,
  mapRowsToReadings,
  readingKey,
  dedupe,
  guessColumns,
  guessUtility,
  type CsvMapping,
} from "./csv";
import type { Building, NewReading } from "./domain";

describe("parseCsv", () => {
  it("parses basic comma-separated LF input", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted commas, CRLF and a trailing newline", () => {
    expect(parseCsv('x,"a,b",z\r\n1,2,3\r\n')).toEqual([
      ["x", "a,b", "z"],
      ["1", "2", "3"],
    ]);
  });

  it('handles "" escapes and flushes the last row without a newline', () => {
    expect(parseCsv('"he said ""hi"""')).toEqual([['he said "hi"']]);
  });

  it("returns an empty array for an empty string", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("strips a leading BOM", () => {
    expect(parseCsv("\uFEFFa\n")).toEqual([["a"]]);
  });

  it("keeps blank lines as rows of empty cells", () => {
    expect(parseCsv("a\n\nb")).toEqual([["a"], [""], ["b"]]);
  });
});

describe("toHalfWidth", () => {
  it("converts full-width alphanumerics, symbols, spaces and hyphen variants to half-width", () => {
    expect(toHalfWidth("ＡＢ１２３．，　－ー―")).toBe("AB123., ---");
  });
});

describe("normalizeNumber", () => {
  it("strips currency, commas and units before converting to a number", () => {
    expect(normalizeNumber("¥1,234円")).toBe(1234);
    expect(normalizeNumber("12.5kWh")).toBe(12.5);
    expect(normalizeNumber("5 m³")).toBe(5);
    expect(normalizeNumber("１，２３４")).toBe(1234);
    expect(normalizeNumber("1,234.56")).toBe(1234.56);
  });
  it("returns null for empty, hyphen, non-numeric and null", () => {
    expect(normalizeNumber("")).toBeNull();
    expect(normalizeNumber("-")).toBeNull();
    expect(normalizeNumber("abc")).toBeNull();
    expect(normalizeNumber(null)).toBeNull();
    expect(normalizeNumber(undefined)).toBeNull();
  });
});

describe("normalizeDate", () => {
  it("normalizes various formats to YYYY-MM-DD", () => {
    expect(normalizeDate("2026/6/1")).toBe("2026-06-01");
    expect(normalizeDate("2026-06-19")).toBe("2026-06-19");
    expect(normalizeDate("2026年6月1日")).toBe("2026-06-01");
    expect(normalizeDate("2026年6月")).toBe("2026-06-01");
    expect(normalizeDate("２０２６/０６/１９")).toBe("2026-06-19");
    expect(normalizeDate("2026.6.1")).toBe("2026-06-01");
  });
  it("reads a 2-digit year as 20xx or Reiwa, whichever is closer to today (LPIO \"26年06月\", waterworks \"8年 6月\")", () => {
    const today = new Date("2026-07-14");
    expect(normalizeDate("26年06月", today)).toBe("2026-06-01"); // Gregorian 2026 is closer than Reiwa 26 (2044)
    expect(normalizeDate("25年12月", today)).toBe("2025-12-01");
    expect(normalizeDate("26/6/1", today)).toBe("2026-06-01");
    expect(normalizeDate("8年 6月", today)).toBe("2026-06-01"); // Reiwa 8 (2026) is closer than Gregorian 2008
    expect(normalizeDate("00年01月", today)).toBe("2000-01-01"); // Reiwa 0 does not exist -> Gregorian
    expect(normalizeDate("8年1月", new Date("2017-06-01"))).toBe("2008-01-01"); // Gregorian on a tie
  });
  it("takes the end of a Japanese-era range with \"分\" (Tokyo Waterworks usage months)", () => {
    const today = new Date("2026-07-14");
    expect(normalizeDate(" 8年 6月 ～  8年 7月分", today)).toBe("2026-07-01");
    expect(normalizeDate("2026/06")).toBe("2026-06-01");
  });
  it("returns null for partial forms without a year (month-day, month only, day only)", () => {
    expect(normalizeDate("5月14日")).toBeNull();
    expect(normalizeDate("6月")).toBeNull();
    expect(normalizeDate("10日")).toBeNull();
    expect(normalizeDate("8年月")).toBeNull(); // Malformed notation
  });
  it("returns null for unparseable, out-of-range and null", () => {
    expect(normalizeDate("")).toBeNull();
    expect(normalizeDate(null)).toBeNull();
    expect(normalizeDate(undefined)).toBeNull();
    expect(normalizeDate("2026")).toBeNull();
    expect(normalizeDate("abc/def")).toBeNull();
    expect(normalizeDate("2026/13/01")).toBeNull();
    expect(normalizeDate("1899/06/01")).toBeNull();
    expect(normalizeDate("2026/06/40")).toBeNull();
  });
});

describe("normalizeDateRange", () => {
  const today = new Date("2026-07-14");

  it("fills both year-less sides from the anchor year (waterworks usage period)", () => {
    expect(normalizeDateRange(" 5月14日 ～  7月10日", "2026-07-01", today)).toEqual({
      start: "2026-05-14",
      end: "2026-07-10",
    });
  });

  it("moves the start to the previous year when start > end (period spanning New Year)", () => {
    expect(normalizeDateRange("11月14日 ～ 1月10日", "2026-01-31", today)).toEqual({
      start: "2025-11-14",
      end: "2026-01-10",
    });
    // Days reversed within the same month follow the same rule
    expect(normalizeDateRange("6月20日 ～ 6月10日", "2026-06-30", today)).toEqual({
      start: "2025-06-20",
      end: "2026-06-10",
    });
  });

  it("corrects an end more than half a year off the anchor as spanning New Year", () => {
    expect(normalizeDateRange("11月14日 ～ 12月28日", "2026-01-31", today)).toEqual({
      start: "2025-11-14",
      end: "2025-12-28",
    });
    expect(normalizeDateRange("1月4日 ～ 1月20日", "2026-12-01", today)).toEqual({
      start: "2027-01-04",
      end: "2027-01-20",
    });
  });

  it("uses its own year on a side that has one (Japanese era or Gregorian)", () => {
    expect(normalizeDateRange("8年6月 ～ 8年7月分", "2030-01-01", today)).toEqual({
      start: "2026-06-01",
      end: "2026-07-01",
    });
    expect(normalizeDateRange("2026/5/14 ～ 2026/7/10", "2030-01-01", today)).toEqual({
      start: "2026-05-14",
      end: "2026-07-10",
    });
    expect(normalizeDateRange("26/5/14 ～ 2026/7/10", "2030-01-01", today)).toEqual({
      start: "2026-05-14",
      end: "2026-07-10",
    });
  });

  it("treats a month-only side as the 1st", () => {
    expect(normalizeDateRange("6月 ～ 7月10日", "2026-07-01", today)).toEqual({
      start: "2026-06-01",
      end: "2026-07-10",
    });
  });

  it("treats a missing day as the 1st when comparing sides within the same month", () => {
    // Start without a day: the 1st never comes after the end, so the year stays.
    expect(normalizeDateRange("6月 ～ 6月30日", "2026-06-30", today)).toEqual({
      start: "2026-06-01",
      end: "2026-06-30",
    });
    // End without a day: a start after the 1st is read as the previous year.
    expect(normalizeDateRange("6月20日 ～ 6月", "2026-06-30", today)).toEqual({
      start: "2025-06-20",
      end: "2026-06-01",
    });
  });

  it("returns null when unparseable, not exactly two sides, or out of range", () => {
    expect(normalizeDateRange(null, "2026-07-01", today)).toBeNull();
    expect(normalizeDateRange("2026/6/1", "2026-07-01", today)).toBeNull();
    expect(normalizeDateRange("1月 ～ 2月 ～ 3月", "2026-07-01", today)).toBeNull();
    expect(normalizeDateRange("?? ～ 7月10日", "2026-07-01", today)).toBeNull();
    expect(normalizeDateRange("5月14日 ～ ??", "2026-07-01", today)).toBeNull();
    expect(normalizeDateRange("5月14日 ～ 13月10日", "2026-07-01", today)).toBeNull();
    expect(normalizeDateRange("0月14日 ～ 7月10日", "2026-07-01", today)).toBeNull();
  });
});

describe("monthRange", () => {
  it("returns the first and last day of the month", () => {
    expect(monthRange("2026-06-15")).toEqual({ start: "2026-06-01", end: "2026-06-30" });
  });
  it("handles February in a leap year", () => {
    expect(monthRange("2024-02-10")).toEqual({ start: "2024-02-01", end: "2024-02-29" });
    expect(monthRange("2025-02-10")).toEqual({ start: "2025-02-01", end: "2025-02-28" });
  });
});

describe("mapRowsToReadings", () => {
  it("with a header and a month-only column, prorates across the whole month (TEPCO style)", () => {
    const rows = [
      ["年月", "使用量(kWh)", "請求額(円)"],
      ["2026/05", "120", "3,000"],
      ["2026/06", "100", "3,200"],
    ];
    const mapping: CsvMapping = {
      utility: "electricity",
      buildingId: "b1",
      hasHeader: true,
      columns: { periodEnd: 0, usage: 1, amount: 2 },
    };
    const { readings, errors } = mapRowsToReadings(rows, mapping);
    expect(errors).toEqual([]);
    expect(readings).toHaveLength(2);
    expect(readings[0]).toMatchObject({
      utility: "electricity",
      buildingId: "b1",
      provider: "TEPCO",
      periodStart: "2026-05-01",
      periodEnd: "2026-05-31",
      amountYen: 3000,
      usageValue: 120,
      usageUnit: "kWh",
      source: "csv",
    });
  });

  it("imports the LPIO yearly usage format (2-digit year, ¥ amounts)", () => {
    const rows = [
      ["年月", "使用量", "ご利用金額"],
      ["26年06月", "22.0", "¥4,331"],
      ["25年07月", "17.0", "¥3,625"],
    ];
    const { readings, errors } = mapRowsToReadings(rows, {
      utility: "gas",
      buildingId: "b1",
      hasHeader: true,
      columns: { periodEnd: 0, usage: 1, amount: 2 },
    });
    expect(errors).toEqual([]);
    expect(readings[0]).toMatchObject({
      utility: "gas",
      provider: "LPIO",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      amountYen: 4331,
      usageValue: 22,
      usageUnit: "m³",
    });
    expect(readings[1]).toMatchObject({ periodStart: "2025-07-01", periodEnd: "2025-07-31", amountYen: 3625 });
  });

  it("uses the period as is when both start and end columns are given; provider/unit can be overridden", () => {
    const rows = [["2026/05/20", "2026/06/19", "6200", "24"]];
    const mapping: CsvMapping = {
      utility: "water",
      buildingId: "b1",
      provider: "東京都水道局",
      usageUnit: "㎥",
      hasHeader: false,
      columns: { periodStart: 0, periodEnd: 1, amount: 2, usage: 3 },
    };
    const { readings } = mapRowsToReadings(rows, mapping);
    expect(readings[0]).toMatchObject({
      periodStart: "2026-05-20",
      periodEnd: "2026-06-19",
      amountYen: 6200,
      usageValue: 24,
      provider: "東京都水道局",
      usageUnit: "㎥",
    });
  });

  it("imports the Tokyo Waterworks meterdata format (era usage months, range in one cell)", () => {
    const rows = [
      ["お客さま番号", "合計請求金額（円）", "水道使用量（m3）", "使用月分", "使用期間"],
      ["75-000000-00", "8193", "43", " 8年 6月 ～  8年 7月分", " 5月14日 ～  7月10日"],
    ];
    const mapping: CsvMapping = {
      utility: "water",
      buildingId: "b1",
      hasHeader: true,
      columns: { periodEnd: 3, periodStart: 4, amount: 1, usage: 2 },
    };
    const { readings, errors } = mapRowsToReadings(rows, mapping, new Date("2026-07-14"));
    expect(errors).toEqual([]);
    expect(readings[0]).toMatchObject({
      utility: "water",
      provider: "TokyoWaterworks",
      periodStart: "2026-05-14",
      periodEnd: "2026-07-10",
      amountYen: 8193,
      usageValue: 43,
      usageUnit: "m³",
    });
  });

  it("falls back to the end month's range when the start column's range cannot be parsed", () => {
    const rows = [["あ ～ い", "2026/07/31", "5000"]];
    const { readings } = mapRowsToReadings(rows, {
      utility: "water",
      buildingId: "b1",
      hasHeader: false,
      columns: { periodStart: 0, periodEnd: 1, amount: 2 },
    });
    expect(readings[0]).toMatchObject({ periodStart: "2026-07-01", periodEnd: "2026-07-31" });
  });

  it("falls back to the end month's range when the start column has an invalid date", () => {
    const rows = [["invalid", "2026/07/31", "5000"]];
    const mapping: CsvMapping = {
      utility: "gas",
      buildingId: "b1",
      hasHeader: false,
      columns: { periodStart: 0, periodEnd: 1, amount: 2 },
    };
    const { readings } = mapRowsToReadings(rows, mapping);
    expect(readings[0]).toMatchObject({ periodStart: "2026-07-01", periodEnd: "2026-07-31" });
  });

  it("sets usage and unit to null when there is no usage column or the cell is empty", () => {
    const rows = [
      ["2026/06", "", "3000"], // usage column is mapped but empty
    ];
    const mapping: CsvMapping = {
      utility: "electricity",
      buildingId: "b1",
      hasHeader: false,
      columns: { periodEnd: 0, usage: 1, amount: 2 },
    };
    const { readings } = mapRowsToReadings(rows, mapping);
    expect(readings[0].usageValue).toBeNull();
    expect(readings[0].usageUnit).toBeNull();

    // null too when the usage column is not mapped at all
    const noUsage = mapRowsToReadings([["2026/06", "3000"]], {
      utility: "electricity",
      buildingId: "b1",
      hasHeader: false,
      columns: { periodEnd: 0, amount: 1 },
    });
    expect(noUsage.readings[0].usageValue).toBeNull();
  });

  it("sends rows with invalid amount or date to errors and silently skips blank rows", () => {
    const rows = [
      ["年月", "請求額"],
      ["2026/06", "3000"], // ok  → dataRows[0] rowIndex 1
      ["2026/06", "notnum"], // invalid amount -> rowIndex 2
      ["baddate", "3000"], // invalid date -> rowIndex 3
      ["", ""], // blank row -> skip
    ];
    const mapping: CsvMapping = {
      utility: "electricity",
      buildingId: "b1",
      hasHeader: true,
      columns: { periodEnd: 0, amount: 1 },
    };
    const { readings, errors } = mapRowsToReadings(rows, mapping);
    expect(readings).toHaveLength(1);
    expect(errors).toEqual([
      { row: 2, reason: "金額を数値として解釈できません" },
      { row: 3, reason: "日付を解釈できません" },
    ]);
  });

  it("sends reversed periods (end < start) to the error rows", () => {
    const rows = [["2026/07/31", "2026/07/01", "5000"]];
    const { readings, errors } = mapRowsToReadings(rows, {
      utility: "gas",
      buildingId: "b1",
      hasHeader: false,
      columns: { periodStart: 0, periodEnd: 1, amount: 2 },
    });
    expect(readings).toHaveLength(0);
    expect(errors).toEqual([{ row: 0, reason: "検針期間の終了日が開始日より前です" }]);
  });

  describe("building resolution", () => {
    const oldHome: Building = { id: "old", name: "旧居", movedInOn: "2025-01-01", movedOutOn: "2026-05-31" };
    const newHome: Building = { id: "new", name: "新居", movedInOn: "2026-06-01", movedOutOn: null };

    it("infers the building per row from residence periods when buildingId is omitted (splits a CSV spanning a move)", () => {
      const rows = [
        ["2026/05", "3000"],
        ["2026/06", "3200"],
      ];
      const { readings, errors } = mapRowsToReadings(rows, {
        utility: "electricity",
        buildings: [oldHome, newHome],
        hasHeader: false,
        columns: { periodEnd: 0, amount: 1 },
      });
      expect(errors).toEqual([]);
      expect(readings.map((r) => r.buildingId)).toEqual(["old", "new"]);
    });

    it("sends rows that match no residence period to errors", () => {
      const rows = [["2024/01", "3000"]];
      const { readings, errors } = mapRowsToReadings(rows, {
        utility: "electricity",
        buildings: [oldHome, newHome],
        hasHeader: false,
        columns: { periodEnd: 0, amount: 1 },
      });
      expect(readings).toHaveLength(0);
      expect(errors).toEqual([{ row: 0, reason: "検針期間に該当する建物がありません" }]);
    });

    it("fails every row when neither buildingId nor buildings is given", () => {
      const { readings, errors } = mapRowsToReadings([["2026/06", "3000"]], {
        utility: "electricity",
        hasHeader: false,
        columns: { periodEnd: 0, amount: 1 },
      });
      expect(readings).toHaveLength(0);
      expect(errors).toEqual([{ row: 0, reason: "検針期間に該当する建物がありません" }]);
    });
  });
});

describe("guessColumns / guessUtility", () => {
  it("infers columns and utility from Tokyo Waterworks headers (billed amount over current charge)", () => {
    const header = [
      "お客さま番号",
      "水道ご使用場所",
      "使用者名",
      "合計今回料金（円）",
      "合計請求金額（円）",
      "水道使用量（m3）",
      "使用月分",
      "使用期間",
    ];
    expect(guessColumns(header)).toEqual({ periodEnd: 6, periodStart: 7, amount: 4, usage: 5 });
    expect(guessUtility(header)).toBe("water");
  });

  it("infers TEPCO and LPIO headers too", () => {
    expect(guessColumns(["年月", "使用量(kWh)", "請求額(円)"])).toEqual({
      periodEnd: 0,
      periodStart: null,
      amount: 2,
      usage: 1,
    });
    expect(guessUtility(["年月", "使用量(kWh)", "請求額(円)"])).toBe("electricity");
    expect(guessColumns(["年月", "使用量", "ご利用金額"])).toEqual({
      periodEnd: 0,
      periodStart: null,
      amount: 2,
      usage: 1,
    });
    expect(guessUtility(["年月", "ガス使用量", "ご利用金額"])).toBe("gas");
  });

  it("returns null for unmatched columns and utility", () => {
    expect(guessColumns(["a", "b"])).toEqual({ periodEnd: null, periodStart: null, amount: null, usage: null });
    expect(guessUtility(["a", "b"])).toBeNull();
  });
});

describe("readingKey / dedupe", () => {
  const mk = (u: NewReading["utility"], s: string, e: string, buildingId = "b1"): NewReading => ({
    utility: u,
    buildingId,
    provider: "x",
    periodStart: s,
    periodEnd: e,
    amountYen: 1,
    usageValue: null,
    usageUnit: null,
    note: null,
    source: "csv",
  });

  it("readingKey is unique per building, utility and period", () => {
    expect(readingKey(mk("gas", "2026-06-01", "2026-06-30"))).toBe("b1|gas|2026-06-01|2026-06-30");
  });

  it("gives different keys for different buildings with the same utility and period", () => {
    expect(readingKey(mk("gas", "2026-06-01", "2026-06-30", "b1"))).not.toBe(
      readingKey(mk("gas", "2026-06-01", "2026-06-30", "b2"))
    );
  });

  it("sorts existing keys and in-file repeats into duplicates (other buildings are not duplicates)", () => {
    const incoming = [
      mk("electricity", "2026-06-01", "2026-06-30"),
      mk("electricity", "2026-06-01", "2026-06-30"), // duplicate within the file
      mk("water", "2026-05-01", "2026-06-30"), // already exists
      mk("gas", "2026-06-01", "2026-06-30"), // new
      mk("water", "2026-05-01", "2026-06-30", "b2"), // same period as an existing record but another building -> new
    ];
    const existing = ["b1|water|2026-05-01|2026-06-30"];
    const { toInsert, duplicates } = dedupe(incoming, existing);
    expect(toInsert.map(readingKey)).toEqual([
      "b1|electricity|2026-06-01|2026-06-30",
      "b1|gas|2026-06-01|2026-06-30",
      "b2|water|2026-05-01|2026-06-30",
    ]);
    expect(duplicates).toHaveLength(2);
  });
});
