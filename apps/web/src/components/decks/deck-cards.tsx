"use client";

import { useMemo, type ReactNode } from "react";
import type { DeckId } from "@mtg/core/contract";
import { sortCards } from "@mtg/core/journey";
import { CardPlate } from "@/components/cards/card-plate";
import { PocketGrid } from "@/components/cards/pocket-grid";
import { DeckOriginal } from "@/components/decks/deck-original";
import { DeckViewToggle, SortMenu, useCardSort, useDeckView } from "@/components/decks/deck-view";
import type { DeckPageData } from "@/lib/server/deck-page";
import { cardCategoryLabel } from "@/lib/labels";

/**
 * A saved deck's cards: the 99 by type, then the changes from the original when there are any. One toolbar row, as on
 * a built deck: the export icons on the left, the Images/List toggle and the sort on the right; both choices are
 * remembered in this browser. The owner's deck switches (`settings`) get their own row above it.
 */
export function DeckCards({
  deckId,
  name,
  isOwner,
  original,
  groups,
  exportActions,
  settings,
}: {
  deckId: DeckId;
  name: string;
  isOwner: boolean;
  /** Null when the comparison isn't shown. */
  original: DeckPageData["original"];
  groups: DeckPageData["groups"];
  /** Copy and Download, icon only. */
  exportActions: ReactNode;
  /** The owner's switches (Public, Built); nothing for anyone else. */
  settings?: ReactNode;
}) {
  const [view, setView] = useDeckView();
  const [sort, setSort] = useCardSort("deck");
  const sorted = useMemo(
    () => groups.map((group) => ({ ...group, cards: sortCards(group.cards, sort, (entry) => entry.card) })),
    [groups, sort],
  );
  const hasCards = Boolean(original) || groups.length > 0;

  return (
    <>
      {/* The toolbar is a strip of paper of its own; each card type below gets a sheet, as on the commander page. */}
      <div className="sheet flex flex-col px-4 py-1 sm:px-6">
        {settings && <div className="flex flex-wrap items-center gap-x-4">{settings}</div>}
        <div className="flex items-center justify-between gap-2">
          {exportActions}
          {hasCards && (
            <div className="flex items-center gap-1">
              <DeckViewToggle view={view} onChange={setView} className="self-center" />
              <SortMenu sort={sort} onChange={setSort} />
            </div>
          )}
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="sheet p-4 text-muted-foreground sm:p-6">This deck has no cards yet.</p>
      ) : (
        sorted.map((group) => (
          <section key={group.category} aria-labelledby={`group-${group.category}`} className="sheet flex flex-col gap-3 p-4 sm:p-6 lg:p-8">
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

      {original && <DeckOriginal deckId={deckId} name={name} isOwner={isOwner} original={original} view={view} sort={sort} />}
    </>
  );
}
