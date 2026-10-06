// Pure logic for CSV import. Parse -> normalize -> map to NewReading -> drop duplicates.
// Built with TEPCO in mind, but generic: column mapping handles any CSV.
// Even unknown provider formats are absorbed by the column mapping in the UI.

import { UTILITIES, type Building, type NewReading, type Utility } from "./domain";
import { inferBuilding } from "./buildings";

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * Upper bound for one imported file. A year of utility CSVs is a few KB and a bill PDF a few
 * hundred KB; anything larger is a wrong file, and parsing it in the browser would only freeze the tab.
 */
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

/** True when a selected file is too large to import (checked before it is read). */
export function exceedsImportLimit(sizeBytes: number): boolean {
  return sizeBytes > MAX_IMPORT_BYTES;
}

/**
 * Minimal CSV parser. Handles double-quoted fields, "" escapes, CRLF/LF and a leading BOM.
 * A trailing newline does not produce an empty row.
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

/** Converts full-width alphanumerics/symbols, full-width spaces and assorted hyphens to half-width. */
export function toHalfWidth(s: string): string {
  return s
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/．/g, ".")
    .replace(/，/g, ",")
    .replace(/　/g, " ")
    .replace(/[－ー―]/g, "-");
}

/** Turns "¥1,234円" or full-width digits into a number. Empty or non-numeric gives null. */
export function normalizeNumber(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = toHalfWidth(String(raw))
    .replace(/[,\s¥￥円]/g, "")
    .replace(/kWh|m3|m³|㎥/gi, "");
  if (s === "" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Separator of a period inside one cell, like "5月14日 ～ 7月10日" (Tokyo Waterworks, 東京都水道局). */
const RANGE_SEP = /[～〜~]/;

interface DateParts {
  y: number | null;
  m: number;
  d: number | null;
}

/**
 * Splits one date notation into year, month and day. Year and day are optional
 * (partial forms such as "5月14日", "8年 7月分", "6月" are allowed). null if it cannot be parsed.
 */
function parseDateParts(raw: string): DateParts | null {
  let s = toHalfWidth(raw).trim();
  if (s === "") return null;
  const hasYear = s.includes("年");
  const hasMonth = s.includes("月");
  s = s
    .replace(/分\s*$/, "")
    .replace(/[年月]/g, "/")
    .replace(/日/g, "")
    .replace(/\/+\s*$/, "");
  const parts = s
    .split(/[/\-.]/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
  if (parts.length === 0 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  if (nums.length >= 3) return { y: nums[0], m: nums[1], d: nums[2] };
  if (nums.length === 2) {
    if (hasYear) return { y: nums[0], m: nums[1], d: null }; // "8年 7月" "2026年6月"
    if (hasMonth) return { y: null, m: nums[0], d: nums[1] }; // "5月14日"
    return { y: nums[0], m: nums[1], d: null }; // "2026/06"
  }
  // A single element is accepted as a date candidate only when it is month-only like "6月" (not "2026" or "10日").
  if (hasMonth && !hasYear) return { y: null, m: nums[0], d: null };
  return null;
}

/**
 * Reads a 2-digit year both as 2000s Gregorian (LPIO "26年06月" = 2026) and as Reiwa (Tokyo Waterworks "8年 6月" = Reiwa 8
 * = 2026) and takes whichever is closer to today's year (Gregorian on a tie; Reiwa 0 does not exist).
 */
function resolveTwoDigitYear(y: number, todayYear: number): number {
  const west = 2000 + y;
  if (y < 1) return west;
  const reiwa = 2018 + y;
  return Math.abs(reiwa - todayYear) < Math.abs(west - todayYear) ? reiwa : west;
}

/** Builds "YYYY-MM-DD" from year/month/day with range checks. null when out of range. */
function toIso(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Normalizes "2026/6/1" "2026-06-01" "2026年6月1日" "2026年6月" (day omitted = 1st) "8年 7月分" (Japanese era year) to
 * "YYYY-MM-DD". For ranges like "6月 ～ 7月分" the end side is used. null if it cannot be parsed.
 */
export function normalizeDate(raw: string | null | undefined, today: Date = new Date()): string | null {
  if (raw == null) return null;
  const sides = String(raw).split(RANGE_SEP);
  const p = parseDateParts(sides[sides.length - 1]);
  if (p == null || p.y == null) return null;
  const y = p.y < 100 ? resolveTwoDigitYear(p.y, today.getFullYear()) : p.y;
  return toIso(y, p.m, p.d ?? 1);
}

/**
 * Splits a period inside one cell, like "5月14日 ～ 7月10日", into {start, end}.
 * A side without a year takes the year of anchorEnd ("YYYY-MM-DD" from the period-end column);
 * when the months differ by more than half a year or start > end, it is corrected as crossing a year (Dec -> Jan etc.).
 */
export function normalizeDateRange(
  raw: string | null | undefined,
  anchorEnd: string,
  today: Date = new Date()
): { start: string; end: string } | null {
  if (raw == null) return null;
  const sides = String(raw).split(RANGE_SEP);
  if (sides.length !== 2) return null;
  const sp = parseDateParts(sides[0]);
  const ep = parseDateParts(sides[1]);
  if (sp == null || ep == null) return null;

  const [anchorY, anchorM] = anchorEnd.split("-").map(Number);

  let ey: number;
  if (ep.y != null) {
    ey = ep.y < 100 ? resolveTwoDigitYear(ep.y, today.getFullYear()) : ep.y;
  } else {
    ey = anchorY;
    if (ep.m - anchorM > 6) ey -= 1;
    else if (anchorM - ep.m > 6) ey += 1;
  }
  const end = toIso(ey, ep.m, ep.d ?? 1);
  if (end == null) return null;

  let sy: number;
  if (sp.y != null) {
    sy = sp.y < 100 ? resolveTwoDigitYear(sp.y, today.getFullYear()) : sp.y;
  } else {
    sy = ey;
    if (sp.m > ep.m || (sp.m === ep.m && (sp.d ?? 1) > (ep.d ?? 1))) sy -= 1;
  }
  const start = toIso(sy, sp.m, sp.d ?? 1);
  if (start == null) return null;

  return { start, end };
}

/** Returns the first and last day of the month containing "YYYY-MM-DD". */
export function monthRange(iso: string): { start: string; end: string } {
  const [y, m] = iso.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${y}-${pad2(m)}-01`, end: `${y}-${pad2(m)}-${pad2(lastDay)}` };
}

export interface CsvMapping {
  /** The utility this whole CSV is for. */
  utility: Utility;
  /** Target building. When omitted, inferred per row from `buildings` by reading period. */
  buildingId?: string;
  /** Candidates for inference when `buildingId` is omitted (matched by residence period). */
  buildings?: Building[];
  /** Provider name (defaults to the utility's default). */
  provider?: string;
  /** Usage unit (defaults to the utility's default). */
  usageUnit?: string;
  /** Whether to skip the first row as a header. */
  hasHeader: boolean;
  columns: {
    /** Period start column (when omitted, the whole month containing periodEnd is the period). */
    periodStart?: number;
    /** Period end column, or the reading date / billing month column (required). */
    periodEnd: number;
    /** Amount column (required). */
    amount: number;
    /** Usage column (optional). */
    usage?: number;
  };
}

export interface RowError {
  /** 0-based index of the source row. */
  row: number;
  reason: string;
}

export interface MapResult {
  readings: NewReading[];
  errors: RowError[];
}

/** Whether every cell in the row is empty. */
function isBlankRow(cells: string[]): boolean {
  // trim() also strips full-width spaces (U+3000), so whitespace-only cells count as empty.
  return cells.every((c) => c.trim() === "");
}

/** Converts parsed rows into NewReading[] according to the mapping. */
export function mapRowsToReadings(rows: string[][], mapping: CsvMapping, today: Date = new Date()): MapResult {
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
    const endDate = normalizeDate(cells[endCol], today);

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
    const startCell = startCol != null ? cells[startCol] : undefined;
    // For a period inside one cell like Tokyo Waterworks' 「使用期間」 ("5月14日 ～ 7月10日"),
    // take both start and end from it, using the end column's date (e.g. usage month) as the year anchor.
    const cellRange = startCell != null && RANGE_SEP.test(startCell) ? normalizeDateRange(startCell, endDate, today) : null;
    if (cellRange != null) {
      periodStart = cellRange.start;
      periodEnd = cellRange.end;
    } else {
      const rawStart = startCell != null && !RANGE_SEP.test(startCell) ? normalizeDate(startCell, today) : null;
      if (rawStart != null) {
        periodStart = rawStart;
        periodEnd = endDate;
      } else {
        const range = monthRange(endDate);
        periodStart = range.start;
        periodEnd = range.end;
      }
    }

    // A reversed period (end < start) would be a "dead row" that never counts in aggregation, so report it as an error.
    if (periodEnd < periodStart) {
      errors.push({ row: rowIndex, reason: "検針期間の終了日が開始日より前です" });
      return;
    }

    // Building: unless fixed, inferred per row from the overlap of reading and residence periods
    // (so a CSV spanning a move is split in a single import).
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

export interface ColumnGuess {
  periodEnd: number | null;
  periodStart: number | null;
  amount: number | null;
  usage: number | null;
}

/**
 * Infers the initial column mapping from header names (modeled on real TEPCO, LPIO and Tokyo Waterworks CSVs).
 * When several columns contain the same name, the first wins. Fields with no match are null (the UI falls back to defaults).
 */
export function guessColumns(header: string[]): ColumnGuess {
  const find = (...patterns: RegExp[]): number | null => {
    for (const p of patterns) {
      const i = header.findIndex((h) => p.test(h));
      if (i !== -1) return i;
    }
    return null;
  };
  return {
    periodEnd: find(/使用月分/, /検針日/, /年月/, /日付/),
    periodStart: find(/使用期間/),
    amount: find(/請求金額/, /請求額/, /利用金額/, /金額/, /料金/),
    usage: find(/使用量/),
  };
}

/** Infers the utility type from header vocabulary. null if it cannot tell. */
export function guessUtility(header: string[]): Utility | null {
  const joined = header.join(" ");
  if (joined.includes("水道")) return "water";
  if (joined.includes("ガス")) return "gas";
  if (/kWh|電気|電力/i.test(joined)) return "electricity";
  return null;
}

/** Unique key (same building, utility and period count as duplicates; same granularity as the DB unique constraint). */
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
 * Sorts import candidates against the set of existing keys and in-file duplicates.
 * Anything matching an existing key or already seen in the same file goes to duplicates.
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
