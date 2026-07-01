"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Trash2, Pencil, Check, X, Download } from "lucide-react";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UTILITIES, type NewReading, type Reading } from "@/lib/domain";
import { toMonthlySeries, trimIncompleteEnds } from "@/lib/aggregate";
import { readingKey } from "@/lib/csv";
import { toCsv, toExportJson, exportFilename } from "@/lib/export";
import { bulkUpsert, deleteReading, fetchReadings, insertReading, updateReading } from "@/lib/supabase";
import { formatYen } from "@/lib/utils";

import { SummaryCards } from "./SummaryCards";
import { ProviderLinks } from "./ProviderLinks";
import { StatsStrip } from "./StatsStrip";
import { CompositionCard } from "./CompositionCard";
import { CostChart } from "./CostChart";
import { UsageChart } from "./UsageChart";
import { YoYChart } from "./YoYChart";
import { EntryForm } from "./EntryForm";
import { CsvImport } from "./CsvImport";

function download(filename: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function Dashboard() {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchReadings()
      .then((rows) => active && setReadings(rows))
      .catch((e) => active && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const rawMonthly = useMemo(() => toMonthlySeries(readings), [readings]);
  const monthly = useMemo(() => trimIncompleteEnds(rawMonthly), [rawMonthly]);
  const existingKeys = useMemo(() => readings.map(readingKey), [readings]);
  const trimmedCount = rawMonthly.length - monthly.length;

  async function handleAdd(r: NewReading) {
    const inserted = await insertReading(r);
    setReadings((prev) => [...prev, inserted]);
  }

  async function handleImport(rows: NewReading[]) {
    await bulkUpsert(rows);
    setReadings(await fetchReadings());
  }

  async function handleDelete(id: string) {
    await deleteReading(id);
    setReadings((prev) => prev.filter((r) => r.id !== id));
  }

  async function handleUpdate(id: string, patch: Partial<NewReading>) {
    const updated = await updateReading(id, patch);
    setReadings((prev) => prev.map((r) => (r.id === id ? updated : r)));
  }

  if (loading) {
    return <p className="py-16 text-center text-sm text-muted-foreground">読み込み中…</p>;
  }
  if (error) {
    return (
      <Card>
        <CardContent className="space-y-1 py-8 text-center text-sm">
          <p className="text-destructive">データの取得に失敗しました。</p>
          <p className="text-muted-foreground">{error}</p>
          <p className="text-muted-foreground">RLS 適用後は該当ユーザーでログインが必要です。</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Tabs defaultValue="overview" className="space-y-4">
      <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:inline-flex sm:h-10 sm:w-auto sm:gap-0">
        <TabsTrigger value="overview" className="w-full sm:w-auto">
          料金・総評
        </TabsTrigger>
        <TabsTrigger value="usage" className="w-full sm:w-auto">
          使用量・単価
        </TabsTrigger>
        <TabsTrigger value="yoy" className="w-full sm:w-auto">
          前年同月比
        </TabsTrigger>
        <TabsTrigger value="entry" className="w-full sm:w-auto">
          入力・管理
        </TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="space-y-4">
        <SummaryCards monthly={monthly} />
        <StatsStrip data={monthly} />
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">月別料金の推移（3社積み上げ＋合計）</CardTitle>
            </CardHeader>
            <CardContent>
              <CostChart data={monthly} />
              {monthly.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  紫の点線は一般家庭（二人以上世帯）の月平均光熱費の目安（家計調査ベースの概算）。
                </p>
              )}
              {trimmedCount > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  ※ データ端の部分月（検針期間が月全体を覆わない {trimmedCount} 月）は、合計が過小に見えるため比較グラフから除外しています。
                </p>
              )}
            </CardContent>
          </Card>
          <CompositionCard data={monthly} />
        </div>
      </TabsContent>

      <TabsContent value="usage">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">使用量と実効単価</CardTitle>
          </CardHeader>
          <CardContent>
            <UsageChart readings={readings} />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="yoy">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">前年同月比・季節性</CardTitle>
          </CardHeader>
          <CardContent>
            <YoYChart data={monthly} />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="entry" className="grid gap-4 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">各社の料金ページ</CardTitle>
            <CardDescription>明細の確認・CSV ダウンロードはこちらから（別タブで開きます）。</CardDescription>
          </CardHeader>
          <CardContent>
            <ProviderLinks />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">手入力</CardTitle>
          </CardHeader>
          <CardContent>
            <EntryForm onAdd={handleAdd} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">CSV 取込</CardTitle>
          </CardHeader>
          <CardContent>
            <CsvImport existingKeys={existingKeys} onImport={handleImport} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex-col items-stretch gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">登録済みレコード（{readings.length} 件）</CardTitle>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={readings.length === 0}
                onClick={() => download(exportFilename("json"), toExportJson(readings), "application/json")}
              >
                <Download className="size-4" /> JSON
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={readings.length === 0}
                onClick={() => download(exportFilename("csv"), toCsv(readings), "text/csv")}
              >
                <Download className="size-4" /> CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <RecordList readings={readings} onDelete={handleDelete} onUpdate={handleUpdate} />
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

function RecordList({
  readings,
  onDelete,
  onUpdate,
}: {
  readings: Reading[];
  onDelete: (id: string) => Promise<void>;
  onUpdate: (id: string, patch: Partial<NewReading>) => Promise<void>;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const sorted = [...readings].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));

  if (sorted.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">まだレコードがありません。</p>;
  }

  async function remove(id: string) {
    if (!window.confirm("このレコードを削除します。元に戻せません。よろしいですか？")) return;
    setPendingId(id);
    try {
      await onDelete(id);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-2 py-2">種別</th>
            <th className="px-2 py-2">検針期間</th>
            <th className="px-2 py-2 text-right">金額</th>
            <th className="px-2 py-2 text-right">使用量</th>
            <th className="px-2 py-2">元</th>
            <th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const meta = UTILITIES[r.utility];
            const isEditing = editingId === r.id;
            return (
              <Fragment key={r.id}>
                <tr className="border-t">
                  <td className="px-2 py-1.5">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: meta.color }} />
                      {meta.label}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {r.periodStart} 〜 {r.periodEnd}
                  </td>
                  <td className="px-2 py-1.5 text-right">{formatYen(r.amountYen)}</td>
                  <td className="px-2 py-1.5 text-right text-muted-foreground">
                    {r.usageValue != null ? `${r.usageValue} ${r.usageUnit ?? meta.unit}` : "—"}
                  </td>
                  <td className="px-2 py-1.5">
                    <Badge variant={r.source === "csv" ? "secondary" : "outline"}>{r.source}</Badge>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="編集"
                        onClick={() => setEditingId(isEditing ? null : r.id)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="削除"
                        disabled={pendingId === r.id}
                        onClick={() => remove(r.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
                {isEditing && (
                  <tr className="bg-muted/30">
                    <td colSpan={6} className="px-2 py-3">
                      <EditRow
                        reading={r}
                        onCancel={() => setEditingId(null)}
                        onSave={async (patch) => {
                          await onUpdate(r.id, patch);
                          setEditingId(null);
                        }}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EditRow({
  reading,
  onSave,
  onCancel,
}: {
  reading: Reading;
  onSave: (patch: Partial<NewReading>) => Promise<void>;
  onCancel: () => void;
}) {
  const meta = UTILITIES[reading.utility];
  const [periodStart, setPeriodStart] = useState(reading.periodStart);
  const [periodEnd, setPeriodEnd] = useState(reading.periodEnd);
  const [amount, setAmount] = useState(String(reading.amountYen));
  const [usage, setUsage] = useState(reading.usageValue != null ? String(reading.usageValue) : "");
  const [note, setNote] = useState(reading.note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    const amountYen = Number(amount);
    if (amount === "" || !Number.isFinite(amountYen) || amountYen < 0) {
      setErr("金額は0以上の数値で入力してください。");
      return;
    }
    if (periodEnd < periodStart) {
      setErr("終了日は開始日以降にしてください。");
      return;
    }
    const usageValue = usage === "" ? null : Number(usage);
    if (usageValue != null && (!Number.isFinite(usageValue) || usageValue < 0)) {
      setErr("使用量は0以上の数値で入力してください。");
      return;
    }
    setBusy(true);
    try {
      await onSave({
        periodStart,
        periodEnd,
        amountYen: Math.round(amountYen),
        usageValue,
        usageUnit: usageValue != null ? meta.unit : null,
        note: note.trim() || null,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label>開始</Label>
          <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>終了</Label>
          <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>金額（円）</Label>
          <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>使用量（{meta.unit}）</Label>
          <Input inputMode="decimal" value={usage} onChange={(e) => setUsage(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1">
        <Label>メモ</Label>
        <Input value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={save}>
          <Check className="size-4" /> {busy ? "保存中…" : "保存"}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          <X className="size-4" /> キャンセル
        </Button>
      </div>
    </div>
  );
}
