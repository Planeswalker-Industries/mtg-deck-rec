import type { Metadata, Route } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { decklistText } from "@mtg/core/parse";
import { PocketGrid } from "@/components/cards/pocket-grid";
import { DeckExport } from "@/components/decks/deck-export";
import { DeckOriginal } from "@/components/decks/deck-original";
import { DeckVisibility } from "@/components/decks/deck-visibility";
import { buttonVariants } from "@/components/ui/button";
import { ColorIdentity } from "@/components/deck/color-identity";
import { createAuthClient, getCurrentUser } from "@/lib/server/auth";
import { deckExportEntries } from "@/lib/server/deck-export";
import { loadDeckPage } from "@/lib/server/deck-page";
import { displayName } from "@/lib/cards";
import { cardCategoryLabel } from "@/lib/labels";

const WUBRG = "WUBRG";

/**
 * A saved deck. The same route serves its owner and everyone else: a private deck 404s for a stranger, so its id
 * cannot be probed. Never indexed — a deck's page is for sharing a link, not for search results, and the names on it
 * are user-written.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function DeckPage({ params }: PageProps<"/decks/[commander]/[code]">) {
  return (
    <Suspense
      fallback={
        <p role="status" className="text-sm text-muted-foreground">
          Loading deck…
        </p>
      }
    >
      <DeckDetails params={params} />
    </Suspense>
  );
}

async function DeckDetails({ params }: Pick<PageProps<"/decks/[commander]/[code]">, "params">) {
  const { code } = await params;
  const user = await getCurrentUser();
  const deck = await loadDeckPage(await createAuthClient(), code, user?.id ?? null);
  if (!deck) notFound();
  // The commander segment is decoration: the code alone resolves the deck, so a stale segment (the deck was
  // renamed to a different commander, or someone hand-edited the URL) still works. Deliberately not redirected to
  // the canonical path — redirect() inside this <Suspense> runs after the shell has streamed, which leaves the
  // visitor on a loading page rather than moving them. The page is noindex, so duplicate paths cost nothing.

  const lead = deck.commanders[0];
  const art = lead?.images?.front.artCrop;
  const identity = [...WUBRG].filter((c) => deck.commanders.some((cmd) => cmd.colorIdentity.includes(c))).join("");

  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          {art && (
            <Image
              src={art}
              alt=""
              width={192}
              height={140}
              unoptimized
              priority
              className="h-20 w-28 shrink-0 rounded-lg object-cover ring-1 ring-seam sm:h-24 sm:w-36"
            />
          )}
          <div className="min-w-0">
            <h1 className="font-heading text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
              {deck.name}
            </h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span>{deck.commanders.map(displayName).join(" and ") || "No commander"}</span>
              <ColorIdentity identity={identity} />
              <span className="tabular-nums">{deck.cardCount} cards</span>
              {deck.bracket !== null && <span>Bracket {deck.bracket}</span>}
            </p>
          </div>
        </div>

        {deck.isOwner && (
          <div className="flex flex-wrap gap-2">
            <Link href={`/decks/${deck.commanderSlug}/${deck.code}/edit` as Route} className={buttonVariants({ size: "sm" })}>
              Edit deck
            </Link>
            <Link href={{ pathname: "/deck", query: { deck: deck.code } }} className={buttonVariants({ size: "sm", variant: "outline" })}>
              Upgrade it
            </Link>
            <Link href="/decks" className={buttonVariants({ variant: "outline", size: "sm" })}>
              All your decks
            </Link>
          </div>
        )}

        <DeckExport text={decklistText(deckExportEntries(deck))} commanderSlug={deck.commanderSlug} code={deck.code} />
      </header>

      {deck.isOwner && <DeckVisibility deckId={deck.id} isPublic={deck.isPublic} />}

      {/* A stranger sees the comparison only while there is one; the owner also sees that a restored deck matches. */}
      {deck.original && (deck.isOwner || deck.original.out.length + deck.original.in.length > 0) && (
        <DeckOriginal deckId={deck.id} name={deck.name} isOwner={deck.isOwner} original={deck.original} />
      )}

      {deck.groups.length === 0 ? (
        <p className="text-muted-foreground">This deck has no cards yet.</p>
      ) : (
        deck.groups.map((group) => (
          <section key={group.category} aria-labelledby={`group-${group.category}`} className="flex flex-col gap-3">
            <h2 id={`group-${group.category}`} className="font-heading text-2xl font-semibold tracking-tight">
              {cardCategoryLabel[group.category]}{" "}
              <span className="font-sans text-base font-normal text-muted-foreground tabular-nums">
                {group.cards.reduce((n, c) => n + c.quantity, 0)}
              </span>
            </h2>
            <PocketGrid
              zoomable
              label={cardCategoryLabel[group.category]}
              items={group.cards.map((entry) => ({
                card: entry.card,
                href: `/card/${entry.card.slug}`,
                caption: entry.quantity > 1 ? <span className="tabular-nums">×{entry.quantity}</span> : undefined,
              }))}
            />
          </section>
        ))
      )}

      {!deck.isOwner && (
        <p className="border-t border-seam pt-4 text-sm text-muted-foreground">
          This deck was shared by someone using MTG Deck Rec.{" "}
          <a
            href={`https://github.com/Planeswalker-Industries/mtg-deck-rec/issues/new?title=${encodeURIComponent(
              `Report deck ${deck.id}`,
            )}&body=${encodeURIComponent(`Deck: ${deck.id}\n\nWhat's wrong with it:`)}`}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Report it
          </a>{" "}
          if the name or contents are abusive.
        </p>
      )}
    </article>
  );
}
