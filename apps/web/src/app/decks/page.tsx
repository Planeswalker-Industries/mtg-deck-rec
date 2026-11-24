import type { Metadata, Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, cache } from "react";
import { DeckList } from "@/components/decks/deck-list";
import { CARD_BACK_SRC, DeckStack } from "@/components/decks/deck-tile";
import { createAuthClient, getCurrentUser } from "@/lib/server/auth";
import { listMyDecks } from "@/lib/server/saved-decks";
import { BUILD_DECK_HREF, PAGE_SHEET, SEAL_BUTTON, SEAL_OUTLINE_BUTTON } from "@/lib/constants";

export const metadata: Metadata = {
  title: "My decks",
  robots: { index: false, follow: false },
};

/** The signed-in player's decks, read once per request: the heading's count and the list share it. Null when signed out. */
const loadMyDecks = cache(async () => {
  const user = await getCurrentUser();
  if (!user) return null;
  return listMyDecks(await createAuthClient(), user.id);
});

export default function DecksPage() {
  return (
    <div className="flex flex-col gap-5 md:gap-8">
      <section aria-labelledby="decks-heading" className={`${PAGE_SHEET} sm:flex-row sm:flex-wrap sm:items-center sm:justify-between`}>
        <div className="flex items-baseline gap-3">
          <h1 id="decks-heading" className="font-heading text-2xl leading-none font-semibold tracking-tight">
            My decks
          </h1>
          <Suspense fallback={null}>
            <DeckCount />
          </Suspense>
        </div>
        {/* The two ways to a new deck, side by side: bring a list, or start from a commander. */}
        <div className="flex flex-wrap gap-2">
          <Link href="/deck" className={SEAL_OUTLINE_BUTTON}>
            Paste a decklist
          </Link>
          <Link href={BUILD_DECK_HREF as Route} className={SEAL_BUTTON}>
            Build a deck
          </Link>
        </div>
      </section>
      <section aria-label="Saved decks" className={PAGE_SHEET}>
        <Suspense
          fallback={
            <p role="status" className="text-sm text-muted-foreground">
              Loading your decks…
            </p>
          }
        >
          <SavedDecks />
        </Suspense>
      </section>
    </div>
  );
}

async function DeckCount() {
  const decks = await loadMyDecks();
  if (!decks || decks.length === 0) return null;
  return (
    <p className="text-muted-foreground">
      <span className="font-mono">{decks.length}</span> {decks.length === 1 ? "deck" : "decks"}
    </p>
  );
}

async function SavedDecks() {
  const decks = await loadMyDecks();
  if (!decks) redirect("/sign-in?next=/decks");

  if (decks.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
        {/* An empty stack, the card back where a commander would lean: what a saved deck will look like here. */}
        <DeckStack cardSrc={CARD_BACK_SRC} className="w-40 shrink-0 opacity-70 grayscale" />
        <div>
          <h2 className="font-heading text-xl leading-tight font-semibold">No decks saved yet.</h2>
          <p className="mt-2 max-w-prose text-muted-foreground">
            Paste a decklist to see what to add, cut and swap, or build one from a commander. Save it and it shows up here.
          </p>
        </div>
      </div>
    );
  }

  return <DeckList decks={decks} />;
}
