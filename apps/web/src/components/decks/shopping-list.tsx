"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { CardId } from "@mtg/core/contract";
import { shoppingList, type ShoppingLine } from "@mtg/core/shop";
import { cn } from "cn";
import { CardPlate } from "@/components/cards/card-plate";
import { buttonVariants } from "@/components/ui/button";
import { affiliateOn, cartLinks, OUTBOUND } from "@/lib/affiliate";
import { displayName } from "@/lib/cards";
import { AFFILIATE_DISCLOSURE, PHONE_HIT_AREA, REMOVE_ARM_MS, SHOPPING_UNDO_MS, TEXT_LINK, TOGGLE_OFF, TOGGLE_ON } from "@/lib/constants";
import { formatAsOf, formatUsd, fromPrice } from "@/lib/format";
import { cardCategoryLabel } from "@/lib/labels";

/** A phone (or any touch screen) gets the two-tap remove; a mouse gets one click. */
const COARSE_POINTER_QUERY = "(pointer: coarse)";

/** Nothing to subscribe to: `useSyncExternalStore` only tells the server render from the client one here. */
const subscribeNothing = () => () => {};

type Scope = "round" | "deck";

const SCOPES: { value: Scope; label: string }[] = [
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
 * Copy decklist at the top, so the list has no copy button of its own (owner, 2026-11-15). With a collection the
 * lines are the copies it doesn't supply; without one, `scopeToggle` offers this round's cards or the whole deck. Removing
 * a line is for this view only (Undo brings it back) and never touches the collection.
 */
export function ShoppingList({
  title = "Shopping list",
  entries,
  missing,
  roundIds,
  scopeToggle,
  pinActions = false,
  headingLevel = 3,
}: {
  title?: string;
  /** The title's heading level: 3 inside Finish, 2 where the list is one of the page's own sections. */
  headingLevel?: 2 | 3;
  /** The deck as it stands, commanders included. */
  entries: readonly ShoppingLine[];
  /** Copies the collection doesn't supply; null without a collection; undefined while it is being checked. */
  missing: ReadonlyMap<CardId, number> | null | undefined;
  /** Cards the round put in, best first; empty where there is no round. */
  roundIds: readonly CardId[];
  /** Offer "This round's cards | Whole deck" (only without a collection). */
  scopeToggle: boolean;
  /** Keep Buy and the price note at the foot of a scrolling container (Finish's aside from xl). */
  pinActions?: boolean;
}) {
  const coarse = useCoarsePointer();
  // A round that put nothing in has nothing to buy in round scope, so the whole deck is the useful default there.
  const [scope, setScope] = useState<Scope>(roundIds.length > 0 ? "round" : "deck");
  const [removed, setRemoved] = useState<CardId[]>([]);
  const [undoShown, setUndoShown] = useState(false);
  // True once hydrated: the toast portals into <body>, which the server render has no access to.
  const mounted = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
  const headingId = useId();
  // Keyed on content, so a parent that builds a fresh array each render doesn't rebuild the list.
  const roundKey = roundIds.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableRoundIds = useMemo(() => roundIds, [roundKey]);

  useEffect(() => {
    if (!undoShown) return;
    const timer = window.setTimeout(() => setUndoShown(false), SHOPPING_UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [undoShown, removed]);

  const list = useMemo(() => {
    const gone = new Set(removed);
    return shoppingList({
      entries: entries.filter((e) => !gone.has(e.card.id)),
      missing: missing ?? null,
      roundIds: stableRoundIds,
      scope: scopeToggle ? scope : "deck",
    });
  }, [entries, missing, stableRoundIds, scope, scopeToggle, removed]);
  const carts = useMemo(
    () => cartLinks(list.groups.flatMap((g) => g.lines).map((l) => ({ name: l.card.name, quantity: l.quantity }))),
    [list],
  );
  const Title = headingLevel === 2 ? "h2" : "h3";
  const GroupTitle = headingLevel === 2 ? "h3" : "h4";

  if (missing === undefined) {
    return (
      <section aria-label={title} className="flex flex-col gap-2">
        <Title className="font-heading text-xl leading-none font-semibold">{title}</Title>
        <p role="status" className="text-sm text-muted-foreground">
          Checking your collection…
        </p>
      </section>
    );
  }

  const lastRemoved = removed.length > 0 ? entries.find((e) => e.card.id === removed[removed.length - 1]) : undefined;
  const remove = (id: CardId) => {
    setRemoved((r) => [...r, id]);
    setUndoShown(true);
  };
  const undo = () => {
    setRemoved((r) => r.slice(0, -1));
    setUndoShown(false);
  };

  return (
    // A container: one column in Finish's aside, two where the list has the page's width.
    <section aria-labelledby={headingId} className="@container flex flex-col gap-3">
      <Title id={headingId} className="font-heading text-xl leading-none font-semibold">
        {title}{" "}
        <span className="font-mono text-base font-normal text-muted-foreground">
          · {list.count} {list.count === 1 ? "card" : "cards"} ~{formatUsd(list.totalUsd)}
        </span>
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

      {list.count === 0 ? (
        <p className="text-sm text-muted-foreground">
          {removed.length > 0
            ? "You removed every card."
            : missing
              ? "Your collection has every card."
              : scopeToggle && scope === "round"
                ? "This round put in no cards to buy."
                : "Nothing to buy."}
        </p>
      ) : (
        <div className="columns-1 gap-6 @xl:columns-2">
          {list.groups.map((group) => (
            <section key={group.category} aria-label={cardCategoryLabel[group.category]} className="mb-4 break-inside-avoid">
              <GroupTitle className="mb-2 text-sm font-semibold text-muted-foreground">
                {cardCategoryLabel[group.category]}{" "}
                <span className="font-mono font-normal">{group.lines.reduce((n, l) => n + l.quantity, 0)}</span>
              </GroupTitle>
              <ul aria-label={`${cardCategoryLabel[group.category]} to buy`} className="flex flex-col gap-1.5">
                {group.lines.map(({ card, quantity }) => (
                  <CardPlate
                    key={card.id}
                    card={card}
                    quantity={quantity}
                    showCost={false}
                    onSwipeAway={() => remove(card.id)}
                    trailing={
                      <>
                        <span className="px-1 font-mono text-xs whitespace-nowrap text-muted-foreground">{fromPrice(card.price)}</span>
                        <RemoveButton name={displayName(card)} coarse={coarse} onRemove={() => remove(card.id)} />
                      </>
                    }
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/*
        A toast over the page, above the docked Deck stats footer, so it shows wherever in a long list the line was.
        Portalled to <body>: this section is a size container, which would otherwise be the toast's containing block.
        The live region stays mounted so a screen reader announces each new message.
      */}
      {mounted &&
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
        )}

      {/* In Finish's aside (a scroll box from xl) Buy stays in view at its foot while the lines scroll. */}
      <div className={cn("flex flex-col gap-3", pinActions && "xl:sticky xl:bottom-0 xl:bg-background xl:pt-2 xl:pb-1")}>
        {/* A named primary action (owner, 2026-11-15): the solid blue button. */}
        <div className="flex flex-wrap items-center gap-2">
          {carts.length === 0 || list.count === 0 ? (
            <span aria-disabled className={cn(buttonVariants({ size: "lg" }), "pointer-events-none opacity-50")}>
              Buy on TCGplayer
            </span>
          ) : (
            carts.map((href, i) => (
              <a key={href} href={href} {...OUTBOUND} className={cn(buttonVariants({ size: "lg" }), "lit")}>
                {carts.length > 1 ? `Buy on TCGplayer (${i + 1} of ${carts.length})` : "Buy on TCGplayer"}
              </a>
            ))
          )}
        </div>

        <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {list.asOf && (
            <p>
              Scryfall prices, {formatAsOf(list.asOf)}. TCGplayer shows the final price.
              {list.unpriced > 0 && ` ${list.unpriced} unpriced.`}
            </p>
          )}
          {!list.asOf && list.unpriced > 0 && <p>{list.unpriced} unpriced. TCGplayer shows the final price.</p>}
          {affiliateOn() && <p>{AFFILIATE_DISCLOSURE}</p>}
        </div>
      </div>
    </section>
  );
}
