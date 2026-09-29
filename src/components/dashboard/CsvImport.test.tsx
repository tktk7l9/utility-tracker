import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Building, NewReading, Reading } from "@/lib/domain";
import type { BillParseResult } from "@/lib/pdfBill";

// PDF.js only runs in a real browser; stand in for the text extraction and let each test decide the parse result.
const pdf = vi.hoisted(() => ({
  results: new Map<string, BillParseResult | Error>(),
}));
vi.mock("@/lib/pdfText", () => ({
  extractPdfText: vi.fn(async (buf: ArrayBuffer) => new TextDecoder().decode(buf)),
}));
vi.mock("@/lib/pdfBill", () => ({
  parseBillText: vi.fn((text: string) => {
    const r = pdf.results.get(text);
    if (r instanceof Error) throw r;
    return r ?? { ok: false, reason: "対応していない請求書です" };
  }),
}));

import { CsvImport } from "./CsvImport";

const home: Building = { id: "b1", name: "自宅", movedInOn: "2024-04-01", movedOutOn: null };
const oldHome: Building = { id: "b0", name: "旧居", movedInOn: "2020-04-01", movedOutOn: "2024-03-31" };

const TEPCO_CSV = "年月,使用量(kWh),請求額(円)\n2026/05,120,\"3,000\"\n2026/06,100,\"3,200\"\n";

function csvFile(text: string, name = "bill.csv") {
  return new File([text], name, { type: "text/csv" });
}
function pdfFile(key: string, name: string) {
  return new File([key], name, { type: "application/pdf" });
}

function setup(over: { existing?: Reading[]; onImport?: (r: NewReading[]) => Promise<void>; defaultBuildingId?: string | null } = {}) {
  const onImport = over.onImport ?? vi.fn<(r: NewReading[]) => Promise<void>>().mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(
    <CsvImport
      buildings={[home, oldHome]}
      defaultBuildingId={over.defaultBuildingId ?? null}
      existingReadings={over.existing ?? []}
      onImport={onImport}
    />
  );
  const fileInput = screen.getByLabelText("CSV / PDF ファイル") as HTMLInputElement;
  return { user, onImport, fileInput };
}

beforeEach(() => pdf.results.clear());

