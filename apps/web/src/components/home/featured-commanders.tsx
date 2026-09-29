"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "cn";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import type { FeaturedCommander } from "@/lib/server/featured";
import { ColorIdentity } from "@/components/deck/color-identity";
import { buttonVariants } from "@/components/ui/button";
import { formatDeckCount } from "@/lib/labels";
import type { ColorKey } from "@/lib/featured-decks";
import { DeckOverview } from "./deck-overview";

type Direction = 1 | -1;

const AUTO_ADVANCE_MS = 7_000;
/** The detail slides sideways, the way the tiles run, and only this far: the tiles sit right above it. */
const DETAIL_SLIDE_PX = 32;

const COLOR_NAME: Record<string, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };

const IDENTITY_ORDER: readonly ColorKey[] = ["W", "U", "B", "R", "G"];

/** Tiles are about 140 px wide on desktop and a third of a phone; Scryfall's art crops are about 626 px wide. */
const TILE_ART_SIZES = "(min-width: 1024px) 140px, 33vw";

/** The fixture's identity when the catalog didn't answer: the colours its cards count under, in WUBRG order. */
function fixtureIdentity(counts: Record<ColorKey, number>): string {
  return IDENTITY_ORDER.filter((key) => counts[key] > 0).join("");
}

/** "White, Black" for the plan's subtitle; "Colorless" when the identity is empty. */
function colorNames(identity: string): string {
  const names = [...identity].map((c) => COLOR_NAME[c] ?? c);
  return names.length > 0 ? names.join(", ") : "Colorless";
}

/**
 * The featured commanders: the selected deck's overview wheel beside a row of tiles (art, colours, deck count), and
 * the selected commander's name and Build this Deck under both.
 * Takes all three commanders' server-rendered data as props. Auto-advances on a timer, takes manual input from
 * the tiles and the arrow keys, pauses on hover and focus, and respects reduced motion.
 *
 * Only the selected commander's wheel and name are in the DOM. Tile names are not headings: the detail's `h3` is the
 * commander on show.
 */
export function FeaturedCommanders({ commanders }: { commanders: FeaturedCommander[] }) {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<Direction>(1);
  const [tick, setTick] = useState(0);
  const reduceMotion = useReducedMotion();
  const pausedRef = useRef(false);
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const count = commanders.length;

  const advance = useCallback(
    (delta: number) => {
      setDirection(delta > 0 ? 1 : -1);
      setIndex((i) => (i + delta + count) % count);
    },
    [count],
  );

  const select = useCallback((next: number) => {
    setIndex((prev) => {
      if (next === prev) return prev;
      setDirection(next > prev ? 1 : -1);
      return next;
    });
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

  const card = current.card;

  // Reduced motion: a cross-fade in place of the slide (motion.dev's accessibility guidance).
  const variants: Variants = reduceMotion
    ? {
        // x stays in every state so the server's render (which can't know the preference) and the client's agree.
        enter: { x: 0, opacity: 0 },
        center: { x: 0, opacity: 1 },
        exit: { x: 0, opacity: 0 },
      }
    : {
        enter: (d: Direction) => ({ x: d * DETAIL_SLIDE_PX, opacity: 0 }),
        center: { x: 0, opacity: 1 },
        exit: (d: Direction) => ({ x: -d * DETAIL_SLIDE_PX, opacity: 0 }),
      };

  // One selection change animates two places (the wheel and the name row); both use the same keyed swap.
  const swap = (key: string, content: ReactNode) => (
    <AnimatePresence mode="wait" custom={direction} initial={false}>
      <motion.div
        key={key}
        // Custom goes on the element too, not just AnimatePresence: non-exit variants resolve it
        // from the component's own prop (presence custom is only read for "exit"), so without it
        // enter always slid in from the same side whichever way the selection moved.
        custom={direction}
        variants={variants}
        initial="enter"
        animate="center"
        exit="exit"
        transition={{ duration: reduceMotion ? 0.2 : 0.3, ease: "easeInOut" }}
      >
        {content}
      </motion.div>
    </AnimatePresence>
  );

  return (
    <div
      aria-live="polite"
      className="relative flex flex-col gap-5"
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
      {/* The wheel is fixed-width so a deck with more legend rows doesn't shove the tiles sideways. */}
      <div className="grid gap-5 md:grid-cols-[16.5rem_minmax(0,1fr)] md:items-start md:gap-6">
        {swap(
          `overview-${current.deck.slug}`,
          <DeckOverview
            composition={current.deck.composition}
            colorCounts={current.deck.colorCounts}
            cardCount={current.deck.cardCount}
          />,
        )}

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

      {/* The commander on show and the one action. */}
      {swap(
        `detail-${current.deck.slug}`,
        <div className="flex flex-col gap-4 border-t border-seam pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3 className="font-heading text-xl font-semibold">{current.deck.commanderName}</h3>
              {card && <ColorIdentity identity={card.colorIdentity} />}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Commander
              {card ? ` · ${colorNames(card.colorIdentity)}` : ""}
              {current.deckCount !== null ? ` · ${formatDeckCount(current.deckCount)}` : ""}
            </p>
          </div>
          <Link
            href={`/deck?commander=${current.deck.slug}`}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "shrink-0 gap-2 self-start border-primary bg-background text-primary sm:self-auto",
              "hover:border-primary hover:bg-background hover:text-primary",
              "dark:border-primary dark:bg-background dark:hover:bg-background dark:hover:text-primary",
            )}
          >
            Build this Deck
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        </div>,
      )}
    </div>
  );
}
