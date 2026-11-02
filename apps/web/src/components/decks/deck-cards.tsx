"use client";

import type { DeckId } from "@mtg/core/contract";
import { CardPlate } from "@/components/cards/card-plate";
import { PocketGrid } from "@/components/cards/pocket-grid";
import { DeckOriginal } from "@/components/decks/deck-original";
import { DeckViewToggle, useDeckView } from "@/components/decks/deck-view";
import type { DeckPageData } from "@/lib/server/deck-page";
import { cardCategoryLabel } from "@/lib/labels";

/**
 * A saved deck's cards: the changes from the original when there are any, then the 99 by type. One toggle shows them
 * all as whole card images or as plates, and the choice is remembered in this browser.
 */
export function DeckCards({
  deckId,
  name,
  isOwner,
  original,
  groups,
}: {
  deckId: DeckId;
  name: string;
  isOwner: boolean;
  /** Null when the comparison isn't shown. */
  original: DeckPageData["original"];
  groups: DeckPageData["groups"];
}) {
  const [view, setView] = useDeckView();

  return (
    <>
      {(original || groups.length > 0) && <DeckViewToggle view={view} onChange={setView} />}

      {original && <DeckOriginal deckId={deckId} name={name} isOwner={isOwner} original={original} view={view} />}

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
    </>
  );
}
