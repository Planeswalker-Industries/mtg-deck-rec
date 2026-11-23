"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X } from "lucide-react";
import type { CardId } from "@mtg/core/contract";
import { cn } from "cn";
import { PriceTag } from "@/components/cards/buy-price";
import { CardPlate } from "@/components/cards/card-plate";
import { displayName } from "@/lib/cards";
import {
  PHONE_HIT_AREA,
  REMOVE_ARM_MS,
  SHOPPING_UNDO_MS,
  TEXT_LINK,
  TOGGLE_OFF,
  TOGGLE_ON,
} from "@/lib/constants";
import { asOfSuffix, formatAsOf, formatUsd } from "@/lib/format";
import { cardCategoryLabel } from "@/lib/labels";
import { BuyButtons, type BuySaveState } from "./buy-buttons";
import type { CartScope, ShoppingCart } from "./use-shopping-cart";

/** A phone (or any touch screen) gets the two-tap remove; a mouse gets one click. */
const COARSE_POINTER_QUERY = "(pointer: coarse)";

/** Nothing to subscribe to: `useSyncExternalStore` only tells the server render from the client one here. */
const subscribeNothing = () => () => {};

const SCOPES: { value: CartScope; label: string }[] = [
  { value: "round", label: "This round's cards" },
  { value: "deck", label: "Whole deck" },
];

function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(COARSE_POINTER_QUERY);
    const update = () => setCoarse(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return coarse;
}

/**
 * A line's remove button. On a touch screen it sits muted; the first tap arms it (red), a second removes, and a tap
 * elsewhere or `REMOVE_ARM_MS` disarms it. With a mouse it turns red on hover or focus and one click removes.
 */
function RemoveButton({ name, coarse, onRemove }: { name: string; coarse: boolean; onRemove: () => void }) {
  const [armed, setArmed] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), REMOVE_ARM_MS);
    const away = (e: PointerEvent) => {
      if (!button.current?.contains(e.target as Node)) setArmed(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", away, true);
    };
  }, [armed]);

  return (
    <button
      ref={button}
      type="button"
      aria-label={armed ? `Remove ${name}, tap again to confirm` : `Remove ${name}`}
      title={`Remove ${name}`}
      onClick={() => {
        if (coarse && !armed) return setArmed(true);
        setArmed(false);
        onRemove();
      }}
      className={cn(
        "relative flex size-8 items-center justify-center rounded-full transition-colors duration-180 ease-table",
        // 44 px to a thumb without making the row taller.
        "after:absolute after:-inset-1.5 after:content-['']",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-destructive",
        armed
          ? "bg-destructive/15 text-destructive"
          : "text-muted-foreground hover:bg-destructive/15 hover:text-destructive focus-visible:text-destructive",
      )}
    >
      <X aria-hidden className="size-4" />
    </button>
  );
}

/**
 * The cards a deck still needs, grouped by type, to buy on TCGplayer (T090). Both pages that show it already offer
 * Copy decklist at the top, so the list has no copy button of its own (owner, 2026-11-15). It renders the deck's `cart`
 * (`useShoppingCart`), which the page owns so its other totals follow this list: with a collection the lines are the
 * copies it doesn't supply; without one, the cart's scope toggle offers this round's cards or the whole deck. Removing a
 * line is for this view only (Undo brings it back) and never touches the collection.
 *
 * `folded` (the saved deck page) leads with the count, the total and Buy, and keeps the lines behind a disclosure, so
 * buying fits in the first viewport.
 */
