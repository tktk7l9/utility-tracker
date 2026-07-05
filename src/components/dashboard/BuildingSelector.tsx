"use client";

import type { Building } from "@/lib/domain";
import { sortBuildings, isCurrentResidence } from "@/lib/buildings";
import { cn } from "@/lib/utils";

export function BuildingSelector({
  buildings,
  value,
  onChange,
}: {
  buildings: Building[];
  value: string | "all";
  onChange: (v: string | "all") => void;
}) {
  const sorted = sortBuildings(buildings);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => onChange("all")}
        aria-pressed={value === "all"}
        className={cn(
          "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
          value === "all" ? "border-transparent bg-foreground text-background" : "bg-background hover:bg-accent"
        )}
      >
        すべて（合算）
      </button>
      {sorted.map((b) => (
        <button
          key={b.id}
          type="button"
          onClick={() => onChange(b.id)}
          aria-pressed={value === b.id}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
            value === b.id ? "border-transparent bg-foreground text-background" : "bg-background hover:bg-accent"
          )}
        >
          {b.name}
          {isCurrentResidence(b) && (
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] leading-none",
                value === b.id ? "bg-background/20" : "bg-muted text-muted-foreground"
              )}
            >
              現住
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
