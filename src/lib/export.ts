// 手入力・取込で積み上げた履歴のバックアップ／可搬用エクスポート（純関数）。
// データは Supabase にしか無いため、JSON/CSV で書き出せると保全性・可搬性が上がる。

import type { Building, Reading } from "./domain";

/** レコードを建物マスタごと整形 JSON 文字列に（居住期間まで含めて自己完結するバックアップ）。 */
export function toExportJson(readings: Reading[], buildings: Building[]): string {
  return JSON.stringify({ buildings, readings }, null, 2);
}

const CSV_HEADER = [
  "utility",
  "building",
  "provider",
  "period_start",
  "period_end",
  "amount_yen",
  "usage_value",
  "usage_unit",
  "note",
  "source",
] as const;

/** CSV セルのエスケープ（カンマ・引用符・改行を含む場合のみ引用符で囲む）。 */
function csvCell(value: string | number | null | undefined): string {
  if (value == null) return "";
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** レコードを CSV 文字列（CRLF 改行・ヘッダ付き）に。建物は名前で出力し、未解決なら id にフォールバック。 */
export function toCsv(readings: Reading[], buildings: Building[]): string {
  const nameById = new Map(buildings.map((b) => [b.id, b.name]));
  const lines = [CSV_HEADER.join(",")];
  for (const r of readings) {
    lines.push(
      [
        r.utility,
        nameById.get(r.buildingId) ?? r.buildingId,
        r.provider,
        r.periodStart,
        r.periodEnd,
        r.amountYen,
        r.usageValue,
        r.usageUnit,
        r.note ?? "",
        r.source,
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return lines.join("\r\n");
}

/** "utility-tracker_YYYY-MM-DD.json" 形式のファイル名。 */
export function exportFilename(ext: "json" | "csv", now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `utility-tracker_${stamp}.${ext}`;
}
