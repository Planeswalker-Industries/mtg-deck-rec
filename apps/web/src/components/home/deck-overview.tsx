"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { CardCategory } from "@mtg/core/contract";
import { cn } from "cn";
import { cardCategoryLabel } from "@/lib/labels";
import type { ColorKey } from "@/lib/featured-decks";
import { COLOR_NAMES, MANA_SYMBOL_URL } from "@/components/deck/color-identity";

/** Legend and ring order, matching the homepage mock: lands first, battle last. */
const CATEGORY_ORDER: readonly CardCategory[] = [
  "land",
  "creature",
  "instant",
  "sorcery",
  "artifact",
  "enchantment",
  "planeswalker",
  "battle",
];

/** CSS color token for each card category, matching the --color-cat-* tokens in globals.css. */
const CAT_COLORS: Record<CardCategory, string> = {
  land: "var(--color-cat-land)",
  creature: "var(--color-cat-creature)",
  instant: "var(--color-cat-instant)",
  sorcery: "var(--color-cat-sorcery)",
  artifact: "var(--color-cat-artifact)",
  enchantment: "var(--color-cat-enchantment)",
  planeswalker: "var(--color-cat-planeswalker)",
  battle: "var(--color-cat-battle)",
};

/** The ring's centre names one card: "1 battle", not "1 battles". */
const CATEGORY_SINGULAR: Record<CardCategory, string> = {
  land: "land",
  creature: "creature",
  instant: "instant",
  sorcery: "sorcery",
  artifact: "artifact",
  enchantment: "enchantment",
  planeswalker: "planeswalker",
  battle: "battle",
};

const COLOR_ORDER: readonly ColorKey[] = ["W", "U", "B", "R", "G", "C"];

/** The ring in the 100-unit viewBox: its radius, and how thick a slice is at rest and under the pointer. */
const RING_RADIUS = 42;
const RING_STROKE = 14;
const RING_STROKE_ACTIVE = 17;
/** Slices other than the one under the pointer fade to this, so the hovered one reads as lit. */
const DIMMED_OPACITY = 0.25;
const HOVER_TRANSITION_S = 0.18;
/** Switching decks empties the ring over this long, then fills it with the new deck over the same again. */
const RING_SWAP_S = 0.35;
const MS_PER_S = 1000;
/** A commander deck: the centre reads "cards in the deck / this". */
const DECK_SIZE = 100;

interface DeckShape {
  composition: Record<CardCategory, number>;
  colorCounts: Record<ColorKey, number>;
  cardCount: number;
}

/**
 * An inline SVG donut chart with a mana-symbol row and, unless `compact`, a legend. Shows the card-type composition
 * and color split of a deck. Pointing at a slice lights it, dims the rest and puts its count in the centre. A new
 * `deckKey` empties the ring (each slice shrinks back to where it starts), then fills it again with the new deck.
 *
 * The ring's `role="img"` carries an `aria-label` naming every category and count (zeroes included,
 * so no category can silently disappear), because a donut is unreadable to a screen reader. The hover is a visual
 * extra on top of that, so the slices themselves stay out of the tab order.
 */
