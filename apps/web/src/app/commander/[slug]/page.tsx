import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { cn } from "cn";
import { ArtHeader } from "@/components/ui/art-header";
import { PocketGrid } from "@/components/cards/pocket-grid";
import { buttonVariants } from "@/components/ui/button";
import { GameChangerBadge } from "@/components/deck/card-label";
import { ColorIdentity } from "@/components/deck/color-identity";
import { displayName } from "@/lib/cards";
import { formatAsOf, formatPercent, fromPrice } from "@/lib/format";
import { cardCategoryLabel, commanderDecksPhrase, fewDecksPhrase, formatDeckCount } from "@/lib/labels";
import { getCommanderPage } from "@/lib/server/recs-cache";
import { TEXT_LINK } from "@/lib/constants";

const WUBRG = "WUBRG";

export async function generateMetadata({ params }: PageProps<"/commander/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const page = await getCommanderPage(slug);
  if (!page) return { title: "Commander not found", robots: { index: false, follow: true } };
  const names = page.key.commanders.map((c) => c.name).join(" and ");
  return {
    title: `${names} decks`,
    description: `The cards ${page.key.deckCount.toLocaleString("en-US")} ${names} Commander decks run most, by card type, and how much ramp, card advantage, removal and protection they play.`,
    alternates: { canonical: `/commander/${slug}` },
  };
}

export default function CommanderPage({ params }: PageProps<"/commander/[slug]">) {
  return (
    <Suspense
      fallback={
        <p role="status" className="text-sm text-muted-foreground">
          Loading commander…
        </p>
      }
    >
      <CommanderDetails params={params} />
    </Suspense>
  );
}

async function CommanderDetails({ params }: Pick<PageProps<"/commander/[slug]">, "params">) {
  const { slug } = await params;
  const page = await getCommanderPage(slug);
  if (!page) notFound();

  const { key, top, roleProfile, computedAt, artists } = page;
  // One Scryfall snapshot prices the page; its date joins the footer's Updated line (no separate price note).
  const priceAsOf = top.groups.flatMap((g) => g.suggestions).find((s) => s.card.price)?.card.price?.asOf ?? null;
  const names = key.commanders.map(displayName).join(" and ");
  const identity = [...WUBRG].filter((color) => key.commanders.some((c) => c.colorIdentity.includes(color))).join("");
  const lead = key.commanders[0];
  const art = lead?.images?.front.artCrop;

  const artist = lead ? artists[lead.id] : null;

  return (
    <article className="flex flex-col gap-5 md:gap-8">
      <ArtHeader
        art={art}
        credit={artist && lead ? { cardName: displayName(lead), cardSlug: lead.slug, artist } : null}
        labelledBy="commander-heading"
        className="p-4 sm:p-6 lg:p-8"
      >
        <div className="flex min-w-0 flex-col gap-6">
          <header className="flex flex-col gap-4">
            <div>
              <h1
                id="commander-heading"
                className="font-heading text-2xl leading-none font-semibold tracking-tight text-balance sm:text-3xl"
              >
                {names}
              </h1>
              <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <ColorIdentity identity={identity} />
                <span>What {commanderDecksPhrase(key)} run</span>
              </p>
            </div>
            {key.confidence !== "full" && (
              <p className="max-w-prose text-sm">{fewDecksPhrase(key)}, so these rankings can still shift as more decks come in.</p>
            )}
            <div className="flex flex-wrap gap-2">
              {/* Pair names run long, so the label wraps instead of running off a phone screen. */}
              <Link
                href="/deck"
                className={cn(buttonVariants({ size: "lg" }), "lit h-auto min-h-9 max-w-full py-2 text-center whitespace-normal")}
              >
                Upgrade your {names} deck
              </Link>
              <Link
                href={`/rate?commander=${key.slug ?? slug}` as Route}
                className={cn(
                  buttonVariants({ size: "lg", variant: "outline" }),
                  "h-auto min-h-9 max-w-full bg-background/70 py-2 text-center whitespace-normal",
                )}
              >
                Rate cards for this commander
              </Link>
            </div>
          </header>

          {roleProfile.length > 0 && (
            <section aria-labelledby="roles-heading" className="flex flex-col gap-3 border-t border-seam pt-5">
              <h2 id="roles-heading" className="font-heading text-xl font-semibold tracking-tight">
                In a typical deck
              </h2>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {roleProfile.map(({ tag, avgPerDeck }) => (
                  <div key={tag.id} className="rounded-lg border border-seam bg-sleeve px-3 py-2">
                    <dt className="text-sm text-muted-foreground">{tag.label}</dt>
                    <dd className="font-mono text-2xl">{avgPerDeck}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>
      </ArtHeader>

      {/* One sheet per card type, so a long page reads as a stack of papers. */}
      {top.groups.map((group) => (
        <section key={group.category} aria-labelledby={`top-${group.category}`} className="sheet flex flex-col gap-2 p-4 sm:p-6 lg:p-8">
          <h2 id={`top-${group.category}`} className="font-heading text-xl font-semibold tracking-tight">
            {cardCategoryLabel[group.category]}
          </h2>
          <PocketGrid
            zoomable
            label={`Most played ${cardCategoryLabel[group.category].toLowerCase()}`}
            items={group.suggestions.map((s) => ({
              card: s.card,
              caption: (
                <span className="flex flex-col items-start gap-0.5">
                  {s.card.gameChanger && <GameChangerBadge />}
                  {s.corpus && <span className="text-muted-foreground font-mono">In {formatPercent(s.corpus.inclusionRate)} of decks</span>}
                  <span className="text-muted-foreground font-mono">{fromPrice(s.card.price)}</span>
                </span>
              ),
            }))}
          />
        </section>
      ))}

      <footer className="sheet flex flex-col gap-1 px-4 py-3 text-xs text-muted-foreground sm:px-6">
        <p>
          Based on {formatDeckCount(key.deckCount + (key.borrowedDeckCount ?? 0))} shared publicly on{" "}
          <a href="https://archidekt.com" className={TEXT_LINK}>
            Archidekt
          </a>
          , counted only since each card came out. Updated {formatAsOf(computedAt)}
          {priceAsOf && `, prices ${formatAsOf(priceAsOf)}`}.
        </p>
      </footer>
    </article>
  );
}
