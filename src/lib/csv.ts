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

/** "5月14日 ～ 7月10日"（東京都水道局）のような1セル内期間の区切り。 */
const RANGE_SEP = /[～〜~]/;

interface DateParts {
  y: number | null;
  m: number;
  d: number | null;
}

/**
 * 1つの日付表記を年・月・日に分解する。年・日は省略可
 * （"5月14日"・"8年 7月分"・"6月" 等の部分表記を許す）。解釈不能なら null。
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
  // 1要素は "6月" のような月のみ表記だけを日付候補として許す（"2026"・"10日" は不可）。
  if (hasMonth && !hasYear) return { y: null, m: nums[0], d: null };
  return null;
}

/**
 * 2桁年を西暦2000年代（LPIO「26年06月」= 2026）と令和（東京都水道局「8年 6月」= 令和8年
 * = 2026）の両解釈で比較し、today の年に近い方を採る（同距離なら西暦。令和0年は存在しない）。
 */
function resolveTwoDigitYear(y: number, todayYear: number): number {
  const west = 2000 + y;
  if (y < 1) return west;
  const reiwa = 2018 + y;
  return Math.abs(reiwa - todayYear) < Math.abs(west - todayYear) ? reiwa : west;
}

/** 年月日をレンジ検証つきで "YYYY-MM-DD" にする。範囲外は null。 */
function toIso(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * "2026/6/1" "2026-06-01" "2026年6月1日" "2026年6月"（日省略=1日）"8年 7月分"（和暦）を
 * "YYYY-MM-DD" へ正規化。"6月 ～ 7月分" のような範囲表記は終端側を採る。解釈不能なら null。
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
 * "5月14日 ～ 7月10日" のような1セル内の期間表記を {start, end} に分解する。
 * 年が無い側は anchorEnd（期間終了列から得た "YYYY-MM-DD"）の年で補完し、
 * 月が半年超ずれる場合や開始>終了になる場合は年またぎ（12月→1月等）として補正する。
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
    // 東京都水道局の「使用期間」のような1セル内期間（"5月14日 ～ 7月10日"）は、
    // 終了列の日付（使用月分等）を年の基準にして開始・終了の両方をここから取る。
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

export interface ColumnGuess {
  periodEnd: number | null;
  periodStart: number | null;
  amount: number | null;
  usage: number | null;
}

/**
 * ヘッダ行の列名から列マッピングの初期値を推定する（TEPCO・LPIO・東京都水道局の実CSVを想定）。
 * 同名を含む列が複数あるときは先頭優先。該当なしの項目は null（UI 側で既定値に落とす）。
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

/** ヘッダの語彙から光熱費種別を推定する。判別できなければ null。 */
export function guessUtility(header: string[]): Utility | null {
  const joined = header.join(" ");
  if (joined.includes("水道")) return "water";
  if (joined.includes("ガス")) return "gas";
  if (/kWh|電気|電力/i.test(joined)) return "electricity";
  return null;
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
