"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UTILITIES, UTILITY_ORDER, type Building, type NewReading, type Reading, type Utility } from "@/lib/domain";
import { inferBuilding } from "@/lib/buildings";
import { parseLenientNumber } from "@/lib/number";
import { suggestPeriod } from "@/lib/period";
import { friendlyError } from "@/lib/errors";
import { ToggleChip } from "@/components/ui/toggle-chip";

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function EntryForm({
  buildings,
  readings,
  defaultBuildingId,
  onAdd,
}: {
  buildings: Building[];
  /** Existing records, used to suggest the next billing period (SHIG 14/42). */
  readings: Reading[];
  defaultBuildingId: string | null;
  onAdd: (r: NewReading) => Promise<void>;
}) {
  const id = useId();
  const [utility, setUtility] = useState<Utility>("electricity");
  const [initialPeriod] = useState(() => suggestPeriod(readings, "electricity", new Date(), defaultBuildingId));
  const [periodStart, setPeriodStart] = useState(initialPeriod.periodStart);
  const [periodEnd, setPeriodEnd] = useState(initialPeriod.periodEnd);
  const [buildingChoice, setBuildingChoice] = useState(defaultBuildingId ?? "");
  const [amount, setAmount] = useState("");
  const [usage, setUsage] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const meta = UTILITIES[utility];
  const inferred = inferBuilding(buildings, periodStart, periodEnd);

  /** Switching the utility also moves the period to where that utility's records leave off. */
  function chooseUtility(u: Utility) {
    setUtility(u);
    const next = suggestPeriod(readings, u, new Date(), buildingChoice || defaultBuildingId);
    setPeriodStart(next.periodStart);
    setPeriodEnd(next.periodEnd);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    const amountYen = parseLenientNumber(amount);
    if (amountYen == null || !Number.isFinite(amountYen) || amountYen < 0) {
      setError("金額は0以上の数値で入力してください。");
      return;
    }
    if (periodEnd < periodStart) {
      setError("期間の終了日は開始日以降にしてください。");
      return;
    }
    const usageValue = parseLenientNumber(usage);
    if (usageValue != null && (!Number.isFinite(usageValue) || usageValue < 0)) {
      setError("使用量は0以上の数値で入力してください。");
      return;
    }
    const buildingId = buildingChoice || inferred?.id;
    if (!buildingId) {
      setError("建物を選択してください。");
      return;
    }

    setBusy(true);
    try {
      await onAdd({
        utility,
        buildingId,
        provider: meta.provider,
        periodStart,
        periodEnd,
        amountYen: Math.round(amountYen),
        usageValue,
        usageUnit: usageValue != null ? meta.unit : null,
        note: note.trim() || null,
        source: "manual",
      });
      setAmount("");
      setUsage("");
      setNote("");
      setOk(true);
      // Move on to the following period so the next bill can be entered straight away.
      const next = suggestPeriod([{ utility, buildingId, periodStart, periodEnd }], utility, new Date());
      setPeriodStart(next.periodStart);
      setPeriodEnd(next.periodEnd);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label id={`${id}-utility-label`}>種別</Label>
        <div className="flex gap-1.5" role="group" aria-labelledby={`${id}-utility-label`}>
          {UTILITY_ORDER.map((u) => (
            <ToggleChip key={u} pressed={u === utility} color={UTILITIES[u].color} onClick={() => chooseUtility(u)}>
              {UTILITIES[u].label}
            </ToggleChip>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-building`} className="block">建物</Label>
        <select
          id={`${id}-building`}
          className={selectClass}
          value={buildingChoice}
          onChange={(e) => setBuildingChoice(e.target.value)}
        >
          <option value="">自動（推定: {inferred?.name ?? "該当なし"}）</option>
          {buildings.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      {utility === "water" && (
        <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          水道は2か月ごとの請求です。請求書の検針期間（約2か月）をそのまま入れると、月別のグラフでは日数で分けて表示します。
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-ps`}>検針期間（開始）</Label>
          <Input id={`${id}-ps`} type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-pe`}>検針期間（終了）</Label>
          <Input id={`${id}-pe`} type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-amt`}>請求額（円・税込）</Label>
          <Input id={`${id}-amt`} inputMode="numeric" placeholder="例: 6,200" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-use`}>使用量（{meta.unit}・任意）</Label>
          <Input id={`${id}-use`} inputMode="decimal" placeholder={`例: 24`} value={usage} onChange={(e) => setUsage(e.target.value)} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-note`}>メモ（任意）</Label>
        <Input id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="燃料費調整の変動 など" />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {/* The live region stays mounted so the confirmation is announced when it appears. */}
      <p aria-live="polite" className="text-sm text-success empty:hidden">
        {ok && "保存しました。"}
      </p>

      <Button type="submit" disabled={busy}>
        {busy ? "保存中…" : "追加する"}
      </Button>
    </form>
  );
}
