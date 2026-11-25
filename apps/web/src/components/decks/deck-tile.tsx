"use client";

import { useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { BookOpen, CircleAlert, Copy, Ellipsis, Lock, SquarePen, Trash2, TriangleAlert, WandSparkles, type LucideIcon } from "lucide-react";
import { COMMANDER_DECK_SIZE } from "@mtg/core/commander";
import type { SavedDeckSummary } from "@mtg/core/contract";
import { cn } from "cn";
import { COLOR_NAMES, ColorIdentity } from "@/components/deck/color-identity";
import { displayName } from "@/lib/cards";

/** The deck stack photo (public/decks/deck-stack.webp, resized from the owner's deck_preview.png) at its pixel size. */
const STACK = { src: "/decks/deck-stack.webp", width: 720, height: 679 } as const;
/** The card back stands in for a deck with no commander, so the stack never shows the photo's blank grey card. */
export const CARD_BACK_SRC = "/card_back.webp";
/** Scryfall's `normal` image size: the leaning card is at most about 125 px wide, and `normal` covers that at 2x. */
const CARD_PX = { width: 488, height: 680 } as const;

/**
 * Where the photo's leaning card sits, as a CSS 3D transform in container-width units (cqw), so it scales with the
 * tile. Fitted to the card's four corners in the photo (within 2 px of 868); the card is centred on (x, y).
 */
const LEAN = {
  centerXCqw: 70.073,
  centerYCqw: 48.453,
  widthCqw: 55.898,
  perspectiveCqw: 328.643,
  rotateXDeg: -0.286,
  rotateYDeg: 30.372,
  rotateZDeg: -12.072,
  /** A hair larger than the fit, so no sliver of the photo's grey card shows along an edge. */
  overscan: 1.012,
} as const;
const LEAN_HEIGHT_CQW = (LEAN.widthCqw * CARD_PX.height) / CARD_PX.width;

const LEAN_STYLE: React.CSSProperties = {
  left: `${LEAN.centerXCqw - LEAN.widthCqw / 2}cqw`,
  top: `${LEAN.centerYCqw - LEAN_HEIGHT_CQW / 2}cqw`,
  width: `${LEAN.widthCqw}cqw`,
  height: `${LEAN_HEIGHT_CQW}cqw`,
  transform: `perspective(${LEAN.perspectiveCqw}cqw) rotateX(${LEAN.rotateXDeg}deg) rotateY(${LEAN.rotateYDeg}deg) rotateZ(${LEAN.rotateZDeg}deg) scale(${LEAN.overscan})`,
};
const STACK_ASPECT = `${STACK.width} / ${STACK.height}`;
/** The stack's widest, in rem: the tile's `max-w-56`, so wide tiles keep the photo a modest size. */
const STACK_MAX_REM = 14;
/** The popover's top in the tile (its wrapper is the container): the stack's height, the stack being the tile's width up to its cap. */
const POPOVER_TOP = `calc(min(100cqw, ${STACK_MAX_REM}rem) * ${STACK.height} / ${STACK.width} + 0.25rem)`;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
/** Calendar months and years vary; these averages only pick the unit a rounded "N months ago" reads in. */
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;
const AGO_STEPS: [limitMs: number, unitMs: number, unit: Intl.RelativeTimeFormatUnit][] = [
  [HOUR_MS, MINUTE_MS, "minute"],
  [DAY_MS, HOUR_MS, "hour"],
  [WEEK_MS, DAY_MS, "day"],
  [MONTH_MS, WEEK_MS, "week"],
  [YEAR_MS, MONTH_MS, "month"],
  [Infinity, YEAR_MS, "year"],
];
const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "Updated 3 days ago": what tells decks with the same commander (and often the same name) apart. */
function updatedAgo(iso: string, now: number): string {
  const ms = Math.max(0, now - Date.parse(iso));
  if (ms < MINUTE_MS) return "Updated just now";
  // The last step's limit is Infinity, so the loop always returns.
  for (const [limit, unitMs, unit] of AGO_STEPS) {
    if (ms < limit) return `Updated ${RELATIVE.format(-Math.round(ms / unitMs), unit)}`;
  }
  return "Updated a long time ago";
}

const MENU_ITEM_FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/**
 * Depth for the stack photo, which is otherwise a flat cut-out on the paper: a soft contact shadow under it and a wider
 * one further out. The selected tile's is deeper, as if lifted. Shadow colour is the onyx of the wood bar.
 */
const STACK_SHADOW = "drop-shadow-[0_3px_3px_rgb(19_17_17/0.35)] drop-shadow-[0_14px_14px_rgb(19_17_17/0.3)]";
const STACK_SHADOW_LIFTED = "drop-shadow-[0_5px_5px_rgb(19_17_17/0.35)] drop-shadow-[0_24px_22px_rgb(19_17_17/0.35)]";
/** The commander leaning on the stack casts its own shadow back onto it, to the left and down. */
const LEAN_SHADOW = "shadow-[-6px_6px_12px_rgb(19_17_17/0.45)]";

type MenuItem = { key: string; label: string; aria: string; icon: LucideIcon; destructive?: boolean } & (
  { href: Route } | { onClick: () => void }
);

/**
 * The deck stack photo with a card leaning on it: the deck's commander, or the card back. Decorative; whatever wraps it
 * names the deck.
 */
export function DeckStack({ cardSrc, className }: { cardSrc: string; className?: string }) {
  return (
    <span className={cn("@container relative block", STACK_SHADOW, className)} style={{ aspectRatio: STACK_ASPECT }}>
      <Image src={STACK.src} alt="" width={STACK.width} height={STACK.height} unoptimized className="absolute inset-0 size-full" />
      <Image
        src={cardSrc}
        alt=""
        width={CARD_PX.width}
        height={CARD_PX.height}
        unoptimized
        style={LEAN_STYLE}
        className={cn("absolute rounded-[4.75%/3.4%] bg-seam object-cover", LEAN_SHADOW)}
      />
    </span>
  );
}

/**
 * One saved deck as a stack of cards with its commander leaning against it; below, its name, colours, when it was last
 * updated and, if it isn't at 100 cards, its count.
 *
 * Selecting a tile grows it and shows its actions; the list keeps one tile selected at a time. A mouse selects by
 * hovering and opens the deck on click. A touch selects on the first tap and opens on the second; a tap outside any
 * tile clears it. The keyboard selects on focus. On touch screens a ⋯ button selects too, for anyone who doesn't guess
 * the first tap; where a pointer can hover, hovering already shows the actions, so the button is hidden there.
 * From sm up the actions open as a small popover over the tile's own name and colours, just under its cards; on phones
 * as a sheet along the bottom of the screen. Either way they never cover the next row's cards.
 */
export function DeckTile({
  deck,
  active,
  now,
  onActivate,
  onDeactivate,
  onDuplicate,
  onDelete,
}: {
  deck: SavedDeckSummary;
  active: boolean;
  /** The list's clock, so every tile's "Updated …" agrees. */
  now: number;
  onActivate: () => void;
  onDeactivate: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const href = deckHref(deck);
  const commander = deck.commanderKey.commanders[0];
  const linkRef = useRef<HTMLAnchorElement>(null);
  // The pointer behind the next click: a touch's first tap selects instead of following the link.
  const pointerRef = useRef<string>("");
  const ids = { description: `deck-tile-${deck.id}`, sheet: `deck-sheet-${deck.id}`, popover: `deck-popover-${deck.id}` };

  const items: MenuItem[] = [
    {
      key: "upgrade",
      label: "Upgrade",
      aria: `Upgrade ${deck.name} in the deck tool`,
      icon: WandSparkles,
      href: `/deck?deck=${deck.code}` as Route,
    },
    { key: "open", label: "Open", aria: `Open ${deck.name}`, icon: BookOpen, href },
    { key: "edit", label: "Edit", aria: `Edit ${deck.name}`, icon: SquarePen, href: `${href}/edit` as Route },
    { key: "copy", label: "Copy", aria: `Copy ${deck.name}`, icon: Copy, onClick: onDuplicate },
    { key: "delete", label: "Delete", aria: `Delete ${deck.name}`, icon: Trash2, onClick: onDelete, destructive: true },
  ];

  return (
    <li
      data-deck-tile={deck.id}
      data-active={active || undefined}
      className="relative data-active:z-30"
      onPointerEnter={(e) => e.pointerType === "mouse" && onActivate()}
      onPointerLeave={(e) => e.pointerType === "mouse" && active && onDeactivate()}
      onFocus={(e) => {
        // Keyboard focus only: Chrome focuses a link on a tap's pointerdown, which would skip the select step.
        if ((e.target as HTMLElement).matches(":focus-visible")) onActivate();
      }}
      onBlur={(e) => {
        if (active && !e.currentTarget.contains(e.relatedTarget)) onDeactivate();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && active) {
          onDeactivate();
          linkRef.current?.focus();
        }
      }}
    >
      <div
        className={cn(
          "relative origin-bottom transition-transform duration-200 ease-table motion-reduce:transition-none",
          active && "scale-105",
        )}
      >
        <Link
          ref={linkRef}
          href={href}
          // The name alone, so the tile reads as its deck; the commander, colours and state follow as its description.
          aria-label={deck.name}
          aria-describedby={ids.description}
          className="group block rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
          onPointerDown={(e) => {
            pointerRef.current = e.pointerType;
          }}
          onClick={(e) => {
            const pointer = pointerRef.current;
            pointerRef.current = "";
            if (!active && pointer !== "" && pointer !== "mouse") {
              e.preventDefault();
              onActivate();
            }
          }}
        >
          <span className="relative mx-auto block w-full max-w-56">
            <DeckStack
              cardSrc={commander?.images?.front.normal ?? CARD_BACK_SRC}
              className={cn("transition-[filter] duration-200", active && STACK_SHADOW_LIFTED)}
            />
            {!deck.isPublic && (
              // The photo's top left corner is empty table, so the badge covers no card.
              <span
                title="Private"
                className="absolute top-0 left-0 flex size-8 items-center justify-center rounded-full bg-(--wood-bar) text-(--wood-ink) shadow-md"
              >
                <Lock aria-hidden className="size-4" />
              </span>
            )}
          </span>
          <span id={ids.description} className="sr-only">
            {describe(deck)}
          </span>
          <span className="mt-2 flex flex-col items-center gap-1.5 text-center">
            <span className="line-clamp-2 font-heading text-xl leading-tight font-semibold break-words text-primary group-hover:underline">
              {deck.name}
            </span>
            <ColorIdentity identity={identityOf(deck)} size="lg" />
            <span aria-hidden className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span suppressHydrationWarning>{updatedAgo(deck.updatedAt, now)}</span>
              <CountChip count={deck.cardCount} />
            </span>
          </span>
        </Link>

        {/* Over the stack's top right corner: the photo's frame, so the button sits on the same spot at every size. Touch
            screens only: a hover shows the actions before a mouse could reach it, so there its click would do nothing. */}
        <span className="pointer-events-none absolute inset-x-0 top-0 mx-auto block w-full max-w-56" style={{ aspectRatio: STACK_ASPECT }}>
          <button
            type="button"
            aria-label={`Actions for ${deck.name}`}
            aria-expanded={active}
            aria-controls={`${ids.sheet} ${ids.popover}`}
            onClick={(e) => {
              // A mouse already opened the actions by hovering, so its click only keeps them open.
              const mouse = (e.nativeEvent as PointerEvent).pointerType === "mouse";
              if (active && !mouse) onDeactivate();
              else onActivate();
            }}
            className={cn(
              "pointer-events-auto absolute -top-1 -right-1 flex size-11 [@media(hover:hover)]:hidden items-center justify-center rounded-full bg-popover text-primary shadow-md ring-1 ring-foreground/10 transition-colors hover:bg-primary/10 sm:size-9",
              MENU_ITEM_FOCUS,
              active && "ring-2 ring-primary",
            )}
          >
            <Ellipsis aria-hidden className="size-5" />
          </button>
        </span>
      </div>

      {active && (
        <>
          {/* Phones: a sheet along the bottom of the screen, so the actions never cover the next row's cards. */}
          <div
            id={ids.sheet}
            role="group"
            aria-label={`Actions for ${deck.name}`}
            className="fixed inset-x-0 bottom-0 z-50 rounded-t-xl bg-popover px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] text-popover-foreground shadow-lift ring-1 ring-foreground/10 duration-200 animate-in fade-in-0 slide-in-from-bottom-8 motion-reduce:animate-none sm:hidden"
          >
            <p className="truncate border-b border-seam pb-2 font-heading text-xl font-semibold">{deck.name}</p>
            <div className="flex flex-col pt-1">
              {items.map((item) => (
                <MenuEntry key={item.key} item={item} className="min-h-12 gap-3 px-2 text-base" />
              ))}
            </div>
          </div>

          {/* From sm up: a popover the tile's width over its name and colours, its actions in a 3 by 2 grid, starting
              where the cards end. */}
          {/* The tile's width as a container, on this wrapper alone: on the tile, containment would trap the phone sheet. */}
          <div className="@container absolute inset-x-0 top-0 max-sm:hidden">
            <div
              id={ids.popover}
              role="group"
              aria-label={`Actions for ${deck.name}`}
              style={{ top: POPOVER_TOP }}
              // A little wider than the tile: the selected tile grows, and its name with it.
              className="absolute -inset-x-2 grid grid-cols-3 gap-1 rounded-lg bg-popover p-1 text-popover-foreground shadow-lift ring-1 ring-foreground/10 duration-150 animate-in fade-in-0 zoom-in-95 motion-reduce:animate-none"
            >
              {items.map((item) => (
                <MenuEntry key={item.key} item={item} className="min-h-14 flex-col justify-center gap-1 px-1 text-xs" />
              ))}
            </div>
          </div>
        </>
      )}
    </li>
  );
}

function MenuEntry({ item, className }: { item: MenuItem; className: string }) {
  const Icon = item.icon;
  const classes = cn(
    "flex items-center rounded-md font-semibold transition-colors",
    MENU_ITEM_FOCUS,
    item.destructive ? "text-destructive hover:bg-destructive/10" : "text-primary hover:bg-primary/10",
    className,
  );
  const content = (
    <>
      <Icon aria-hidden className="size-5" />
      {item.label}
    </>
  );
  return "href" in item ? (
    <Link href={item.href} aria-label={item.aria} className={classes}>
      {content}
    </Link>
  ) : (
    <button type="button" onClick={item.onClick} aria-label={item.aria} className={classes}>
      {content}
    </button>
  );
}

/** A deck short of 100 cards (amber) or over it (red): the count against 100. At 100 there's nothing to say. */
function CountChip({ count }: { count: number }) {
  if (count === COMMANDER_DECK_SIZE) return null;
  const over = count > COMMANDER_DECK_SIZE;
  const Icon = over ? CircleAlert : TriangleAlert;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm",
        over ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-warning/40 bg-warning/10 text-warning",
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      <span className="font-mono">
        {count} / {COMMANDER_DECK_SIZE}
      </span>
    </span>
  );
}

/** What a screen reader hears after the deck's name: what the tile shows as pictures, chips and muted text. */
function describe(deck: SavedDeckSummary): string {
  const names = deck.commanderKey.commanders.map(displayName);
  const parts = [
    names.length === 0 ? "No commander" : `Led by ${names.join(" and ")}`,
    [...(identityOf(deck) || "C")].map((c) => COLOR_NAMES[c] ?? c).join(", "),
  ];
  if (deck.cardCount !== COMMANDER_DECK_SIZE) parts.push(`${deck.cardCount} of ${COMMANDER_DECK_SIZE} cards`);
  if (!deck.isPublic) parts.push("Private");
  return `${parts.join(". ")}.`;
}

/** The commander segment is decoration; the code is what resolves the deck. */
function deckHref(deck: SavedDeckSummary): Route {
  const commander = deck.commanderKey.commanders[0]?.slug ?? "deck";
  return `/decks/${commander}/${deck.code}` as Route;
}

export const WUBRG = "WUBRG";

export function identityOf(deck: SavedDeckSummary): string {
  const colors = new Set(deck.commanderKey.commanders.flatMap((c) => [...c.colorIdentity]));
  return [...WUBRG].filter((c) => colors.has(c)).join("");
}
