"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "cn";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import type { FeaturedCommander } from "@/lib/server/featured";
import { CardImage } from "@/components/cards/card-image";
import { ColorIdentity } from "@/components/deck/color-identity";
import { buttonVariants } from "@/components/ui/button";
import { formatDeckCount } from "@/lib/labels";
import { DeckOverview } from "./deck-overview";

type Direction = 1 | -1;

const AUTO_ADVANCE_MS = 7_000;

const COLOR_NAME: Record<string, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };

/** "White, Black" for the plan's subtitle; "Colorless" when the identity is empty. */
function colorNames(identity: string): string {
  const names = [...identity].map((c) => COLOR_NAME[c] ?? c);
  return names.length > 0 ? names.join(", ") : "Colorless";
}

/**
 * The featured-commanders carousel. Takes all three commanders' server-rendered data as props. Auto-advances
 * on a timer, takes manual input from the dots and the arrow keys, pauses on hover and focus, and respects
 * reduced motion.
 *
 * Only the visible panel is in the DOM.
 */
export function FeaturedCommanders({ commanders }: { commanders: FeaturedCommander[] }) {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<Direction>(1);
  const [tick, setTick] = useState(0);
  const reduceMotion = useReducedMotion();
  const pausedRef = useRef(false);
  const dotRefs = useRef<(HTMLButtonElement | null)[]>([]);

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
    dotRefs.current[next]?.focus();
    select(next);
  };

  const current = commanders[index];
  if (!current || count === 0) return null;

  const card = current.card;

  // Reduced motion: a cross-fade in place of the y-slide (motion.dev's accessibility guidance).
  const variants: Variants = reduceMotion
    ? {
        enter: { opacity: 0 },
        center: { opacity: 1 },
        exit: { opacity: 0 },
      }
    : {
        enter: (d: Direction) => ({ y: d > 0 ? -200 : 200, opacity: 0 }),
        center: { y: 0, opacity: 1 },
        exit: (d: Direction) => ({ y: d > 0 ? 200 : -200, opacity: 0 }),
      };

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
      <AnimatePresence mode="wait" custom={direction} initial={false}>
        <motion.article
          key={current.deck.slug}
          // Custom goes on the article too, not just AnimatePresence: non-exit variants resolve it
          // from the component's own prop (presence custom is only read for "exit"), so without it
          // enter always fell to the `d > 0` false branch and slid up from the bottom.
          custom={direction}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: reduceMotion ? 0.2 : 0.3, ease: "easeInOut" }}
        >
          <div className="rounded-xl border border-seam bg-sleeve">
            <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-2 lg:gap-0">
              {/* Left half: the commander and its details down to the one action. */}
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5 lg:pr-6">
                {card && <CardImage card={card} alt="" className="w-28 shrink-0 sm:w-36" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-heading text-xl font-semibold">{current.deck.commanderName}</h3>
                    {card && <ColorIdentity identity={card.colorIdentity} />}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Commander
                    {card ? ` · ${colorNames(card.colorIdentity)}` : ""}
                    {current.deckCount !== null ? ` · ${formatDeckCount(current.deckCount)}` : ""}
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{current.deck.summary}</p>
                  <Link
                    href={`/deck?commander=${current.deck.slug}`}
                    className={cn(
                      buttonVariants({ variant: "outline" }),
                      "mt-4 gap-2 border-primary bg-background text-primary",
                      "hover:border-primary hover:bg-background hover:text-primary",
                      "dark:border-primary dark:bg-background dark:hover:bg-background dark:hover:text-primary",
                    )}
                  >
                    Build this Deck
                    <ArrowRight aria-hidden className="size-4" />
                  </Link>
                </div>
              </div>

              {/* Right half: the deck's card-type breakdown, split by the mid-card seam. */}
              <div className="border-t border-seam pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
                <DeckOverview
                  composition={current.deck.composition}
                  colorCounts={current.deck.colorCounts}
                  cardCount={current.deck.cardCount}
                />
              </div>
            </div>
          </div>
        </motion.article>
      </AnimatePresence>

      {/* Carousel dots: click to select, arrow keys when focused. */}
      <div
        className="mt-4 flex items-center justify-center gap-2"
        role="group"
        aria-label="Featured commanders"
        onKeyDown={onKeyDown}
      >
        {commanders.map((cmd, i) => (
          <button
            key={cmd.deck.slug}
            ref={(el) => {
              dotRefs.current[i] = el;
            }}
            type="button"
            aria-label={`Show ${cmd.deck.commanderName}`}
            aria-current={i === index}
            onClick={() => select(i)}
            className={`size-2.5 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
              i === index ? "bg-primary" : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
