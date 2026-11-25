"use client";

import { useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Popover } from "radix-ui";
import type { CardSummary } from "@mtg/core/contract";
import { statDeltas, towardTarget, type CompareCard, type CompareMark, type DeckStatsReport, type TallyCard } from "@mtg/core/journey";
import { cn } from "cn";
import { TIP_HOVER_DELAY_MS } from "@/lib/constants";
import { countTip, markTip } from "./stat-chip-copy";
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
  /** What the chip means, opened by a tap or a hover: "More ramp. The deck needs it." (`stat-chip-copy`). */
  tip: string;
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
    // A colour row whose count holds while its requirement moves has no direction of its own: its arrow follows the tone.
    const up = to === from ? better : to > from;
    const counts = to === from ? "" : `${formatCount(from)} to ${formatCount(to)}, `;
    const needs = moved.target === undefined ? "" : `needs ${Math.round(moved.target)}, `;
    return [
      {
        key: stat.key,
        label: stat.label,
        better,
        up,
        detail: `${counts}${needs}${better ? "toward the target" : "away from the target"}`,
        tip: countTip({ group: stat.group, label: stat.label, up, better }),
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
  tip: markTip(mark),
});

/**
 * One chip, unchanged to the eye (owner, 2026-11-18), that opens its tip on a tap or a click, or while a mouse rests
 * on it. The tip names the change in its first few words and says why it is good or bad here.
 */
function Chip({ chip }: { chip: StatChip }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const Icon = chip.up ? ArrowUp : ArrowDown;
  return (
    <li className="shrink-0">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          type="button"
          onPointerEnter={(e) => {
            if (e.pointerType !== "mouse") return;
            clear();
            timer.current = window.setTimeout(() => setOpen(true), TIP_HOVER_DELAY_MS);
          }}
          onPointerLeave={(e) => {
            if (e.pointerType !== "mouse") return;
            clear();
            setOpen(false);
          }}
          className={cn(
            "relative inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
            // A taller target for a thumb without making the row taller.
            "after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
            chip.better ? "border-success/40 bg-success/10 text-success" : "border-destructive/40 bg-destructive/10 text-destructive",
          )}
        >
          <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={2.75} />
          <span>{chip.label}</span>
          <span className="sr-only">{`: ${chip.detail}${chip.better ? " (better)" : " (worse)"}`}</span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="top"
            sideOffset={6}
            collisionPadding={16}
            // A hover tip leaves focus where it was; a tap moves nothing either, so the swipe keys keep working.
            onOpenAutoFocus={(e) => e.preventDefault()}
            className="z-50 max-w-64 rounded-lg border border-seam bg-sleeve px-3 py-2 text-sm text-foreground shadow-lift"
          >
            {chip.tip}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </li>
  );
}

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
  tour,
}: {
  chips: readonly StatChip[];
  label: string;
  phoneRow?: boolean;
  className?: string;
  /** The screen's tour id: the list carries `<tour>.chips`. */
  tour?: string | undefined;
}) {
  if (chips.length === 0) return null;
  return (
    <ul
      aria-label={label}
      data-tour={tour && `${tour}.chips`}
      className={cn("flex flex-wrap items-center gap-1.5", phoneRow && "max-sm:-mx-4 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:px-4", className)}
    >
      {chips.map((chip) => (
        <Chip key={chip.key} chip={chip} />
      ))}
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
  tour,
}: {
  add: CardSummary | null;
  remove: CardSummary | null;
  marks?: readonly CompareMark[];
  all?: boolean;
  className?: string;
  /** The screen's tour id, for the chips' `data-tour`. */
  tour?: string | undefined;
}) {
  const lines = useStatChips(add, remove);
  const chips = [...marks.map(markChip), ...lines];
  return <ChipList chips={chips} label="What this changes" phoneRow={!all} className={className} tour={tour} />;
}
