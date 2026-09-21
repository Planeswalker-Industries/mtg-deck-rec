import type { CommanderLegality } from "@mtg/core/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArtBackdrop } from "@/components/cards/art-backdrop";
import { FlippableCardImage } from "@/components/cards/flippable-card-image";
import { PocketGrid, type PocketItem } from "@/components/cards/pocket-grid";
import { GameChangerBadge } from "@/components/deck/card-label";
import { buttonVariants } from "@/components/ui/button";
import { displayName } from "@/lib/cards";
import { describeCostDelta, formatAsOf, formatPercent, formatUsd } from "@/lib/format";
import { emptySwapMessage } from "@/lib/labels";
import { getCardPage } from "@/lib/server/recs-cache";

const LEGALITY: Record<CommanderLegality, string> = {
  legal: "Legal in Commander",
  banned: "Banned in Commander",
  restricted: "Restricted in Commander",
  not_legal: "Not legal in Commander",
};

export async function generateMetadata({ params }: PageProps<"/card/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const page = await getCardPage(slug);
  if (!page) return { title: "Card not found", robots: { index: false, follow: true } };
  const rules = (page.card.faces?.map((f) => f.oracleText).join(" // ") ?? page.card.oracleText ?? "").replace(/\s+/g, " ").trim();
  const summary = rules.length > 140 ? `${rules.slice(0, 139)}…` : rules;
  return {
    title: page.card.name,
    description: `${summary} Cards that do the same job in Commander, and the commanders whose decks run it most.`.trim(),
    alternates: { canonical: `/card/${slug}` },
  };
}

export default function CardPage({ params }: PageProps<"/card/[slug]">) {
  return (
    <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Loading card…</p>}>
      <CardDetails params={params} />
    </Suspense>
  );
}

async function CardDetails({ params }: Pick<PageProps<"/card/[slug]">, "params">) {
  const { slug } = await params;
  const page = await getCardPage(slug);
  if (!page) notFound();

  const { card, alternatives, playedWith, commanderSlug, artist } = page;
  const name = displayName(card);
  const faces = card.faces ?? [{ name: card.name, manaCost: "", typeLine: card.typeLine, oracleText: card.oracleText ?? "" }];
  const priceAsOf = card.price?.asOf ?? alternatives.suggestions.find((s) => s.costDelta.asOf)?.costDelta.asOf ?? null;

  const commanderItems = playedWith.flatMap((entry): PocketItem[] => {
    const [first, partner] = entry.commanders;
    if (!first) return [];
    return [
      {
        card: first,
        href: `/commander/${entry.slug}`,
        caption: (
          <span className="flex flex-col items-start gap-0.5">
            {partner && <span>with {displayName(partner)}</span>}
            <span className="text-muted-foreground tabular-nums">
              In {formatPercent(entry.inclusionRate)} of {entry.deckCount.toLocaleString("en-US")} decks
            </span>
          </span>
        ),
      },
    ];
  });

  return (
    <article className="flex flex-col gap-8">
      <ArtBackdrop art={card.images?.front.artCrop} artist={artist} cardName={name} cardSlug={card.slug}>
      <div className="grid gap-6 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <figure className="mx-auto w-full max-w-72 sm:mx-0">
          <FlippableCardImage card={card} zoomable variant="large" sizes="(min-width: 640px) 288px, 80vw" eager />
        </figure>

        <div className="flex min-w-0 flex-col gap-4">
          <div>
            <h1 className="font-heading text-4xl leading-none font-extrabold tracking-tight text-balance sm:text-5xl">{name}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{card.typeLine}</p>
          </div>

          {faces.map((face) => (
            <div key={face.name} className="rounded-lg border border-seam bg-sleeve p-3">
              {faces.length > 1 && (
                <p className="mb-1 text-sm font-bold">
                  {face.name} <span className="font-normal text-muted-foreground">{face.typeLine}</span>
                </p>
              )}
              <p className="text-sm leading-relaxed whitespace-pre-line">{face.oracleText || "No rules text."}</p>
            </div>
          ))}

          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <li className={card.legalCommander === "legal" ? undefined : "font-bold text-destructive"}>{LEGALITY[card.legalCommander]}</li>
            {card.gameChanger && (
              <li>
                <GameChangerBadge />
              </li>
            )}
            <li className="tabular-nums">{card.price ? `About ${formatUsd(card.price.usd)}` : "No price"}</li>
          </ul>

          {card.tags.length > 0 && (
            <section aria-labelledby="jobs-heading">
              <h2 id="jobs-heading" className="text-sm font-bold">
                What it does
              </h2>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {card.tags.map((tag) => (
                  <li key={tag.id} className="rounded-full bg-sleeve px-2.5 py-0.5 text-xs ring-1 ring-seam">
                    {tag.label}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="flex flex-wrap items-center gap-3 text-sm">
            {commanderSlug && (
              <Link href={`/commander/${commanderSlug}`} className={buttonVariants({ variant: "outline" })}>
                {name} as a commander
              </Link>
            )}
            <a href={card.scryfallUri} className="font-medium text-primary underline underline-offset-2">
              View on Scryfall
            </a>
          </div>
        </div>
      </div>
      </ArtBackdrop>

      <section aria-labelledby="alternatives-heading" className="flex flex-col gap-2">
        <h2 id="alternatives-heading" className="font-heading text-2xl font-extrabold tracking-tight">
          Cards that do the same job
        </h2>
        <p className="max-w-prose text-sm text-muted-foreground">
          In {name}&apos;s colors, best fit first. <Link href="/deck" className="text-primary underline underline-offset-2">Paste your deck</Link> to see
          replacements picked for your commander.
        </p>
        {alternatives.suggestions.length === 0 ? (
          <p className="text-sm">{emptySwapMessage[alternatives.emptyReason ?? "NO_CANDIDATES"]}</p>
        ) : (
          <PocketGrid
            zoomable
            label={`Cards that do the same job as ${name}`}
            items={alternatives.suggestions.map((s) => ({
              card: s.card,
              href: `/card/${s.card.slug}`,
              caption: (
                <span className="flex flex-col items-start gap-0.5">
                  {s.card.gameChanger && <GameChangerBadge />}
                  <span className="text-muted-foreground tabular-nums">{describeCostDelta(s.costDelta)}</span>
                </span>
              ),
            }))}
          />
        )}
      </section>

      {commanderItems.length > 0 && (
        <section aria-labelledby="commanders-heading" className="flex flex-col gap-2">
          <h2 id="commanders-heading" className="font-heading text-2xl font-extrabold tracking-tight">
            Commanders whose decks run it most
          </h2>
          <PocketGrid zoomable label={`Commanders whose decks run ${name}`} items={commanderItems} />
        </section>
      )}

      <footer className="flex max-w-prose flex-col gap-1 text-xs text-muted-foreground">
        {priceAsOf && <p>Prices are Scryfall estimates from {formatAsOf(priceAsOf)}.</p>}
        <p>
          Deck counts come from decks shared publicly on{" "}
          <a href="https://archidekt.com" className="underline underline-offset-2">
            Archidekt
          </a>
          , counted only since the card came out.
        </p>
      </footer>
    </article>
  );
}
