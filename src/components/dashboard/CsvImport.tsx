"use client";

import { useId, useMemo, useState } from "react";
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
import { decodeCsv, type CsvEncoding } from "@/lib/encoding";
import { formatPeriod, formatYen } from "@/lib/utils";
import { friendlyError } from "@/lib/errors";
import { ToggleChip } from "@/components/ui/toggle-chip";

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Parse result for one loaded PDF file. */
interface PdfFileResult {
  name: string;
  bills: ParsedBill[];
  error: string | null;
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function ColSelect({
  id,
  value,
  onChange,
  maxCols,
  label,
  allowNone,
}: {
  id: string;
  value: number | null;
  onChange: (v: number | null) => void;
  maxCols: number;
  label: (i: number) => string;
  allowNone?: boolean;
}) {
  return (
    <select
      id={id}
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
  const id = useId();
  const [rawText, setRawText] = useState("");
  const [encoding, setEncoding] = useState<CsvEncoding>("utf-8");
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [pdfFiles, setPdfFiles] = useState<PdfFileResult[]>([]);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [utility, setUtility] = useState<Utility>("electricity");
  // Utility type detected from the CSV headers (undefined = not loaded yet or re-picked by hand, null = could not detect).
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
  // Remounting the file input clears the file name it shows once the import is done (SHIG 25).
  const [inputKey, setInputKey] = useState(0);
  const [dragging, setDragging] = useState(false);

  const rows = useMemo(() => parseCsv(rawText), [rawText]);
  const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  // The key includes the building, so duplicate detection never mixes buildings (built from all records).
  const existingKeys = useMemo(() => existingReadings.map(readingKey), [existingReadings]);
  const existingSet = useMemo(() => new Set(existingKeys), [existingKeys]);
  const mode: "csv" | "pdf" | null = pdfFiles.length > 0 ? "pdf" : rows.length > 0 ? "csv" : null;

  function applyDefaults(parsed: string[][]) {
    const cols = parsed.reduce((m, r) => Math.max(m, r.length), 0);
    // When there is a header, infer the initial mapping and type from column names (can be re-picked by hand if wrong).
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

  /**
   * Decodes the buffer and shows it. Without `enc`, the encoding is detected (SHIG 29).
   * resetCols=true re-applies the default column mapping.
   */
  function decodeAndLoad(buf: ArrayBuffer, enc: CsvEncoding | undefined, resetCols: boolean) {
    const { text, encoding: used } = decodeCsv(buf, enc);
    setEncoding(used);
    setRawText(text);
    if (resetCols) {
      applyDefaults(parseCsv(text));
    } else {
      // Keep the column mapping already set when switching encoding (the structure is the same).
      setDone(null);
      setError(null);
    }
  }

  /** Reads and parses bill PDFs one by one (files that cannot be read are kept with a reason). */
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

  /** Shared by the file input and the drop zone (SHIG 79: drop the downloaded bill straight in). */
  async function handleFiles(files: File[]) {
    if (files.length === 0) return;
    setDone(null);
    setError(null);
    // Each file is a fresh decision: a choice made for the last file must not stay ticked while the option is hidden (SHIG 57).
    setOverwrite(false);
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
      decodeAndLoad(buf, undefined, true);
    } catch {
      setError("ファイルを読み込めませんでした。別のファイルを選ぶか、もう一度お試しください。");
    }
  }

  // When the encoding changes, re-decode the selected file while keeping the column mapping.
  function onEncodingChange(enc: CsvEncoding) {
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

  // For PDFs, each bill's parse result becomes an import candidate (the building is inferred from the reading period unless fixed).
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
  // In overwrite mode existing keys are not excluded; only in-file duplicates are collapsed (bulkUpsert overwrites via upsert).
  const { toInsert, duplicates } = dedupe(candidates, overwrite ? [] : existingKeys);
  const overwriteCount = overwrite ? toInsert.filter((r) => existingSet.has(readingKey(r))).length : 0;
  // Overwriting only matters when the file repeats a registered period; the option appears just then (SHIG 67).
  const canOverwrite = candidates.some((r) => existingSet.has(readingKey(r)));
  // Existing records whose periods overlap without being identical (e.g. old month-based records vs. bills by reading period) would be double-counted.
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
      setInputKey((k) => k + 1);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    // On the input tab this sits in a half-width card, so the column count follows this element's width, not the viewport.
    <div className="@container space-y-4">
      {/* The bill comes first: everything else is decided from it (SHIG 40, 20). */}
      <div
        data-testid="drop-zone"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          // Moving over a child fires dragleave on the zone too; only leaving the zone itself ends the highlight.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handleFiles(Array.from(e.dataTransfer.files));
        }}
        className={`space-y-2 rounded-lg border-2 border-dashed p-4 transition-colors ${
          dragging ? "border-primary bg-primary/5" : "border-border bg-muted/30"
        }`}
      >
        <Label htmlFor={`${id}-file`} className="text-sm font-medium">
          CSV / PDF ファイル
        </Label>
        <Input
          key={inputKey}
          type="file"
          accept=".csv,text/csv,.pdf,application/pdf"
          multiple
          id={`${id}-file`}
          onChange={(e) => void handleFiles(Array.from(e.target.files ?? []))}
          className="h-9 bg-background file:mr-3 file:rounded file:bg-secondary file:px-2 file:py-1"
        />
        <p className="text-xs text-muted-foreground">
          ここにドロップしても選べます。PDF は東京電力・エルピオ・東京都水道局の請求書に対応し、複数まとめて選べます（この端末の中だけで読み取ります）。
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-building`} className="block">建物</Label>
          <select
            id={`${id}-building`}
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
        {/* PDFs say which utility they are; only a CSV needs the choice (SHIG 67). */}
        {mode === "csv" && (
          <div className="space-y-1.5">
            <Label id={`${id}-utility-label`}>種別</Label>
            <div className="flex gap-1.5" role="group" aria-labelledby={`${id}-utility-label`}>
              {UTILITY_ORDER.map((u) => (
                <ToggleChip
                  key={u}
                  pressed={u === utility}
                  color={UTILITIES[u].color}
                  onClick={() => {
                    setUtility(u);
                    setDetectedUtility(undefined);
                  }}
                >
                  {UTILITIES[u].label}
                </ToggleChip>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* One always-mounted live region for progress and detection messages, so they are announced. */}
      <div aria-live="polite" className="space-y-1 empty:hidden">
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
      </div>

      {mode === "csv" && (
        <div className="grid grid-cols-1 gap-3 rounded-md border bg-muted/40 p-3 @xs:grid-cols-2 @2xl:grid-cols-4">
          <label className="col-span-full flex items-center gap-2 text-sm">
            <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
            1行目はヘッダ
          </label>
          <details className="col-span-full text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              文字コード: {encoding === "utf-8" ? "UTF-8" : "Shift_JIS"}（自動判定・文字化けするときは変更）
            </summary>
            <div className="mt-2 space-y-1">
              <Label htmlFor={`${id}-enc`}>文字コード</Label>
              <select
                id={`${id}-enc`}
                className={selectClass}
                value={encoding}
                onChange={(e) => onEncodingChange(e.target.value as CsvEncoding)}
              >
                <option value="utf-8">UTF-8</option>
                <option value="shift_jis">Shift_JIS</option>
              </select>
            </div>
          </details>
          <div className="space-y-1">
            <Label htmlFor={`${id}-col-end`}>検針日 / 期間終了列</Label>
            <ColSelect id={`${id}-col-end`} value={colEnd} onChange={(v) => setColEnd(v ?? 0)} maxCols={maxCols} label={headerLabel} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-col-amount`}>金額列</Label>
            <ColSelect id={`${id}-col-amount`} value={colAmount} onChange={(v) => setColAmount(v ?? 0)} maxCols={maxCols} label={headerLabel} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-col-start`}>期間開始列（任意）</Label>
            <ColSelect id={`${id}-col-start`} value={colStart} onChange={setColStart} maxCols={maxCols} label={headerLabel} allowNone />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-col-usage`}>使用量列（任意）</Label>
            <ColSelect id={`${id}-col-usage`} value={colUsage} onChange={setColUsage} maxCols={maxCols} label={headerLabel} allowNone />
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
          {canOverwrite && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
              既存の同一期間レコードを上書きする（金額の訂正などを再取込する場合）
            </label>
          )}

          {overlaps.length > 0 && (
            <div role="alert" className="space-y-1.5 rounded-md border border-warning/60 bg-warning/10 p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <TriangleAlert className="size-4 shrink-0 text-warning" />
                期間が重なる登録済みの記録が {overlaps.length} 件あります
              </p>
              <p className="text-xs">
                このまま取り込むと、重なった日数分が二重に計上されます。古い記録は「記録」タブで開いて削除してください（削除は取り消せます）。
              </p>
              <ul className="space-y-0.5 text-xs">
                {overlaps.map(({ incoming, existing }) => (
                  <li key={`${existing.id}|${readingKey(incoming)}`}>
                    {UTILITIES[existing.utility].label}：登録済み {formatPeriod(existing.periodStart, existing.periodEnd)}（
                    {formatYen(existing.amountYen)}）と、取込 {formatPeriod(incoming.periodStart, incoming.periodEnd)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {toInsert.length > 0 && (
            // Scrolls sideways on phones, so it must be reachable by keyboard (WCAG 2.1.1).
            <div
              role="region"
              aria-label="取り込む内容"
              tabIndex={0}
              className="overflow-x-auto rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                  <tr>
                    {mode === "pdf" && <th className="whitespace-nowrap px-3 py-2">種別</th>}
                    <th className="whitespace-nowrap px-3 py-2">建物</th>
                    <th className="px-3 py-2">期間</th>
                    <th className="whitespace-nowrap px-3 py-2">金額</th>
                    <th className="whitespace-nowrap px-3 py-2">使用量</th>
                  </tr>
                </thead>
                <tbody>
                  {toInsert.slice(0, 6).map((r, i) => (
                    <tr key={i} className="border-t">
                      {mode === "pdf" && <td className="whitespace-nowrap px-3 py-1.5">{UTILITIES[r.utility].label}</td>}
                      <td className="whitespace-nowrap px-3 py-1.5">{buildingNameById.get(r.buildingId) ?? r.buildingId}</td>
                      <td className="whitespace-nowrap px-3 py-1.5">{formatPeriod(r.periodStart, r.periodEnd)}</td>
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

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {/* The undo notice announces the result; this line only confirms it visually. */}
      {done != null && <p className="text-sm text-success">{done} 件を取り込みました。</p>}
    </div>
  );
}
