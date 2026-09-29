"use client";

import { useState } from "react";
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
/** A commander deck: the centre reads "cards in the deck / this". */
const DECK_SIZE = 100;

/**
 * An inline SVG donut chart with a mana-symbol row and, unless `compact`, a legend. Shows the card-type composition
 * and color split of a deck. Pointing at a slice lights it, dims the rest and puts its count in the centre.
 *
 * The ring's `role="img"` carries an `aria-label` naming every category and count (zeroes included,
 * so no category can silently disappear), because a donut is unreadable to a screen reader. The hover is a visual
 * extra on top of that, so the slices themselves stay out of the tab order.
 */
export function DeckOverview({
  composition,
  colorCounts,
  cardCount,
  compact = false,
}: {
  composition: Record<CardCategory, number>;
  colorCounts: Record<ColorKey, number>;
  cardCount: number;
  /** Ring and mana symbols only, without the legend list. */
  compact?: boolean;
}) {
  const [active, setActive] = useState<CardCategory | null>(null);
  const reduceMotion = useReducedMotion();
  const transition = { duration: reduceMotion ? 0 : HOVER_TRANSITION_S };

  const circumference = 2 * Math.PI * RING_RADIUS;
  const total = Object.values(composition).reduce((a, b) => a + b, 0);

  // Legend rows only for categories the deck has; the aria-label still names all of them.
  const rows = CATEGORY_ORDER.filter((cat) => composition[cat] > 0);
  const colors = COLOR_ORDER.filter((key) => key === "C" || colorCounts[key] > 0);

  const ariaLabel = CATEGORY_ORDER.map((cat) => `${cardCategoryLabel[cat]}: ${composition[cat]}`).join(", ");

  // Each segment starts where the previous one ended.
  const segments = rows.map((cat, idx) => {
    const count = composition[cat];
    const share = total > 0 ? count / total : 0;
    const dashLength = share * circumference;
    const gapLength = circumference - dashLength;
    const previousCount = rows.slice(0, idx).reduce((sum, prev) => sum + composition[prev], 0);
    const offset = -(previousCount / total) * circumference;
    return { cat, dashLength, gapLength, offset };
  });

  const centre = active
    ? {
        value: String(composition[active]),
        label: composition[active] === 1 ? CATEGORY_SINGULAR[active] : cardCategoryLabel[active].toLowerCase(),
      }
    : { value: `${cardCount} / ${DECK_SIZE}`, label: "cards" };

  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-xs font-bold tracking-[0.2em] text-muted-foreground uppercase">Deck overview</h4>
      <div className="flex flex-row items-center gap-4">
        <div className="flex shrink-0 flex-col items-center gap-2.5">
          <svg
            role="img"
            aria-label={ariaLabel}
            viewBox="0 0 100 100"
            className="size-28 shrink-0"
            onPointerLeave={() => setActive(null)}
          >
            <g transform="rotate(-90 50 50)">
              {segments.map(({ cat, dashLength, gapLength, offset }) => (
                <motion.circle
                  key={cat}
                  cx="50"
                  cy="50"
                  r={String(RING_RADIUS)}
                  fill="none"
                  stroke={CAT_COLORS[cat]}
                  strokeDasharray={`${dashLength} ${gapLength}`}
                  strokeDashoffset={String(offset)}
                  initial={false}
                  animate={{
                    opacity: active && active !== cat ? DIMMED_OPACITY : 1,
                    strokeWidth: active === cat ? RING_STROKE_ACTIVE : RING_STROKE,
                  }}
                  transition={transition}
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
                  className="fill-foreground text-[13px] font-bold"
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
                <span className="text-[0.625rem] font-semibold tabular-nums text-muted-foreground">
                  {colorCounts[key]}
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
                <span className="ml-auto font-semibold tabular-nums text-foreground">{composition[cat]}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