export function ShoppingList({
  title = "Shopping list",
  cart,
  pinActions = false,
  headingLevel = 3,
  folded = false,
  summary,
  buyLabel,
  extraAction,
  onBuy,
  saved,
  buy = true,
  foldAt,
}: {
  title?: string;
  /** The title's heading level: 3 inside Finish, 2 where the list is one of the page's own sections. */
  headingLevel?: 2 | 3;
  /** The deck's cart: its lines, scope and removals, shared with the page's other totals. */
  cart: ShoppingCart;
  /** Keep Buy and the price note at the top of a scrolling container (Finish's aside from xl). */
  pinActions?: boolean;
  /** Count, total and Buy first; the lines behind "Show the N cards", closed at first. */
  folded?: boolean;
  /** Folded: the line under the title, from the number of cards listed (else "N cards, about $Y"). */
  summary?: (count: number) => string;
  /** Folded: the Buy button's words, from the total (else "Buy on TCGplayer"). */
  buyLabel?: (totalUsd: number) => string;
  /** Folded: a second action before Buy (the saved deck page's collection upload). */
  extraAction?: ReactNode;
  /** Called as a cart opens: Finish saves the deck to My Decks for a signed-in player, as every Buy does. */
  onBuy?: () => void;
  /** What became of that save. */
  saved?: BuySaveState;
  /** Show Buy here; false where the page already leads with its own Buy and total (Finish). */
  buy?: boolean;
  /** From this many cards, open on the first group with "Show all" (Finish, where the Decklist repeats a long list). */
  foldAt?: number;
}) {
  const coarse = useCoarsePointer();
  const { list, carts, scope, setScope, scopeToggle, removed } = cart;
  const [undoShown, setUndoShown] = useState(false);
  const [linesOpen, setLinesOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  // True once hydrated: the toast portals into <body>, which the server render has no access to.
  const mounted = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
  const headingId = useId();
  const linesId = useId();

  useEffect(() => {
    if (!undoShown) return;
    const timer = window.setTimeout(() => setUndoShown(false), SHOPPING_UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [undoShown, removed]);

  const Title = headingLevel === 2 ? "h2" : "h3";
  const GroupTitle = headingLevel === 2 ? "h3" : "h4";

  if (list === null) {
    return (
      <section aria-label={title} className="flex flex-col gap-2">
        <Title className="font-heading text-xl leading-none font-semibold">{title}</Title>
        <p role="status" className="text-sm text-muted-foreground">
          Checking your collection…
        </p>
      </section>
    );
  }

  const lastRemoved = cart.lastRemoved;
  const remove = (id: CardId) => {
    cart.remove(id);
    setUndoShown(true);
  };
  const undo = () => {
    cart.undo();
    setUndoShown(false);
  };

  const cardsWord = list.count === 1 ? "card" : "cards";
  // The prices' as-of date rides on the total (owner, 2026-11-16); where they come from is on /privacy.
  const asOf = asOfSuffix(list.asOf);
  const emptyText =
    removed.length > 0
      ? "You removed every card."
      : cart.fromCollection
        ? folded
          ? "You own every card in this deck."
          : "Your collection has every card."
        : scopeToggle && scope === "round"
          ? "This round put in no cards to buy."
          : "Nothing to buy.";

  // A long list opens on its first group; "Show all" brings the rest.
  const cut = !folded && !showAll && foldAt !== undefined && list.count >= foldAt && list.groups.length > 1;
  const shownGroups = cut ? list.groups.slice(0, 1) : list.groups;

  /*
   * Folded (the saved deck page): from lg the groups are narrow columns side by side, scrolling sideways, each scrolling
   * down on its own, so the list fills the sheet's width (owner, 2026-11-21). Only with a mouse: on a touch screen a
   * sideways drag on a plate removes the card there, so the row stays one column on phones and tablets alike.
   */
  const lines = (
    <div
      className={
        folded
          ? "flex flex-col gap-4 lg:pointer-fine:flex-row lg:pointer-fine:items-start lg:pointer-fine:overflow-x-auto lg:pointer-fine:pb-2"
          : "columns-1 gap-6 @xl:columns-2"
      }
    >
      {shownGroups.map((group) => (
        <section
          key={group.category}
          aria-label={cardCategoryLabel[group.category]}
          className={folded ? "lg:pointer-fine:w-64 lg:pointer-fine:shrink-0" : "mb-4 break-inside-avoid"}
        >
          <GroupTitle className="mb-2 text-sm font-semibold text-muted-foreground">
            {cardCategoryLabel[group.category]}{" "}
            <span className="font-mono font-normal">{group.lines.reduce((n, l) => n + l.quantity, 0)}</span>
          </GroupTitle>
          <ul
            aria-label={`${cardCategoryLabel[group.category]} to buy`}
            className={cn("flex flex-col gap-1.5", folded && "lg:max-h-96 lg:overflow-y-auto lg:pr-1 lg:*:shrink-0")}
          >
            {group.lines.map(({ card, quantity }) => (
              <CardPlate
                key={card.id}
                card={card}
                quantity={quantity}
                showCost={false}
                onSwipeAway={() => remove(card.id)}
                trailing={
                  <>
                    <PriceTag price={card.price} className="mx-1 text-xs whitespace-nowrap text-muted-foreground" />
                    <RemoveButton name={displayName(card)} coarse={coarse} onRemove={() => remove(card.id)} />
                  </>
                }
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );

  /*
    A toast over the page, above the docked Deck stats footer, so it shows wherever in a long list the line was.
    Portalled to <body>: this section is a size container, which would otherwise be the toast's containing block.
    The live region stays mounted so a screen reader announces each new message.
  */
  const toast =
    mounted &&
    createPortal(
      <div
        role="status"
        className="pointer-events-none fixed inset-x-4 bottom-[calc(var(--deck-stats-dock,0px)+1rem)] z-50 mx-auto max-w-sm"
      >
        {undoShown && lastRemoved && (
          <p className="pointer-events-auto flex items-center justify-between gap-3 rounded-lg border border-seam bg-sleeve px-3 py-2 text-sm shadow-lift">
            <span className="min-w-0 truncate">Removed {displayName(lastRemoved.card)}.</span>
            <button type="button" onClick={undo} className={cn(TEXT_LINK, PHONE_HIT_AREA, "shrink-0 font-semibold")}>
              Undo
            </button>
          </p>
        )}
      </div>,
      document.body,
    );

  const buyText = buyLabel ? buyLabel(list.totalUsd) : "Buy on TCGplayer";
  const showBuy = (folded && extraAction) || (buy && carts.length > 0 && list.count > 0);
  // With no Buy and no note (Finish, everything priced) there is nothing to keep in view: no empty sticky band.
  const actions = (showBuy || list.unpriced > 0 || (folded && buyLabel && list.asOf)) && (
    // In Finish's aside (a scroll box from xl) Buy stays in view at its top while the lines scroll under it.
    <div className={cn("flex flex-col gap-3", pinActions && "xl:sticky xl:top-0 xl:z-10 xl:bg-background xl:pt-1 xl:pb-2")}>
      {/*
        A named primary action (owner, 2026-11-15): the solid button; on the saved deck page, the page's seal. Nothing to
        buy shows no Buy at all (T102).
      */}
      {showBuy ? (
        <div className="flex flex-wrap items-start gap-2">
          {folded && extraAction}
          {buy && list.count > 0 && <BuyButtons carts={carts} onBuy={onBuy} saved={saved} seal={folded} label={buyText} />}
        </div>
      ) : null}

      <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        {/* A total shown on the button still carries its prices' date. */}
        {folded && buyLabel && list.asOf && <p>Prices from {formatAsOf(list.asOf)}.</p>}
        {list.unpriced > 0 && <p>{list.unpriced} unpriced.</p>}
      </div>
    </div>
  );

  if (folded) {
    return (
      <section aria-labelledby={headingId} className="@container flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Title id={headingId} className="font-heading text-xl leading-none font-semibold">
            {title}
          </Title>
          <p className="text-sm text-muted-foreground">
            {list.count === 0
              ? emptyText
              : summary
                ? summary(list.count)
                : `${list.count} ${cardsWord}, about ${formatUsd(list.totalUsd)}${asOf}`}
          </p>
        </div>
        {/* Nothing to buy: no Buy button at all, so nothing reads as broken. */}
        {list.count > 0 && (
          <>
            {actions}
            <div>
              <button
                type="button"
                aria-expanded={linesOpen}
                aria-controls={linesId}
                onClick={() => setLinesOpen((o) => !o)}
                // From lg the lines always show, as columns; the toggle is for phones.
                className="flex min-h-11 items-center gap-2 rounded-md text-sm text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary lg:hidden"
              >
                <ChevronDown aria-hidden className={cn("size-4 transition-transform", !linesOpen && "-rotate-90")} />
                {linesOpen ? `Hide the ${list.count} ${cardsWord}` : `Show the ${list.count} ${cardsWord}`}
              </button>
              <div id={linesId} className={cn("mt-2", !linesOpen && "hidden lg:block")}>
                {lines}
              </div>
            </div>
          </>
        )}
        {toast}
      </section>
    );
  }

  return (
    // A container: one column in Finish's aside, two where the list has the page's width.
    <section aria-labelledby={headingId} className="@container flex flex-col gap-3">
      <Title id={headingId} className="font-heading text-xl leading-none font-semibold">
        {/* The count alone, as Decklist shows it: the total and its date lead the page this list sits on. */}
        {title} <span className="font-mono text-base font-normal text-muted-foreground">{list.count}</span>
      </Title>

      {scopeToggle && (
        <div role="group" aria-label="Cards to list" className="inline-flex w-fit rounded-lg bg-muted p-0.5">
          {SCOPES.map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={scope === o.value}
              onClick={() => setScope(o.value)}
              className={cn(
                "rounded-md px-4 py-1 text-sm font-normal transition-colors max-sm:min-h-11",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                scope === o.value ? TOGGLE_ON : TOGGLE_OFF,
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}

      {/* Buy at the top, as on the saved deck page (owner, 2026-11-18): the lines can run long. */}
      {actions}

      {list.count === 0 ? <p className="text-sm text-muted-foreground">{emptyText}</p> : lines}
      {cut && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="flex min-h-11 w-fit items-center gap-2 rounded-md text-sm text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <ChevronDown aria-hidden className="size-4" />
          Show all {list.count} {cardsWord}
        </button>
      )}

      {toast}
    </section>
  );
}
