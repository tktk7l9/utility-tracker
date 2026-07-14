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
  it("2桁年は西暦20xx／令和のうち today に近い方（LPIO「26年06月」・水道局「8年 6月」）", () => {
    const today = new Date("2026-07-14");
    expect(normalizeDate("26年06月", today)).toBe("2026-06-01"); // 西暦2026 が令和26(2044)より近い
    expect(normalizeDate("25年12月", today)).toBe("2025-12-01");
    expect(normalizeDate("26/6/1", today)).toBe("2026-06-01");
    expect(normalizeDate("8年 6月", today)).toBe("2026-06-01"); // 令和8(2026) が西暦2008より近い
    expect(normalizeDate("00年01月", today)).toBe("2000-01-01"); // 令和0年は存在しない → 西暦
    expect(normalizeDate("8年1月", new Date("2017-06-01"))).toBe("2008-01-01"); // 同距離なら西暦
  });
  it("和暦＋範囲＋「分」（東京都水道局「使用月分」）は終端側を採る", () => {
    const today = new Date("2026-07-14");
    expect(normalizeDate(" 8年 6月 ～  8年 7月分", today)).toBe("2026-07-01");
    expect(normalizeDate("2026/06")).toBe("2026-06-01");
  });
  it("年を持たない部分表記（月日・月のみ・日のみ）は単独では null", () => {
    expect(normalizeDate("5月14日")).toBeNull();
    expect(normalizeDate("6月")).toBeNull();
    expect(normalizeDate("10日")).toBeNull();
    expect(normalizeDate("8年月")).toBeNull(); // 崩れた表記
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

describe("normalizeDateRange", () => {
  const today = new Date("2026-07-14");

  it("年なしの両側を anchor の年で補完する（水道局「使用期間」）", () => {
    expect(normalizeDateRange(" 5月14日 ～  7月10日", "2026-07-01", today)).toEqual({
      start: "2026-05-14",
      end: "2026-07-10",
    });
  });

  it("開始>終了は年またぎ期間として開始を前年に倒す", () => {
    expect(normalizeDateRange("11月14日 ～ 1月10日", "2026-01-31", today)).toEqual({
      start: "2025-11-14",
      end: "2026-01-10",
    });
    // 同月内で日が逆転しているケースも同じ規則
    expect(normalizeDateRange("6月20日 ～ 6月10日", "2026-06-30", today)).toEqual({
      start: "2025-06-20",
      end: "2026-06-10",
    });
  });

  it("anchor と半年超ずれる終端は年またぎとして補正する", () => {
    expect(normalizeDateRange("11月14日 ～ 12月28日", "2026-01-31", today)).toEqual({
      start: "2025-11-14",
      end: "2025-12-28",
    });
    expect(normalizeDateRange("1月4日 ～ 1月20日", "2026-12-01", today)).toEqual({
      start: "2027-01-04",
      end: "2027-01-20",
    });
  });

  it("年つきの側は自前の年を使う（和暦・西暦とも）", () => {
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

  it("月のみの側は1日として扱う", () => {
    expect(normalizeDateRange("6月 ～ 7月10日", "2026-07-01", today)).toEqual({
      start: "2026-06-01",
      end: "2026-07-10",
    });
  });

  it("解釈不能・区切りが2側でない・範囲外は null", () => {
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

  it("LPIO「1年間の使用実績」形式（2桁年・¥金額）を取り込める", () => {
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

  it("開始・終了の両列指定 → 期間そのまま。provider/unit も上書きできる", () => {
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

  it("東京都水道局 meterdata 形式（使用月分=和暦・使用期間=1セル内範囲）を取り込める", () => {
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

  it("開始列の範囲表記が解釈できなければ終了月の月範囲にフォールバック", () => {
    const rows = [["あ ～ い", "2026/07/31", "5000"]];
    const { readings } = mapRowsToReadings(rows, {
      utility: "water",
      buildingId: "b1",
      hasHeader: false,
      columns: { periodStart: 0, periodEnd: 1, amount: 2 },
    });
    expect(readings[0]).toMatchObject({ periodStart: "2026-07-01", periodEnd: "2026-07-31" });
  });

  it("開始列が不正日付なら終了月の月範囲にフォールバック", () => {
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

  it("使用量列なし／空セルは使用量 null・単位 null", () => {
    const rows = [
      ["2026/06", "", "3000"], // usage 列は指定するが空
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

    // usage 列自体を指定しない場合も null
    const noUsage = mapRowsToReadings([["2026/06", "3000"]], {
      utility: "electricity",
      buildingId: "b1",
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

  it("期間逆転(終了<開始)はエラー行に回す", () => {
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

  describe("建物の解決", () => {
    const oldHome: Building = { id: "old", name: "旧居", movedInOn: "2025-01-01", movedOutOn: "2026-05-31" };
    const newHome: Building = { id: "new", name: "新居", movedInOn: "2026-06-01", movedOutOn: null };

    it("buildingId 省略時は行ごとに居住期間から推定（引っ越しまたぎ CSV を振り分け）", () => {
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

    it("どの居住期間にも該当しない行はエラーに回す", () => {
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

    it("buildingId も buildings も未指定なら全行エラー", () => {
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
  it("東京都水道局ヘッダから列と種別を推定する（今回料金より請求金額を優先）", () => {
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

  it("TEPCO・LPIO 形式のヘッダも推定できる", () => {
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

  it("該当しない列・種別は null", () => {
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

  it("readingKey は建物＋光熱費＋期間で一意", () => {
    expect(readingKey(mk("gas", "2026-06-01", "2026-06-30"))).toBe("b1|gas|2026-06-01|2026-06-30");
  });

  it("同一光熱費・同一期間でも建物が違えば別キー", () => {
    expect(readingKey(mk("gas", "2026-06-01", "2026-06-30", "b1"))).not.toBe(
      readingKey(mk("gas", "2026-06-01", "2026-06-30", "b2"))
    );
  });

  it("既存キー・ファイル内重複を duplicates に振り分ける（別建物は重複にしない）", () => {
    const incoming = [
      mk("electricity", "2026-06-01", "2026-06-30"),
      mk("electricity", "2026-06-01", "2026-06-30"), // ファイル内重複
      mk("water", "2026-05-01", "2026-06-30"), // 既存にあり
      mk("gas", "2026-06-01", "2026-06-30"), // 新規
      mk("water", "2026-05-01", "2026-06-30", "b2"), // 既存と同期間だが別建物 → 新規
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
