import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { decklistText } from "@mtg/core/parse";
import { cn } from "cn";
import { DeckCards } from "@/components/decks/deck-cards";
import { DeckExport } from "@/components/decks/deck-export";
import { DeckBuilt } from "@/components/decks/deck-built";
import { DeckVisibility } from "@/components/decks/deck-visibility";
import { SavedDeckShopping } from "@/components/decks/saved-deck-shopping";
import { ArtPortraitHeader } from "@/components/ui/art-portrait-header";
import { buttonVariants } from "@/components/ui/button";
import { ColorIdentity } from "@/components/deck/color-identity";
import { createAuthClient, getCurrentUser } from "@/lib/server/auth";
import { deckExportEntries } from "@/lib/server/deck-export";
import { loadDeckPage } from "@/lib/server/deck-page";
import { createPublicClient } from "@/lib/server/supabase";
import { deckShareText } from "@/lib/deck-share";
import { shareMetadata } from "@/lib/share-metadata";
import { displayName } from "@/lib/cards";
import { TEXT_LINK } from "@/lib/constants";
import { feedbackHref } from "@/lib/feedback";

const WUBRG = "WUBRG";

/**
 * Never indexed — a deck's page is for sharing a link, not for search results, and the names on it are user-written.
 */
const ROBOTS: Metadata["robots"] = { index: false, follow: false };

/**
 * A saved deck. The same route serves its owner and everyone else: a private deck 404s for a stranger, so its id
 * cannot be probed. The link preview reads the deck as a stranger (no viewer), so a private deck's name never reaches
 * its head, even for its owner.
 */
export async function generateMetadata({ params }: PageProps<"/decks/[commander]/[code]">): Promise<Metadata> {
  const { code } = await params;
  const deck = await loadDeckPage(createPublicClient(), code, null);
  if (!deck) return { robots: ROBOTS };
  const { title, description } = deckShareText(deck);
  const lead = deck.commanders[0];
  const art = lead?.images?.front.artCrop;
  return {
    robots: ROBOTS,
    title,
    description,
    ...shareMetadata({ title, description, image: art && lead ? { url: art, alt: `${displayName(lead)} art` } : undefined }),
  };
}

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

  const identity = [...WUBRG].filter((c) => deck.commanders.some((cmd) => cmd.colorIdentity.includes(c))).join("");

  const lead = deck.commanders[0];
  const art = lead?.images?.front.artCrop;
  const artist = lead ? deck.artists[lead.id] : null;

  return (
    <article className="flex flex-col gap-5 md:gap-8">
      <ArtPortraitHeader
        art={art}
        credit={artist && lead ? { cardName: displayName(lead), cardSlug: lead.slug, artist } : null}
        labelledBy="deck-heading"
      >
        <header className="flex min-w-0 flex-col gap-4">
          <div>
            <h1 id="deck-heading" className="font-heading text-2xl leading-tight font-semibold tracking-tight text-balance sm:text-3xl">
              {deck.name}
            </h1>
            {/* Lining figures and a shared baseline: the body face's old-style "3" otherwise sits below the mono count. */}
            <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-muted-foreground lining-nums">
              <span>{deck.commanders.map(displayName).join(" and ") || "No commander"}</span>
              <ColorIdentity identity={identity} className="self-center" />
              <span className="font-mono">{deck.cardCount} cards</span>
              {deck.bracket !== null && <span>Bracket {deck.bracket}</span>}
            </p>
          </div>

          {deck.isOwner && (
            <div className="flex flex-wrap gap-2">
              <Link href={`/decks/${deck.commanderSlug}/${deck.code}/edit` as Route} className={cn(buttonVariants({ size: "sm" }), "lit")}>
                Edit
              </Link>
              <Link
                href={{ pathname: "/deck", query: { deck: deck.code } }}
                className={cn(buttonVariants({ size: "sm", variant: "outline" }), "bg-background/70")}
              >
                Upgrade
              </Link>
            </div>
          )}
        </header>
      </ArtPortraitHeader>

      {/* Buying sits in the first viewport (owner, 2026-11-16): the lines fold away under it. */}
      <SavedDeckShopping
        deckId={deck.id}
        isOwner={deck.isOwner}
        commanders={deck.commanders}
        cards={deck.groups.flatMap((g) => g.cards.map(({ card, quantity }) => ({ card, quantity })))}
      />

      <DeckCards
        deckId={deck.id}
        name={deck.name}
        isOwner={deck.isOwner}
        // A stranger sees the comparison only while there is one; the owner also sees that a restored deck matches.
        original={deck.original && (deck.isOwner || deck.original.out.length + deck.original.in.length > 0) ? deck.original : null}
        groups={deck.groups}
        exportActions={
          <DeckExport text={decklistText(deckExportEntries(deck))} commanderSlug={deck.commanderSlug} code={deck.code} iconOnly />
        }
        settings={
          deck.isOwner && (
            <>
              <DeckVisibility deckId={deck.id} isPublic={deck.isPublic} />
              <DeckBuilt deckId={deck.id} isBuilt={deck.isBuilt} />
            </>
          )
        }
      />

      {!deck.isOwner && (
        <p className="sheet px-4 py-3 text-sm text-muted-foreground sm:px-6">
          This deck was shared by someone using Spell Chasm.{" "}
          <Link href={feedbackHref(`/decks/${deck.commanderSlug}/${deck.code}`)} className={TEXT_LINK}>
            Report it
          </Link>{" "}
          if the name or contents are abusive.
        </p>
      )}
    </article>
  );
}
