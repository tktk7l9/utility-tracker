// CSV取込の純ロジック。パース → 正規化 → NewReading への写像 → 重複除外。
// TEPCO 想定だが、列マッピングで任意のCSVに対応できる汎用設計。
// 各社フォーマットが未知でも UI の列マッピングで吸収する。

import { UTILITIES, type Building, type NewReading, type Utility } from "./domain";
import { inferBuilding } from "./buildings";

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * 最小構成のCSVパーサ。ダブルクオート囲み・""エスケープ・CRLF/LF・先頭BOMに対応。
 * 末尾改行は空行を生まない。
 */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** 全角英数記号・全角スペース・各種ハイフンを半角へ。 */
export function toHalfWidth(s: string): string {
  return s
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/．/g, ".")
    .replace(/，/g, ",")
    .replace(/　/g, " ")
    .replace(/[－ー―]/g, "-");
}

/** "¥1,234円" や全角数字を数値に。空・非数値は null。 */
export function normalizeNumber(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = toHalfWidth(String(raw))
    .replace(/[,\s¥￥円]/g, "")
    .replace(/kWh|m3|m³|㎥/gi, "");
  if (s === "" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * "2026/6/1" "2026-06-01" "2026年6月1日" "2026年6月"（日省略=1日）を
 * "YYYY-MM-DD" へ正規化。解釈不能なら null。
 */
export function normalizeDate(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let s = toHalfWidth(String(raw)).trim();
  if (s === "") return null;
  s = s.replace(/[年月]/g, "/").replace(/日/g, "").replace(/\/+$/, "");
  const parts = s
    .split(/[/\-.]/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
  if (parts.length < 2) return null;
  let y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = parts.length >= 3 ? Number(parts[2]) : 1;
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  // 2桁年（LPIO「26年06月」等）は 20xx として解釈する。
  if (y < 100) y += 2000;
  if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** "YYYY-MM-DD" の属する月の初日・末日を返す。 */
export function monthRange(iso: string): { start: string; end: string } {
  const [y, m] = iso.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${y}-${pad2(m)}-01`, end: `${y}-${pad2(m)}-${pad2(lastDay)}` };
}

export interface CsvMapping {
  /** このCSV全体が対象とする光熱費。 */
  utility: Utility;
  /** 取込先の建物。省略時は `buildings` から検針期間で行ごとに自動推定。 */
  buildingId?: string;
  /** `buildingId` 省略時の推定候補（居住期間で照合）。 */
  buildings?: Building[];
  /** 事業者名（省略時は光熱費の既定値）。 */
  provider?: string;
  /** 使用量の単位（省略時は光熱費の既定値）。 */
  usageUnit?: string;
  /** 1行目をヘッダとして読み飛ばすか。 */
  hasHeader: boolean;
  columns: {
    /** 期間開始列（省略時は periodEnd の属する月全体を期間とする）。 */
    periodStart?: number;
    /** 期間終了列 or 検針日/請求月の列（必須）。 */
    periodEnd: number;
    /** 金額列（必須）。 */
    amount: number;
    /** 使用量列（任意）。 */
    usage?: number;
  };
}

export interface RowError {
  /** 0始まりの元行インデックス。 */
  row: number;
  reason: string;
}

export interface MapResult {
  readings: NewReading[];
  errors: RowError[];
}

/** 行が全セル空か。 */
function isBlankRow(cells: string[]): boolean {
  // trim() は全角スペース(U+3000)も除去するため、空白のみのセルも空とみなせる。
  return cells.every((c) => c.trim() === "");
}

/** パース済みの行群を、マッピングに従って NewReading[] に変換する。 */
export function mapRowsToReadings(rows: string[][], mapping: CsvMapping): MapResult {
  const meta = UTILITIES[mapping.utility];
  const provider = mapping.provider ?? meta.provider;
  const usageUnit = mapping.usageUnit ?? meta.unit;
  const { periodStart: startCol, periodEnd: endCol, amount: amountCol, usage: usageCol } = mapping.columns;

  const dataRows = mapping.hasHeader ? rows.slice(1) : rows;
  const headerOffset = mapping.hasHeader ? 1 : 0;

  const readings: NewReading[] = [];
  const errors: RowError[] = [];

  dataRows.forEach((cells, idx) => {
    const rowIndex = idx + headerOffset;
    if (isBlankRow(cells)) return;

    const amount = normalizeNumber(cells[amountCol]);
    const endDate = normalizeDate(cells[endCol]);

    if (amount == null) {
      errors.push({ row: rowIndex, reason: "金額を数値として解釈できません" });
      return;
    }
    if (endDate == null) {
      errors.push({ row: rowIndex, reason: "日付を解釈できません" });
      return;
    }

    let periodStart: string;
    let periodEnd: string;
    const rawStart = startCol != null ? normalizeDate(cells[startCol]) : null;
    if (rawStart != null) {
      periodStart = rawStart;
      periodEnd = endDate;
    } else {
      const range = monthRange(endDate);
      periodStart = range.start;
      periodEnd = range.end;
    }

    // 期間逆転（終了<開始）は集計に寄与しない“死んだ行”になるためエラーに回す。
    if (periodEnd < periodStart) {
      errors.push({ row: rowIndex, reason: "検針期間の終了日が開始日より前です" });
      return;
    }

    // 建物: 固定指定がなければ検針期間と居住期間の重なりから行ごとに推定
    // （引っ越しをまたぐ CSV も1回の取込で振り分けられる）。
    const buildingId =
      mapping.buildingId ?? inferBuilding(mapping.buildings ?? [], periodStart, periodEnd)?.id;
    if (buildingId == null) {
      errors.push({ row: rowIndex, reason: "検針期間に該当する建物がありません" });
      return;
    }

    const usageValue = usageCol != null ? normalizeNumber(cells[usageCol]) : null;

    readings.push({
      utility: mapping.utility,
      buildingId,
      provider,
      periodStart,
      periodEnd,
      amountYen: Math.round(amount),
      usageValue,
      usageUnit: usageValue != null ? usageUnit : null,
      note: null,
      source: "csv",
    });
  });

  return { readings, errors };
}

/** 一意キー（同一建物・同一光熱費・同一期間を重複とみなす。DB の一意制約と同じ粒度）。 */
export function readingKey(r: {
  buildingId: string;
  utility: Utility;
  periodStart: string;
  periodEnd: string;
}): string {
  return `${r.buildingId}|${r.utility}|${r.periodStart}|${r.periodEnd}`;
}

export interface DedupeResult {
  toInsert: NewReading[];
  duplicates: NewReading[];
}

/**
 * 取込候補を、既存キー集合＆ファイル内重複に対して振り分ける。
 * 既存キーまたは同一ファイル内で既出のものは duplicates に回す。
 */
export function dedupe(incoming: NewReading[], existingKeys: Iterable<string>): DedupeResult {
  const seen = new Set<string>(existingKeys);
  const toInsert: NewReading[] = [];
  const duplicates: NewReading[] = [];
  for (const r of incoming) {
    const key = readingKey(r);
    if (seen.has(key)) {
      duplicates.push(r);
    } else {
      seen.add(key);
      toInsert.push(r);
    }
  }
  return { toInsert, duplicates };
}
