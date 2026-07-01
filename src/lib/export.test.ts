import { describe, it, expect } from "vitest";
import type { Reading } from "./domain";
import { toExportJson, toCsv, exportFilename } from "./export";

const rows: Reading[] = [
  {
    id: "1",
    utility: "electricity",
    provider: "TEPCO",
    periodStart: "2025-06-17",
    periodEnd: "2025-07-16",
    amountYen: 23837,
    usageValue: 663,
    usageUnit: "kWh",
    note: null,
    source: "csv",
  },
  {
    id: "2",
    utility: "water",
    provider: "TokyoWaterworks",
    periodStart: "2025-05-14",
    periodEnd: "2025-07-10",
    amountYen: 6146,
    usageValue: null,
    usageUnit: null,
    note: 'メモ,に"引用"と\n改行',
    source: "manual",
  },
];

describe("toExportJson", () => {
  it("整形JSONで往復できる", () => {
    const json = toExportJson(rows);
    expect(json).toContain("\n"); // pretty print
    expect(JSON.parse(json)).toEqual(rows);
  });
});

describe("toCsv", () => {
  const csv = toCsv(rows);
  const lines = csv.split("\r\n");

  it("ヘッダ行を持つ", () => {
    expect(lines[0]).toBe(
      "utility,provider,period_start,period_end,amount_yen,usage_value,usage_unit,note,source"
    );
  });
  it("通常行はそのまま", () => {
    expect(lines[1]).toBe("electricity,TEPCO,2025-06-17,2025-07-16,23837,663,kWh,,csv");
  });
  it("カンマ/引用符/改行はエスケープ、null は空", () => {
    // usage_value/usage_unit が null → 空セル、note は引用符で囲みつつ " を "" にエスケープ
    expect(lines[2]).toBe(
      'water,TokyoWaterworks,2025-05-14,2025-07-10,6146,,,"メモ,に""引用""と\n改行",manual'
    );
  });
});

describe("exportFilename", () => {
  it("日付入りのファイル名を作る", () => {
    const d = new Date(2026, 6, 1); // 2026-07-01（ローカル）
    expect(exportFilename("json", d)).toBe("utility-tracker_2026-07-01.json");
    expect(exportFilename("csv", d)).toBe("utility-tracker_2026-07-01.csv");
  });
});
