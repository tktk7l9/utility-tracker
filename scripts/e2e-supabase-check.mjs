// E2E smoke test including auth: login -> INSERT -> SELECT -> DELETE -> logout.
// The password is typed at a hidden terminal prompt (so it never lands in a transcript).
//
//   node scripts/e2e-supabase-check.mjs you@example.com
//
// Reads NEXT_PUBLIC_SUPABASE_URL / ANON_KEY from .env.local. Prints only PASS/FAIL.
import { readFileSync } from "node:fs";
import readline from "node:readline";
import { createClient } from "@supabase/supabase-js";

function loadEnv() {
  const env = {};
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

function askHidden(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.stdoutMuted = true;
    rl._writeToOutput = (s) => rl.output.write(rl.stdoutMuted && !s.includes("\n") ? "" : s);
    process.stdout.write(query);
    rl.question("", (ans) => {
      rl.close();
      process.stdout.write("\n");
      resolve(ans);
    });
  });
}

const email = process.argv[2];
if (!email) {
  console.error("usage: node scripts/e2e-supabase-check.mjs <email>");
  process.exit(2);
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anon) {
  console.error("FAIL: .env.local has no URL / ANON_KEY");
  process.exit(1);
}

const password = process.env.SUPABASE_PW || (await askHidden(`password for ${email}: `));
const supabase = createClient(url, anon, { auth: { persistSession: false } });

let ok = true;
const step = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  — " + extra : ""}`);
  if (!cond) ok = false;
};

const { data: signIn, error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
step("sign in", !signInErr && !!signIn.session, signInErr?.message ?? signIn.user?.email);
if (!signIn?.session) {
  console.log("→ If it says 'Email not confirmed', confirm the user under Dashboard > Users.");
  process.exit(1);
}

const { data: building, error: buildingErr } = await supabase
  .from("buildings")
  .select("id")
  .limit(1)
  .single();
step("fetch one building (used for readings.building_id)", !buildingErr && !!building?.id, buildingErr?.message);

const probe = {
  utility: "electricity",
  building_id: building?.id,
  provider: "TEPCO",
  period_start: "2099-01-01",
  period_end: "2099-01-31",
  amount_yen: 1,
  usage_value: 1,
  usage_unit: "kWh",
  note: "e2e-check (auto-deleted)",
  source: "manual",
};

const { data: ins, error: insErr } = await supabase.from("readings").insert(probe).select().single();
step("INSERT as the signed-in user", !insErr && !!ins?.id, insErr?.message);

if (ins?.id) {
  const { data: sel, error: selErr } = await supabase.from("readings").select("id,note").eq("id", ins.id).single();
  step("read back with SELECT", !selErr && sel?.id === ins.id, selErr?.message);

  // Upsert with the same key -> it matches the new unique(user_id,building_id,utility,period_start,period_end)
  // and becomes an UPDATE rather than a duplicate INSERT (bulkUpsert's onConflict agrees with the constraint).
  const { error: upErr } = await supabase
    .from("readings")
    .upsert({ ...probe, amount_yen: 2 }, { onConflict: "user_id,building_id,utility,period_start,period_end" });
  step("upsert with the same key (onConflict matches the new unique constraint)", !upErr, upErr?.message);

  const { data: dup } = await supabase
    .from("readings")
    .select("id,amount_yen")
    .eq("utility", probe.utility)
    .eq("period_start", probe.period_start)
    .eq("period_end", probe.period_end);
  step("upsert overwrites without a duplicate (1 row, amount updated)", (dup?.length ?? 0) === 1 && dup?.[0]?.amount_yen === 2);

  const { error: delErr } = await supabase.from("readings").delete().eq("id", ins.id);
  step("clean up with DELETE", !delErr, delErr?.message);
}

await supabase.auth.signOut();
console.log(ok ? "\n✅ All PASS — authenticated reads and writes work." : "\n❌ Some steps failed (see above).");
process.exit(ok ? 0 : 1);
