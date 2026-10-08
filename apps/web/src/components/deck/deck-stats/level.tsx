import type { DeckStatsLevel } from "@mtg/core/journey";
import { Check, CircleAlert, TriangleAlert, type LucideIcon } from "lucide-react";

/** Each level's icon, word and colour: the colour never stands alone. */
export const LEVEL: Record<DeckStatsLevel, { icon: LucideIcon; word: string; text: string }> = {
  ok: { icon: Check, word: "OK", text: "text-stat-ok" },
  mild: { icon: TriangleAlert, word: "Mild", text: "text-stat-mild" },
  urgent: { icon: CircleAlert, word: "Urgent", text: "text-stat-urgent" },
};

export function LevelBadge({ level, okCount, total }: { level: DeckStatsLevel; okCount: number; total: number }) {
  const { icon: Icon, word, text } = LEVEL[level];
  return (
    <span className={`inline-flex items-center gap-1.5 ${text}`}>
      <Icon aria-hidden className="size-4" />
      <span className="text-sm">{word}</span>
      <span aria-hidden className="font-mono text-sm text-foreground">
        {okCount}/{total}
      </span>
      <span className="sr-only">
        , {okCount} of {total} in line
      </span>
    </span>
  );
}
