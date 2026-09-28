"use client";

import { useId, useState } from "react";
import { Check, ChevronDown, Trash2, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SOURCE_LABELS, UTILITIES, type Building, type NewReading, type Reading } from "@/lib/domain";
import { friendlyError } from "@/lib/errors";
import { parseLenientNumber } from "@/lib/number";
import { cn, formatPeriod, formatYen } from "@/lib/utils";

/** Records shown at first and added per "もっと見る" (SHIG 36/52: do not render hundreds of rows). */
const PAGE_SIZE = 12;

// One grid template for the header and every row, so the columns line up without a <table>.
// On phones each record becomes a two-line card: "type · building / period" and "amount / usage" (SHIG 82).
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 sm:grid-cols-[5.5rem_minmax(0,1fr)_11rem_6.5rem_6.5rem_5.5rem_1.5rem]";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function RecordList({
  readings,
  buildings,
  buildingNameById,
  onDelete,
  onUpdate,
}: {
  readings: Reading[];
  buildings: Building[];
  buildingNameById: Map<string, string>;
  onDelete: (id: string) => Promise<void>;
  onUpdate: (id: string, patch: Partial<NewReading>) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const sorted = [...readings].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
  const shown = sorted.slice(0, limit);

  if (sorted.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">まだレコードがありません。</p>;
  }

  return (
    <div className="space-y-3">
      <div className={cn(ROW_GRID, "hidden px-2 py-2 text-xs text-muted-foreground sm:grid")} aria-hidden>
        <span>種別</span>
        <span>建物</span>
        <span>検針期間</span>
        <span className="text-right">金額</span>
        <span className="text-right">使用量</span>
        <span>入力方法</span>
        <span />
      </div>
      <ul className="divide-y border-y">
        {shown.map((r) => {
          const meta = UTILITIES[r.utility];
          const isEditing = editingId === r.id;
          const buildingName = buildingNameById.get(r.buildingId) ?? r.buildingId;
          const usage = r.usageValue != null ? `${r.usageValue} ${r.usageUnit ?? meta.unit}` : null;
          return (
            <li key={r.id}>
              <button
                type="button"
                aria-expanded={isEditing}
                aria-label={`${meta.label} ${formatPeriod(r.periodStart, r.periodEnd)} ${formatYen(r.amountYen)} を編集`}
                onClick={() => setEditingId(isEditing ? null : r.id)}
                className={cn(
                  ROW_GRID,
                  "w-full px-2 py-2.5 text-left text-sm transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:py-2",
                  isEditing && "bg-muted/40"
                )}
              >
                <span className="order-1 flex min-w-0 items-center gap-1.5 font-medium sm:order-none sm:font-normal">
                  <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
                  {meta.label}
                  <span className="truncate font-normal text-muted-foreground sm:hidden">· {buildingName}</span>
                </span>
                <span className="hidden truncate text-muted-foreground sm:block">{buildingName}</span>
                <span className="order-3 whitespace-nowrap text-xs text-muted-foreground sm:order-none sm:text-sm sm:text-foreground">
                  {formatPeriod(r.periodStart, r.periodEnd)}
                </span>
                <span className="order-2 text-right font-medium tabular-nums sm:order-none sm:font-normal">
                  {formatYen(r.amountYen)}
                </span>
                <span className="order-4 text-right text-xs text-muted-foreground tabular-nums sm:order-none sm:text-sm">
                  {usage ?? <span className="hidden sm:inline">—</span>}
                </span>
                <span className="hidden sm:block">
                  <Badge variant={r.source === "manual" ? "outline" : "secondary"}>{SOURCE_LABELS[r.source]}</Badge>
                </span>
                <ChevronDown
                  aria-hidden
                  className={cn("hidden size-4 text-muted-foreground transition-transform sm:block", isEditing && "rotate-180")}
                />
              </button>
              {isEditing && (
                // The editor sits below the row at full width, never inside a scrolling table (SHIG 82/30).
                <div className="border-t bg-muted/30 px-3 py-3">
                  <EditRow
                    reading={r}
                    buildings={buildings}
                    onCancel={() => setEditingId(null)}
                    onSave={async (patch) => {
                      await onUpdate(r.id, patch);
                      setEditingId(null);
                    }}
                    onDelete={async () => {
                      await onDelete(r.id);
                      setEditingId(null);
                    }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {sorted.length > shown.length && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setLimit((n) => n + PAGE_SIZE * 2)}>
            もっと見る（残り {sorted.length - shown.length} 件）
          </Button>
        </div>
      )}
    </div>
  );
}

function EditRow({
  reading,
  buildings,
  onSave,
  onCancel,
  onDelete,
}: {
  reading: Reading;
  buildings: Building[];
  onSave: (patch: Partial<NewReading>) => Promise<void>;
  onCancel: () => void;
  onDelete: () => Promise<void>;
}) {
  const id = useId();
  const meta = UTILITIES[reading.utility];
  const [buildingId, setBuildingId] = useState(reading.buildingId);
  const [periodStart, setPeriodStart] = useState(reading.periodStart);
  const [periodEnd, setPeriodEnd] = useState(reading.periodEnd);
  const [amount, setAmount] = useState(String(reading.amountYen));
  const [usage, setUsage] = useState(reading.usageValue != null ? String(reading.usageValue) : "");
  const [note, setNote] = useState(reading.note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    const amountYen = parseLenientNumber(amount);
    if (amountYen == null || !Number.isFinite(amountYen) || amountYen < 0) {
      setErr("金額は0以上の数値で入力してください。");
      return;
    }
    if (periodEnd < periodStart) {
      setErr("終了日は開始日以降にしてください。");
      return;
    }
    const usageValue = parseLenientNumber(usage);
    if (usageValue != null && (!Number.isFinite(usageValue) || usageValue < 0)) {
      setErr("使用量は0以上の数値で入力してください。");
      return;
    }
    setBusy(true);
    try {
      await onSave({
        buildingId,
        periodStart,
        periodEnd,
        amountYen: Math.round(amountYen),
        usageValue,
        usageUnit: usageValue != null ? meta.unit : null,
        note: note.trim() || null,
      });
    } catch (e) {
      setErr(friendlyError(e));
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("このレコードを削除します。元に戻せません。よろしいですか？")) return;
    setErr(null);
    setBusy(true);
    try {
      await onDelete();
    } catch (e) {
      setErr(friendlyError(e));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1">
          <Label htmlFor={`${id}-building`}>建物</Label>
          <select
            id={`${id}-building`}
            className={selectClass}
            value={buildingId}
            onChange={(e) => setBuildingId(e.target.value)}
          >
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-start`}>開始</Label>
          <Input id={`${id}-start`} type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-end`}>終了</Label>
          <Input id={`${id}-end`} type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-amount`}>金額（円）</Label>
          <Input id={`${id}-amount`} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-usage`}>使用量（{meta.unit}）</Label>
          <Input id={`${id}-usage`} inputMode="decimal" value={usage} onChange={(e) => setUsage(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-note`}>メモ</Label>
        <Input id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {err && (
        <p role="alert" className="text-sm text-destructive">
          {err}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy} onClick={save}>
          <Check className="size-4" /> {busy ? "保存中…" : "保存"}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          <X className="size-4" /> キャンセル
        </Button>
        {/* Delete lives at the far end, away from 保存 (SHIG 16/78). */}
        <Button size="sm" variant="ghost" disabled={busy} onClick={remove} className="ml-auto text-destructive hover:text-destructive">
          <Trash2 className="size-4" /> 削除
        </Button>
      </div>
    </div>
  );
}
