"use client";

import { Fragment, useState } from "react";
import { Trash2, Pencil, Check, X, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { Building, NewBuilding } from "@/lib/domain";
import { sortBuildings, isCurrentResidence } from "@/lib/buildings";

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
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const sorted = sortBuildings(buildings);

  async function remove(id: string) {
    if (!window.confirm("この建物を削除します。元に戻せません。よろしいですか？")) return;
    setPendingId(id);
    try {
      await onDelete(id);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-2 py-2">名前</th>
              <th className="px-2 py-2">居住期間</th>
              <th className="px-2 py-2 text-right">レコード数</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((b) => {
              const count = readingCounts.get(b.id) ?? 0;
              const isEditing = editingId === b.id;
              return (
                <Fragment key={b.id}>
                  <tr className="border-t">
                    <td className="px-2 py-1.5">{b.name}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">
                      {b.movedInOn} 〜 {isCurrentResidence(b) ? <Badge variant="outline">現住</Badge> : b.movedOutOn}
                    </td>
                    <td className="px-2 py-1.5 text-right text-muted-foreground">{count}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="編集"
                          onClick={() => setEditingId(isEditing ? null : b.id)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="削除"
                          disabled={count > 0 || pendingId === b.id}
                          title={count > 0 ? "レコードがある建物は削除できません" : undefined}
                          onClick={() => remove(b.id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                  {isEditing && (
                    <tr className="bg-muted/30">
                      <td colSpan={4} className="px-2 py-3">
                        <BuildingEditRow
                          building={b}
                          onCancel={() => setEditingId(null)}
                          onSave={async (patch) => {
                            await onUpdate(b.id, patch);
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
        {sorted.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">まだ建物が登録されていません。</p>
        )}
      </div>

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

function BuildingEditRow({
  building,
  onSave,
  onCancel,
}: {
  building: Building;
  onSave: (patch: Partial<NewBuilding>) => Promise<void>;
  onCancel: () => void;
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
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label>名前</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>入居日</Label>
          <Input type="date" value={movedInOn} onChange={(e) => setMovedInOn(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>退去日（空欄 = 現住）</Label>
          <Input type="date" value={movedOutOn} onChange={(e) => setMovedOutOn(e.target.value)} />
        </div>
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
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label>名前</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 座間新居" />
        </div>
        <div className="space-y-1">
          <Label>入居日</Label>
          <Input type="date" value={movedInOn} onChange={(e) => setMovedInOn(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>退去日（空欄 = 現住）</Label>
          <Input type="date" value={movedOutOn} onChange={(e) => setMovedOutOn(e.target.value)} />
        </div>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
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