export function DeckOverview({
  deckKey,
  composition,
  colorCounts,
  cardCount,
  compact = false,
}: DeckShape & {
  /** Identifies the deck; a change plays the empty-and-refill swap. */
  deckKey: string;
  /** Ring and mana symbols only, without the title or the legend list; the ring fills its parent's height. */
  compact?: boolean;
}) {
  const [active, setActive] = useState<CardCategory | null>(null);
  const reduceMotion = useReducedMotion();
  const transition = { duration: reduceMotion ? 0 : HOVER_TRANSITION_S };
  const swapS = reduceMotion ? 0 : RING_SWAP_S;

  // The deck the ring is drawing. It trails the props by one emptying: while they differ the ring is emptying the
  // old deck, and the new one takes over once it is empty.
  const [shown, setShown] = useState<DeckShape & { key: string }>({ key: deckKey, composition, colorCounts, cardCount });
  const emptying = shown.key !== deckKey;
  useEffect(() => {
    if (!emptying) return;
    const id = setTimeout(() => setShown({ key: deckKey, composition, colorCounts, cardCount }), swapS * MS_PER_S);
    return () => clearTimeout(id);
  }, [emptying, deckKey, composition, colorCounts, cardCount, swapS]);

  const total = Object.values(shown.composition).reduce((a, b) => a + b, 0);

  // Legend rows only for categories the deck has; the aria-label still names all of them.
  const rows = CATEGORY_ORDER.filter((cat) => shown.composition[cat] > 0);
  const colors = COLOR_ORDER.filter((key) => key === "C" || shown.colorCounts[key] > 0);

  const ariaLabel = CATEGORY_ORDER.map((cat) => `${cardCategoryLabel[cat]}: ${shown.composition[cat]}`).join(", ");

  // Every category gets a slice, empty when the deck has none, so a deck change never mounts or unmounts one: each
  // slice just changes length. Slices are fractions of the ring (Motion's pathLength), each starting where the
  // previous one ended.
  const segments = CATEGORY_ORDER.map((cat, idx) => {
    const share = total > 0 ? shown.composition[cat] / total : 0;
    const start = total > 0 ? CATEGORY_ORDER.slice(0, idx).reduce((sum, prev) => sum + shown.composition[prev], 0) / total : 0;
    return { cat, share, start };
  });

  const centre = active
    ? {
        value: String(shown.composition[active]),
        label: shown.composition[active] === 1 ? CATEGORY_SINGULAR[active] : cardCategoryLabel[active].toLowerCase(),
      }
    : { value: `${shown.cardCount} / ${DECK_SIZE}`, label: "cards" };

  return (
    <div className={cn("flex flex-col gap-3", compact && "h-full")}>
      <h4 className={compact ? "sr-only" : "font-mono text-xs tracking-[0.12em] text-muted-foreground uppercase"}>
        Deck overview
      </h4>
      <div className={cn("flex flex-row items-center gap-4", compact && "h-full min-h-0 justify-center")}>
        <div className={cn("flex shrink-0 flex-col items-center gap-2.5", compact && "h-full min-h-0 w-full")}>
          <svg
            role="img"
            aria-label={ariaLabel}
            viewBox="0 0 100 100"
            className={cn(
              "shrink-0",
              // Compact fills the height its parent gives it (the tile row on the home page), square, above the pips.
              compact ? "aspect-square max-w-full min-h-0 flex-1" : "size-28",
            )}
            onPointerLeave={() => setActive(null)}
          >
            <g transform="rotate(-90 50 50)">
              {segments.map(({ cat, share, start }) => (
                <motion.circle
                  key={cat}
                  cx="50"
                  cy="50"
                  r={String(RING_RADIUS)}
                  fill="none"
                  stroke={CAT_COLORS[cat]}
                  initial={false}
                  animate={{
                    pathLength: emptying ? 0 : share,
                    pathOffset: start,
                    opacity: active && active !== cat ? DIMMED_OPACITY : 1,
                    strokeWidth: active === cat ? RING_STROKE_ACTIVE : RING_STROKE,
                  }}
                  transition={{
                    ...transition,
                    pathLength: { duration: swapS, ease: "easeInOut" },
                    // The start moves only while the ring is empty, so it jumps.
                    pathOffset: { duration: 0 },
                  }}
                  onPointerEnter={() => setActive(cat)}
                  className="cursor-default"
                />
              ))}
            </g>
            {/* Centre text: the deck's size, or the slice under the pointer. */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.g
                key={active ?? "all"}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={transition}
              >
                <text
                  x="50"
                  y="47"
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="fill-foreground font-mono text-[11px]"
                >
                  {centre.value}
                </text>
                <text
                  x="50"
                  y="59"
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="fill-muted-foreground text-[8px]"
                >
                  {centre.label}
                </text>
              </motion.g>
            </AnimatePresence>
          </svg>

          {/* Mana-symbol row: colors the deck runs, plus colorless. */}
          <div className="flex items-center gap-1.5">
            {colors.map((key) => (
              <div key={key} className="flex flex-col items-center gap-0.5">
                <Image
                  src={MANA_SYMBOL_URL(key)}
                  alt={COLOR_NAMES[key] ?? key}
                  width={18}
                  height={18}
                  unoptimized
                  className="size-[1.125rem]"
                />
                <span className="font-mono text-xs text-muted-foreground">
                  {shown.colorCounts[key]}
                </span>
              </div>
            ))}
          </div>
        </div>

        {!compact && (
          <ul className="grid min-w-0 flex-1 grid-cols-1 gap-y-1">
            {rows.map((cat) => (
              <li
                key={cat}
                className={cn(
                  "flex items-center gap-2 text-xs transition-opacity",
                  active && active !== cat && "opacity-40",
                )}
              >
                <span
                  aria-hidden
                  className="inline-block size-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: CAT_COLORS[cat] }}
                />
                <span className="text-muted-foreground">{cardCategoryLabel[cat]}</span>
                <span className="ml-auto font-mono text-foreground">{shown.composition[cat]}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
