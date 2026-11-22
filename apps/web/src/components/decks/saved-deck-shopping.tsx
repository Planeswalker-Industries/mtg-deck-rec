"use client";

import { useMemo } from "react";
import type { CardId, CardSummary, DeckId, DeckInput } from "@mtg/core/contract";
import { missingFromCoverage, type ShoppingLine } from "@mtg/core/shop";
import { useCollectionSource } from "@/components/collection/use-collection-source";
import { useDeckCoverage } from "@/components/deck/use-deck-coverage";
import { ShoppingList } from "./shopping-list";
import { useShoppingCart } from "./use-shopping-cart";
import { usePathname } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { formatUsd } from "@/lib/format";
import { SEAL_OUTLINE_BUTTON } from "@/lib/constants";

/** A saved deck has no round. */
const NO_ROUND: readonly CardId[] = [];

/**
 * The saved deck page's shopping list, for whoever is looking (T090). The page is public and server-rendered; the
 * viewer's collection lives in their browser or account, so this reads it here. Its words follow who is looking
 * (owner, 2026-11-21): with a collection (in an account, or in this browser while signed out), the cards it doesn't
 * supply; signed in without one, an invitation to upload it beside buying the whole deck; signed out, the whole deck
 * with the same two buttons. The deck maker's budget never shows here.
 */
export function SavedDeckShopping({
  deckId,
  isOwner,
  commanders,
  cards,
}: {
  deckId: DeckId;
  isOwner: boolean;
  commanders: readonly CardSummary[];
  /** The 99 (or fewer), in the page's order. */
  cards: readonly ShoppingLine[];
}) {
  const { source } = useCollectionSource();
  const entries = useMemo<ShoppingLine[]>(() => [...commanders.map((card) => ({ card, quantity: 1 })), ...cards], [commanders, cards]);
  const deck = useMemo<DeckInput>(
    () => ({
      commanders: commanders.map((c) => c.id),
      cards: [
        ...commanders.map((c) => ({ cardId: c.id, quantity: 1, section: "commander" as const })),
        ...cards.map((l) => ({ cardId: l.card.id, quantity: l.quantity, section: "main" as const })),
      ],
    }),
    [commanders, cards],
  );
  // The owner's own deck doesn't count as holding its cards away from itself.
  const coverage = useDeckCoverage(deck, source, isOwner ? deckId : undefined, true);
  const coverageData = coverage?.status === "ready" ? coverage.data.coverage : null;
  const checking = source.kind === "loading" || coverage?.status === "loading";
  const missing = useMemo(() => (checking ? undefined : coverageData ? missingFromCoverage(coverageData) : null), [checking, coverageData]);
  const cart = useShoppingCart({ entries, missing, roundIds: NO_ROUND, scopeToggle: false, resetKey: deckId });
  const signedIn = source.kind === "account" || ((source.kind === "none" || source.kind === "browser") && source.signedIn);
  // A viewer with a collection whose coverage read failed gets the neutral copy, never "Upload your collection".
  const hasCollection = source.kind === "account" || source.kind === "browser";
  const pathname = usePathname();
  const buyLabel = (totalUsd: number) => `${formatUsd(totalUsd)} on TCGplayer`;
  const upload = (
    <Link href={`/collection/import?next=${encodeURIComponent(pathname)}` as Route} className={SEAL_OUTLINE_BUTTON}>
      Upload
    </Link>
  );
  const copy =
    missing === undefined || (missing === null && hasCollection)
      ? { title: "Shopping list" }
      : missing !== null
        ? { title: "Complete This Deck!", summary: (n: number) => `${n} ${n === 1 ? "card" : "cards"} missing from your collection.` }
        : signedIn
          ? { title: "Build from Collection!", summary: () => "Upload your collection and buy the cards you need.", extraAction: upload }
          : {
              title: "Build this Deck!",
              summary: (n: number) => `Purchase these ${n} ${n === 1 ? "card" : "cards"} or only the ones you need!`,
              extraAction: upload,
            };

  return (
    <div className="sheet p-4 sm:p-6">
      <ShoppingList
        // Neutral while the collection is checked: a visitor without one would otherwise see "missing" flash.
        {...copy}
        buyLabel={buyLabel}
        cart={cart}
        headingLevel={2}
        folded
      />
    </div>
  );
}
