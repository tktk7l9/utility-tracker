"use client";

import { useMemo, useState } from "react";
import { TriangleAlert, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { UTILITIES, UTILITY_ORDER, type Building, type NewReading, type Reading, type Utility } from "@/lib/domain";
import { parseCsv, mapRowsToReadings, dedupe, readingKey, guessColumns, guessUtility, type CsvMapping } from "@/lib/csv";
import { inferBuilding } from "@/lib/buildings";
import { parseBillText, type ParsedBill } from "@/lib/pdfBill";
import { extractPdfText } from "@/lib/pdfText";
import { findPeriodOverlaps } from "@/lib/overlaps";
import { formatYen } from "@/lib/utils";

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** 読み込んだ PDF 1ファイル分の解析結果。 */
interface PdfFileResult {
  name: string;
  bills: ParsedBill[];
  error: string | null;
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function ColSelect({
  value,
  onChange,
  maxCols,
  label,
  allowNone,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  maxCols: number;
  label: (i: number) => string;
  allowNone?: boolean;
}) {
  return (
    <select
      className={`${selectClass} w-full`}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
    >
      {allowNone && <option value="">なし</option>}
      {Array.from({ length: maxCols }, (_, i) => (
        <option key={i} value={i}>
          {label(i)}
        </option>
      ))}
    </select>
  );
}

export function CsvImport({
  buildings,
  defaultBuildingId,
  existingReadings,
  onImport,
}: {
  buildings: Building[];
  defaultBuildingId: string | null;
  existingReadings: Reading[];
  onImport: (readings: NewReading[]) => Promise<void>;
}) {
  const [rawText, setRawText] = useState("");
  const [encoding, setEncoding] = useState("utf-8");
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [pdfFiles, setPdfFiles] = useState<PdfFileResult[]>([]);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [utility, setUtility] = useState<Utility>("electricity");
  // CSV の見出しから種別を判別した結果（undefined = 未読込か手で選び直した、null = 判別できなかった）。
  const [detectedUtility, setDetectedUtility] = useState<Utility | null | undefined>(undefined);
  const [buildingChoice, setBuildingChoice] = useState(defaultBuildingId ?? "");
  const [hasHeader, setHasHeader] = useState(true);
  const [overwrite, setOverwrite] = useState(false);
  const [colEnd, setColEnd] = useState(0);
  const [colAmount, setColAmount] = useState(1);
  const [colStart, setColStart] = useState<number | null>(null);
  const [colUsage, setColUsage] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const rows = useMemo(() => parseCsv(rawText), [rawText]);
  const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  // 建物軸を含むキーなので、重複判定は建物間で混ざらない（全件から生成する）。
  const existingKeys = useMemo(() => existingReadings.map(readingKey), [existingReadings]);
  const existingSet = useMemo(() => new Set(existingKeys), [existingKeys]);
  const mode: "csv" | "pdf" | null = pdfFiles.length > 0 ? "pdf" : rows.length > 0 ? "csv" : null;

  function applyDefaults(parsed: string[][]) {
    const cols = parsed.reduce((m, r) => Math.max(m, r.length), 0);
    // ヘッダがあれば列名から初期マッピングと種別を推定する（外れても手動で選び直せる）。
    const header = hasHeader ? parsed[0] : undefined;
    const guess = header && header.length > 0 ? guessColumns(header) : null;
    setColEnd(guess?.periodEnd ?? 0);
    setColAmount(guess?.amount ?? (cols > 1 ? cols - 1 : 0));
    setColStart(guess?.periodStart ?? null);
    setColUsage(guess?.usage ?? null);
    const u = header ? guessUtility(header) : null;
    if (u) setUtility(u);
    setDetectedUtility(u);
    setDone(null);
    setError(null);
  }

  /** バッファを指定エンコーディングでデコードして反映する。resetCols=true で列既定を初期化。 */
  function decodeAndLoad(buf: ArrayBuffer, enc: string, resetCols: boolean) {
    const text = new TextDecoder(enc).decode(buf);
    setRawText(text);
    if (resetCols) {
      applyDefaults(parseCsv(text));
    } else {
      // 文字コード切替時は既に設定した列マッピングを保持する（構造は同じ）。
      setDone(null);
      setError(null);
    }
  }

  /** 請求書 PDF を順に読み取って解析する（読めなかったファイルは理由つきで残す）。 */
  async function loadPdfs(files: File[]) {
    setLoadingPdf(true);
    try {
      const results: PdfFileResult[] = [];
      for (const file of files) {
        try {
          const parsed = parseBillText(await extractPdfText(await file.arrayBuffer()));
          results.push(
            parsed.ok
              ? { name: file.name, bills: parsed.bills, error: null }
              : { name: file.name, bills: [], error: parsed.reason }
          );
        } catch {
          results.push({ name: file.name, bills: [], error: "PDF を読み込めませんでした" });
        }
      }
      setRawText("");
      setBuffer(null);
      setDetectedUtility(undefined);
      setPdfFiles(results);
    } finally {
      setLoadingPdf(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setDone(null);
    setError(null);
    const pdfCount = files.filter(isPdf).length;
    if (pdfCount > 0 && pdfCount < files.length) {
      setError("CSV と PDF は別々に選んでください。");
      return;
    }
    if (pdfCount > 0) {
      await loadPdfs(files);
      return;
    }
    if (files.length > 1) {
      setError("CSV は1ファイルずつ選んでください（PDF は複数まとめて選べます）。");
      return;
    }
    setPdfFiles([]);
    try {
      const buf = await files[0].arrayBuffer();
      setBuffer(buf);
      decodeAndLoad(buf, encoding, true);
    } catch {
      setError("ファイルを読み込めませんでした。エンコーディングを確認してください。");
    }
  }

  // 文字コードを切り替えたら、選択済みファイルを列マッピングを保ったまま再デコードする。
  function onEncodingChange(enc: string) {
    setEncoding(enc);
    if (buffer) decodeAndLoad(buffer, enc, false);
  }

  const mapping: CsvMapping = {
    utility,
    buildingId: buildingChoice || undefined,
    buildings,
    hasHeader,
    columns: {
      periodEnd: colEnd,
      amount: colAmount,
      periodStart: colStart ?? undefined,
      usage: colUsage ?? undefined,
    },
  };

  const parsed = useMemo(
    () => (rows.length ? mapRowsToReadings(rows, mapping) : { readings: [], errors: [] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, utility, buildingChoice, buildings, hasHeader, colEnd, colAmount, colStart, colUsage]
  );

  // PDF は請求書ごとの解析結果を取込候補にする（建物は固定指定がなければ検針期間から推定）。
  const pdfMapped = useMemo(() => {
    const readings: NewReading[] = [];
    const errors: string[] = [];
    for (const file of pdfFiles) {
      if (file.error) {
        errors.push(`${file.name}: ${file.error}`);
        continue;
      }
      for (const bill of file.bills) {
        const buildingId = buildingChoice || inferBuilding(buildings, bill.periodStart, bill.periodEnd)?.id;
        if (!buildingId) {
          errors.push(`${file.name}: 検針期間に該当する建物がありません`);
          continue;
        }
        readings.push({ ...bill, buildingId, note: null, source: "pdf" });
      }
    }
    return { readings, errors };
  }, [pdfFiles, buildingChoice, buildings]);

  const candidates = mode === "pdf" ? pdfMapped.readings : parsed.readings;
  const errorCount = mode === "pdf" ? pdfMapped.errors.length : parsed.errors.length;
  // 上書きモードでは既存キーを除外せず、ファイル内重複だけ畳む（bulkUpsert が upsert で上書き）。
  const { toInsert, duplicates } = dedupe(candidates, overwrite ? [] : existingKeys);
  const overwriteCount = overwrite ? toInsert.filter((r) => existingSet.has(readingKey(r))).length : 0;
  // 同一期間ではないが期間が重なる既存の記録（年月単位の古い記録と検針期間の請求書など）は二重計上になる。
  const overlaps = findPeriodOverlaps(toInsert, existingReadings);

  const headerLabel = (i: number): string => (hasHeader && rows[0]?.[i] ? rows[0][i] : `列${i + 1}`);
  const buildingNameById = useMemo(() => new Map(buildings.map((b) => [b.id, b.name])), [buildings]);

  async function runImport() {
    setBusy(true);
    setError(null);
    try {
      await onImport(toInsert);
      setDone(toInsert.length);
      setRawText("");
      setPdfFiles([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    // 入力タブでは半幅カードに置かれるため、列数は画面幅ではなくこの要素の幅で決める。
    <div className="@container space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        {mode !== "pdf" && (
          <div className="space-y-1.5">
            <Label>種別</Label>
            <div className="flex gap-1.5">
              {UTILITY_ORDER.map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => {
                    setUtility(u);
                    setDetectedUtility(undefined);
                  }}
                  aria-pressed={u === utility}
                  className={
                    "rounded-md border px-3 py-1.5 text-sm transition-colors " +
                    (u === utility ? "border-transparent text-neutral-900" : "bg-background hover:bg-accent")
                  }
                  style={u === utility ? { backgroundColor: UTILITIES[u].color } : undefined}
                >
                  {UTILITIES[u].label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="building">建物</Label>
          <select
            id="building"
            className={selectClass}
            value={buildingChoice}
            onChange={(e) => setBuildingChoice(e.target.value)}
          >
            <option value="">自動（期間から判定）</option>
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        {mode !== "pdf" && (
          <div className="space-y-1.5">
            <Label htmlFor="enc">文字コード</Label>
            <select id="enc" className={selectClass} value={encoding} onChange={(e) => onEncodingChange(e.target.value)}>
              <option value="utf-8">UTF-8</option>
              <option value="shift_jis">Shift_JIS</option>
            </select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="file">CSV / PDF ファイル</Label>
          <Input
            type="file"
            accept=".csv,text/csv,.pdf,application/pdf"
            multiple
            id="file"
            onChange={onFile}
            className="h-9 file:mr-3 file:rounded file:bg-secondary file:px-2 file:py-1"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        PDF は東京電力・エルピオ・東京都水道局の請求書に対応し、複数まとめて選べます（この端末の中だけで読み取ります）。
      </p>

      {loadingPdf && <p className="text-sm text-muted-foreground">PDF を読み取り中…</p>}

      {mode === "csv" &&
        detectedUtility !== undefined &&
        (detectedUtility ? (
          <p className="text-sm text-muted-foreground">
            見出しから種別を「{UTILITIES[detectedUtility].label}」と判別しました。
          </p>
        ) : (
          <p className="text-sm text-destructive">種別を判別できませんでした。種別が正しいか確認してください。</p>
        ))}

      {mode === "csv" && (
        <div className="grid grid-cols-1 gap-3 rounded-md border bg-muted/40 p-3 @xs:grid-cols-2 @2xl:grid-cols-4">
          <label className="col-span-full flex items-center gap-2 text-sm">
            <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
            1行目はヘッダ
          </label>
          <label className="col-span-full flex items-center gap-2 text-sm">
            <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
            既存の同一期間レコードを上書きする（金額の訂正などを再取込する場合）
          </label>
          <div className="space-y-1">
            <Label>検針日 / 期間終了列</Label>
            <ColSelect value={colEnd} onChange={(v) => setColEnd(v ?? 0)} maxCols={maxCols} label={headerLabel} />
          </div>
          <div className="space-y-1">
            <Label>金額列</Label>
            <ColSelect value={colAmount} onChange={(v) => setColAmount(v ?? 0)} maxCols={maxCols} label={headerLabel} />
          </div>
          <div className="space-y-1">
            <Label>期間開始列（任意）</Label>
            <ColSelect value={colStart} onChange={setColStart} maxCols={maxCols} label={headerLabel} allowNone />
          </div>
          <div className="space-y-1">
            <Label>使用量列（任意）</Label>
            <ColSelect value={colUsage} onChange={setColUsage} maxCols={maxCols} label={headerLabel} allowNone />
          </div>
        </div>
      )}

      {mode === "pdf" && pdfMapped.errors.length > 0 && (
        <ul className="space-y-0.5 text-sm text-destructive">
          {pdfMapped.errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      {mode != null && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="success">取込 {toInsert.length} 件</Badge>
            {overwriteCount > 0 && <Badge variant="secondary">うち上書き {overwriteCount} 件</Badge>}
            {duplicates.length > 0 && <Badge variant="secondary">重複スキップ {duplicates.length} 件</Badge>}
            {errorCount > 0 && <Badge variant="destructive">エラー {errorCount} 件</Badge>}
          </div>

          {overlaps.length > 0 && (
            <div role="alert" className="space-y-1.5 rounded-md border border-warning/60 bg-warning/10 p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <TriangleAlert className="size-4 shrink-0 text-warning" />
                期間が重なる登録済みの記録が {overlaps.length} 件あります
              </p>
              <p className="text-xs">
                このまま取り込むと、重なった日数分が二重に計上されます。古い記録は「登録済みレコード」から削除してください。
              </p>
              <ul className="space-y-0.5 text-xs">
                {overlaps.map(({ incoming, existing }) => (
                  <li key={`${existing.id}|${readingKey(incoming)}`}>
                    {UTILITIES[existing.utility].label}：登録済み {existing.periodStart} 〜 {existing.periodEnd}（
                    {formatYen(existing.amountYen)}）と、取込 {incoming.periodStart} 〜 {incoming.periodEnd}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {toInsert.length > 0 && (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                  <tr>
                    {mode === "pdf" && <th className="whitespace-nowrap px-3 py-2">種別</th>}
                    <th className="px-3 py-2">建物</th>
                    <th className="px-3 py-2">期間</th>
                    <th className="whitespace-nowrap px-3 py-2">金額</th>
                    <th className="whitespace-nowrap px-3 py-2">使用量</th>
                  </tr>
                </thead>
                <tbody>
                  {toInsert.slice(0, 6).map((r, i) => (
                    <tr key={i} className="border-t">
                      {mode === "pdf" && <td className="whitespace-nowrap px-3 py-1.5">{UTILITIES[r.utility].label}</td>}
                      <td className="px-3 py-1.5">{buildingNameById.get(r.buildingId) ?? r.buildingId}</td>
                      <td className="px-3 py-1.5">
                        {r.periodStart} 〜 {r.periodEnd}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5">{formatYen(r.amountYen)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5">{r.usageValue ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {toInsert.length > 6 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">ほか {toInsert.length - 6} 件…</p>
              )}
            </div>
          )}

          <Button onClick={runImport} disabled={busy || toInsert.length === 0}>
            <Upload className="size-4" />
            {busy
              ? "取込中…"
              : overwriteCount > 0
                ? `${toInsert.length} 件を取り込む（上書き ${overwriteCount} 件）`
                : `${toInsert.length} 件を取り込む`}
          </Button>
        </>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {done != null && <p className="text-sm text-success">{done} 件を取り込みました。</p>}
    </div>
  );
}
