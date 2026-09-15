import { describe, it, expect } from "vitest";
import { detectBillKind, parseBillText } from "./pdfBill";

// PDF.js で抜き出したテキストの形（行の並び・全角記号・「～」）を再現した匿名化フィクスチャ。
// 氏名・住所・お客さま番号などは架空の値に置き換えている。
const TEPCO_2026_08 = [
  "更新年月日",
  "山田 太郎 様",
  "電気料金等請求書",
  "東京都架空市1-2-3",
  "2026年 8月20日",
  "東京電力エナジーパートナー株式会社",
  "お客さま番号 00000‐00000‐0‐00",
  "ご契約種別 従量電灯 Ｂ",
  "ご契約 30A",
  "請求金額 20,277円 621kWhご使用量",
  "(うち消費税等相当額 1,843円 )",
  "料金確定日 2026年 8月19日",
  "ご使用期間 7月17日～ 8月18日",
  "検針月日 8月19日 （33日間）",
  "次回検針予定日 9月16日",
  "2026年08月",
  "計器情報",
  "使用電力量 621",
  "合計（10％対象） 20,277円",
  "再エネ発電賦課金単価 （1kWhあたり） 4円18銭",
].join("\n");

const LPIO_2026_08 = [
  "御請求書 発行日 : 2026年08月21日",
  "架空市1-2-3 会社名 株式会社エルピオ",
  "山田 太郎 様 TEL 0120-00-0000",
  "請求年月 2026年08月",
  "前回ご請求額 今回入金額 今回お買上額 うち消費税 今回ご請求額 備考",
  "0 0 3,685 (335) 3,685",
  "月日 伝票番号 商品名／型式／備考 数量 金額 入金",
  "08/06 26080601 ガス料金（都市ガス） 07月06日～08月06日 19.0 3,685",
  "基本料金 975.00円",
  "従量料金 2,710.35円",
  "合計 10%対象 3,685",
  "Powered by TCPDF (www.tcpdf.org)",
].join("\n");

describe("detectBillKind", () => {
  it("事業者名から請求書の種類を判別する", () => {
    expect(detectBillKind(TEPCO_2026_08)).toBe("tepco");
    expect(detectBillKind(LPIO_2026_08)).toBe("lpio");
  });

  it("対応していない請求書は null", () => {
    expect(detectBillKind("御請求書 株式会社エルピオ 灯油 18L")).toBeNull();
    expect(detectBillKind("")).toBeNull();
  });
});

describe("parseBillText（東京電力）", () => {
  it("ご使用期間・請求金額・使用量を取り出す", () => {
    expect(parseBillText(TEPCO_2026_08)).toEqual({
      ok: true,
      bills: [
        {
          utility: "electricity",
          provider: "TEPCO",
          periodStart: "2026-07-17",
          periodEnd: "2026-08-18",
          amountYen: 20277,
          usageValue: 621,
          usageUnit: "kWh",
        },
      ],
    });
  });

  it("年をまたぐ期間は料金確定日の年から開始年を補う", () => {
    const text = TEPCO_2026_08.replace("料金確定日 2026年 8月19日", "料金確定日 2027年 1月19日").replace(
      "ご使用期間 7月17日～ 8月18日",
      "ご使用期間 12月17日～ 1月16日"
    );
    expect(parseBillText(text)).toMatchObject({
      ok: true,
      bills: [{ periodStart: "2026-12-17", periodEnd: "2027-01-16" }],
    });
  });

  it("料金確定日が無ければ請求月の行（2026年08月）で年を補う", () => {
    const text = TEPCO_2026_08.replace("料金確定日 2026年 8月19日\n", "");
    expect(parseBillText(text)).toMatchObject({
      ok: true,
      bills: [{ periodStart: "2026-07-17", periodEnd: "2026-08-18" }],
    });
  });

  it("年月が見つからなければエラー（更新年月日の「2026年 8月20日」は請求月とみなさない）", () => {
    const text = TEPCO_2026_08.replace("料金確定日 2026年 8月19日\n", "").replace("2026年08月\n", "");
    expect(parseBillText(text)).toEqual({ ok: false, reason: "請求の年月が見つかりません" });
  });

  it("ご使用期間が無ければエラー", () => {
    const text = TEPCO_2026_08.replace("ご使用期間 7月17日～ 8月18日\n", "");
    expect(parseBillText(text)).toEqual({ ok: false, reason: "ご使用期間が見つかりません" });
  });

  it("ご使用期間の日付を解釈できなければエラー", () => {
    const text = TEPCO_2026_08.replace("ご使用期間 7月17日～ 8月18日", "ご使用期間 13月17日～ 8月18日");
    expect(parseBillText(text)).toEqual({ ok: false, reason: "ご使用期間を解釈できません" });
  });

  it("請求金額が無ければエラー", () => {
    const text = TEPCO_2026_08.replace("請求金額 20,277円 621kWhご使用量", "621kWhご使用量");
    expect(parseBillText(text)).toEqual({ ok: false, reason: "請求金額が見つかりません" });
  });

  it("使用量（kWh）が無ければ金額だけ取り込む", () => {
    const text = TEPCO_2026_08.replace("621kWhご使用量", "ご使用量").replace("（1kWhあたり）", "（1単位あたり）");
    expect(parseBillText(text)).toMatchObject({
      ok: true,
      bills: [{ amountYen: 20277, usageValue: null, usageUnit: null }],
    });
  });

  it("全角数字でも読める", () => {
    const text = TEPCO_2026_08.replace("請求金額 20,277円", "請求金額 ２０，２７７円");
    expect(parseBillText(text)).toMatchObject({ ok: true, bills: [{ amountYen: 20277 }] });
  });
});

