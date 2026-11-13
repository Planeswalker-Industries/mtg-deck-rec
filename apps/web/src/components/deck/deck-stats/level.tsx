import type { DeckStatsLevel } from "@mtg/core/journey";
import { ArrowDown, ArrowRight, ArrowUp, Check, CircleAlert, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "cn";

/** Each level's icon, word and colour: the colour never stands alone. */
export const LEVEL: Record<DeckStatsLevel, { icon: LucideIcon; word: string; text: string }> = {
  ok: { icon: Check, word: "OK", text: "text-stat-ok" },
  mild: { icon: TriangleAlert, word: "Mild", text: "text-stat-mild" },
  urgent: { icon: CircleAlert, word: "Urgent", text: "text-stat-urgent" },
};

/** `compact`: the icon and count only (the docked bar); the word stays for screen readers. */
export function LevelBadge({
  level,
  okCount,
  total,
  compact = false,
}: {
  level: DeckStatsLevel;
  okCount: number;
  total: number;
  compact?: boolean;
}) {
  const { icon: Icon, word, text } = LEVEL[level];
  return (
    <span className={`inline-flex items-center gap-1.5 ${text}`}>
      <Icon aria-hidden className="size-4" />
      <span className={compact ? "sr-only" : "text-sm"}>{word}</span>
      <span aria-hidden className="font-mono text-sm text-foreground">
        {okCount}/{total}
      </span>
      <span className="sr-only">
        , {okCount} of {total} in line
      </span>
    </span>
  );
}

/**
 * "→ 4/11": the score answering the card on screen would give, beside the level badge: green with an up arrow when
 * higher, red with a down arrow when lower.
 */
export function ScoreAfter({ okCount, total, now }: { okCount: number; total: number; now: number }) {
  const Icon = okCount > now ? ArrowUp : okCount < now ? ArrowDown : null;
  const tone = okCount > now ? "text-success" : okCount < now ? "text-destructive" : "text-muted-foreground";
  return (
    <span className="inline-flex items-center gap-1 font-mono text-sm">
      <ArrowRight aria-hidden className="size-3.5 text-muted-foreground" />
      <span className="sr-only">With this card: </span>
      <span className={tone}>
        {okCount}/{total}
      </span>
      {Icon && <Icon aria-hidden className={cn("size-3.5", tone)} strokeWidth={2.75} />}
      <span className="sr-only">{okCount > now ? ", more lines in line" : okCount < now ? ", fewer lines in line" : ", no change"}</span>
    </span>
  );
}
