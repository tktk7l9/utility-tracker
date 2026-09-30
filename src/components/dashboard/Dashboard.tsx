"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Download, RotateCw, LogIn } from "lucide-react";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UTILITIES, type Building, type NewBuilding, type NewReading, type Reading } from "@/lib/domain";
import { toMonthlySeries, trimIncompleteEnds } from "@/lib/aggregate";
import { toCsv, toExportJson, exportFilename } from "@/lib/export";
import {
  bulkUpsert,
  deleteBuilding,
  deleteReading,
  deleteReadings,
  fetchBuildings,
  fetchReadings,
  insertBuilding,
  insertReading,
  signOut,
  updateBuilding,
  updateReading,
} from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { planImportUndo, previousValues, undoImport, withoutId } from "@/lib/undo";
import { formatPeriod, formatYen } from "@/lib/utils";
import { UndoToast, type UndoNotice } from "@/components/UndoToast";

import { SummaryCards } from "./SummaryCards";
import { ProviderLinks } from "./ProviderLinks";
import { StatsStrip } from "./StatsStrip";
import { CompositionCard } from "./CompositionCard";
import { CostChart } from "./CostChart";
import { UsageChart } from "./UsageChart";
import { YoYChart } from "./YoYChart";
import { EntryForm } from "./EntryForm";
import { CsvImport } from "./CsvImport";
import { BuildingSelector } from "./BuildingSelector";
import { BuildingManager } from "./BuildingManager";
import { RecordList } from "./RecordList";

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

const TAB_KEYS = ["overview", "usage", "yoy", "entry", "records"] as const;
type TabKey = (typeof TAB_KEYS)[number];

function isTabKey(v: string): v is TabKey {
  return (TAB_KEYS as readonly string[]).includes(v);
}

/** The tab named in the URL hash, so a reload or a shared link lands on the same view (SHIG 59, 76). */
function tabFromHash(): TabKey {
  if (typeof window === "undefined") return "overview";
  const key = window.location.hash.slice(1);
  return isTabKey(key) ? key : "overview";
}

