"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getSession, isConfigured, onAuthChange, signOut } from "@/lib/supabase";

/** ヘッダー右上のアカウント表示（ログイン中のみ email ＋ ログアウトを表示）。 */
export function AccountControls() {
  const [configured] = useState(() => isConfigured());
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!configured) return;
    let active = true;
    getSession().then((s) => active && setSession(s));
    const unsub = onAuthChange((s) => setSession(s));
    return () => {
      active = false;
      unsub();
    };
  }, [configured]);

  if (!session) return null;

  return (
    <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
      <span className="hidden max-w-[12rem] truncate sm:inline">{session.user.email}</span>
      <Button variant="ghost" size="sm" onClick={() => signOut()}>
        <LogOut className="size-4" />
        ログアウト
      </Button>
    </div>
  );
}
