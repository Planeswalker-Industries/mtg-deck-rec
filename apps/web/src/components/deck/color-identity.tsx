import type { ColorIdentity as ColorIdentityValue } from "@mtg/core/contract";

const COLORS: Record<string, { name: string; className: string }> = {
  W: { name: "White", className: "bg-amber-50 text-amber-900 ring-amber-200" },
  U: { name: "Blue", className: "bg-sky-100 text-sky-900 ring-sky-300" },
  B: { name: "Black", className: "bg-zinc-800 text-zinc-100 ring-zinc-600" },
  R: { name: "Red", className: "bg-red-100 text-red-900 ring-red-300" },
  G: { name: "Green", className: "bg-emerald-100 text-emerald-900 ring-emerald-300" },
};

export function ColorIdentity({ identity }: { identity: ColorIdentityValue }) {
  if (!identity) return <span className="text-xs text-muted-foreground">Colorless</span>;
  const colors = [...identity];
  return (
    <span className="inline-flex gap-1" aria-label={colors.map((c) => COLORS[c]?.name ?? c).join(", ")}>
      {colors.map((c) => (
        <span
          key={c}
          aria-hidden
          className={`inline-flex size-5 items-center justify-center rounded-full text-[10px] font-semibold ring-1 ${COLORS[c]?.className ?? ""}`}
        >
          {c}
        </span>
      ))}
    </span>
  );
}
