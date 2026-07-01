"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession, isConfigured, onAuthChange, signIn, signOut } from "@/lib/supabase";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [configured] = useState(() => isConfigured());
  // 未設定なら読み込む対象がないので最初から false。
  const [loading, setLoading] = useState(configured);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!configured) return;
    let active = true;
    getSession().then((s) => {
      if (active) {
        setSession(s);
        setLoading(false);
      }
    });
    const unsub = onAuthChange((s) => setSession(s));
    return () => {
      active = false;
      unsub();
    };
  }, [configured]);

  if (!configured) {
    return (
      <Card className="mx-auto max-w-lg">
        <CardHeader>
          <CardTitle className="text-lg">Supabase が未設定です</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            <code>.env.local</code> に <code>NEXT_PUBLIC_SUPABASE_URL</code> と{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> を設定してください。
          </p>
          <p>
            テーブル・RLS は <code>supabase/schema.sql</code> → <code>supabase/rls.sql</code> を Dashboard の SQL
            Editor で実行します。
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return <p className="py-16 text-center text-sm text-muted-foreground">読み込み中…</p>;
  }

  if (!session) {
    return <SignInForm />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-3 text-sm text-muted-foreground">
        <span>{session.user.email}</span>
        <Button variant="ghost" size="sm" onClick={() => signOut()}>
          <LogOut className="size-4" />
          ログアウト
        </Button>
      </div>
      {children}
    </div>
  );
}

function SignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto max-w-sm">
      <CardHeader>
        <CardTitle className="text-lg">ログイン</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="email">メールアドレス</Label>
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">パスワード</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "認証中…" : "ログイン"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
