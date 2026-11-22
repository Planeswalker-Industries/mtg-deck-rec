import type { Metadata } from "next";
import { Suspense } from "react";
import { DeckTool } from "@/components/deck/deck-tool";
import { BUILD_COMMANDER_PARAM, DECK_START_BUILD, DECK_START_PARAM } from "@/lib/constants";
import { getCommanderPage } from "@/lib/server/recs-cache";

export const metadata: Metadata = {
  title: "Deck tool",
  description: "Paste a Commander decklist to see cards to add, cards to cut, and substitutes.",
  // Pasted decks are ephemeral; indexable content lives on card and commander pages.
  robots: { index: false, follow: true },
};

export default function DeckPage({ searchParams }: PageProps<"/deck">) {
  return (
    // The tool reads ?deck=<code> to open a saved deck, and a search param is request-time data under cacheComponents.
    <Suspense
      fallback={
        <p role="status" className="text-sm text-muted-foreground">
          Loading the deck tool…
        </p>
      }
    >
      <DeckToolEntry searchParams={searchParams} />
    </Suspense>
  );
}

/**
 * `?start=build&commander=<slug>` (a commander page's "Build this Commander") opens the build start with that
 * commander, or both partners of a pair, already picked. The slug is resolved here, from the cached commander page, so
 * the picker opens filled rather than filling in after a client request. An unknown slug leaves the picker empty.
 */
async function DeckToolEntry({ searchParams }: Pick<PageProps<"/deck">, "searchParams">) {
  const params = await searchParams;
  const start = params[DECK_START_PARAM];
  const commander = params[BUILD_COMMANDER_PARAM];
  const page = start === DECK_START_BUILD && typeof commander === "string" ? await getCommanderPage(commander) : null;
  return <DeckTool prefill={page?.key.commanders ?? null} />;
}
