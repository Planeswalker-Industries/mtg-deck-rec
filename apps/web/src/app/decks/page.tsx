import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DeckList } from "@/components/decks/deck-list";
import { buttonVariants } from "@/components/ui/button";
import { createAuthClient } from "@/lib/server/auth";
import { getCurrentUser } from "@/lib/server/auth";
import { listMyDecks } from "@/lib/server/saved-decks";

export const metadata: Metadata = {
  title: "Your decks",
  robots: { index: false, follow: false },
};

export default function DecksPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-heading text-4xl leading-none font-semibold tracking-tight">Your decks</h1>
        <Link href="/deck" className={buttonVariants({ className: "h-10 px-4" })}>
          Build a deck
        </Link>
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
        <h2 className="font-heading text-2xl leading-tight font-semibold">No decks saved yet.</h2>
        <p className="mt-2 max-w-prose text-muted-foreground">
          Paste a decklist, see what to cut, add and replace, then save it here to come back to.
        </p>
        <Link href="/deck" className={buttonVariants({ className: "mt-4 h-10 px-4" })}>
          Paste a decklist
        </Link>
      </div>
    );
  }

  return <DeckList decks={decks} />;
}
