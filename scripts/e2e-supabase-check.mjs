// 認証込みの E2E スモーク: ログイン → INSERT → SELECT → DELETE → ログアウト。
// パスワードは端末の隠しプロンプトで入力（transcript に残さない）。
//
//   node scripts/e2e-supabase-check.mjs you@example.com
//
// .env.local の NEXT_PUBLIC_SUPABASE_URL / ANON_KEY を読む。PASS/FAIL のみ出力。
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
  console.error("FAIL: .env.local に URL / ANON_KEY がありません");
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
step("ログイン", !signInErr && !!signIn.session, signInErr?.message ?? signIn.user?.email);
if (!signIn?.session) {
  console.log("→ 'Email not confirmed' の場合は Dashboard の Users で該当ユーザーを Confirm してください。");
  process.exit(1);
}

const probe = {
  utility: "electricity",
  provider: "TEPCO",
  period_start: "2099-01-01",
  period_end: "2099-01-31",
  amount_yen: 1,
  usage_value: 1,
  usage_unit: "kWh",
  note: "e2e-check (自動削除)",
  source: "manual",
};

const { data: ins, error: insErr } = await supabase.from("readings").insert(probe).select().single();
step("認証ユーザーで INSERT", !insErr && !!ins?.id, insErr?.message);

if (ins?.id) {
  const { data: sel, error: selErr } = await supabase.from("readings").select("id,note").eq("id", ins.id).single();
  step("SELECT で読み戻し", !selErr && sel?.id === ins.id, selErr?.message);

  const { error: delErr } = await supabase.from("readings").delete().eq("id", ins.id);
  step("後始末 DELETE", !delErr, delErr?.message);
}

await supabase.auth.signOut();
console.log(ok ? "\n✅ 全て PASS — 認証込みの読み書きが動作しています。" : "\n❌ 失敗あり（上記参照）。");
process.exit(ok ? 0 : 1);
