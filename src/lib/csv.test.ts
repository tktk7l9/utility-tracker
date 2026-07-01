import { describe, it, expect } from "vitest";
import {
  parseCsv,
  toHalfWidth,
  normalizeNumber,
  normalizeDate,
  monthRange,
  mapRowsToReadings,
  readingKey,
  dedupe,
  type CsvMapping,
} from "./csv";
import type { NewReading } from "./domain";

describe("parseCsv", () => {
  it("基本のカンマ区切り＋LF", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("クオート囲みのカンマ・CRLF・末尾改行", () => {
    expect(parseCsv('x,"a,b",z\r\n1,2,3\r\n')).toEqual([
      ["x", "a,b", "z"],
      ["1", "2", "3"],
    ]);
  });

  it('""エスケープ・改行なし末尾フラッシュ', () => {
    expect(parseCsv('"he said ""hi"""')).toEqual([['he said "hi"']]);
  });

  it("空文字は空配列", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("先頭BOMを除去する", () => {
    expect(parseCsv("\uFEFFa\n")).toEqual([["a"]]);
  });

  it("空行は空セルの行として保持される", () => {
    expect(parseCsv("a\n\nb")).toEqual([["a"], [""], ["b"]]);
  });
});

describe("toHalfWidth", () => {
  it("全角英数記号・スペース・各種ハイフンを半角化", () => {
    expect(toHalfWidth("ＡＢ１２３．，　－ー―")).toBe("AB123., ---");
  });
});

describe("normalizeNumber", () => {
  it("通貨・カンマ・単位を除去して数値化", () => {
    expect(normalizeNumber("¥1,234円")).toBe(1234);
    expect(normalizeNumber("12.5kWh")).toBe(12.5);
    expect(normalizeNumber("5 m³")).toBe(5);
    expect(normalizeNumber("１，２３４")).toBe(1234);
    expect(normalizeNumber("1,234.56")).toBe(1234.56);
  });
  it("空・ハイフン・非数値・null は null", () => {
    expect(normalizeNumber("")).toBeNull();
    expect(normalizeNumber("-")).toBeNull();
    expect(normalizeNumber("abc")).toBeNull();
    expect(normalizeNumber(null)).toBeNull();
    expect(normalizeNumber(undefined)).toBeNull();
  });
});

describe("normalizeDate", () => {
  it("各種フォーマットを YYYY-MM-DD に正規化", () => {
    expect(normalizeDate("2026/6/1")).toBe("2026-06-01");
    expect(normalizeDate("2026-06-19")).toBe("2026-06-19");
    expect(normalizeDate("2026年6月1日")).toBe("2026-06-01");
    expect(normalizeDate("2026年6月")).toBe("2026-06-01");
    expect(normalizeDate("２０２６/０６/１９")).toBe("2026-06-19");
    expect(normalizeDate("2026.6.1")).toBe("2026-06-01");
  });
  it("2桁年は 20xx として解釈（LPIO「26年06月」形式）", () => {
    expect(normalizeDate("26年06月")).toBe("2026-06-01");
    expect(normalizeDate("25年12月")).toBe("2025-12-01");
    expect(normalizeDate("26/6/1")).toBe("2026-06-01");
    expect(normalizeDate("00年01月")).toBe("2000-01-01");
  });
  it("解釈不能・範囲外・null は null", () => {
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

describe("monthRange", () => {
  it("その月の初日・末日を返す", () => {
    expect(monthRange("2026-06-15")).toEqual({ start: "2026-06-01", end: "2026-06-30" });
  });
  it("うるう年の2月を正しく扱う", () => {
    expect(monthRange("2024-02-10")).toEqual({ start: "2024-02-01", end: "2024-02-29" });
    expect(monthRange("2025-02-10")).toEqual({ start: "2025-02-01", end: "2025-02-28" });
  });
});

describe("mapRowsToReadings", () => {
  it("ヘッダ付き・月のみ列 → 月全体を期間として按分（TEPCO想定）", () => {
    const rows = [
      ["年月", "使用量(kWh)", "請求額(円)"],
      ["2026/05", "120", "3,000"],
      ["2026/06", "100", "3,200"],
    ];
    const mapping: CsvMapping = {
      utility: "electricity",
      hasHeader: true,
      columns: { periodEnd: 0, usage: 1, amount: 2 },
    };
    const { readings, errors } = mapRowsToReadings(rows, mapping);
    expect(errors).toEqual([]);
    expect(readings).toHaveLength(2);
    expect(readings[0]).toMatchObject({
      utility: "electricity",
      provider: "TEPCO",
      periodStart: "2026-05-01",
      periodEnd: "2026-05-31",
      amountYen: 3000,
      usageValue: 120,
      usageUnit: "kWh",
      source: "csv",
    });
  });

  it("LPIO「1年間の使用実績」形式（2桁年・¥金額）を取り込める", () => {
    const rows = [
      ["年月", "使用量", "ご利用金額"],
      ["26年06月", "22.0", "¥4,331"],
      ["25年07月", "17.0", "¥3,625"],
    ];
    const { readings, errors } = mapRowsToReadings(rows, {
      utility: "gas",
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

  it("開始・終了の両列指定 → 期間そのまま。provider/unit も上書きできる", () => {
    const rows = [["2026/05/20", "2026/06/19", "6200", "24"]];
    const mapping: CsvMapping = {
      utility: "water",
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

  it("開始列が不正日付なら終了月の月範囲にフォールバック", () => {
    const rows = [["invalid", "2026/07/31", "5000"]];
    const mapping: CsvMapping = {
      utility: "gas",
      hasHeader: false,
      columns: { periodStart: 0, periodEnd: 1, amount: 2 },
    };
    const { readings } = mapRowsToReadings(rows, mapping);
    expect(readings[0]).toMatchObject({ periodStart: "2026-07-01", periodEnd: "2026-07-31" });
  });

  it("使用量列なし／空セルは使用量 null・単位 null", () => {
    const rows = [
      ["2026/06", "", "3000"], // usage 列は指定するが空
    ];
    const mapping: CsvMapping = {
      utility: "electricity",
      hasHeader: false,
      columns: { periodEnd: 0, usage: 1, amount: 2 },
    };
    const { readings } = mapRowsToReadings(rows, mapping);
    expect(readings[0].usageValue).toBeNull();
    expect(readings[0].usageUnit).toBeNull();

    // usage 列自体を指定しない場合も null
    const noUsage = mapRowsToReadings([["2026/06", "3000"]], {
      utility: "electricity",
      hasHeader: false,
      columns: { periodEnd: 0, amount: 1 },
    });
    expect(noUsage.readings[0].usageValue).toBeNull();
  });

  it("金額・日付が不正な行はエラーに回し、空行は黙って飛ばす", () => {
    const rows = [
      ["年月", "請求額"],
      ["2026/06", "3000"], // ok  → dataRows[0] rowIndex 1
      ["2026/06", "notnum"], // 金額不正 → rowIndex 2
      ["baddate", "3000"], // 日付不正 → rowIndex 3
      ["", ""], // 空行 → skip
    ];
    const mapping: CsvMapping = {
      utility: "electricity",
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

  it("期間逆転(終了<開始)はエラー行に回す", () => {
    const rows = [["2026/07/31", "2026/07/01", "5000"]];
    const { readings, errors } = mapRowsToReadings(rows, {
      utility: "gas",
      hasHeader: false,
      columns: { periodStart: 0, periodEnd: 1, amount: 2 },
    });
    expect(readings).toHaveLength(0);
    expect(errors).toEqual([{ row: 0, reason: "検針期間の終了日が開始日より前です" }]);
  });
});

describe("readingKey / dedupe", () => {
  const mk = (u: NewReading["utility"], s: string, e: string): NewReading => ({
    utility: u,
    provider: "x",
    periodStart: s,
    periodEnd: e,
    amountYen: 1,
    usageValue: null,
    usageUnit: null,
    note: null,
    source: "csv",
  });

  it("readingKey は光熱費＋期間で一意", () => {
    expect(readingKey(mk("gas", "2026-06-01", "2026-06-30"))).toBe("gas|2026-06-01|2026-06-30");
  });

  it("既存キー・ファイル内重複を duplicates に振り分ける", () => {
    const incoming = [
      mk("electricity", "2026-06-01", "2026-06-30"),
      mk("electricity", "2026-06-01", "2026-06-30"), // ファイル内重複
      mk("water", "2026-05-01", "2026-06-30"), // 既存にあり
      mk("gas", "2026-06-01", "2026-06-30"), // 新規
    ];
    const existing = ["water|2026-05-01|2026-06-30"];
    const { toInsert, duplicates } = dedupe(incoming, existing);
    expect(toInsert.map(readingKey)).toEqual([
      "electricity|2026-06-01|2026-06-30",
      "gas|2026-06-01|2026-06-30",
    ]);
    expect(duplicates).toHaveLength(2);
  });
});
