"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ChartNoAxesColumnIncreasing, History, Layers } from "lucide-react";
import { useReducedMotion } from "motion/react";
import type { CardSummary } from "@mtg/core/contract";
import { cn } from "cn";
import { ColorIdentity } from "@/components/deck/color-identity";
import { ArtPlate } from "@/components/ui/art-plate";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { HINT_TEXT, HOME_SHOWCASE_DAYS, SEAL_BUTTON } from "@/lib/constants";
import { formatAge, formatDeckCount } from "@/lib/labels";
import type { ShowcaseCommander, ShowcaseDeck } from "@/lib/server/home-showcase";

/** How long each Popular commander stays highlighted before the next one comes in: long enough to read its stats. */
const AUTO_ADVANCE_MS = 7_000;

/** The Highlight's plate is about 40% of a 1280 px sheet from `lg`, the full width below it. */
const HIGHLIGHT_ART_SIZES = "(min-width: 1024px) 40vw, 100vw";
/** A row's thumbnail: 6 rem on phones, 5 rem in the narrow `lg` columns, 7 rem (112 px) from `2xl`. */
const THUMB_ART_SIZES = "112px";

/** The keys that move between Popular rows (the column runs down, but either axis reads naturally). */
const PREVIOUS_KEYS = new Set(["ArrowUp", "ArrowLeft"]);
const NEXT_KEYS = new Set(["ArrowDown", "ArrowRight"]);

/** A row's pressable area: ink text, the espresso wash on hover, the focus ring. */
const ROW_PRESS =
  "flex min-h-11 min-w-0 flex-1 items-center gap-3 p-2 text-left transition-colors hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
/** The row in the Highlight: `TOGGLE_ON`'s thick espresso edge, without its espresso text (the name stays ink). */
const ROW_SELECTED = "ring-3 ring-inset ring-primary";

/** Nothing to subscribe to: `useSyncExternalStore` only tells the server render from the client one here. */
const subscribeNothing = () => () => {};

/**
 * The homepage's Commanders & Decks: the Highlight (a Popular commander's art, stats and the seal that builds with it)
 * beside Popular Commanders and Latest Decks, at about 4 : 3 : 3 from `lg`, separated by seams on the one sheet.
 *
 * A Popular row loads its commander into the Highlight (the arrow keys move between them); its Build link goes
 * straight to the build page. A Latest row opens its deck's page. The Highlight cycles through the Popular commanders
 * every 7 s, paused on hover and focus and off with reduced motion; the first row chosen stops it for the visit.
 */
