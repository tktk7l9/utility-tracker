"use client";

import { useEffect, useState } from "react";
import { Undo2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { friendlyError } from "@/lib/errors";

/** A change that already happened, and how to revert it. `id` restarts the timer. */
export interface UndoNotice {
  id: number;
  message: string;
  undo: () => Promise<void>;
}

const VISIBLE_MS = 8000;

/**
 * "削除しました［元に戻す］" notification (SHIG 57 act silently + 54 fail-safe):
 * destructive actions run without a confirm dialog and can be reverted from here.
 */
export function UndoToast({ notice, onClose }: { notice: UndoNotice | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ id: number; text: string } | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(onClose, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [notice, onClose]);

  if (!notice) return null;
  const errorText = error?.id === notice.id ? error.text : null;

  async function undo(n: UndoNotice) {
    setBusy(true);
    try {
      await n.undo();
      onClose();
    } catch (e) {
      setError({ id: n.id, text: `元に戻せませんでした。${friendlyError(e)}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-lg border bg-foreground px-4 py-2 text-sm text-background shadow-lg"
      >
        <p className="min-w-0 flex-1">{errorText ?? notice.message}</p>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => undo(notice)}
          className="shrink-0 font-semibold text-background hover:bg-background/15 hover:text-background"
        >
          <Undo2 className="size-4" /> {busy ? "戻しています…" : "元に戻す"}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="閉じる"
          onClick={onClose}
          className="size-9 shrink-0 text-background hover:bg-background/15 hover:text-background"
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}
