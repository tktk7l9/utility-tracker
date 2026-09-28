// Pure functions that parse text extracted from bill PDFs (PDF.js output).
// Reading the PDF itself is done by the browser-only pdfText.ts; this file only handles strings (easy to test).
// Supported: TEPCO Energy Partner 「電気料金等請求書」, LPIO 「御請求書」 (gas),
// Tokyo Waterworks 「ご使用水量等のお知らせ」.
// Periods use the dates printed on the PDF as is (LPIO runs from the previous to the current reading date, so the boundary day appears in both bills;
// aggregate.ts prorates that day into the earlier period only).

import { UTILITIES, type Utility } from "./domain";
import { normalizeDate, normalizeDateRange } from "./csv";

export type BillKind = "tepco" | "lpio" | "tokyo-water";

export interface ParsedBill {
  utility: Utility;
  provider: string;
  periodStart: string;
  periodEnd: string;
  amountYen: number;
  usageValue: number | null;
  usageUnit: string | null;
}

export type BillParseResult = { ok: true; bills: ParsedBill[] } | { ok: false; reason: string };

/** Period notation like "7月17日～ 8月18日" (separator ～, 〜 or ~). */
const PERIOD = String.raw`\d{1,2}月\s*\d{1,2}日\s*[～〜~]\s*\d{1,2}月\s*\d{1,2}日`;

/**
 * Normalizes compatibility characters such as full-width alphanumerics and ㎥ to standard ones. Tokyo Waterworks PDFs return 「月・水・用・金」 etc.
 * as look-alike Kangxi radicals (⽉⽔⽤⾦), so without normalizing neither phrases nor dates match.
 */
function normalizeText(text: string): string {
  return text.normalize("NFKC");
}

/** Detects the bill type from the provider name. null when unsupported. */
export function detectBillKind(text: string): BillKind | null {
  const t = normalizeText(text);
  if (t.includes("東京電力エナジーパートナー")) return "tepco";
  if (t.includes("エルピオ") && t.includes("ガス料金")) return "lpio";
  if (t.includes("東京都水道局")) return "tokyo-water";
  return null;
}

/** Turns year and month numbers into an anchor date "YYYY-MM-01" used to fill in the period's year. */
function anchorOf(year: string, month: string): string {
  return `${year}-${month.padStart(2, "0")}-01`;
}

/** "20,277" -> 20277. */
function toNumber(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

function parseTepco(text: string, today: Date): BillParseResult {
  const period = new RegExp(`ご使用期間\\s*(${PERIOD})`).exec(text);
  if (!period) return { ok: false, reason: "ご使用期間が見つかりません" };
  // The year comes from the charge confirmation date, or else the billing month line ("2026年08月"). Year-months with a day, like the update date, are excluded.
  const anchor = /料金確定日\s*(\d{4})年\s*(\d{1,2})月/.exec(text) ?? /(\d{4})年\s*(\d{1,2})月(?!\s*\d)/.exec(text);
  if (!anchor) return { ok: false, reason: "請求の年月が見つかりません" };
  const range = normalizeDateRange(period[1], anchorOf(anchor[1], anchor[2]), today);
  if (!range) return { ok: false, reason: "ご使用期間を解釈できません" };
  const amount = /請求金額\s*([\d,]+)\s*円/.exec(text);
  if (!amount) return { ok: false, reason: "請求金額が見つかりません" };
  // The unit price notation 「(1kWhあたり)」 is not usage, so exclude it.
  const usage = /([\d,.]+)\s*kWh(?!あたり)/.exec(text);
  const meta = UTILITIES.electricity;
  return {
    ok: true,
    bills: [
      {
        utility: "electricity",
        provider: meta.provider,
        periodStart: range.start,
        periodEnd: range.end,
        amountYen: Math.round(toNumber(amount[1])),
        usageValue: usage ? toNumber(usage[1]) : null,
        usageUnit: usage ? meta.unit : null,
      },
    ],
  };
}

function parseLpio(text: string, today: Date): BillParseResult {
  const month = /請求年月\s*(\d{4})年\s*(\d{1,2})月/.exec(text);
  if (!month) return { ok: false, reason: "請求年月が見つかりません" };
  const anchor = anchorOf(month[1], month[2]);
  // Line item: "08/06 26080601 ガス料金(都市ガス) 07月06日~08月06日 19.0 3,685" (quantity = m³, amount = yen)
  const lines = [...text.matchAll(new RegExp(`ガス料金[^\\n]*?(${PERIOD})\\s+([\\d,.]+)\\s+([\\d,]+)`, "g"))];
  if (lines.length === 0) return { ok: false, reason: "ガス料金の明細行が見つかりません" };
  const meta = UTILITIES.gas;
  const bills: ParsedBill[] = [];
  for (const line of lines) {
    const range = normalizeDateRange(line[1], anchor, today);
    if (!range) return { ok: false, reason: "ガス料金の期間を解釈できません" };
    bills.push({
      utility: "gas",
      provider: meta.provider,
      periodStart: range.start,
      periodEnd: range.end,
      amountYen: Math.round(toNumber(line[3])),
      usageValue: toNumber(line[2]),
      usageUnit: meta.unit,
    });
  }
  return { ok: true, bills };
}

function parseTokyoWater(text: string, today: Date): BillParseResult {
  // The year comes from the Japanese-era usage months ("8年 6月 〜 8年 7月分"), not the issue date (which becomes the download date).
  const month = /((?:\d{1,2}年\s*\d{1,2}月\s*[～〜~]\s*)?\d{1,2}年\s*\d{1,2}月分)/.exec(text);
  const anchor = month ? normalizeDate(month[1], today) : null;
  if (!anchor) return { ok: false, reason: "使用月分が見つかりません" };
  const period = new RegExp(`使用期間\\s*(${PERIOD})`).exec(text);
  if (!period) return { ok: false, reason: "使用期間が見つかりません" };
  const range = normalizeDateRange(period[1], anchor, today);
  if (!range) return { ok: false, reason: "使用期間を解釈できません" };
  const amount = /合計請求金額\s*([\d,]+)\s*円/.exec(text);
  if (!amount) return { ok: false, reason: "合計請求金額が見つかりません" };
  // Take 「使用量」, which includes the old meter's share, rather than 「差引使用量」 or 「旧メータ使用量」.
  const usage = /(?:^|\s)使用量\s*([\d,.]+)\s*m3/m.exec(text);
  const meta = UTILITIES.water;
  return {
    ok: true,
    bills: [
      {
        utility: "water",
        provider: meta.provider,
        periodStart: range.start,
        periodEnd: range.end,
        amountYen: Math.round(toNumber(amount[1])),
        usageValue: usage ? toNumber(usage[1]) : null,
        usageUnit: usage ? meta.unit : null,
      },
    ],
  };
}

/** Parses bill text. Unsupported bills or missing required fields return ok:false with a reason. */
export function parseBillText(text: string, today: Date = new Date()): BillParseResult {
  const normalized = normalizeText(text);
  const kind = detectBillKind(normalized);
  if (kind == null) return { ok: false, reason: "対応していない請求書です（東京電力・エルピオ・東京都水道局のみ）" };
  if (kind === "tepco") return parseTepco(normalized, today);
  if (kind === "lpio") return parseLpio(normalized, today);
  return parseTokyoWater(normalized, today);
}
