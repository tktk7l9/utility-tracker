"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UTILITIES, UTILITY_ORDER, type NewReading, type Utility } from "@/lib/domain";

function firstOfMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function lastOfMonth(d: Date): string {
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

export function EntryForm({ onAdd }: { onAdd: (r: NewReading) => Promise<void> }) {
  const now = new Date();
  const [utility, setUtility] = useState<Utility>("electricity");
  const [periodStart, setPeriodStart] = useState(firstOfMonth(now));
  const [periodEnd, setPeriodEnd] = useState(lastOfMonth(now));
  const [amount, setAmount] = useState("");
  const [usage, setUsage] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const meta = UTILITIES[utility];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    const amountYen = Number(amount);
    if (amount === "" || !Number.isFinite(amountYen) || amountYen < 0) {
      setError("金額は0以上の数値で入力してください。");
      return;
    }
    if (periodEnd < periodStart) {
      setError("期間の終了日は開始日以降にしてください。");
      return;
    }
    const usageValue = usage === "" ? null : Number(usage);
    if (usageValue != null && (!Number.isFinite(usageValue) || usageValue < 0)) {
      setError("使用量は0以上の数値で入力してください。");
      return;
    }

    setBusy(true);
    try {
      await onAdd({
        utility,
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label>種別</Label>
        <div className="flex gap-1.5">
          {UTILITY_ORDER.map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setUtility(u)}
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
        <p className="text-xs text-muted-foreground">事業者: {meta.provider}（種別で自動設定）</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ps">検針期間（開始）</Label>
          <Input id="ps" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pe">検針期間（終了）</Label>
          <Input id="pe" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="amt">請求額（円・税込）</Label>
          <Input id="amt" inputMode="numeric" placeholder="例: 6200" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="use">使用量（{meta.unit}・任意）</Label>
          <Input id="use" inputMode="decimal" placeholder={`例: 24`} value={usage} onChange={(e) => setUsage(e.target.value)} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="note">メモ（任意）</Label>
        <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="燃料費調整の変動 など" />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {ok && <p className="text-sm text-success">保存しました。</p>}

      <Button type="submit" disabled={busy}>
        {busy ? "保存中…" : "追加する"}
      </Button>
      <p className="text-xs text-muted-foreground">
        水道は隔月請求のため、検針期間（約2か月）をそのまま入力すると月次グラフに日割りで按分されます。
      </p>
    </form>
  );
}
