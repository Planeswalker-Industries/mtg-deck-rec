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

/** Tiles are about 220 px wide on desktop and a third of a phone; Scryfall's art crops are about 626 px wide. */
const TILE_ART_SIZES = "(min-width: 1024px) 220px, 33vw";

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
      {/* The wheel and the tiles share a row, and the tiles set its height: from md up the wheel's cell is absolute
          inside, so it adds no height of its own and the ring grows or shrinks to match the tiles. */}
      <div className="mt-6 grid gap-6 md:grid-cols-[10rem_minmax(0,1fr)] md:items-stretch md:gap-8">
        <div className="relative flex justify-center">
          <div className="md:absolute md:inset-0">
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
          className="grid grid-cols-3 gap-2 sm:gap-3"
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
                  "group flex min-w-0 flex-col overflow-hidden rounded-sm border bg-background text-left transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                  selected ? "border-primary" : "border-seam hover:border-muted-foreground/60",
                )}
              >
                <div className="relative aspect-[16/10] w-full bg-muted">
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
                <div className="flex flex-1 flex-col gap-1.5 p-2 sm:p-3">
                  <span className="line-clamp-2 text-sm leading-snug font-bold">{cmd.deck.commanderName}</span>
                  <span className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1">
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
