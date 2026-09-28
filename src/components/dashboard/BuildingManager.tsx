"use client";

import { useId, useState } from "react";
import { Check, ChevronDown, Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { Building, NewBuilding } from "@/lib/domain";
import { sortBuildings, isCurrentResidence } from "@/lib/buildings";
import { friendlyError } from "@/lib/errors";
import { cn, formatPeriod } from "@/lib/utils";

// Shared by the header and the rows; on phones a row is "name / period" plus the record count (SHIG 82).
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 sm:grid-cols-[minmax(0,1fr)_14rem_6rem_1.5rem]";

export function BuildingManager({
  buildings,
  readingCounts,
  onAdd,
  onUpdate,
  onDelete,
}: {
  buildings: Building[];
  readingCounts: Map<string, number>;
  onAdd: (b: NewBuilding) => Promise<void>;
  onUpdate: (id: string, patch: Partial<NewBuilding>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const sorted = sortBuildings(buildings);

  return (
    <div className="space-y-3">
      {sorted.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">まだ建物が登録されていません。</p>
      ) : (
        <div>
          <div className={cn(ROW_GRID, "hidden px-2 py-2 text-xs text-muted-foreground sm:grid")} aria-hidden>
            <span>名前</span>
            <span>居住期間</span>
            <span className="text-right">記録数</span>
            <span />
          </div>
          <ul className="divide-y border-y">
            {sorted.map((b) => {
              const count = readingCounts.get(b.id) ?? 0;
              const isEditing = editingId === b.id;
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    aria-expanded={isEditing}
                    aria-label={`${b.name} を編集`}
                    onClick={() => setEditingId(isEditing ? null : b.id)}
                    className={cn(
                      ROW_GRID,
                      "w-full px-2 py-2.5 text-left text-sm transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:py-2",
                      isEditing && "bg-muted/40"
                    )}
                  >
                    <span className="truncate font-medium sm:font-normal">{b.name}</span>
                    <span className="order-3 flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground sm:order-none sm:text-sm">
                      {formatPeriod(b.movedInOn, b.movedOutOn)}
                      {isCurrentResidence(b) && <Badge variant="outline">現住</Badge>}
                    </span>
                    <span className="order-2 text-right text-xs text-muted-foreground tabular-nums sm:order-none sm:text-sm">
                      {count} 件
                    </span>
                    <ChevronDown
                      aria-hidden
                      className={cn("hidden size-4 text-muted-foreground transition-transform sm:block", isEditing && "rotate-180")}
                    />
                  </button>
                  {isEditing && (
                    <div className="border-t bg-muted/30 px-3 py-3">
                      <BuildingEditRow
                        building={b}
                        readingCount={count}
                        onCancel={() => setEditingId(null)}
                        onSave={async (patch) => {
                          await onUpdate(b.id, patch);
                          setEditingId(null);
                        }}
                        onDelete={async () => {
                          await onDelete(b.id);
                          setEditingId(null);
                        }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {adding ? (
        <BuildingAddForm
          onCancel={() => setAdding(false)}
          onSave={async (b) => {
            await onAdd(b);
            setAdding(false);
          }}
        />
      ) : (
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Plus className="size-4" /> 建物を追加
        </Button>
      )}
    </div>
  );
}

function BuildingFields({
  name,
  movedInOn,
  movedOutOn,
  onName,
  onMovedInOn,
  onMovedOutOn,
  namePlaceholder,
}: {
  name: string;
  movedInOn: string;
  movedOutOn: string;
  onName: (v: string) => void;
  onMovedInOn: (v: string) => void;
  onMovedOutOn: (v: string) => void;
  namePlaceholder?: string;
}) {
  const id = useId();
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <div className="space-y-1">
        <Label htmlFor={`${id}-name`}>名前</Label>
        <Input id={`${id}-name`} value={name} onChange={(e) => onName(e.target.value)} placeholder={namePlaceholder} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-in`}>入居日</Label>
        <Input id={`${id}-in`} type="date" value={movedInOn} onChange={(e) => onMovedInOn(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-out`}>退去日（空欄 = 現住）</Label>
        <Input id={`${id}-out`} type="date" value={movedOutOn} onChange={(e) => onMovedOutOn(e.target.value)} />
      </div>
    </div>
  );
}

function BuildingEditRow({
  building,
  readingCount,
  onSave,
  onCancel,
  onDelete,
}: {
  building: Building;
  readingCount: number;
  onSave: (patch: Partial<NewBuilding>) => Promise<void>;
  onCancel: () => void;
  onDelete: () => Promise<void>;
}) {
  const [name, setName] = useState(building.name);
  const [movedInOn, setMovedInOn] = useState(building.movedInOn);
  const [movedOutOn, setMovedOutOn] = useState(building.movedOutOn ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    if (name.trim() === "") {
      setErr("名前を入力してください。");
      return;
    }
    if (movedOutOn !== "" && movedOutOn < movedInOn) {
      setErr("退去日は入居日以降にしてください。");
      return;
    }
    setBusy(true);
    try {
      await onSave({ name: name.trim(), movedInOn, movedOutOn: movedOutOn === "" ? null : movedOutOn });
    } catch (e) {
      setErr(friendlyError(e));
      setBusy(false);
    }
  }

  async function remove() {
    // The button stays enabled so the reason can be shown next to it, not only in a tooltip (SHIG 94/66).
    if (readingCount > 0) {
      setErr(`記録が ${readingCount} 件あるため削除できません。先に「登録済みレコード」から記録を移すか削除してください。`);
      return;
    }
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
      <BuildingFields
        name={name}
        movedInOn={movedInOn}
        movedOutOn={movedOutOn}
        onName={setName}
        onMovedInOn={setMovedInOn}
        onMovedOutOn={setMovedOutOn}
      />
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
        <Button size="sm" variant="ghost" disabled={busy} onClick={remove} className="ml-auto text-destructive hover:text-destructive">
          <Trash2 className="size-4" /> 削除
        </Button>
      </div>
    </div>
  );
}

function BuildingAddForm({
  onSave,
  onCancel,
}: {
  onSave: (b: NewBuilding) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [movedInOn, setMovedInOn] = useState("");
  const [movedOutOn, setMovedOutOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    if (name.trim() === "") {
      setErr("名前を入力してください。");
      return;
    }
    if (movedInOn === "") {
      setErr("入居日を入力してください。");
      return;
    }
    if (movedOutOn !== "" && movedOutOn < movedInOn) {
      setErr("退去日は入居日以降にしてください。");
      return;
    }
    setBusy(true);
    try {
      await onSave({ name: name.trim(), movedInOn, movedOutOn: movedOutOn === "" ? null : movedOutOn });
      setName("");
      setMovedInOn("");
      setMovedOutOn("");
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3">
      <BuildingFields
        name={name}
        movedInOn={movedInOn}
        movedOutOn={movedOutOn}
        onName={setName}
        onMovedInOn={setMovedInOn}
        onMovedOutOn={setMovedOutOn}
        namePlaceholder="例: 座間新居"
      />
      {err && (
        <p role="alert" className="text-sm text-destructive">
          {err}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={save}>
          {busy ? "追加中…" : "追加する"}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          キャンセル
        </Button>
      </div>
    </div>
  );
}
