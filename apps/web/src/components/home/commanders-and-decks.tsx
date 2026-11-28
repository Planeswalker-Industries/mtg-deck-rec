"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ChartNoAxesColumnIncreasing, History, Layers } from "lucide-react";
import { useReducedMotion } from "motion/react";
import type { CardSummary } from "@mtg/core/contract";
import { cn } from "cn";
import { ColorIdentity } from "@/components/deck/color-identity";
import { ArtPlate } from "@/components/ui/art-plate";
import { SEAL_BUTTON } from "@/lib/constants";
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

/** Tailwind's `lg`, from which the lists are columns beside the Highlight instead of tabs under it. */
const COLUMNS_QUERY = "(min-width: 64rem)";

const onColumnsChange = (change: () => void) => {
  const query = window.matchMedia(COLUMNS_QUERY);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
};
/** Whether the lists are columns; false on the server and before hydration, so the first render has the tabs' roles. */
const useColumns = () =>
  useSyncExternalStore(
    onColumnsChange,
    () => window.matchMedia(COLUMNS_QUERY).matches,
    () => false,
  );

/** The focus ring; inset below `lg`, where the swipe strip's scroll box would clip it at a pane's edge. */
const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary max-lg:focus-visible:-outline-offset-2";
/** A row's pressable area: ink text, the espresso wash on hover, the focus ring. */
const ROW_PRESS = `flex min-h-11 min-w-0 flex-1 items-center gap-3 p-2 text-left transition-colors hover:bg-primary/10 ${FOCUS_RING}`;
/** The row in the Highlight: `TOGGLE_ON`'s thick espresso edge, without its espresso text (the name stays ink). */
const ROW_SELECTED = "ring-3 ring-inset ring-primary";

/** Nothing to subscribe to: `useSyncExternalStore` only tells the server render from the client one here. */
const subscribeNothing = () => () => {};

/** The two lists, in the order of their tabs and of the panes on the swipe strip. */
const LISTS = [
  { key: "popular", tab: "Popular", title: "Popular Commanders", icon: ChartNoAxesColumnIncreasing },
  { key: "latest", tab: "Latest", title: "Latest Decks", icon: History },
] as const;

/**
 * The homepage's Commanders & Decks: the Highlight (a Popular commander's art, stats and the seal that builds with it)
 * beside Popular Commanders and Latest Decks, at about 4 : 3 : 3 from `lg`, separated by seams on the one sheet.
 *
 * A Popular row loads its commander into the Highlight (the arrow keys move between them); its Build link goes
 * straight to the build page. A Latest row opens its deck's page. The Highlight cycles through the Popular commanders
 * every 7 s, paused on hover and focus and off with reduced motion; the first row chosen stops it for the visit.
 *
 * Below `lg` the two lists sit side by side on a scroll-snap strip under "Popular" and "Latest" tabs: a swipe moves the
 * selected tab, a tab scrolls its pane in. From `lg` the strip and its wrapper are `display: contents`, so the same two
 * columns are the grid's own items and nothing renders twice.
 */