export function Dashboard() {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | "all">("all");
  const [tab, setTabState] = useState<TabKey>(tabFromHash);
  const setTab = useCallback((value: string) => {
    if (!isTabKey(value)) return;
    setTabState(value);
    const { pathname, search } = window.location;
    // replaceState keeps the browser's back button for leaving the app, not for retracing tab clicks (SHIG 81).
    window.history.replaceState(null, "", value === "overview" ? pathname + search : `#${value}`);
  }, []);
  useEffect(() => {
    const onHashChange = () => setTabState(tabFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  const [notice, setNotice] = useState<UndoNotice | null>(null);
  const closeNotice = useCallback(() => setNotice(null), []);
  const notify = (message: string, undo: () => Promise<void>) => setNotice({ id: Date.now(), message, undo });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([fetchReadings(), fetchBuildings()])
      .then(([r, b]) => {
        if (!active) return;
        setReadings(r);
        setBuildings(b);
      })
      .catch((e) => active && setError(friendlyError(e)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const visibleReadings = useMemo(
    () => (selectedBuildingId === "all" ? readings : readings.filter((r) => r.buildingId === selectedBuildingId)),
    [readings, selectedBuildingId]
  );
  const rawMonthly = useMemo(() => toMonthlySeries(visibleReadings), [visibleReadings]);
  const monthly = useMemo(() => trimIncompleteEnds(rawMonthly), [rawMonthly]);
  const buildingNameById = useMemo(() => new Map(buildings.map((b) => [b.id, b.name])), [buildings]);
  const readingCountsByBuilding = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of readings) counts.set(r.buildingId, (counts.get(r.buildingId) ?? 0) + 1);
    return counts;
  }, [readings]);
  const trimmedCount = rawMonthly.length - monthly.length;
  const defaultBuildingId = selectedBuildingId === "all" ? null : selectedBuildingId;

  // Additions and edits get the same undo notice as deletes, so no change is one-way (SHIG 54, 6).
  async function handleAdd(r: NewReading) {
    const inserted = await insertReading(r);
    setReadings((prev) => [...prev, inserted]);
    notify(
      `${UTILITIES[r.utility].label} ${formatPeriod(r.periodStart, r.periodEnd)} ${formatYen(r.amountYen)} を追加しました`,
      async () => {
        await deleteReading(inserted.id);
        setReadings((prev) => prev.filter((x) => x.id !== inserted.id));
      }
    );
  }

  // Imports can overwrite records; keep what they replace so the notice can put it back (SHIG 54).
  async function handleImport(rows: NewReading[]) {
    const plan = planImportUndo(rows, readings);
    await bulkUpsert(rows);
    setReadings(await fetchReadings());
    const overwritten = plan.restore.length;
    notify(
      overwritten > 0 ? `${rows.length} 件を取り込みました（うち上書き ${overwritten} 件）` : `${rows.length} 件を取り込みました`,
      async () => setReadings(await undoImport(plan, { fetchReadings, deleteReadings, bulkUpsert }))
    );
  }

  // Deletes run without a confirm dialog; the notice offers undo instead (SHIG 57, 54).
  async function handleDelete(id: string) {
    const removed = readings.find((r) => r.id === id);
    await deleteReading(id);
    setReadings((prev) => prev.filter((r) => r.id !== id));
    if (!removed) return;
    notify("レコードを削除しました", async () => {
      const restored = await insertReading(withoutId(removed));
      setReadings((prev) => [...prev, restored]);
    });
  }

  async function handleUpdate(id: string, patch: Partial<NewReading>) {
    const before = readings.find((r) => r.id === id);
    const updated = await updateReading(id, patch);
    setReadings((prev) => prev.map((r) => (r.id === id ? updated : r)));
    if (!before) return;
    notify("変更を保存しました", async () => {
      const restored = await updateReading(id, previousValues(before, patch));
      setReadings((prev) => prev.map((r) => (r.id === id ? restored : r)));
    });
  }

  async function handleAddBuilding(b: NewBuilding) {
    const inserted = await insertBuilding(b);
    setBuildings((prev) => [...prev, inserted]);
  }

  async function handleUpdateBuilding(id: string, patch: Partial<NewBuilding>) {
    const before = buildings.find((b) => b.id === id);
    const updated = await updateBuilding(id, patch);
    setBuildings((prev) => prev.map((b) => (b.id === id ? updated : b)));
    if (!before) return;
    notify(`建物「${updated.name}」の変更を保存しました`, async () => {
      const restored = await updateBuilding(id, previousValues(before, patch));
      setBuildings((prev) => prev.map((b) => (b.id === id ? restored : b)));
    });
  }

  async function handleDeleteBuilding(id: string) {
    const removed = buildings.find((b) => b.id === id);
    await deleteBuilding(id);
    setBuildings((prev) => prev.filter((b) => b.id !== id));
    if (selectedBuildingId === id) setSelectedBuildingId("all");
    if (!removed) return;
    notify(`建物「${removed.name}」を削除しました`, async () => {
      const restored = await insertBuilding(withoutId(removed));
      setBuildings((prev) => [...prev, restored]);
    });
  }

  if (loading) {
    return (
      <p role="status" className="py-16 text-center text-sm text-muted-foreground">
        読み込み中…
      </p>
    );
  }
  if (error) {
    return (
      <Card>
        <CardContent className="space-y-3 py-8 text-center text-sm">
          <p role="alert" className="text-destructive">
            データを読み込めませんでした。{error}
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button variant="outline" onClick={() => window.location.reload()}>
              <RotateCw className="size-4" /> 再読み込み
            </Button>
            <Button variant="ghost" onClick={() => signOut()}>
              <LogIn className="size-4" /> ログインし直す
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <BuildingSelector buildings={buildings} value={selectedBuildingId} onChange={setSelectedBuildingId} />
      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        {/* On phones: three tabs on the first row, two on the second, with no empty slot (SHIG 85). */}
        <TabsList className="grid h-auto w-full grid-cols-6 gap-1 sm:inline-flex sm:h-10 sm:w-auto sm:gap-0">
          <TabsTrigger value="overview" className="col-span-2 w-full sm:w-auto">
            料金・総評
          </TabsTrigger>
          <TabsTrigger value="usage" className="col-span-2 w-full sm:w-auto">
            使用量・単価
          </TabsTrigger>
          <TabsTrigger value="yoy" className="col-span-2 w-full sm:w-auto">
            前年同月比
          </TabsTrigger>
          <TabsTrigger value="entry" className="col-span-3 w-full sm:w-auto">
            取込
          </TabsTrigger>
          <TabsTrigger value="records" className="col-span-3 w-full sm:w-auto">
            記録
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <SummaryCards monthly={monthly} onStartImport={() => setTab("entry")} />
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
                    「一般家庭の目安」は二人以上世帯の月平均光熱費の概算（家計調査ベース）。「この期間の平均」はグラフに出ている月の合計の平均です。
                  </p>
                )}
                {trimmedCount > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    ※ 最初と最後の月は日数が足りないため、グラフに含めていません（{trimmedCount} か月）。
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
              <UsageChart readings={visibleReadings} />
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

        {/* The monthly task comes first: import the bill; manual entry and links follow (SHIG 20). */}
        <TabsContent value="entry" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">請求書の取込（PDF・CSV）</CardTitle>
            </CardHeader>
            <CardContent>
              <CsvImport
                buildings={buildings}
                defaultBuildingId={defaultBuildingId}
                existingReadings={readings}
                onImport={handleImport}
              />
            </CardContent>
          </Card>

          <Card>
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-6 [&::-webkit-details-marker]:hidden">
                {/* A heading inside the summary, so heading navigation reaches this card like the others (SHIG 59). */}
                <h2 className="text-base font-semibold">手入力</h2>
                <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
                  PDF・CSV がないとき
                  <ChevronDown aria-hidden className="size-4 transition-transform group-open:rotate-180" />
                </span>
              </summary>
              <CardContent>
                <EntryForm
                  buildings={buildings}
                  readings={readings}
                  defaultBuildingId={defaultBuildingId}
                  onAdd={handleAdd}
                />
              </CardContent>
            </details>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">各社の料金ページ</CardTitle>
              <CardDescription>請求書の PDF・CSV はここからダウンロードできます（別タブで開きます）。</CardDescription>
            </CardHeader>
            <CardContent>
              <ProviderLinks />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="records" className="space-y-4">
          <Card>
            <CardHeader className="flex-col items-stretch gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base">登録済みレコード（{visibleReadings.length} 件）</CardTitle>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={readings.length === 0}
                  onClick={() => download(exportFilename("json"), toExportJson(readings, buildings), "application/json")}
                >
                  <Download className="size-4" /> JSON
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={readings.length === 0}
                  onClick={() => download(exportFilename("csv"), toCsv(readings, buildings), "text/csv")}
                >
                  <Download className="size-4" /> CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <RecordList
                readings={visibleReadings}
                buildings={buildings}
                buildingNameById={buildingNameById}
                onDelete={handleDelete}
                onUpdate={handleUpdate}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">建物（住まい）</CardTitle>
              <CardDescription>居住期間が引っ越し記録を兼ねます。取込・手入力のときの建物の自動判定に使います。</CardDescription>
            </CardHeader>
            <CardContent>
              <BuildingManager
                buildings={buildings}
                readingCounts={readingCountsByBuilding}
                onAdd={handleAddBuilding}
                onUpdate={handleUpdateBuilding}
                onDelete={handleDeleteBuilding}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      <UndoToast notice={notice} onClose={closeNotice} />
    </div>
  );
}
