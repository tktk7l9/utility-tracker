import * as React from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A pressable chip for "pick one of these" rows (utility, metric, year).
 * The selected chip is announced with aria-pressed and shown with a check mark and
 * bold text, so the choice does not depend on the background color alone (SHIG 96, 25).
 * One component for every such row keeps them consistent (SHIG 6).
 */
export function ToggleChip({
  pressed,
  color,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"button">, "type" | "aria-pressed"> & {
  pressed: boolean;
  /** Background for the selected state (e.g. a utility's color). Defaults to the primary color. */
  color?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        "inline-flex min-h-9 items-center gap-1 rounded-md border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        pressed
          ? cn("border-transparent font-semibold shadow-sm", color ? "text-neutral-900" : "bg-primary text-primary-foreground")
          : "bg-background font-medium hover:bg-accent",
        className
      )}
      style={pressed && color ? { backgroundColor: color } : undefined}
      {...props}
    >
      {pressed && <Check aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={3} />}
      {children}
    </button>
  );
}