describe("parseBillText（エルピオ）", () => {
  it("ガス料金の明細行から期間・数量・金額を取り出す", () => {
    expect(parseBillText(LPIO_2026_08)).toEqual({
      ok: true,
      bills: [
        {
          utility: "gas",
          provider: "LPIO",
          periodStart: "2026-07-06",
          periodEnd: "2026-08-06",
          amountYen: 3685,
          usageValue: 19,
          usageUnit: "m³",
        },
      ],
    });
  });

  it("年をまたぐ期間は請求年月の年から補う", () => {
    const text = LPIO_2026_08.replace("請求年月 2026年08月", "請求年月 2027年01月").replace(
      "07月06日～08月06日",
      "12月05日～01月06日"
    );
    expect(parseBillText(text)).toMatchObject({
      ok: true,
      bills: [{ periodStart: "2026-12-05", periodEnd: "2027-01-06" }],
    });
  });

  it("ガス料金の明細行が複数あればそれぞれ取り込む", () => {
    const text = LPIO_2026_08.replace(
      "基本料金 975.00円",
      "08/20 26082001 ガス料金（都市ガス） 08月06日～08月20日 5.0 1,020\n基本料金 975.00円"
    );
    const result = parseBillText(text);
    expect(result).toMatchObject({
      ok: true,
      bills: [
        { periodStart: "2026-07-06", periodEnd: "2026-08-06", amountYen: 3685 },
        { periodStart: "2026-08-06", periodEnd: "2026-08-20", amountYen: 1020, usageValue: 5 },
      ],
    });
  });

  it("請求年月が無ければエラー", () => {
    const text = LPIO_2026_08.replace("請求年月 2026年08月\n", "");
    expect(parseBillText(text)).toEqual({ ok: false, reason: "請求年月が見つかりません" });
  });

  it("ガス料金の明細行が無ければエラー", () => {
    const text = LPIO_2026_08.replace(
      "08/06 26080601 ガス料金（都市ガス） 07月06日～08月06日 19.0 3,685",
      "ガス料金の明細は別紙をご覧ください"
    );
    expect(parseBillText(text)).toEqual({ ok: false, reason: "ガス料金の明細行が見つかりません" });
  });

  it("ガス料金の期間を解釈できなければエラー", () => {
    const text = LPIO_2026_08.replace("07月06日～08月06日", "13月06日～08月06日");
    expect(parseBillText(text)).toEqual({ ok: false, reason: "ガス料金の期間を解釈できません" });
  });
});

// 東京都水道局の PDF は、埋め込みフォントの ToUnicode が「月・水・用・金・日」などを康熙部首
// （⽉⽔⽤⾦⽇）で返す。PDF.js の出力どおりにそれを再現している。発行日はダウンロードした日になる。
const WATER_2026_07 = [
  "2026年9⽉15⽇",
  "東京都⽔道局⽔道事業会計 T8-8000-2000-0783",
  "ご使⽤⽔量等のお知らせご使⽤⽔量等のお知らせ",
  "お客さま番号 00-000000-00",
  "⽔道ご使⽤場所 架空町１丁⽬２番３号",
  "使⽤者名 山田 太郎 様",
  "基準⽇ 呼び径 メータ番号",
  "10⽇ 20mm 00-000000",
  "使⽤⽉分 ⽔道（円） 下⽔道（円） 使⽤量 43㎥",
  "使⽤期間料⾦ 8年 6⽉ 〜 8年 7⽉分 3,595 4,598 汚⽔排出量 43㎥",
  "内訳",
  "基本料⾦ 0 1,120 使⽤期間 5⽉14⽇ 〜 7⽉10⽇",
  "従量料⾦ 3,269 3,060 今回指針 431㎥",
  "消費税相当額 326 418 前回指針 388㎥",
  "差引使⽤量 43㎥",
  "今回料⾦ 3,595 4,598 旧メータ使⽤量",
  "10%対象 うち消費税相当額 (326) (418) 前回使⽤⽔量 47㎥",
  "合計今回料⾦ 8,193円 前年同期使⽤⽔量 36㎥",
  "次回検針予定⽇ 9⽉10⽇",
  "合計請求⾦額 8,193円",
].join("\n");