describe("CsvImport with a CSV file", () => {
  it("detects the columns and the utility from the header, previews and imports", async () => {
    const { user, onImport, fileInput } = setup();
    await user.upload(fileInput, csvFile(TEPCO_CSV));

    expect(await screen.findByText("見出しから種別を「電気」と判別しました。")).toBeTruthy();
    expect(screen.getByText("取込 2 件")).toBeTruthy();
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByText("3,200円")).toBeTruthy();
    expect(within(table).getAllByText("自宅")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "2 件を取り込む" }));
    expect(onImport).toHaveBeenCalledTimes(1);
    const rows = vi.mocked(onImport).mock.calls[0][0];
    expect(rows.map((r) => [r.periodStart, r.amountYen, r.usageValue, r.buildingId])).toEqual([
      ["2026-05-01", 3000, 120, "b1"],
      ["2026-06-01", 3200, 100, "b1"],
    ]);
    expect(screen.getByText("2 件を取り込みました。")).toBeTruthy();
    // The preview is cleared after importing.
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("warns when the utility cannot be detected, and the chip can be re-picked", async () => {
    const { user, onImport, fileInput } = setup({ defaultBuildingId: "b1" });
    await user.upload(fileInput, csvFile("年月,金額\n2026/05,4000\n"));
    expect(await screen.findByText("種別を判別できませんでした。種別が正しいか確認してください。")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "ガス" }));
    expect(screen.queryByText(/種別を判別できませんでした/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "1 件を取り込む" }));
    expect(vi.mocked(onImport).mock.calls[0][0][0]).toMatchObject({ utility: "gas", provider: "LPIO", amountYen: 4000 });
  });

  it("skips records that already exist, and overwrites them when asked", async () => {
    const existing: Reading = {
      id: "r1",
      utility: "electricity",
      provider: "TEPCO",
      buildingId: "b1",
      periodStart: "2026-05-01",
      periodEnd: "2026-05-31",
      amountYen: 2900,
      usageValue: 120,
      usageUnit: "kWh",
      source: "csv",
    };
    const { user, onImport, fileInput } = setup({ existing: [existing] });
    await user.upload(fileInput, csvFile(TEPCO_CSV));
    expect(await screen.findByText("重複スキップ 1 件")).toBeTruthy();
    expect(screen.getByText("取込 1 件")).toBeTruthy();

    await user.click(screen.getByRole("checkbox", { name: /既存の同一期間レコードを上書きする/ }));
    expect(screen.getByText("うち上書き 1 件")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "2 件を取り込む（上書き 1 件）" }));
    expect(vi.mocked(onImport).mock.calls[0][0]).toHaveLength(2);
  });

  it("warns about existing records whose periods overlap without matching", async () => {
    const monthly: Reading = {
      id: "r1",
      utility: "electricity",
      provider: "TEPCO",
      buildingId: "b1",
      periodStart: "2026-05-10",
      periodEnd: "2026-06-09",
      amountYen: 3100,
      usageValue: null,
      usageUnit: null,
      source: "manual",
    };
    const { user, fileInput } = setup({ existing: [monthly] });
    await user.upload(fileInput, csvFile(TEPCO_CSV));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("期間が重なる登録済みの記録が 2 件あります");
    expect(alert.textContent).toContain("3,100円");
  });

  it("counts rows that cannot be read as errors and lets the header toggle and columns be changed", async () => {
    const { user, fileInput } = setup({ defaultBuildingId: "b1" });
    await user.upload(fileInput, csvFile("年月,請求額,使用量\n2026/05,3000,10\nbad,row,x\n"));
    expect(await screen.findByText("エラー 1 件")).toBeTruthy();

    // Point the amount column at the usage column: the preview follows.
    const amountSelect = screen.getByLabelText("金額列");
    await user.selectOptions(amountSelect, "使用量");
    expect(within(screen.getByRole("table")).getByText("10円")).toBeTruthy();

    // Optional columns can be set and cleared.
    const usageSelect = screen.getByLabelText("使用量列（任意）");
    await user.selectOptions(usageSelect, "請求額");
    expect(within(screen.getByRole("table")).getByText("3000")).toBeTruthy();
    await user.selectOptions(usageSelect, "なし");
    expect(within(screen.getByRole("table")).getByText("—")).toBeTruthy();

    // Without a header, the first line becomes a (broken) data row and the labels fall back to column numbers.
    await user.click(screen.getByRole("checkbox", { name: "1行目はヘッダ" }));
    expect(screen.getByText("エラー 2 件")).toBeTruthy();
    expect(screen.getAllByRole("option", { name: "列1" }).length).toBeGreaterThan(0);
  });

  it("re-decodes the same file when the encoding is changed by hand", async () => {
    const { user, fileInput } = setup({ defaultBuildingId: "b1" });
    await user.upload(fileInput, csvFile(TEPCO_CSV));
    expect(await screen.findByText(/文字コード: UTF-8/)).toBeTruthy();
    const amountOption = () => screen.queryAllByRole("option", { name: "請求額(円)" });
    expect(amountOption().length).toBeGreaterThan(0);
    // Map the amount to the usage column by hand, so a re-detection on switching would show.
    await user.selectOptions(screen.getByLabelText("金額列"), "使用量(kWh)");
    expect(within(screen.getByRole("table")).getByText("100円")).toBeTruthy();

    // Decoding UTF-8 bytes as Shift_JIS garbles the header, so the column labels change.
    await user.selectOptions(screen.getByLabelText("文字コード"), "Shift_JIS");
    expect(screen.getByText(/文字コード: Shift_JIS/)).toBeTruthy();
    expect(amountOption()).toHaveLength(0);
    // The hand-made mapping is kept, so the amounts are still read from the usage column.
    expect(within(screen.getByRole("table")).getByText("100円")).toBeTruthy();

    await user.selectOptions(screen.getByLabelText("文字コード"), "UTF-8");
    expect(amountOption().length).toBeGreaterThan(0);
  });

  it("refuses several CSV files at once", async () => {
    const { user, fileInput } = setup();
    await user.upload(fileInput, [csvFile(TEPCO_CSV, "a.csv"), csvFile(TEPCO_CSV, "b.csv")]);
    expect(screen.getByText("CSV は1ファイルずつ選んでください（PDF は複数まとめて選べます）。")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("refuses CSV and PDF mixed together", async () => {
    const { user, fileInput } = setup();
    await user.upload(fileInput, [csvFile(TEPCO_CSV), pdfFile("x", "bill.pdf")]);
    expect(screen.getByText("CSV と PDF は別々に選んでください。")).toBeTruthy();
  });

  it("says so when the file cannot be read", async () => {
    const { user, fileInput } = setup();
    const broken = csvFile(TEPCO_CSV);
    broken.arrayBuffer = () => Promise.reject(new Error("NotReadableError"));
    await user.upload(fileInput, broken);
    expect(
      await screen.findByText("ファイルを読み込めませんでした。別のファイルを選ぶか、もう一度お試しください。")
    ).toBeTruthy();
  });

  it("keeps the preview and shows the reason when importing fails", async () => {
    const onImport = vi.fn<(r: NewReading[]) => Promise<void>>().mockRejectedValue(new Error("インポートに失敗しました"));
    const { user, fileInput } = setup({ onImport });
    await user.upload(fileInput, csvFile(TEPCO_CSV));
    await user.click(await screen.findByRole("button", { name: "2 件を取り込む" }));
    expect(screen.getByText("インポートに失敗しました")).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("ignores an empty selection", async () => {
    const { user, fileInput } = setup();
    await user.upload(fileInput, []);
    expect(screen.queryByText(/取込 \d+ 件/)).toBeNull();
  });

  it("shows how many more rows there are beyond the preview", async () => {
    const lines = ["年月,請求額(円)"];
    for (let m = 1; m <= 9; m++) lines.push(`2025/0${m},${1000 + m}`);
    const { user, fileInput } = setup({ defaultBuildingId: "b1" });
    await user.upload(fileInput, csvFile(lines.join("\n")));
    expect(await screen.findByText("ほか 3 件…")).toBeTruthy();
  });
});

describe("CsvImport with PDF bills", () => {
  const bill = (over: Partial<NewReading> = {}) => ({
    utility: "electricity" as const,
    provider: "TEPCO",
    periodStart: "2026-07-17",
    periodEnd: "2026-08-18",
    amountYen: 7100,
    usageValue: 250,
    usageUnit: "kWh",
    ...over,
  });

  it("reads several bills, infers each building from its period and lists files it could not read", async () => {
    pdf.results.set("tepco", { ok: true, bills: [bill()] });
    pdf.results.set("water", { ok: true, bills: [bill({ utility: "water", provider: "東京都水道局", periodStart: "2022-05-01", periodEnd: "2022-06-30", amountYen: 5000, usageValue: null, usageUnit: null })] });
    pdf.results.set("broken", new Error("bad pdf"));
    const { user, onImport, fileInput } = setup();
    await user.upload(fileInput, [pdfFile("tepco", "t.pdf"), pdfFile("water", "w.pdf"), pdfFile("broken", "x.pdf"), pdfFile("unknown", "u.pdf")]);

    expect(await screen.findByText("取込 2 件")).toBeTruthy();
    expect(screen.getByText("エラー 2 件")).toBeTruthy();
    expect(screen.getByText("x.pdf: PDF を読み込めませんでした")).toBeTruthy();
    expect(screen.getByText("u.pdf: 対応していない請求書です")).toBeTruthy();
    // PDF mode shows the utility per row instead of the utility chips.
    expect(screen.queryByRole("button", { name: "ガス" })).toBeNull();
    const table = screen.getByRole("table");
    expect(within(table).getByText("水道")).toBeTruthy();
    expect(within(table).getByText("旧居")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "2 件を取り込む" }));
    expect(vi.mocked(onImport).mock.calls[0][0].map((r) => [r.utility, r.buildingId, r.source])).toEqual([
      ["electricity", "b1", "pdf"],
      ["water", "b0", "pdf"],
    ]);
  });

  it("reports a bill whose period no building covers, until a building is chosen", async () => {
    pdf.results.set("old", { ok: true, bills: [bill({ periodStart: "2010-01-01", periodEnd: "2010-01-31" })] });
    const { user, fileInput } = setup();
    await user.upload(fileInput, pdfFile("old", "old.pdf"));
    expect(await screen.findByText("old.pdf: 検針期間に該当する建物がありません")).toBeTruthy();
    expect(screen.getByRole("button", { name: "0 件を取り込む" }).hasAttribute("disabled")).toBe(true);

    await user.selectOptions(screen.getByLabelText("建物"), "旧居");
    expect(screen.getByText("取込 1 件")).toBeTruthy();
  });

  it("shows progress while reading PDFs", async () => {
    const { extractPdfText } = await import("@/lib/pdfText");
    let release!: (text: string) => void;
    vi.mocked(extractPdfText).mockImplementationOnce(() => new Promise((r) => (release = r)));
    pdf.results.set("tepco", { ok: true, bills: [bill()] });
    const { user, fileInput } = setup();
    await user.upload(fileInput, pdfFile("tepco", "t.pdf"));
    expect(screen.getByText("PDF を読み取り中…")).toBeTruthy();
    release("tepco");
    expect(await screen.findByText("取込 1 件")).toBeTruthy();
    expect(screen.queryByText("PDF を読み取り中…")).toBeNull();
  });
});
