// Supabase クライアントと readings テーブルの CRUD / 認証ラッパ。
// anon キーはクライアントに載って良い設計（実アクセス制御は RLS = supabase/rls.sql）。
// NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY を .env.local と
// Vercel Project env に設定する。ネットワーク層のためカバレッジ計測対象外。

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type { NewReading, Reading, Utility } from "./domain";

const TABLE = "readings";

interface Row {
  id: string;
  utility: Utility;
  provider: string;
  period_start: string;
  period_end: string;
  amount_yen: number;
  usage_value: number | null;
  usage_unit: string | null;
  note: string | null;
  source: "manual" | "csv";
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

/** unique(utility, period_start, period_end) で衝突したら上書き（冪等な再取込）。 */
export async function bulkUpsert(readings: NewReading[]): Promise<void> {
  if (readings.length === 0) return;
  const { error } = await requireClient()
    .from(TABLE)
    .upsert(readings.map(newReadingToRow), { onConflict: "utility,period_start,period_end" });
  if (error) throw new Error(error.message);
}

const FIELD_TO_COLUMN: Record<keyof NewReading, string> = {
  utility: "utility",
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
