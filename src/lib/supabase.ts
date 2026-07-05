// Supabase クライアントと readings テーブルの CRUD / 認証ラッパ。
// anon キーはクライアントに載って良い設計（実アクセス制御は RLS = supabase/rls.sql）。
// NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY を .env.local と
// Vercel Project env に設定する。ネットワーク層のためカバレッジ計測対象外。

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type { Building, NewBuilding, NewReading, Reading, Utility } from "./domain";

const TABLE = "readings";
const BUILDINGS_TABLE = "buildings";

interface Row {
  id: string;
  utility: Utility;
  building_id: string;
  provider: string;
  period_start: string;
  period_end: string;
  amount_yen: number;
  usage_value: number | null;
  usage_unit: string | null;
  note: string | null;
  source: "manual" | "csv";
}

interface BuildingRow {
  id: string;
  name: string;
  moved_in_on: string;
  moved_out_on: string | null;
}

function rowToBuilding(row: BuildingRow): Building {
  return { id: row.id, name: row.name, movedInOn: row.moved_in_on, movedOutOn: row.moved_out_on };
}

function newBuildingToRow(b: NewBuilding): Omit<BuildingRow, "id"> {
  return { name: b.name, moved_in_on: b.movedInOn, moved_out_on: b.movedOutOn };
}

let client: SupabaseClient | null | undefined;

/** 環境変数があれば singleton クライアントを返す。未設定なら null。 */
export function getClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  if (!url || !anonKey) {
    client = null;
    return client;
  }
  client = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return client;
}

export function isConfigured(): boolean {
  return getClient() !== null;
}

function requireClient(): SupabaseClient {
  const c = getClient();
  if (!c) throw new Error("Supabase が未設定です（NEXT_PUBLIC_SUPABASE_URL / ANON_KEY）。");
  return c;
}

function rowToReading(row: Row): Reading {
  return {
    id: row.id,
    utility: row.utility,
    buildingId: row.building_id,
    provider: row.provider,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    amountYen: row.amount_yen,
    usageValue: row.usage_value,
    usageUnit: row.usage_unit,
    note: row.note,
    source: row.source,
  };
}

function newReadingToRow(r: NewReading): Omit<Row, "id"> {
  return {
    utility: r.utility,
    building_id: r.buildingId,
    provider: r.provider,
    period_start: r.periodStart,
    period_end: r.periodEnd,
    amount_yen: r.amountYen,
    usage_value: r.usageValue,
    usage_unit: r.usageUnit,
    note: r.note ?? null,
    source: r.source,
  };
}

// ── 認証 ────────────────────────────────────────────────────────────
export async function getSession(): Promise<Session | null> {
  const c = getClient();
  if (!c) return null;
  const { data } = await c.auth.getSession();
  return data.session;
}

export function onAuthChange(cb: (session: Session | null) => void): () => void {
  const c = getClient();
  if (!c) return () => {};
  const { data } = c.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await requireClient().auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}

export async function signOut(): Promise<void> {
  await requireClient().auth.signOut();
}

// ── データ ──────────────────────────────────────────────────────────
export async function fetchReadings(): Promise<Reading[]> {
  const { data, error } = await requireClient()
    .from(TABLE)
    .select("*")
    .order("period_end", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as Row[]).map(rowToReading);
}

export async function insertReading(reading: NewReading): Promise<Reading> {
  const { data, error } = await requireClient()
    .from(TABLE)
    .insert(newReadingToRow(reading))
    .select()
    .single();
  if (error) throw new Error(error.message);
  return rowToReading(data as Row);
}

/**
 * unique(user_id, building_id, utility, period_start, period_end) で衝突したら上書き（冪等な再取込）。
 * user_id は挿入行の default auth.uid() で埋まるため、ペイロードには含めない。
 */
export async function bulkUpsert(readings: NewReading[]): Promise<void> {
  if (readings.length === 0) return;
  const { error } = await requireClient()
    .from(TABLE)
    .upsert(readings.map(newReadingToRow), {
      onConflict: "user_id,building_id,utility,period_start,period_end",
    });
  if (error) throw new Error(error.message);
}

const FIELD_TO_COLUMN: Record<keyof NewReading, string> = {
  utility: "utility",
  buildingId: "building_id",
  provider: "provider",
  periodStart: "period_start",
  periodEnd: "period_end",
  amountYen: "amount_yen",
  usageValue: "usage_value",
  usageUnit: "usage_unit",
  note: "note",
  source: "source",
};

/** 指定フィールドのみ部分更新する。 */
export async function updateReading(id: string, patch: Partial<NewReading>): Promise<Reading> {
  const row: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as Array<keyof NewReading>) {
    row[FIELD_TO_COLUMN[key]] = patch[key] ?? null;
  }
  const { data, error } = await requireClient().from(TABLE).update(row).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return rowToReading(data as Row);
}

export async function deleteReading(id: string): Promise<void> {
  const { error } = await requireClient().from(TABLE).delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ── 建物 ────────────────────────────────────────────────────────────
export async function fetchBuildings(): Promise<Building[]> {
  const { data, error } = await requireClient()
    .from(BUILDINGS_TABLE)
    .select("*")
    .order("moved_in_on", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as BuildingRow[]).map(rowToBuilding);
}

export async function insertBuilding(building: NewBuilding): Promise<Building> {
  const { data, error } = await requireClient()
    .from(BUILDINGS_TABLE)
    .insert(newBuildingToRow(building))
    .select()
    .single();
  if (error) throw new Error(error.message);
  return rowToBuilding(data as BuildingRow);
}

export async function updateBuilding(id: string, patch: Partial<NewBuilding>): Promise<Building> {
  const row: Record<string, unknown> = {};
  if ("name" in patch) row.name = patch.name;
  if ("movedInOn" in patch) row.moved_in_on = patch.movedInOn;
  if ("movedOutOn" in patch) row.moved_out_on = patch.movedOutOn;
  const { data, error } = await requireClient().from(BUILDINGS_TABLE).update(row).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return rowToBuilding(data as BuildingRow);
}

/** レコードが残る建物を削除しようとした場合（FK violation）は分かりやすいメッセージに変換する。 */
export async function deleteBuilding(id: string): Promise<void> {
  const { error } = await requireClient().from(BUILDINGS_TABLE).delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      throw new Error("この建物に紐づくレコードがあるため削除できません。");
    }
    throw new Error(error.message);
  }
}
