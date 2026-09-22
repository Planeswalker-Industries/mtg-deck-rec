import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SavedDeckEditor } from "@/components/deckbuilder/saved-deck-editor";
import { createAuthClient, getCurrentUser } from "@/lib/server/auth";
import { loadDeckForEdit } from "@/lib/server/saved-decks";

/**
 * The deckbuilder for one of the signed-in player's saved decks. Owner-only: anyone else, and a deck that doesn't
 * exist, get the not-found page. Signed-out visitors never reach it; proxy.ts sends them to sign in first, because a
 * redirect from inside this page's <Suspense> would leave them on a loading page.
 */
export const metadata: Metadata = {
  title: "Edit deck",
  robots: { index: false, follow: false },
};

export default function EditDeckPage({ params }: PageProps<"/decks/[commander]/[code]/edit">) {
  return (
    <Suspense
      fallback={
        <p role="status" className="text-sm text-muted-foreground">
          Loading deck…
        </p>
      }
    >
      <Editor params={params} />
    </Suspense>
  );
}

async function Editor({ params }: Pick<PageProps<"/decks/[commander]/[code]/edit">, "params">) {
  const { commander, code } = await params;
  const user = await getCurrentUser();
  if (!user) notFound();
  const deck = await loadDeckForEdit(await createAuthClient(), code, user.id);
  if (!deck) notFound();
  const lead = deck.deck.commanders[0];
  const commanderSlug = deck.cards.find((c) => c.id === lead)?.slug ?? commander;

  return (
    <SavedDeckEditor
      deckId={deck.deckId}
      code={deck.code}
      commanderSlug={commanderSlug}
      name={deck.name}
      bracket={deck.bracket}
      deck={deck.deck}
      cards={deck.cards}
    />
  );
}
