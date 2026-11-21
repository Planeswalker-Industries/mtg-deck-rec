import type { CommanderLegality } from "@mtg/core/contract";
import { swapMatchLabel } from "@mtg/core/scoring";
import { Ban, Check, X } from "lucide-react";
import { cn } from "cn";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FlippableCardImage } from "@/components/cards/flippable-card-image";
import { PocketGrid, type PocketItem } from "@/components/cards/pocket-grid";
import { RulesText } from "@/components/cards/rules-text";
import { GameChangerBadge } from "@/components/deck/card-label";
import { ArtHeader } from "@/components/ui/art-header";
import { buttonVariants } from "@/components/ui/button";
import { displayName } from "@/lib/cards";
import { asOfSuffix, formatPercent, fromPrice } from "@/lib/format";
import { emptySwapMessage } from "@/lib/labels";
import { getCardPage } from "@/lib/server/recs-cache";
import { AFFILIATE_DISCLOSURE, SEAL_BUTTON, TEXT_LINK } from "@/lib/constants";
import { affiliateOn, cardBuyLink, OUTBOUND } from "@/lib/affiliate";
import { PriceLink } from "@/components/cards/price-link";

/** The pip beside the card's name: a status colour, so always an icon and a word ("in Commander" for screen readers). */
const LEGALITY: Record<CommanderLegality, { label: string; icon: typeof Check; good: boolean }> = {
  legal: { label: "Legal", icon: Check, good: true },
  banned: { label: "Banned", icon: Ban, good: false },
  restricted: { label: "Restricted", icon: Ban, good: false },
  not_legal: { label: "Illegal", icon: X, good: false },
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

function LegalityPip({ legality }: { legality: CommanderLegality }) {
  const { label, icon: Icon, good } = LEGALITY[legality];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold",
        good ? "border-success/40 bg-success/10 text-success" : "border-destructive/40 bg-destructive/10 text-destructive",
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      {label}
      <span className="sr-only"> in Commander</span>
    </span>
  );
}

export default function CardPage({ params }: PageProps<"/card/[slug]">) {
  return (
    <Suspense
      fallback={
        <p role="status" className="text-sm text-muted-foreground">
          Loading card…
        </p>
      }
    >
      <CardDetails params={params} />
    </Suspense>
  );
}

