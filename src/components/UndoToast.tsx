"use client";

import { useEffect, useRef, useState } from "react";
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
 * Keyboard focus pauses the timer; focus the notice received after a mouse click
 * (the clicked delete button vanished) does not, so the notice still closes by itself.
 */
function isKeyboardFocus(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}

/**
 * "削除しました［元に戻す］" notification (SHIG 57 act silently + 54 fail-safe):
 * destructive actions run without a confirm dialog and can be reverted from here.
 *
 * Accessibility: the live region stays mounted so screen readers announce new notices;
 * the timer pauses while the pointer or keyboard focus is on the notice, while undo is running
 * and while an undo error is shown (WCAG 2.2.1); Escape closes it; when the action removed
 * the focused element (e.g. the deleted row), focus moves to "元に戻す" instead of being lost.
 */
export function UndoToast({ notice, onClose }: { notice: UndoNotice | null; onClose: () => void }) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<{ id: number; text: string } | null>(null);
  // Tagged with the notice id so a new notice never inherits the pause of the previous one.
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const undoRef = useRef<HTMLButtonElement>(null);

  const busy = notice != null && busyId === notice.id;
  const errorText = notice && error?.id === notice.id ? error.text : null;
  const hovered = notice != null && hoveredId === notice.id;
  const focused = notice != null && focusedId === notice.id;
  const paused = hovered || focused || busy || errorText != null;

  useEffect(() => {
    if (!notice || paused) return;
    const timer = setTimeout(onClose, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [notice, onClose, paused]);

  useEffect(() => {
    if (!notice) return;
    const active = document.activeElement;
    if (active == null || active === document.body) undoRef.current?.focus();
  }, [notice]);

  async function undo(n: UndoNotice) {
    setBusyId(n.id);
    try {
      await n.undo();
      onClose();
    } catch (e) {
      setError({ id: n.id, text: `元に戻せませんでした。${friendlyError(e)}` });
    } finally {
      setBusyId((current) => (current === n.id ? null : current));
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
    >
      {notice && (
        <div
          data-testid="undo-toast"
          onMouseEnter={() => setHoveredId(notice.id)}
          onMouseLeave={() => setHoveredId(null)}
          onFocus={(e) => {
            if (isKeyboardFocus(e.target)) setFocusedId(notice.id);
          }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusedId(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
          }}
          className="pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-lg border bg-foreground px-4 py-2 text-sm text-background shadow-lg"
        >
          <p className="min-w-0 flex-1">{errorText ?? notice.message}</p>
          <Button
            ref={undoRef}
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
      )}
    </div>
  );
}