const TODAY = new Date("2026-09-15T00:00:00Z");

describe("parseBillText（東京都水道局）", () => {
  it("康熙部首の文字でも判別でき、使用期間・合計請求金額・使用量を取り出す（年は使用月分の和暦から）", () => {
    expect(detectBillKind(WATER_2026_07)).toBe("tokyo-water");
    expect(parseBillText(WATER_2026_07, TODAY)).toEqual({
      ok: true,
      bills: [
        {
          utility: "water",
          provider: "TokyoWaterworks",
          periodStart: "2026-05-14",
          periodEnd: "2026-07-10",
          amountYen: 8193,
          usageValue: 43,
          usageUnit: "m³",
        },
      ],
    });
  });

  it("メータ交換の月は差引使用量ではなく使用量（旧メータ分を含む）を採る", () => {
    const text = WATER_2026_07.replace("使⽤量 43㎥", "使⽤量 28㎥")
      .replace("差引使⽤量 43㎥", "差引使⽤量 19㎥")
      .replace("旧メータ使⽤量", "旧メータ使⽤量 9㎥")
      .replace("8年 6⽉ 〜 8年 7⽉分", "6年10⽉ 〜 6年11⽉分")
      .replace("使⽤期間 5⽉14⽇ 〜 7⽉10⽇", "使⽤期間 9⽉12⽇ 〜 11⽉12⽇");
    expect(parseBillText(text, TODAY)).toMatchObject({
      ok: true,
      bills: [{ periodStart: "2024-09-12", periodEnd: "2024-11-12", usageValue: 28 }],
    });
  });

  it("年をまたぐ期間は使用月分の終わりの年から開始年を補う", () => {
    const text = WATER_2026_07.replace("8年 6⽉ 〜 8年 7⽉分", "7年12⽉ 〜 8年 1⽉分").replace(
      "使⽤期間 5⽉14⽇ 〜 7⽉10⽇",
      "使⽤期間 11⽉14⽇ 〜 1⽉10⽇"
    );
    expect(parseBillText(text, TODAY)).toMatchObject({
      ok: true,
      bills: [{ periodStart: "2025-11-14", periodEnd: "2026-01-10" }],
    });
  });

  it("使用月分が1か月だけの表記でも年を補える", () => {
    const text = WATER_2026_07.replace("8年 6⽉ 〜 8年 7⽉分", "8年 7⽉分");
    expect(parseBillText(text, TODAY)).toMatchObject({
      ok: true,
      bills: [{ periodStart: "2026-05-14", periodEnd: "2026-07-10" }],
    });
  });

  it("使用月分が無ければエラー", () => {
    const text = WATER_2026_07.replace("8年 6⽉ 〜 8年 7⽉分 ", "");
    expect(parseBillText(text, TODAY)).toEqual({ ok: false, reason: "使用月分が見つかりません" });
  });

  it("使用期間が無ければエラー", () => {
    const text = WATER_2026_07.replace("使⽤期間 5⽉14⽇ 〜 7⽉10⽇", "");
    expect(parseBillText(text, TODAY)).toEqual({ ok: false, reason: "使用期間が見つかりません" });
  });

  it("使用期間の日付を解釈できなければエラー", () => {
    const text = WATER_2026_07.replace("使⽤期間 5⽉14⽇", "使⽤期間 13⽉14⽇");
    expect(parseBillText(text, TODAY)).toEqual({ ok: false, reason: "使用期間を解釈できません" });
  });

  it("合計請求金額が無ければエラー", () => {
    const text = WATER_2026_07.replace("合計請求⾦額 8,193円", "");
    expect(parseBillText(text, TODAY)).toEqual({ ok: false, reason: "合計請求金額が見つかりません" });
  });

  it("使用量が無ければ金額だけ取り込む", () => {
    const text = WATER_2026_07.replace(" 使⽤量 43㎥", "");
    expect(parseBillText(text, TODAY)).toMatchObject({
      ok: true,
      bills: [{ amountYen: 8193, usageValue: null, usageUnit: null }],
    });
  });
});

describe("parseBillText（対応外）", () => {
  it("東京電力・エルピオ・東京都水道局以外はエラー", () => {
    expect(parseBillText("領収書 株式会社どこか 1,000円")).toEqual({
      ok: false,
      reason: "対応していない請求書です（東京電力・エルピオ・東京都水道局のみ）",
    });
  });
});
