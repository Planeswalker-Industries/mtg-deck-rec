import type { Metadata } from "next";
import { Suspense } from "react";
import { DeckTool } from "@/components/deck/deck-tool";

export const metadata: Metadata = {
  title: "Deck tool",
  description: "Paste a Commander decklist to see cards to add, cards to cut, and substitutes.",
  // Pasted decks are ephemeral; indexable content lives on card and commander pages.
  robots: { index: false, follow: true },
};

export default function DeckPage() {
  return (
    // The tool reads ?deck=<code> to open a saved deck, and a search param is request-time data under cacheComponents.
    <Suspense
      fallback={
        <p role="status" className="text-sm text-muted-foreground">
          Loading the deck tool…
        </p>
      }
    >
      <DeckTool />
    </Suspense>
  );
}