export function CommandersAndDecks({ popular, latest }: { popular: ShowcaseCommander[]; latest: ShowcaseDeck[] }) {
  const [index, setIndex] = useState(0);
  const [stopped, setStopped] = useState(false);
  const reduceMotion = useReducedMotion();
  const pausedRef = useRef(false);
  const [tab, setTab] = useState(0);
  const stripRef = useRef<HTMLDivElement>(null);
  // The pane a tab tap is scrolling to: the strip's scroll events don't move the tab until it arrives.
  const targetRef = useRef<number | null>(null);
  const columns = useColumns();
  const idBase = useId();
  const ids = LISTS.map((list) => ({
    heading: `${idBase}-${list.key}-heading`,
    tab: `${idBase}-${list.key}-tab`,
    panel: `${idBase}-${list.key}-panel`,
  }));
  // Ages read the clock, which the server render can't: they appear once hydrated.
  const mounted = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );

  // Only once hydrated: the server can't know the visitor's reduced-motion setting.
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

  const showTab = (next: number) => {
    setTab(next);
    const strip = stripRef.current;
    if (!strip) return;
    // Already on that pane: no scroll event would come to release the hold, so don't take one.
    if (strip.clientWidth === 0 || Math.round(strip.scrollLeft / strip.clientWidth) === next) return;
    targetRef.current = next;
    strip.scrollTo({ left: next * strip.clientWidth, behavior: reduceMotion ? "auto" : "smooth" });
  };

  const releaseTarget = () => {
    targetRef.current = null;
  };

  const onStripScroll = () => {
    const strip = stripRef.current;
    if (!strip || strip.clientWidth === 0) return;
    const at = Math.round(strip.scrollLeft / strip.clientWidth);
    if (targetRef.current !== null) {
      if (at === targetRef.current) targetRef.current = null;
      return;
    }
    setTab(at);
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (tab + step + LISTS.length) % LISTS.length;
    document.getElementById(ids[next]!.tab)?.focus();
    showTab(next);
  };

  const shown = popular[index];
  if (!shown) return null;

  // Tab panels only while there are tabs: from `lg` the columns are plain columns under their own headings.
  const panelProps = (i: number) => (columns ? {} : { id: ids[i]!.panel, role: "tabpanel", "aria-labelledby": ids[i]!.tab });

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
      <Highlight commander={shown} />
      {/* Present from the first render and filled only by a choice, so the cycle stays quiet and the first tap speaks. */}
      <p aria-live="polite" className="sr-only">
        {stopped ? `${shown.name} highlighted` : ""}
      </p>

      <div className="flex min-w-0 flex-col gap-3 lg:contents">
        <div
          role="tablist"
          aria-label="Commanders & Decks"
          onKeyDown={onTabKeyDown}
          className="grid grid-cols-2 border-b border-seam lg:hidden"
        >
          {LISTS.map((list, i) => {
            const on = i === tab;
            return (
              <button
                key={list.key}
                id={ids[i]!.tab}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls={ids[i]!.panel}
                tabIndex={on ? 0 : -1}
                onClick={() => showTab(i)}
                className={cn(
                  "relative flex min-h-11 items-center justify-center px-2 text-base text-primary transition-colors hover:bg-primary/10",
                  "focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-primary",
                  // The selected tab: a thick espresso bar along its foot, as on How it works.
                  on && "font-semibold after:absolute after:inset-x-0 after:-bottom-px after:h-1 after:bg-primary",
                )}
              >
                {list.tab}
              </button>
            );
          })}
        </div>

        <div
          ref={stripRef}
          onScroll={onStripScroll}
          // A finger or a wheel on the strip takes over from a tap's scroll still running.
          onPointerDown={releaseTarget}
          onWheel={releaseTarget}
          className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] lg:contents"
        >
          <Column {...panelProps(0)} headingId={ids[0]!.heading} title={LISTS[0].title} icon={LISTS[0].icon} className="lg:px-6">
            <PopularRows popular={popular} selected={index} onChoose={choose} headingId={ids[0]!.heading} />
          </Column>

          <Column {...panelProps(1)} headingId={ids[1]!.heading} title={LISTS[1].title} icon={LISTS[1].icon} className="lg:pl-6">
            {latest.length === 0 ? (
              <p className="text-sm text-muted-foreground">No decks saved yet.</p>
            ) : (
              <ul aria-labelledby={ids[1]!.heading} className="flex flex-col divide-y divide-seam border-y border-seam">
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
      </div>
    </div>
  );
}

/** The Popular commander in focus: its name, its art framed with the artist's credit, its stats and the seal that builds with it. */
function Highlight({ commander }: { commander: ShowcaseCommander }) {
  const { card } = commander;
  const art = card?.images?.front.artCrop;
  const artist = card?.artist;
  return (
    <div className="flex min-w-0 flex-col gap-3 lg:pr-6">
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

/** "5 builders". */
function Builders({ count }: { count: number }) {
  return (
    <span className="text-sm font-semibold">
      {count.toLocaleString("en-US")} builder{count === 1 ? "" : "s"}
    </span>
  );
}

/**
 * A column's heading over its rows. Below `lg` it is one full-width pane of the swipe strip, and its heading is left
 * to the tab above (kept for screen readers, which name the list by it).
 */
function Column({
  headingId,
  title,
  icon: Icon,
  className,
  children,
  ...panel
}: {
  headingId: string;
  title: string;
  icon: typeof History;
  className?: string;
  children: ReactNode;
} & ComponentPropsWithoutRef<"div">) {
  return (
    <div {...panel} className={cn("flex w-full min-w-0 shrink-0 snap-start flex-col gap-3", className)}>
      <h2 id={headingId} className="flex min-h-11 items-center gap-2 font-heading text-xl font-semibold max-lg:sr-only">
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
              className={cn(
                "flex min-h-11 shrink-0 items-center rounded-md border border-primary px-3 text-sm font-semibold text-primary transition-colors hover:bg-primary/10",
                FOCUS_RING,
              )}
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
