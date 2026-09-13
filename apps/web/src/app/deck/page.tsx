import type { Metadata } from "next";
import { DeckTool } from "@/components/deck/deck-tool";

export const metadata: Metadata = {
  title: "Deck tool",
  description: "Paste a Commander decklist to see cards to add, cards to cut, and substitutes.",
  // Pasted decks are ephemeral; indexable content lives on card and commander pages.
  robots: { index: false, follow: true },
};

export default function DeckPage() {
  return <DeckTool />;
}
