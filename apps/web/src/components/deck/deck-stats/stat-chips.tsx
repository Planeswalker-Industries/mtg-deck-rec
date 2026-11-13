"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import type { CardSummary } from "@mtg/core/contract";
import { statDeltas, towardTarget, type CompareCard, type CompareMark, type DeckStatsReport, type TallyCard } from "@mtg/core/journey";
import { cn } from "cn";
import { useStatChips } from "./stat-preview";

/** Colour rows move in tenths of a source (a Signet is 0.8): read to one decimal when not whole. */
const SOURCE_DECIMALS = 1;

/**
 * One chip by a card: a Deck stats line it would move, or how it compares with the card it replaces. The arrow says
 * which way the thing moves (up is more), the colour whether that is good. The specifics are read out, not shown.
 */
export interface StatChip {
  key: string;
  label: string;
  /** Green when true, red when false. */
  better: boolean;
  /** The arrow: up when the line's count (or the cost, the body) goes up. */
  up: boolean;
  /** For screen readers: "16 to 15, toward the target", "1 cheaper to cast". */
  detail: string;
}

const formatCount = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(SOURCE_DECIMALS));

/**
 * The Deck stats lines one card in and one card out would move, in Deck stats' order (`statDeltas`). The curve's bars
 * make no chip: a pair's Cost mark says the same thing once, and a bar's name alone ("Mana value 5") says nothing.
 */
export function statChips(report: DeckStatsReport, add: TallyCard | null, remove: TallyCard | null): StatChip[] {
  if (!add && !remove) return [];
  const deltas = statDeltas(report.stats, add, remove, report.mana.deck);
  return report.stats.flatMap((stat) => {
    const moved = deltas.get(stat.key);
    if (!moved) return [];
    const from = stat.value;
    const to = stat.value + moved.delta;
    const better = towardTarget(stat.value, stat.target, moved.delta, stat.group === "colours", moved.target);
    const counts = to === from ? "" : `${formatCount(from)} to ${formatCount(to)}, `;
    const needs = moved.target === undefined ? "" : `needs ${Math.round(moved.target)}, `;
    return [
      {
        key: stat.key,
        label: stat.label,
        better,
        // A colour row whose count holds while its requirement moves has no direction of its own: its arrow follows the tone.
        up: to === from ? better : to > from,
        detail: `${counts}${needs}${better ? "toward the target" : "away from the target"}`,
      },
    ];
  });
}

/** What comparing reads from a card, with its printed body and play rate when known (null when not). */
export function compareCardOf(card: CardSummary, power: string | null = null, toughness: string | null = null, inclusionRate: number | null = null): CompareCard {
  return { manaValue: card.manaValue, typeLine: card.typeLine, keywords: card.keywords, inclusionRate, power, toughness };
}

const markChip = (mark: CompareMark): StatChip => ({
  key: `compare:${mark.key}`,
  label: mark.label,
  better: mark.tone === "better",
  up: mark.direction === "up",
  detail: mark.detail,
});

/**
 * Chips by a card, each an arrow and a short name in green or red. The colour never stands alone. `phoneRow` keeps the
 * chips to one row on phones, scrolled sideways like Add's role pills, so a card with many (a land that fixes three
 * colours) can't push ✓ and ✕ under the Deck stats footer at 390×844; wider screens wrap. Without it the chips wrap
 * everywhere.
 */
export function ChipList({
  chips,
  label,
  phoneRow = false,
  className,
}: {
  chips: readonly StatChip[];
  label: string;
  phoneRow?: boolean;
  className?: string;
}) {
  if (chips.length === 0) return null;
  return (
    <ul
      aria-label={label}
      className={cn("flex flex-wrap items-center gap-1.5", phoneRow && "max-sm:-mx-4 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:px-4", className)}
    >
      {chips.map((chip) => {
        const Icon = chip.up ? ArrowUp : ArrowDown;
        return (
          <li
            key={chip.key}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
              chip.better ? "border-success/40 bg-success/10 text-success" : "border-destructive/40 bg-destructive/10 text-destructive",
            )}
          >
            <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={2.75} />
            <span>{chip.label}</span>
            <span className="sr-only">{`: ${chip.detail}${chip.better ? " (better)" : " (worse)"}`}</span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The chips for the card on screen: one coming in, one going out, or both. `marks` (how the pair compares: cost,
 * speed, body, play) come first, then the Deck stats lines; outside the deck tool only the marks show. `all` wraps
 * every chip on a phone too (Fix, whose cards are sized for it); the swipe steps keep them to one scrolling row there.
 */
export function StatChips({
  add,
  remove,
  marks = [],
  all = false,
  className,
}: {
  add: CardSummary | null;
  remove: CardSummary | null;
  marks?: readonly CompareMark[];
  all?: boolean;
  className?: string;
}) {
  const lines = useStatChips(add, remove);
  const chips = [...marks.map(markChip), ...lines];
  return <ChipList chips={chips} label="What this changes" phoneRow={!all} className={className} />;
}
