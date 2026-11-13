"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import type { CardSummary } from "@mtg/core/contract";
import { statDeltas, towardTarget, type DeckStatsReport, type TallyCard } from "@mtg/core/journey";
import { curveBucket, isFrontLand } from "@mtg/core/scoring";
import { cn } from "cn";
import { useStatChips } from "./stat-preview";

/** Colour rows move in tenths of a source (a Signet is 0.8): shown to one decimal when not whole. */
const SOURCE_DECIMALS = 1;

/** One Deck stats line a card would move: its count before and after, and whether that is toward its target. */
export interface StatChip {
  key: string;
  label: string;
  from: number;
  to: number;
  better: boolean;
  /** A colour row whose requirement the card moves: the sources it would need. */
  needs?: number;
}

const formatCount = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(SOURCE_DECIMALS));

/**
 * The lines one card in and one card out would move, in Deck stats' order, each with its count before and after: the
 * stat lines (`statDeltas`), then the curve bars the two cards sit on.
 */
export function statChips(report: DeckStatsReport, add: TallyCard | null, remove: TallyCard | null): StatChip[] {
  if (!add && !remove) return [];
  const deltas = statDeltas(report.stats, add, remove, report.mana.deck);
  const chips: StatChip[] = report.stats.flatMap((stat) => {
    const moved = deltas.get(stat.key);
    if (!moved) return [];
    return [
      {
        key: stat.key,
        label: stat.label,
        from: stat.value,
        to: stat.value + moved.delta,
        better: towardTarget(stat.value, stat.target, moved.delta, stat.group === "colours", moved.target),
        ...(moved.target === undefined ? {} : { needs: Math.round(moved.target) }),
      },
    ];
  });
  const barOf = (card: TallyCard | null) => (card && !isFrontLand(card.typeLine) ? Number(curveBucket(card.manaValue)) : null);
  const [barIn, barOut] = [barOf(add), barOf(remove)];
  const lastBar = report.curve.bars.length - 1;
  for (const bar of report.curve.bars) {
    const delta = Number(bar.manaValue === barIn) - Number(bar.manaValue === barOut);
    if (delta === 0) continue;
    chips.push({
      key: `curve:${bar.manaValue}`,
      label: `Mana value ${bar.manaValue}${bar.manaValue === lastBar ? "+" : ""}`,
      from: bar.value,
      to: bar.value + delta,
      better: towardTarget(bar.value, bar.target, delta),
    });
  }
  return chips;
}

/**
 * The lines a move changes, as chips by the card: the line's full name, its count before and after, and an arrow in
 * green when the count moves toward its target, red when away. The colour never stands alone. `phoneRow` keeps the
 * chips to one row on phones, scrolled sideways like Add's role pills, so a card that moves many lines (a land that
 * fixes three colours) can't push ✓ and ✕ under the Deck stats footer at 390×844; wider screens wrap. Without it the
 * chips wrap everywhere.
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
        const Icon = chip.better ? ArrowUp : ArrowDown;
        return (
          <li
            key={chip.key}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs whitespace-nowrap",
              chip.better ? "border-success/40 bg-success/10" : "border-destructive/40 bg-destructive/10",
            )}
          >
            <Icon aria-hidden className={cn("size-3.5 shrink-0", chip.better ? "text-success" : "text-destructive")} strokeWidth={2.75} />
            <span className="font-semibold">{chip.label}</span>
            {chip.to !== chip.from && (
              <span className="font-mono">
                {formatCount(chip.from)}→{formatCount(chip.to)}
              </span>
            )}
            {chip.needs !== undefined && <span className="font-mono">needs {chip.needs}</span>}
            <span className="sr-only">{chip.better ? ", toward the target" : ", away from the target"}</span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The chips for the card on screen: one coming in, one going out, or both. Nothing outside the deck tool. `all` wraps
 * every chip on a phone too (Fix, whose cards are sized for it); the swipe steps keep them to one scrolling row there.
 */
export function StatChips({
  add,
  remove,
  all = false,
  className,
}: {
  add: CardSummary | null;
  remove: CardSummary | null;
  all?: boolean;
  className?: string;
}) {
  const chips = useStatChips(add, remove);
  return <ChipList chips={chips} label="What this changes in Deck stats" phoneRow={!all} className={className} />;
}