async function CardDetails({ params }: Pick<PageProps<"/card/[slug]">, "params">) {
  const { slug } = await params;
  const page = await getCardPage(slug);
  if (!page) notFound();

  const { card, alternatives, playedWith, commanderSlug, artist, tcgplayerProductIds } = page;
  const name = displayName(card);
  const faces = card.faces ?? [{ name: card.name, manaCost: "", typeLine: card.typeLine, oracleText: card.oracleText ?? "" }];

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
            <span className="text-muted-foreground font-mono">{formatPercent(entry.inclusionRate)} inclusion</span>
          </span>
        ),
      },
    ];
  });

  return (
    <article className="flex flex-col gap-5 md:gap-8">
      <ArtHeader
        art={card.images?.front.artCrop}
        credit={artist ? { cardName: name, cardSlug: card.slug, artist } : null}
        labelledBy="card-heading"
        position="object-[center_30%]"
        className="p-4 sm:p-6 lg:p-8"
      >
        {/* From sm the card stands about as tall as the details beside it, so the header has no empty paper under them. */}
        <div className="grid gap-6 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
          <figure className="mx-auto w-full max-w-72 sm:mx-0 sm:max-w-48">
            <FlippableCardImage card={card} zoomable variant="large" sizes="(min-width: 640px) 192px, 80vw" eager />
          </figure>

          <div className="flex min-w-0 flex-col gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 id="card-heading" className="font-heading text-2xl leading-none font-semibold tracking-tight text-balance sm:text-3xl">
                  {name}
                </h1>
                <LegalityPip legality={card.legalCommander} />
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{card.typeLine}</p>
            </div>

            {faces.map((face) => (
              <div key={face.name} className="rounded-lg border border-seam bg-sleeve p-3">
                {faces.length > 1 && (
                  <p className="mb-1 text-sm font-semibold">
                    {face.name} <span className="font-normal text-muted-foreground">{face.typeLine}</span>
                  </p>
                )}
                <p className="text-sm leading-relaxed whitespace-pre-line">
                  {face.oracleText ? <RulesText text={face.oracleText} /> : "No rules text."}
                </p>
              </div>
            ))}

            <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              {card.gameChanger && (
                <li>
                  <GameChangerBadge />
                </li>
              )}
              <li className="flex flex-wrap items-center gap-2">
                {card.price ? (
                  <>
                    <a href={cardBuyLink(card.name, tcgplayerProductIds[card.id])} {...OUTBOUND} className={SEAL_BUTTON}>
                      <span className="font-mono">{fromPrice(card.price)}</span> on TCGplayer
                    </a>
                    <span className="font-mono text-muted-foreground">{asOfSuffix(card.price.asOf)}</span>
                  </>
                ) : (
                  <span className="font-mono">{fromPrice(card.price)}</span>
                )}
              </li>
            </ul>

            {card.tags.length > 0 && (
              <section aria-labelledby="jobs-heading">
                <h2 id="jobs-heading" className="text-sm font-semibold">
                  Oracle tags
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
                <Link href={`/commander/${commanderSlug}`} className={cn(buttonVariants({ variant: "outline" }), "bg-background/70")}>
                  {name} as a commander
                </Link>
              )}
              <a href={card.scryfallUri} className={cn(TEXT_LINK, "inline-flex min-h-11 items-center sm:min-h-0")}>
                View on Scryfall
              </a>
            </div>
          </div>
        </div>
      </ArtHeader>

      <section aria-labelledby="alternatives-heading" className="sheet flex flex-col gap-2 p-4 sm:p-6 lg:p-8">
        <h2 id="alternatives-heading" className="font-heading text-xl font-semibold tracking-tight">
          Similar cards
        </h2>
        {alternatives.suggestions.length === 0 ? (
          <p className="text-sm">{emptySwapMessage[alternatives.emptyReason ?? "NO_CANDIDATES"]}</p>
        ) : (
          <PocketGrid
            zoomable
            label={`Cards similar to ${name}`}
            items={alternatives.suggestions.map((s) => {
              // A looser rung of the swap ladder says which one it is (T088).
              const rungLabel = swapMatchLabel(s, card);
              return {
                card: s.card,
                href: `/card/${s.card.slug}`,
                ...(s.card.gameChanger || rungLabel
                  ? {
                      caption: (
                        <span className="flex flex-col items-start gap-0.5">
                          {s.card.gameChanger && <GameChangerBadge />}
                          {rungLabel && <span className="text-muted-foreground">{rungLabel}</span>}
                        </span>
                      ),
                    }
                  : {}),
                footer: <PriceLink name={s.card.name} price={s.card.price} productId={tcgplayerProductIds[s.card.id]} />,
              };
            })}
          />
        )}
      </section>

      {commanderItems.length > 0 && (
        <section aria-labelledby="commanders-heading" className="sheet flex flex-col gap-2 p-4 sm:p-6 lg:p-8">
          <h2 id="commanders-heading" className="font-heading text-xl font-semibold tracking-tight">
            Popular Commanders for &ldquo;{name}&rdquo;
          </h2>
          <PocketGrid zoomable label={`Commanders whose decks run ${name}`} items={commanderItems} />
        </section>
      )}

      <footer className="sheet flex flex-col gap-1 px-4 py-3 text-xs text-muted-foreground sm:px-6">
        {affiliateOn() && <p>{AFFILIATE_DISCLOSURE}</p>}
        <p>
          Deck counts come from decks shared publicly on{" "}
          <a href="https://archidekt.com" className={TEXT_LINK}>
            Archidekt
          </a>
          , counted only since the card came out.
        </p>
      </footer>
    </article>
  );
}
