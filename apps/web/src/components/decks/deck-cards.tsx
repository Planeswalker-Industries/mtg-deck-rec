"use client";

import type { ReactNode } from "react";
import type { DeckId } from "@mtg/core/contract";
import { CardPlate } from "@/components/cards/card-plate";
import { PocketGrid } from "@/components/cards/pocket-grid";
import { DeckOriginal } from "@/components/decks/deck-original";
import { DeckViewToggle, useDeckView } from "@/components/decks/deck-view";
import type { DeckPageData } from "@/lib/server/deck-page";
import { cardCategoryLabel } from "@/lib/labels";

/**
 * A saved deck's cards: the 99 by type, then the changes from the original when there are any. One toggle shows them
 * all as whole card images or as plates, and the choice is remembered in this browser. The owner's deck switches
 * (`settings`) share its row, on the left.
 */
export function DeckCards({
  deckId,
  name,
  isOwner,
  original,
  groups,
  settings,
}: {
  deckId: DeckId;
  name: string;
  isOwner: boolean;
  /** Null when the comparison isn't shown. */
  original: DeckPageData["original"];
  groups: DeckPageData["groups"];
  /** The owner's switches (Public, Built); nothing for anyone else. */
  settings?: ReactNode;
}) {
  const [view, setView] = useDeckView();

  return (
    <>
      {(settings || original || groups.length > 0) && (
        <div className="-my-2 flex flex-wrap items-center justify-between gap-x-2">
          {settings && <div className="flex flex-wrap items-center gap-x-2">{settings}</div>}
          {(original || groups.length > 0) && <DeckViewToggle view={view} onChange={setView} className="ml-auto self-center" compact={Boolean(settings)} />}
        </div>
      )}

      {groups.length === 0 ? (
        <p className="text-muted-foreground">This deck has no cards yet.</p>
      ) : (
        groups.map((group) => (
          <section key={group.category} aria-labelledby={`group-${group.category}`} className="flex flex-col gap-3">
            <h2 id={`group-${group.category}`} className="font-heading text-xl font-semibold tracking-tight">
              {cardCategoryLabel[group.category]}{" "}
              <span className="text-base font-normal text-muted-foreground font-mono">
                {group.cards.reduce((n, c) => n + c.quantity, 0)}
              </span>
            </h2>
            {view === "plates" ? (
              <ul aria-label={cardCategoryLabel[group.category]} className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {group.cards.map(({ card, quantity }) => (
                  <CardPlate key={card.id} card={card} quantity={quantity} />
                ))}
              </ul>
            ) : (
              <PocketGrid
                zoomable
                label={cardCategoryLabel[group.category]}
                items={group.cards.map((entry) => ({
                  card: entry.card,
                  href: `/card/${entry.card.slug}`,
                  caption: entry.quantity > 1 ? <span className="font-mono">×{entry.quantity}</span> : undefined,
                }))}
              />
            )}
          </section>
        ))
      )}

      {original && <DeckOriginal deckId={deckId} name={name} isOwner={isOwner} original={original} view={view} />}
    </>
  );
}
