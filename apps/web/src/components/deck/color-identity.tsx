import type { ColorIdentity as ColorIdentityValue } from "@mtg/core/contract";
import { cn } from "cn";

const COLORS: Record<string, { name: string; className: string }> = {
  W: { name: "White", className: "bg-mana-w" },
  U: { name: "Blue", className: "bg-mana-u" },
  B: { name: "Black", className: "bg-mana-b" },
  R: { name: "Red", className: "bg-mana-r" },
  G: { name: "Green", className: "bg-mana-g" },
};

export function ColorIdentity({ identity, className }: { identity: ColorIdentityValue; className?: string }) {
  if (!identity) return <span className={cn("text-xs text-muted-foreground", className)}>Colorless</span>;
  const colors = [...identity];
  return (
    <span
      role="img"
      aria-label={`Color identity: ${colors.map((c) => COLORS[c]?.name ?? c).join(", ")}`}
      className={cn("inline-flex gap-1", className)}
    >
      {colors.map((c) => (
        <span
          key={c}
          aria-hidden
          className={cn(
            "inline-flex size-[1.125rem] items-center justify-center rounded-full text-[0.625rem] font-bold text-foreground ring-1 ring-foreground/15",
            COLORS[c]?.className,
          )}
        >
          {c}
        </span>
      ))}
    </span>
  );
}
