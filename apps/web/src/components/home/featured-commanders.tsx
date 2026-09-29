"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Image from "next/image";
import { cn } from "cn";
import { useReducedMotion } from "motion/react";
import type { FeaturedCommander } from "@/lib/server/featured";
import { ColorIdentity } from "@/components/deck/color-identity";
import { formatDeckCount } from "@/lib/labels";
import type { ColorKey } from "@/lib/featured-decks";
import { DeckOverview } from "./deck-overview";

const AUTO_ADVANCE_MS = 7_000;

const IDENTITY_ORDER: readonly ColorKey[] = ["W", "U", "B", "R", "G"];

/** Tile art is about 220 px wide on desktop and a 64 px thumbnail on phones; Scryfall's art crops are ~626 px wide. */
const TILE_ART_SIZES = "(min-width: 768px) 220px, 64px";

/** The fixture's identity when the catalog didn't answer: the colours its cards count under, in WUBRG order. */
function fixtureIdentity(counts: Record<ColorKey, number>): string {
  return IDENTITY_ORDER.filter((key) => counts[key] > 0).join("");
}

/**
 * The featured commanders: the section heading over the selected deck's overview wheel and a row of tiles (art,
 * colours, deck count). Changing commander empties the wheel and refills it with the new deck (`DeckOverview`).
 * Takes all three commanders' server-rendered data as props. Auto-advances on a timer, takes manual input from
 * the tiles and the arrow keys, pauses on hover and focus, and respects reduced motion.
 *
 * The selected tile's gold border and `aria-current` say which commander the wheel belongs to.
 */
export function FeaturedCommanders({
  commanders,
  intro,
}: {
  commanders: FeaturedCommander[];
  /** The section heading, set above the wheel and tiles. */
  intro: ReactNode;
}) {
  const [index, setIndex] = useState(0);
  const [tick, setTick] = useState(0);
  const reduceMotion = useReducedMotion();
  const pausedRef = useRef(false);
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const count = commanders.length;

  const advance = useCallback(
    (delta: number) => {
      setIndex((i) => (i + delta + count) % count);
    },
    [count],
  );

  const select = useCallback((next: number) => {
    setIndex(next);
    setTick((t) => t + 1);
  }, []);

  // Auto-advance. Restarted on any manual change (`tick`), pause checked per pulse so hover/focus don't reset it.
  useEffect(() => {
    if (reduceMotion) return;
    const id = setInterval(() => {
      if (!pausedRef.current) advance(1);
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(id);
  }, [reduceMotion, advance, tick]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = (index + (event.key === "ArrowRight" ? 1 : -1) + count) % count;
    tileRefs.current[next]?.focus();
    select(next);
  };

  const current = commanders[index];
  if (!current || count === 0) return null;

  return (
    <div
      aria-live="polite"
      className="relative"
      onMouseEnter={() => {
        pausedRef.current = true;
      }}
      onMouseLeave={() => {
        pausedRef.current = false;
      }}
      onFocus={() => {
        pausedRef.current = true;
      }}
      onBlur={() => {
        pausedRef.current = false;
      }}
    >
      {intro}
      {/* The wheel and the tiles share a row, and the tiles set its height: the wheel's content is absolute inside its
          cell, so it adds no height of its own and the ring grows or shrinks to match. Phones stack the decks as rows
          beside the wheel; wider screens lay them out as three tiles. */}
      <div className="mt-6 grid grid-cols-[9rem_minmax(0,1fr)] items-stretch gap-4 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-8">
        <div className="relative">
          <div className="absolute inset-0">
            <DeckOverview
              deckKey={current.deck.slug}
              composition={current.deck.composition}
              colorCounts={current.deck.colorCounts}
              cardCount={current.deck.cardCount}
              compact
            />
          </div>
        </div>

        {/* Tiles: click to select, arrow keys when focused. The gold border moves with the selection. */}
        <div
          className="grid grid-cols-1 gap-2 md:grid-cols-3 md:gap-3"
          role="group"
          aria-label="Featured commanders"
          onKeyDown={onKeyDown}
        >
          {commanders.map((cmd, i) => {
            const art = cmd.card?.images?.front.artCrop;
            const selected = i === index;
            return (
              <button
                key={cmd.deck.slug}
                ref={(el) => {
                  tileRefs.current[i] = el;
                }}
                type="button"
                aria-label={`Show ${cmd.deck.commanderName}`}
                aria-current={selected}
                onClick={() => select(i)}
                className={cn(
                  "group flex min-w-0 flex-row overflow-hidden rounded-sm border bg-background text-left transition-colors md:flex-col",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                  selected ? "border-primary" : "border-seam hover:border-muted-foreground/60",
                )}
              >
                <div className="relative aspect-[4/3] w-16 shrink-0 bg-muted md:aspect-[16/10] md:w-full">
                  {art && (
                    <Image
                      src={art}
                      alt=""
                      fill
                      unoptimized
                      sizes={TILE_ART_SIZES}
                      className={cn(
                        "object-cover transition-opacity",
                        selected ? "opacity-100" : "opacity-70 group-hover:opacity-90",
                      )}
                    />
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-2.5 py-1.5 md:justify-start md:gap-1.5 md:p-3">
                  <span className="line-clamp-1 text-[0.8125rem] leading-snug font-bold md:line-clamp-2 md:text-sm">
                    {cmd.deck.commanderName}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 md:mt-auto">
                    <ColorIdentity
                      identity={cmd.card?.colorIdentity ?? fixtureIdentity(cmd.deck.colorCounts)}
                      className="[&_img]:size-3.5"
                    />
                    {cmd.deckCount !== null && (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {formatDeckCount(cmd.deckCount)}
                      </span>
                    )}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
