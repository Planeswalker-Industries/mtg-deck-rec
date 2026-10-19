"use client";

import type { DeckId } from "@mtg/core/contract";
import { getApis } from "@/lib/api/client";
import { DeckToggle } from "./deck-toggle";

/**
 * Shows or hides the deck's page: a small "Public" switch, with the full explanation behind its (?).
 *
 * The wording is load-bearing: hiding a deck does **not** take it out of the play-rate aggregates, and the control
 * has to say so rather than let "private" imply more than it delivers. It also says which decks count at all: a
 * complete one (the collator's corpus rule: 100 cards, a legal commander, every card inside its colours).
 */
export function DeckVisibility({ deckId, isPublic }: { deckId: DeckId; isPublic: boolean }) {
  return (
    <DeckToggle
      id="deck-public"
      label="Public"
      checked={isPublic}
      onSave={async (next) => {
        const result = await getApis().actions.setDeckVisibility({ deckId, isPublic: next });
        return result.ok ? null : result.error.message;
      }}
      helpLabel="Who can see this deck"
      helpTitle={(on) => (on ? "Anyone with the link can see this deck" : "Only you can see this deck")}
      help={
        <>
          This controls the deck&rsquo;s page. Either way, once the deck is complete (100 cards, a legal commander, every
          card in its colours), the cards you run count toward how often cards are played with your commander, which is
          what the recommendations are built from.
        </>
      }
    />
  );
}
