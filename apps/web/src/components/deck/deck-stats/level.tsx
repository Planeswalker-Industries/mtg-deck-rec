import type { DeckStatsLevel, StatState } from "@mtg/core/journey";
import { ArrowDown, ArrowRight, ArrowUp, Check, CircleAlert, EyeOff, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { cn } from "cn";

/**
 * A Deck stats line's mark: a green check in line, a red X off, or a grey eye when the player chose to ignore the line
 * (left out of the score). Every line in the sheet and the rail starts with one, the Budget row included.
 */
export function Mark({ state }: { state: StatState }) {
  if (state === "ignored") return <EyeOff role="img" aria-label="Ignored" className="size-4 shrink-0 text-muted-foreground" />;
  return state === "ok" ? (
    <Check role="img" aria-label="OK" className="size-4 shrink-0 text-success" />
  ) : (
    <X role="img" aria-label="Off" className="size-4 shrink-0 text-destructive" />
  );
}

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
 * "⬇ 8/9": the footer's score with a card on screen (T091), the result alone: green with an up arrow when higher, red
 * with a down arrow when lower. No change reads as the level badge, since the score stays.
 */
export function ScoreResult({ okCount, total, now, level }: { okCount: number; total: number; now: number; level: DeckStatsLevel }) {
  if (okCount === now) return <LevelBadge level={level} okCount={now} total={total} compact />;
  const up = okCount > now;
  const Icon = up ? ArrowUp : ArrowDown;
  const tone = up ? "text-success" : "text-destructive";
  return (
    <span className={cn("inline-flex items-center gap-1 font-mono text-sm", tone)}>
      <Icon aria-hidden className="size-4" strokeWidth={2.75} />
      <span className="sr-only">With this card: </span>
      {okCount}/{total}
      <span className="sr-only">{up ? ", more lines in line" : ", fewer lines in line"}</span>
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
