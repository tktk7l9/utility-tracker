"use client";

import { useMemo, useState } from "react";
import { Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { UTILITIES, UTILITY_ORDER, type NewReading, type Utility } from "@/lib/domain";
import { parseCsv, mapRowsToReadings, dedupe, type CsvMapping } from "@/lib/csv";
import { formatYen } from "@/lib/utils";

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
      className={selectClass}
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
  existingKeys,
  onImport,
}: {
  existingKeys: string[];
  onImport: (readings: NewReading[]) => Promise<void>;
}) {
  const [rawText, setRawText] = useState("");
  const [encoding, setEncoding] = useState("utf-8");
  const [utility, setUtility] = useState<Utility>("electricity");
  const [hasHeader, setHasHeader] = useState(true);
  const [colEnd, setColEnd] = useState(0);
  const [colAmount, setColAmount] = useState(1);
  const [colStart, setColStart] = useState<number | null>(null);
  const [colUsage, setColUsage] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const rows = useMemo(() => parseCsv(rawText), [rawText]);
  const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0);

  function applyDefaults(parsed: string[][]) {
    const cols = parsed.reduce((m, r) => Math.max(m, r.length), 0);
    setColEnd(0);
    setColAmount(cols > 1 ? cols - 1 : 0);
    setColStart(null);
    setColUsage(null);
    setDone(null);
    setError(null);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const text = new TextDecoder(encoding).decode(buf);
      setRawText(text);
      applyDefaults(parseCsv(text));
    } catch {
      setError("ファイルを読み込めませんでした。エンコーディングを確認してください。");
    }
  }

  const mapping: CsvMapping = {
    utility,
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
    [rows, utility, hasHeader, colEnd, colAmount, colStart, colUsage]
  );
  const { toInsert, duplicates } = dedupe(parsed.readings, existingKeys);

  const headerLabel = (i: number): string => (hasHeader && rows[0]?.[i] ? rows[0][i] : `列${i + 1}`);

  async function runImport() {
    setBusy(true);
    setError(null);
    try {
      await onImport(toInsert);
      setDone(toInsert.length);
      setRawText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label>種別</Label>
          <div className="flex gap-1.5">
            {UTILITY_ORDER.map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setUtility(u)}
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
        <div className="space-y-1.5">
          <Label htmlFor="enc">文字コード</Label>
          <select id="enc" className={selectClass} value={encoding} onChange={(e) => setEncoding(e.target.value)}>
            <option value="utf-8">UTF-8</option>
            <option value="shift_jis">Shift_JIS</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="file">CSV ファイル</Label>
          <Input file id="file" onChange={onFile} />
        </div>
      </div>

      {rows.length > 0 && (
        <>
          <div className="grid gap-3 rounded-md border bg-muted/40 p-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="col-span-full flex items-center gap-2 text-sm">
              <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
              1行目はヘッダ
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

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="success">取込 {toInsert.length} 件</Badge>
            {duplicates.length > 0 && <Badge variant="secondary">重複スキップ {duplicates.length} 件</Badge>}
            {parsed.errors.length > 0 && <Badge variant="destructive">エラー {parsed.errors.length} 件</Badge>}
          </div>

          {toInsert.length > 0 && (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">期間</th>
                    <th className="px-3 py-2">金額</th>
                    <th className="px-3 py-2">使用量</th>
                  </tr>
                </thead>
                <tbody>
                  {toInsert.slice(0, 6).map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-1.5">
                        {r.periodStart} 〜 {r.periodEnd}
                      </td>
                      <td className="px-3 py-1.5">{formatYen(r.amountYen)}</td>
                      <td className="px-3 py-1.5">{r.usageValue ?? "—"}</td>
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
            {busy ? "取込中…" : `${toInsert.length} 件を取り込む`}
          </Button>
        </>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {done != null && <p className="text-sm text-success">{done} 件を取り込みました。</p>}
    </div>
  );
}

// ファイル入力は shadcn Input の file バリアント風。
function Input({ file, className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { file?: boolean }) {
  return (
    <input
      type={file ? "file" : "text"}
      accept={file ? ".csv,text/csv" : undefined}
      className={
        "flex h-9 w-full rounded-md border border-input bg-background px-2 py-1 text-sm file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-sm " +
        (className ?? "")
      }
      {...props}
    />
  );
}