export function CommandersAndDecks({ popular, latest }: { popular: ShowcaseCommander[]; latest: ShowcaseDeck[] }) {
  const [index, setIndex] = useState(0);
  const [stopped, setStopped] = useState(false);
  const reduceMotion = useReducedMotion();
  const pausedRef = useRef(false);
  const popularHeadingId = useId();
  const latestHeadingId = useId();
  // Ages read the clock, which the server render can't: they appear once hydrated.
  const mounted = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );

  // Only once hydrated: the server can't know the visitor's reduced-motion setting, and the Highlight's `aria-live`
  // follows this, so reading it during hydration would mismatch the server's HTML.
  const running = mounted && !stopped && !reduceMotion && popular.length > 1;

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      if (!pausedRef.current) setIndex((current) => (current + 1) % popular.length);
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(id);
  }, [running, popular.length]);

  const choose = useCallback((next: number) => {
    setIndex(next);
    setStopped(true);
  }, []);

  const shown = popular[index];
  if (!shown) return null;

  return (
    <div
      className="grid gap-8 lg:grid-cols-[4fr_3fr_3fr] lg:gap-0 lg:divide-x lg:divide-seam"
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
      <Highlight commander={shown} live={!running} />

      <Column headingId={popularHeadingId} title="Popular Commanders" icon={ChartNoAxesColumnIncreasing} className="lg:px-6">
        <PopularRows popular={popular} selected={index} onChoose={choose} headingId={popularHeadingId} />
      </Column>

      <Column headingId={latestHeadingId} title="Latest Decks" icon={History} className="lg:pl-6">
        {latest.length === 0 ? (
          <p className="text-sm text-muted-foreground">No decks saved yet.</p>
        ) : (
          <ul aria-labelledby={latestHeadingId} className="flex flex-col divide-y divide-seam border-y border-seam">
            {latest.map((deck) => (
              <li key={deck.code} className="flex py-1">
                <Link href={deck.href} aria-label={`Open the ${deck.name} deck`} className={ROW_PRESS}>
                  <RowBody
                    name={deck.name}
                    card={deck.card}
                    identity={deck.colorIdentity}
                    detail={mounted ? formatAge(new Date(deck.createdAt)) : null}
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Column>
    </div>
  );
}

/**
 * The Popular commander in focus: its name, its art framed with the artist's credit, its stats and the seal that builds
 * with it. Announced when it changes, except while it cycles on its own.
 */
function Highlight({ commander, live }: { commander: ShowcaseCommander; live: boolean }) {
  const { card } = commander;
  const art = card?.images?.front.artCrop;
  const artist = card?.artist;
  return (
    <div aria-live={live ? "polite" : "off"} className="flex min-w-0 flex-col gap-3 lg:pr-6">
      <h2 className="flex min-h-11 items-center font-heading text-xl font-semibold text-balance sm:text-2xl lg:text-xl xl:text-2xl">
        {commander.name}
      </h2>

      {art && artist && card ? (
        <ArtPlate
          src={art}
          credit={{ cardName: card.name, cardSlug: card.slug, artist }}
          sizes={HIGHLIGHT_ART_SIZES}
          position="object-[center_25%]"
          unoptimized
          className="aspect-[16/9]"
        />
      ) : (
        // A fixture commander the catalog didn't supply: the frame alone, never an empty image or uncredited art.
        <div aria-hidden className="aspect-[16/9] border-2 border-brass bg-muted" />
      )}

      <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <ColorIdentity identity={commander.colorIdentity} />
        <span aria-hidden className="h-5 border-l border-seam" />
        {commander.visitors !== null && commander.visitors > 0 && <Builders count={commander.visitors} />}
        {commander.deckCount !== null && (
          <span className="flex items-center gap-1.5 font-mono text-xs">
            <Layers aria-hidden className="size-4 text-muted-foreground" />
            {formatDeckCount(commander.deckCount)}
          </span>
        )}
      </div>

      <Link href={commander.href} className={cn(SEAL_BUTTON, "w-full")}>
        Build with this Commander
        <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}

/** "5 builders", underlined dotted: tapped, it says what a builder is. */
function Builders({ count }: { count: number }) {
  const label = `${count.toLocaleString("en-US")} builder${count === 1 ? "" : "s"}`;
  return (
    <Dialog>
      <DialogTrigger className={cn("min-h-11 cursor-pointer text-sm font-semibold", HINT_TEXT)}>{label}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            Visitors who built or tuned a deck with this commander here in the last {HOME_SHOWCASE_DAYS} days. A count only: no names.
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}

/** A column's heading over its rows. */
function Column({
  headingId,
  title,
  icon: Icon,
  className,
  children,
}: {
  headingId: string;
  title: string;
  icon: typeof History;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      <h2 id={headingId} className="flex min-h-11 items-center gap-2 font-heading text-xl font-semibold">
        <Icon aria-hidden className="size-5 shrink-0 text-brass" strokeWidth={1.75} />
        {title}
      </h2>
      {children}
    </div>
  );
}

/**
 * The Popular rows. Each row's button loads its commander into the Highlight (`aria-current` and the thick espresso
 * edge mark the one shown); the Build link beside it, never inside it, goes to the build page. The arrow keys move
 * between the rows.
 */
function PopularRows({
  popular,
  selected,
  onChoose,
  headingId,
}: {
  popular: ShowcaseCommander[];
  selected: number;
  onChoose: (index: number) => void;
  headingId: string;
}) {
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = PREVIOUS_KEYS.has(event.key) ? -1 : NEXT_KEYS.has(event.key) ? 1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + popular.length) % popular.length;
    rowRefs.current[next]?.focus();
    onChoose(next);
  };

  return (
    <ul aria-labelledby={headingId} className="flex flex-col divide-y divide-seam border-y border-seam">
      {popular.map((commander, index) => (
        <li key={commander.slug} className="py-1">
          <div className={cn("flex items-center gap-2 pr-2", selected === index && ROW_SELECTED)}>
            <button
              ref={(el) => {
                rowRefs.current[index] = el;
              }}
              type="button"
              aria-label={`Show ${commander.name}`}
              aria-current={selected === index}
              onClick={() => onChoose(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={ROW_PRESS}
            >
              <RowBody
                name={commander.name}
                card={commander.card}
                identity={commander.colorIdentity}
                detail={commander.deckCount !== null ? formatDeckCount(commander.deckCount) : null}
              />
            </button>
            <Link
              href={commander.href}
              aria-label={`Build with ${commander.name}`}
              className="flex min-h-11 shrink-0 items-center rounded-md border border-primary px-3 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              Build
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** What a row shows: the art, the name, the colours and one detail (deck count or age). */
function RowBody({ name, card, identity, detail }: { name: string; card: CardSummary | null; identity: string; detail: string | null }) {
  const art = card?.images?.front.artCrop;
  return (
    <>
      <span className="relative aspect-[4/3] w-24 shrink-0 overflow-hidden border border-brass bg-muted lg:w-20 2xl:w-28">
        {art && <Image src={art} alt="" fill unoptimized sizes={THUMB_ART_SIZES} className="object-cover object-[center_25%]" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="line-clamp-2 leading-snug font-semibold">{name}</span>
        <span className="flex items-center gap-x-2">
          <ColorIdentity identity={identity} className="shrink-0 [&_img]:size-3.5" />
          {detail && (
            <>
              <span aria-hidden className="h-4 border-l border-seam" />
              <span className="font-mono text-xs whitespace-nowrap text-muted-foreground">{detail}</span>
            </>
          )}
        </span>
      </span>
    </>
  );
}
