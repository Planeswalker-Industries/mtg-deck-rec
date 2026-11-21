import type { Metadata, Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DeckList } from "@/components/decks/deck-list";
import { createAuthClient } from "@/lib/server/auth";
import { getCurrentUser } from "@/lib/server/auth";
import { listMyDecks } from "@/lib/server/saved-decks";
import { BUILD_DECK_HREF, PAGE_SHEET, SEAL_BUTTON, SEAL_OUTLINE_BUTTON } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Your decks",
  robots: { index: false, follow: false },
};

export default function DecksPage() {
  return (
    <div className="flex flex-col gap-5 md:gap-8">
      <section aria-labelledby="decks-heading" className={`${PAGE_SHEET} sm:flex-row sm:flex-wrap sm:items-end sm:justify-between`}>
        <h1 id="decks-heading" className="font-heading text-2xl leading-none font-semibold tracking-tight">
          Your decks
        </h1>
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

async function SavedDecks() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=/decks");

  const decks = await listMyDecks(await createAuthClient(), user.id);
  if (decks.length === 0) {
    return (
      <div>
        <h2 className="font-heading text-xl leading-tight font-semibold">No decks saved yet.</h2>
        <p className="mt-2 max-w-prose text-muted-foreground">
          Paste a decklist to see what to add, cut and swap, or build one from a commander. Save it and it shows up here.
        </p>
      </div>
    );
  }

  return <DeckList decks={decks} />;
}
