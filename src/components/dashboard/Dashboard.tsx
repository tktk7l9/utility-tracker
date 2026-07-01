"use client";

import { useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UTILITIES, type NewReading, type Reading } from "@/lib/domain";
import { summarize, toMonthlySeries } from "@/lib/aggregate";
import { readingKey } from "@/lib/csv";
import { bulkUpsert, deleteReading, fetchReadings, insertReading } from "@/lib/supabase";
import { formatYen } from "@/lib/utils";

import { SummaryCards } from "./SummaryCards";
import { CostChart } from "./CostChart";
import { UsageChart } from "./UsageChart";
import { YoYChart } from "./YoYChart";
import { EntryForm } from "./EntryForm";
import { CsvImport } from "./CsvImport";

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

  const monthly = useMemo(() => toMonthlySeries(readings), [readings]);
  const summary = useMemo(() => summarize(monthly), [monthly]);
  const existingKeys = useMemo(() => readings.map(readingKey), [readings]);

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
      <TabsList className="flex-wrap">
        <TabsTrigger value="overview">料金・総評</TabsTrigger>
        <TabsTrigger value="usage">使用量・単価</TabsTrigger>
        <TabsTrigger value="yoy">前年同月比</TabsTrigger>
        <TabsTrigger value="entry">入力・管理</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="space-y-4">
        <SummaryCards summary={summary} />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">月別料金の推移（3社積み上げ＋合計）</CardTitle>
          </CardHeader>
          <CardContent>
            <CostChart data={monthly} />
          </CardContent>
        </Card>
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
          <CardHeader>
            <CardTitle className="text-base">登録済みレコード（{readings.length} 件）</CardTitle>
          </CardHeader>
          <CardContent>
            <RecordList readings={readings} onDelete={handleDelete} />
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

function RecordList({ readings, onDelete }: { readings: Reading[]; onDelete: (id: string) => Promise<void> }) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const sorted = [...readings].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));

  if (sorted.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">まだレコードがありません。</p>;
  }

  async function remove(id: string) {
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
            return (
              <tr key={r.id} className="border-t">
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
                <td className="px-2 py-1.5 text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="削除"
                    disabled={pendingId === r.id}
                    onClick={() => remove(r.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
