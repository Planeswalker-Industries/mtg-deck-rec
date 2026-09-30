import type { Metadata, Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DeckList } from "@/components/decks/deck-list";
import { buttonVariants } from "@/components/ui/button";
import { createAuthClient } from "@/lib/server/auth";
import { getCurrentUser } from "@/lib/server/auth";
import { listMyDecks } from "@/lib/server/saved-decks";
import { BUILD_DECK_HREF } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Your decks",
  robots: { index: false, follow: false },
};

export default function DecksPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-heading text-2xl leading-none font-semibold tracking-tight">Your decks</h1>
        {/* The two ways to a new deck, side by side: bring a list, or start from a commander. */}
        <div className="flex flex-wrap gap-2">
          <Link href="/deck" className={buttonVariants({ variant: "outline", className: "h-10 px-4" })}>
            Paste a decklist
          </Link>
          <Link href={BUILD_DECK_HREF as Route} className={buttonVariants({ className: "h-10 px-4" })}>
            Build a deck
          </Link>
        </div>
      </div>
      <Suspense
        fallback={
          <p role="status" className="text-sm text-muted-foreground">
            Loading your decks…
          </p>
        }
      >
        <SavedDecks />
      </Suspense>
    </div>
  );
}

async function SavedDecks() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=/decks");

  const decks = await listMyDecks(await createAuthClient(), user.id);
  if (decks.length === 0) {
    return (
      <div className="rounded-xl border border-seam bg-sleeve/60 p-6">
        <h2 className="font-heading text-xl leading-tight font-semibold">No decks saved yet.</h2>
        <p className="mt-2 max-w-prose text-muted-foreground">
          Paste a decklist to see what to cut, add and replace, or build one from a commander. Save it and it shows up here.
        </p>
      </div>
    );
  }

  return <DeckList decks={decks} />;
}
