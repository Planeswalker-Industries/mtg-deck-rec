"use client";

import type { DeckId } from "@mtg/core/contract";
import { getApis } from "@/lib/api/client";
import { DeckToggle } from "./deck-toggle";

/** Marks a saved deck's cards as in use by that deck: a small "Built" switch, explained behind its (?). */
export function DeckBuilt({ deckId, isBuilt }: { deckId: DeckId; isBuilt: boolean }) {
  return (
    <DeckToggle
      id="deck-built"
      label="Built"
      checked={isBuilt}
      onSave={async (next) => {
        const result = await getApis().actions.setDeckBuilt({ deckId, isBuilt: next });
        return result.ok ? null : result.error.message;
      }}
      helpLabel="What Built means"
      helpTitle={(on) => (on ? "You've built this deck" : "You haven't built this deck")}
      help={<>When it&apos;s on, this deck&apos;s cards count as in use: other decks won&apos;t be suggested them as free copies.</>}
    />
  );
}
