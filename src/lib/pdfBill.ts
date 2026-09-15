// 請求書 PDF から抜き出したテキスト（PDF.js の出力）を解析する純関数。
// PDF の読み取り自体はブラウザ専用の pdfText.ts が行い、ここは文字列だけを扱う（テスト容易）。
// 対応: 東京電力エナジーパートナー「電気料金等請求書」、エルピオ「御請求書」（ガス）、
// 東京都水道局「ご使用水量等のお知らせ」。
// 期間はPDFに書かれた日付をそのまま使う（エルピオは前回検針日〜今回検針日で、境目の日が前後の請求で重なる。
// その日の按分は aggregate.ts 側で前の期間にだけ数える）。

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

/** "7月17日～ 8月18日" のような期間表記（区切りは ～ 〜 ~）。 */
const PERIOD = String.raw`\d{1,2}月\s*\d{1,2}日\s*[～〜~]\s*\d{1,2}月\s*\d{1,2}日`;

/**
 * 全角英数・㎥ などの互換文字を標準の文字にそろえる。東京都水道局の PDF は「月・水・用・金」などを
 * 見た目が同じ康熙部首（⽉⽔⽤⾦）で返すため、そろえないと語句も日付も一致しない。
 */
function normalizeText(text: string): string {
  return text.normalize("NFKC");
}

/** 事業者名から請求書の種類を判別する。対応外は null。 */
export function detectBillKind(text: string): BillKind | null {
  const t = normalizeText(text);
  if (t.includes("東京電力エナジーパートナー")) return "tepco";
  if (t.includes("エルピオ") && t.includes("ガス料金")) return "lpio";
  if (t.includes("東京都水道局")) return "tokyo-water";
  return null;
}

/** 年・月の数字を、期間の年を補うための基準日 "YYYY-MM-01" にする。 */
function anchorOf(year: string, month: string): string {
  return `${year}-${month.padStart(2, "0")}-01`;
}

/** "20,277" → 20277。 */
function toNumber(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

function parseTepco(text: string, today: Date): BillParseResult {
  const period = new RegExp(`ご使用期間\\s*(${PERIOD})`).exec(text);
  if (!period) return { ok: false, reason: "ご使用期間が見つかりません" };
  // 年は料金確定日から補う。無ければ請求月の行（"2026年08月"）。更新年月日のような日付付きの年月は除く。
  const anchor = /料金確定日\s*(\d{4})年\s*(\d{1,2})月/.exec(text) ?? /(\d{4})年\s*(\d{1,2})月(?!\s*\d)/.exec(text);
  if (!anchor) return { ok: false, reason: "請求の年月が見つかりません" };
  const range = normalizeDateRange(period[1], anchorOf(anchor[1], anchor[2]), today);
  if (!range) return { ok: false, reason: "ご使用期間を解釈できません" };
  const amount = /請求金額\s*([\d,]+)\s*円/.exec(text);
  if (!amount) return { ok: false, reason: "請求金額が見つかりません" };
  // 「(1kWhあたり)」の単価表記は使用量ではないので除く。
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
  // 明細行: "08/06 26080601 ガス料金(都市ガス) 07月06日~08月06日 19.0 3,685"（数量=m³・金額=円）
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
  // 年は発行日（ダウンロードした日になる）ではなく、使用月分の和暦（"8年 6月 〜 8年 7月分"）から補う。
  const month = /((?:\d{1,2}年\s*\d{1,2}月\s*[～〜~]\s*)?\d{1,2}年\s*\d{1,2}月分)/.exec(text);
  const anchor = month ? normalizeDate(month[1], today) : null;
  if (!anchor) return { ok: false, reason: "使用月分が見つかりません" };
  const period = new RegExp(`使用期間\\s*(${PERIOD})`).exec(text);
  if (!period) return { ok: false, reason: "使用期間が見つかりません" };
  const range = normalizeDateRange(period[1], anchor, today);
  if (!range) return { ok: false, reason: "使用期間を解釈できません" };
  const amount = /合計請求金額\s*([\d,]+)\s*円/.exec(text);
  if (!amount) return { ok: false, reason: "合計請求金額が見つかりません" };
  // 「差引使用量」「旧メータ使用量」ではなく、旧メータ分を含む「使用量」を採る。
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

/** 請求書テキストを解析する。対応外・必須項目の欠落は理由つきで ok:false を返す。 */
export function parseBillText(text: string, today: Date = new Date()): BillParseResult {
  const normalized = normalizeText(text);
  const kind = detectBillKind(normalized);
  if (kind == null) return { ok: false, reason: "対応していない請求書です（東京電力・エルピオ・東京都水道局のみ）" };
  if (kind === "tepco") return parseTepco(normalized, today);
  if (kind === "lpio") return parseLpio(normalized, today);
  return parseTokyoWater(normalized, today);
}
